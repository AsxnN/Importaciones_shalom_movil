import { supabase } from '../lib/supabase';
import { FichaTagRFID, PaletaBodegaItem, ReglaEmpaque, TipoPaleta } from '../types';

/**
 * Consulta la información completa de una etiqueta RFID en Supabase:
 * - Producto asociado (SKU, nombre, categoría, regla de empaque)
 * - Tipo de carga de la paleta (Paleta Completa o Pucho)
 * - Cantidad contenida en este tag específico (cajas y unidades)
 * - Almacén actual en el que reside
 * - Stock consolidado del producto en ese almacén
 * - Orden de importación de procedencia (si está registrada en recepcion_lectura)
 */
export async function consultarTagRfidEnSupabase(
  uid: string
): Promise<FichaTagRFID> {
  const cleanUid = uid.trim().toUpperCase();

  if (!cleanUid) {
    return {
      encontrado: false,
      uid_tag: '',
      mensaje_error: 'Debe ingresar o escanear un UID de etiqueta válido.',
    };
  }

  try {
    // 1. Buscar en la tabla etiqueta_rfid
    const { data: tag, error: errTag } = await supabase
      .from('etiqueta_rfid')
      .select(`
        id_etiqueta,
        uid_tag,
        tipo_paleta,
        cantidad_paquetes,
        cantidad_actual,
        estado,
        id_almacen_actual,
        id_producto,
        producto:id_producto (
          id_producto,
          sku,
          nombre,
          descripcion,
          unidad_medida,
          clasificacion_abc,
          categoria:id_categoria (
            nombre
          ),
          regla_empaque (
            unidades_por_caja,
            cajas_por_camada,
            numero_camadas,
            cajas_por_camita,
            camitas_por_paleta
          )
        ),
        almacen:id_almacen_actual (
          id_almacen,
          nombre,
          tipo
        )
      `)
      .ilike('uid_tag', cleanUid)
      .maybeSingle();

    if (errTag) {
      console.warn('[STOCK] Error consultando etiqueta_rfid:', errTag.message);
    }

    // 2. Si no se encontró en etiqueta_rfid, verificar en recepcion_lectura por si fue recepcionado
    let tagFinal = tag;
    let sesionInfo: any = null;

    const { data: lectura } = await supabase
      .from('recepcion_lectura')
      .select(`
        id_lectura,
        uid_tag,
        tipo_carga,
        cantidad_paquetes,
        cantidad_unidades,
        id_etiqueta,
        id_sesion,
        sesion_recepcion:id_sesion (
          id_sesion,
          id_producto,
          id_almacen,
          id_orden,
          fecha_finalizacion,
          orden_importacion:id_orden (
            numero_orden
          ),
          producto:id_producto (
            id_producto,
            sku,
            nombre,
            descripcion,
            unidad_medida,
            clasificacion_abc,
            regla_empaque (
              unidades_por_caja,
              cajas_por_camada,
              numero_camadas,
              cajas_por_camita,
              camitas_por_paleta
            )
          ),
          almacen:id_almacen (
            id_almacen,
            nombre,
            tipo
          )
        )
      `)
      .ilike('uid_tag', cleanUid)
      .order('id_lectura', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lectura) {
      sesionInfo = lectura.sesion_recepcion;
    }

    if (!tagFinal && !lectura) {
      return {
        encontrado: false,
        uid_tag: cleanUid,
        mensaje_error: `La etiqueta RFID con UID "${cleanUid}" no se encuentra registrada en el sistema. Asegúrese de haberla enrolado en el Módulo 3 de Recepción.`,
      };
    }

    // Extracción normalizada de producto
    const rawProd = tagFinal?.producto ?? sesionInfo?.producto;
    const rawRegla = Array.isArray(rawProd?.regla_empaque)
      ? rawProd?.regla_empaque[0]
      : rawProd?.regla_empaque;

    const uCaja = rawRegla?.unidades_por_caja ?? 10;
    const cCamada = rawRegla?.cajas_por_camada ?? rawRegla?.cajas_por_camita ?? 30;
    const nCamadas = rawRegla?.numero_camadas ?? rawRegla?.camitas_por_paleta ?? 1;
    const cPaleta = cCamada * nCamadas > 0 ? cCamada * nCamadas : 30;

    const reglaEmpaque: ReglaEmpaque = {
      unidades_por_caja: uCaja,
      cajas_por_camada: cCamada,
      numero_camadas: nCamadas,
      cajas_por_paleta: cPaleta,
    };

    const idProducto = tagFinal?.id_producto ?? sesionInfo?.id_producto ?? 1;
    const idAlmacen = tagFinal?.id_almacen_actual ?? sesionInfo?.id_almacen ?? 1;
    const nombreAlmacen =
      (tagFinal?.almacen as any)?.nombre ??
      (sesionInfo?.almacen as any)?.nombre ??
      'Almacén Principal';

    const rawCategoria = (rawProd as any)?.categoria;
    const nombreCategoria = Array.isArray(rawCategoria)
      ? rawCategoria[0]?.nombre
      : rawCategoria?.nombre ?? 'General';

    // 3. Consultar inventario consolidado del almacén para este producto
    let inventarioConsolidado = {
      stock_real: 0,
      stock_minimo: 300,
      estado_semaforo: 'VERDE',
    };

    if (idProducto && idAlmacen) {
      const { data: inv } = await supabase
        .from('inventario')
        .select('stock_real, stock_minimo, estado_semaforo')
        .eq('id_producto', idProducto)
        .eq('id_almacen', idAlmacen)
        .maybeSingle();

      if (inv) {
        inventarioConsolidado = {
          stock_real: Number(inv.stock_real ?? 0),
          stock_minimo: Number(inv.stock_minimo ?? 300),
          estado_semaforo: inv.estado_semaforo ?? 'VERDE',
        };
      }
    }

    const tipoPaleta: TipoPaleta =
      (tagFinal?.tipo_paleta as TipoPaleta) ??
      (lectura?.tipo_carga as TipoPaleta) ??
      'COMPLETO';

    const cantPaquetes =
      tagFinal?.cantidad_paquetes ??
      lectura?.cantidad_paquetes ??
      (tipoPaleta === 'COMPLETO' ? cPaleta : 1);

    const cantActual =
      tagFinal?.cantidad_actual ??
      lectura?.cantidad_unidades ??
      cantPaquetes * uCaja;

    const ordenNum =
      (sesionInfo?.orden_importacion as any)?.numero_orden ??
      (sesionInfo?.id_orden ? `ORD-2026-00${sesionInfo.id_orden}` : undefined);

    return {
      encontrado: true,
      uid_tag: cleanUid,
      estado_tag: tagFinal?.estado ?? 'ACTIVA',
      tipo_paleta: tipoPaleta,
      cantidad_paquetes: Number(cantPaquetes),
      cantidad_actual: Number(cantActual),
      almacen_nombre: nombreAlmacen,
      id_almacen: idAlmacen,
      fecha_registro: sesionInfo?.fecha_finalizacion ?? undefined,
      orden_asociada: ordenNum,
      sesion_id: sesionInfo?.id_sesion ?? undefined,
      producto: {
        id_producto: idProducto,
        sku: rawProd?.sku ?? 'SKU-GENERAL',
        nombre: rawProd?.nombre ?? 'Producto sin denominación',
        descripcion: rawProd?.descripcion ?? '',
        categoria: nombreCategoria,
        unidad_medida: rawProd?.unidad_medida ?? 'UNIDAD',
        clasificacion_abc: rawProd?.clasificacion_abc ?? 'A',
        regla_empaque: reglaEmpaque,
      },
      inventario_almacen: inventarioConsolidado,
    };
  } catch (error: any) {
    console.warn('[STOCK] Excepción consultando tag RFID:', error);
    return {
      encontrado: false,
      uid_tag: cleanUid,
      mensaje_error: error?.message ?? 'Error de conexión consultando Supabase.',
    };
  }
}

/**
 * Consulta la lista completa de productos activos en Supabase con su regla de empaque
 */
export async function fetchCatalogoProductosStock(): Promise<
  {
    id_producto: number;
    sku: string;
    nombre: string;
    descripcion: string;
    categoria: string;
    unidad_medida: string;
    clasificacion_abc: string;
    regla_empaque: ReglaEmpaque;
  }[]
> {
  try {
    const { data, error } = await supabase
      .from('producto')
      .select(`
        id_producto,
        sku,
        nombre,
        descripcion,
        unidad_medida,
        clasificacion_abc,
        categoria:id_categoria (
          nombre
        ),
        regla_empaque (
          unidades_por_caja,
          cajas_por_camada,
          numero_camadas,
          cajas_por_camita,
          camitas_por_paleta
        )
      `)
      .eq('activo', true)
      .order('nombre');

    if (!error && data && data.length > 0) {
      return data.map((p: any) => {
        const rawRegla = Array.isArray(p.regla_empaque) ? p.regla_empaque[0] : p.regla_empaque;
        const uCaja = rawRegla?.unidades_por_caja ?? 10;
        const cCamada = rawRegla?.cajas_por_camada ?? rawRegla?.cajas_por_camita ?? 30;
        const nCamadas = rawRegla?.numero_camadas ?? rawRegla?.camitas_por_paleta ?? 1;
        const cPaleta = cCamada * nCamadas > 0 ? cCamada * nCamadas : 30;

        const rawCat = p.categoria;
        const nombreCat = Array.isArray(rawCat) ? rawCat[0]?.nombre : rawCat?.nombre ?? 'General';

        return {
          id_producto: p.id_producto,
          sku: p.sku,
          nombre: p.nombre,
          descripcion: p.descripcion ?? '',
          categoria: nombreCat,
          unidad_medida: p.unidad_medida ?? 'UNIDAD',
          clasificacion_abc: p.clasificacion_abc ?? 'A',
          regla_empaque: {
            unidades_por_caja: uCaja,
            cajas_por_camada: cCamada,
            numero_camadas: nCamadas,
            cajas_por_paleta: cPaleta,
          },
        };
      });
    }
  } catch (err) {
    console.warn('[STOCK] Error consultando catálogo de productos:', err);
  }

  // Respaldo táctico en caso de fallo de red
  return [
    {
      id_producto: 1,
      sku: 'ROLLO-CONTOMETRO-01',
      nombre: 'Rollo Contómetro Térmico 80x80',
      descripcion: 'Rollo de papel térmico para POS y comprobantes',
      categoria: 'Suministros y Empaques',
      unidad_medida: 'ROLLO',
      clasificacion_abc: 'A',
      regla_empaque: {
        unidades_por_caja: 10,
        cajas_por_camada: 30,
        numero_camadas: 1,
        cajas_por_paleta: 30,
      },
    },
    {
      id_producto: 2,
      sku: 'CINTA-EMBALAJE-02',
      nombre: 'Cinta de Embalaje Transparente 2x100m',
      descripcion: 'Cinta de embalaje industrial para sellado de cajas',
      categoria: 'Suministros y Empaques',
      unidad_medida: 'ROLLO',
      clasificacion_abc: 'B',
      regla_empaque: {
        unidades_por_caja: 36,
        cajas_por_camada: 8,
        numero_camadas: 5,
        cajas_por_paleta: 40,
      },
    },
  ];
}

/**
 * Consulta la lista de almacenes disponibles en Supabase
 */
export async function fetchAlmacenesStock(): Promise<
  { id_almacen: number; nombre: string; tipo?: string }[]
> {
  try {
    const { data, error } = await supabase
      .from('almacen')
      .select('id_almacen, nombre, tipo')
      .eq('activo', true)
      .order('id_almacen');

    if (!error && data && data.length > 0) {
      return data;
    }
  } catch (err) {
    console.warn('[STOCK] Error consultando almacenes:', err);
  }

  return [
    { id_almacen: 1, nombre: 'Almacén Principal', tipo: 'PRINCIPAL' },
    { id_almacen: 2, nombre: 'Tienda Central', tipo: 'TIENDA' },
    { id_almacen: 3, nombre: 'Mermas', tipo: 'MERMA' },
  ];
}

export type FiltroFechaStock = 'HOY' | '7_DIAS' | '30_DIAS' | 'TODO';

/**
 * Consulta manual de existencias de un producto con filtro por almacén y rango de fechas
 */
export async function consultarStockManualProducto(params: {
  producto: {
    id_producto: number;
    sku: string;
    nombre: string;
    descripcion?: string;
    categoria?: string;
    unidad_medida: string;
    clasificacion_abc?: string;
    regla_empaque: ReglaEmpaque;
  };
  idAlmacenFiltro: number; // 0 = Todos los almacenes
  filtroFecha: FiltroFechaStock;
}): Promise<import('../types').ConsultaManualProductoResultado> {
  const { producto, idAlmacenFiltro, filtroFecha } = params;

  // 1. Consultar existencias en la tabla inventario
  let queryInv = supabase
    .from('inventario')
    .select(`
      id_inventario,
      id_almacen,
      stock_real,
      stock_minimo,
      estado_semaforo,
      almacen:id_almacen (
        id_almacen,
        nombre
      )
    `)
    .eq('id_producto', producto.id_producto);

  if (idAlmacenFiltro > 0) {
    queryInv = queryInv.eq('id_almacen', idAlmacenFiltro);
  }

  const { data: invData, error: errInv } = await queryInv;
  if (errInv) {
    console.warn('[STOCK] Error consultando inventario manual:', errInv.message);
  }

  const desgloseAlmacenes: import('../types').StockAlmacenItem[] = [];
  let stockTotal = 0;
  let stockMinimoTotal = 0;

  if (invData && invData.length > 0) {
    for (const inv of invData as any[]) {
      const sReal = Number(inv.stock_real ?? 0);
      const sMin = Number(inv.stock_minimo ?? 0);
      stockTotal += sReal;
      stockMinimoTotal += sMin;

      const almNombre =
        inv.almacen?.nombre ?? `Almacén #${inv.id_almacen}`;

      desgloseAlmacenes.push({
        id_almacen: inv.id_almacen,
        nombre_almacen: almNombre,
        stock_real: sReal,
        stock_minimo: sMin,
        estado_semaforo: inv.estado_semaforo ?? (sReal <= 0 ? 'ROJO' : sReal <= sMin ? 'AMARILLO' : 'VERDE'),
      });
    }
  } else {
    // Si no tiene fila en inventario aún, representarlo con 0
    desgloseAlmacenes.push({
      id_almacen: idAlmacenFiltro > 0 ? idAlmacenFiltro : 1,
      nombre_almacen: idAlmacenFiltro > 0 ? `Almacén #${idAlmacenFiltro}` : 'Almacén Principal',
      stock_real: 0,
      stock_minimo: 300,
      estado_semaforo: 'ROJO',
    });
  }

  const estadoSemaforoGlobal =
    stockTotal <= 0 ? 'ROJO' : stockTotal <= stockMinimoTotal ? 'AMARILLO' : 'VERDE';

  // 2. Consultar historial de movimientos en la tabla movimiento con filtro de fechas
  let queryMov = supabase
    .from('movimiento')
    .select(`
      id_movimiento,
      tipo,
      cantidad_afectada,
      fecha_hora,
      motivo,
      destino_almacen,
      almacen:destino_almacen (
        nombre
      )
    `)
    .eq('id_producto', producto.id_producto)
    .order('fecha_hora', { ascending: false })
    .limit(25);

  if (idAlmacenFiltro > 0) {
    queryMov = queryMov.eq('destino_almacen', idAlmacenFiltro);
  }

  // Calcular fecha de corte según filtro
  const ahora = new Date();
  if (filtroFecha === 'HOY') {
    const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).toISOString();
    queryMov = queryMov.gte('fecha_hora', inicioHoy);
  } else if (filtroFecha === '7_DIAS') {
    const hace7Dias = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    queryMov = queryMov.gte('fecha_hora', hace7Dias);
  } else if (filtroFecha === '30_DIAS') {
    const hace30Dias = new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    queryMov = queryMov.gte('fecha_hora', hace30Dias);
  }

  const { data: movData, error: errMov } = await queryMov;
  if (errMov) {
    console.warn('[STOCK] Error consultando movimientos:', errMov.message);
  }

  const movimientos: import('../types').MovimientoStockItem[] = [];
  if (movData && movData.length > 0) {
    for (const m of movData as any[]) {
      movimientos.push({
        id_movimiento: m.id_movimiento,
        tipo: m.tipo ?? 'INGRESO',
        cantidad_afectada: Number(m.cantidad_afectada ?? 0),
        fecha_hora: m.fecha_hora,
        almacen_destino: m.almacen?.nombre ?? `Almacén #${m.destino_almacen}`,
        motivo: m.motivo ?? '',
      });
    }
  }

  return {
    producto,
    filtro_almacen_id: idAlmacenFiltro,
    stock_total: stockTotal,
    stock_minimo_total: stockMinimoTotal,
    estado_semaforo_global: estadoSemaforoGlobal,
    desglose_almacenes: desgloseAlmacenes,
    movimientos,
  };
}

/**
 * Consulta todas las paletas físicas activas en el almacén desde etiqueta_rfid
 */
export async function fetchPaletasEnBodega(params?: {
  id_almacen?: number;
  tipo_paleta?: 'TODAS' | 'COMPLETO' | 'PUCHO';
  busqueda?: string;
}): Promise<PaletaBodegaItem[]> {
  try {
    let query = supabase
      .from('etiqueta_rfid')
      .select(`
        id_etiqueta,
        uid_tag,
        tipo_paleta,
        cantidad_paquetes,
        cantidad_actual,
        estado,
        id_almacen_actual,
        id_producto,
        producto:id_producto (
          sku,
          nombre,
          unidad_medida,
          regla_empaque (
            unidades_por_caja
          )
        ),
        almacen:id_almacen_actual (
          nombre
        )
      `)
      .eq('estado', 'ACTIVA')
      .order('id_etiqueta', { ascending: false });

    if (params?.id_almacen && params.id_almacen > 0) {
      query = query.or(`id_almacen_actual.eq.${params.id_almacen},id_almacen_actual.is.null`);
    }

    if (params?.tipo_paleta && params.tipo_paleta !== 'TODAS') {
      query = query.eq('tipo_paleta', params.tipo_paleta);
    }

    const { data, error } = await query;

    if (error) {
      console.warn('[STOCK] Error consultando paletas en bodega:', error.message);
    }

    const paletas: PaletaBodegaItem[] = [];

    if (data && data.length > 0) {
      for (const item of data as any[]) {
        const prod = Array.isArray(item.producto) ? item.producto[0] : item.producto;
        const regla = Array.isArray(prod?.regla_empaque) ? prod?.regla_empaque[0] : prod?.regla_empaque;
        const alm = Array.isArray(item.almacen) ? item.almacen[0] : item.almacen;

        const sku = prod?.sku || 'SIN-SKU';
        const nombre = prod?.nombre || 'Producto sin nombre';
        const uCaja = Number(regla?.unidades_por_caja) || 10;

        // Filtrado en memoria si hay búsqueda por texto
        if (params?.busqueda) {
          const q = params.busqueda.trim().toLowerCase();
          const coincideUid = (item.uid_tag || '').toLowerCase().includes(q);
          const coincideSku = sku.toLowerCase().includes(q);
          const coincideNombre = nombre.toLowerCase().includes(q);
          if (!coincideUid && !coincideSku && !coincideNombre) {
            continue;
          }
        }

        paletas.push({
          id_etiqueta: item.id_etiqueta,
          uid_tag: item.uid_tag,
          tipo_paleta: (item.tipo_paleta as TipoPaleta) || 'COMPLETO',
          cantidad_paquetes: Number(item.cantidad_paquetes) || 1,
          cantidad_actual: Number(item.cantidad_actual) || 0,
          estado: item.estado || 'ACTIVA',
          id_almacen: item.id_almacen_actual || 1,
          nombre_almacen: alm?.nombre || 'Almacén Principal',
          id_producto: item.id_producto,
          sku,
          nombre_producto: nombre,
          unidad_medida: prod?.unidad_medida || 'UNIDAD',
          unidades_por_caja: uCaja,
          fecha_registro: new Date().toISOString(),
        });
      }
    }

    // Si etiqueta_rfid aún no tiene registros, fallback a recepcion_lectura para mostrar los tags recibidos
    if (paletas.length === 0) {
      const { data: lecturasData, error: errLect } = await supabase
        .from('recepcion_lectura')
        .select(`
          id_lectura,
          uid_tag,
          tipo_carga,
          cantidad_paquetes,
          cantidad_unidades,
          sesion_recepcion:id_sesion (
            id_almacen,
            id_producto,
            fecha_finalizacion,
            fecha_inicio,
            producto:id_producto (
              sku,
              nombre,
              unidad_medida,
              regla_empaque (
                unidades_por_caja
              )
            ),
            almacen:id_almacen (
              nombre
            )
          )
        `)
        .eq('valido', true)
        .order('id_lectura', { ascending: false })
        .limit(100);

      if (!errLect && lecturasData && lecturasData.length > 0) {
        const uidsVistos = new Set<string>();
        for (const l of lecturasData as any[]) {
          const cleanUid = (l.uid_tag || '').trim().toUpperCase();
          if (!cleanUid || uidsVistos.has(cleanUid)) continue;
          uidsVistos.add(cleanUid);

          const ses = Array.isArray(l.sesion_recepcion) ? l.sesion_recepcion[0] : l.sesion_recepcion;
          const prod = Array.isArray(ses?.producto) ? ses?.producto[0] : ses?.producto;
          const regla = Array.isArray(prod?.regla_empaque) ? prod?.regla_empaque[0] : prod?.regla_empaque;
          const alm = Array.isArray(ses?.almacen) ? ses?.almacen[0] : ses?.almacen;

          if (params?.id_almacen && params.id_almacen > 0 && ses?.id_almacen && ses.id_almacen !== params.id_almacen) {
            continue;
          }

          const tipoPaleta: TipoPaleta = (l.tipo_carga as TipoPaleta) || 'COMPLETO';
          if (params?.tipo_paleta && params.tipo_paleta !== 'TODAS' && tipoPaleta !== params.tipo_paleta) {
            continue;
          }

          const sku = prod?.sku || 'SIN-SKU';
          const nombre = prod?.nombre || 'Producto sin nombre';
          const uCaja = Number(regla?.unidades_por_caja) || 10;

          if (params?.busqueda) {
            const q = params.busqueda.trim().toLowerCase();
            const coincideUid = cleanUid.toLowerCase().includes(q);
            const coincideSku = sku.toLowerCase().includes(q);
            const coincideNombre = nombre.toLowerCase().includes(q);
            if (!coincideUid && !coincideSku && !coincideNombre) {
              continue;
            }
          }

          paletas.push({
            id_etiqueta: l.id_lectura,
            uid_tag: cleanUid,
            tipo_paleta: tipoPaleta,
            cantidad_paquetes: Number(l.cantidad_paquetes) || 1,
            cantidad_actual: Number(l.cantidad_unidades) || 0,
            estado: 'ACTIVA',
            id_almacen: ses?.id_almacen || 1,
            nombre_almacen: alm?.nombre || 'Almacén Principal',
            id_producto: ses?.id_producto || 1,
            sku,
            nombre_producto: nombre,
            unidad_medida: prod?.unidad_medida || 'UNIDAD',
            unidades_por_caja: uCaja,
            fecha_registro: ses?.fecha_finalizacion || ses?.fecha_inicio || new Date().toISOString(),
          });
        }
      }
    }

    return paletas;
  } catch (err) {
    console.warn('[STOCK] Excepción consultando paletas en bodega:', err);
    return [];
  }
}


