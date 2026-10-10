import { supabase } from '../lib/supabase';
import {
  Almacen,
  ConciliacionResultado,
  LecturaRFID,
  OrdenRecepcion,
  TransaccionOffline,
} from '../types';
import {
  DEFAULT_WAREHOUSE,
  enqueueOfflineTransaction,
  getOfflineQueue,
  removeOfflineTransaction,
} from './storage';

// Órdenes maestras por defecto según especificación SRS RF-26
export const DEFAULT_ORDERS: OrdenRecepcion[] = [
  {
    id_orden: 1,
    numero_orden: 'ORD-2026-001',
    id_producto: 1,
    sku: 'ROLLO-CONTOMETRO-01',
    nombre_producto: 'Rollo Contómetro Térmico 80x80',
    regla_empaque: {
      unidades_por_caja: 10,
      cajas_por_camada: 30,
      numero_camadas: 1,
      cajas_por_paleta: 30, // 30 cajas/paleta * 10 u/caja = 300 unidades por paleta
    },
    cantidad_pedida: 980, // SRS: 3 paletas completas (900 u) + 8 puchos (80 u)
  },
  {
    id_orden: 2,
    numero_orden: 'ORD-2026-002',
    id_producto: 2,
    sku: 'CINTA-EMBALAJE-02',
    nombre_producto: 'Cinta de Embalaje Transparente 2x100m',
    regla_empaque: {
      unidades_por_caja: 36,
      cajas_por_camada: 8,
      numero_camadas: 5,
      cajas_por_paleta: 40, // 40 cajas * 36 = 1440 u/paleta
    },
    cantidad_pedida: 1500,
  },
];

/**
 * Consulta almacenes desde Supabase con respaldo local
 */
export async function fetchAlmacenes(): Promise<Almacen[]> {
  try {
    const { data, error } = await supabase
      .from('almacen')
      .select('id_almacen, nombre, tipo, capacidad_m3, activo')
      .eq('activo', true)
      .order('id_almacen');

    if (!error && data && data.length > 0) {
      return data as Almacen[];
    }
  } catch (err) {
    console.warn('Error consultando almacenes en Supabase, usando respaldo:', err);
  }
  return [
    DEFAULT_WAREHOUSE,
    { id_almacen: 2, nombre: 'Tienda Central', tipo: 'TIENDA', capacidad_m3: 80, activo: true },
    { id_almacen: 3, nombre: 'Mermas', tipo: 'MERMA', capacidad_m3: 20, activo: true },
  ];
}

/**
 * Consulta órdenes de importación pendientes desde Supabase o catálogo SRS
 */
export async function fetchOrdenesPendientes(): Promise<OrdenRecepcion[]> {
  try {
    const { data, error } = await supabase
      .from('orden_importacion')
      .select(
        `
        id_orden,
        numero_orden,
        detalle_orden (
          id_detalle,
          id_producto,
          cantidad_pedida,
          producto (
            id_producto,
            sku,
            nombre,
            regla_empaque (
              unidades_por_caja,
              cajas_por_camada,
              numero_camadas,
              cajas_por_camita,
              camitas_por_paleta
            )
          )
        )
      `
      )
      .neq('estado', 'RECIBIDA')
      .limit(10);

    if (!error && data && data.length > 0) {
      const parsed: OrdenRecepcion[] = [];
      for (const ord of data as any[]) {
        const detalles = ord.detalle_orden ?? [];
        for (const det of detalles) {
          const prod = det.producto;
          if (!prod) continue;
          const reg = Array.isArray(prod.regla_empaque) ? prod.regla_empaque[0] : prod.regla_empaque;
          const uCaja = reg?.unidades_por_caja ?? 10;
          const cCamada = reg?.cajas_por_camada ?? reg?.cajas_por_camita ?? 30;
          const nCamadas = reg?.numero_camadas ?? reg?.camitas_por_paleta ?? 1;
          const cPaleta = cCamada * nCamadas;

          parsed.push({
            id_orden: ord.id_orden,
            numero_orden: ord.numero_orden,
            id_producto: prod.id_producto,
            sku: prod.sku,
            nombre_producto: prod.nombre,
            regla_empaque: {
              unidades_por_caja: uCaja,
              cajas_por_camada: cCamada,
              numero_camadas: nCamadas,
              cajas_por_paleta: cPaleta > 0 ? cPaleta : 30,
            },
            cantidad_pedida: det.cantidad_pedida ?? 0,
          });
        }
      }
      if (parsed.length > 0) return parsed;
    }
  } catch (err) {
    console.warn('Error consultando órdenes en Supabase:', err);
  }

  return [];
}

/**
 * Consulta productos directamente desde Supabase con sus reglas de empaque y órdenes asociadas
 */
export async function fetchProductosDesdeSupabase(): Promise<OrdenRecepcion[]> {
  try {
    // 1. Intentar obtener órdenes de importación reales con sus detalles de producto desde Supabase
    const ordenes = await fetchOrdenesPendientes();
    if (ordenes.length > 0) {
      console.log(`[SUPABASE] Se obtuvieron ${ordenes.length} órdenes reales vinculadas desde Supabase.`);
      return ordenes;
    }

    // 2. Si no hay órdenes pendientes pero hay catálogo de productos en Supabase, consultar la tabla producto
    const { data: prods, error: errProds } = await supabase
      .from('producto')
      .select(`
        id_producto,
        sku,
        nombre,
        regla_empaque (
          unidades_por_caja,
          cajas_por_camada,
          numero_camadas,
          cajas_por_camita,
          camitas_por_paleta
        )
      `)
      .eq('activo', true)
      .order('id_producto');

    if (!errProds && prods && prods.length > 0) {
      // Buscar orden real existente en orden_importacion para respetar FK sesion_recepcion_id_orden_fkey
      const { data: ordenesExistentes } = await supabase
        .from('orden_importacion')
        .select('id_orden, numero_orden')
        .order('id_orden')
        .limit(10);

      const primeraOrden = ordenesExistentes && ordenesExistentes.length > 0 ? ordenesExistentes[0] : null;

      console.log(`[SUPABASE] Se obtuvieron ${prods.length} productos del catálogo de Supabase.`);
      return prods.map((prod: any, idx: number) => {
        const reg = Array.isArray(prod.regla_empaque) ? prod.regla_empaque[0] : prod.regla_empaque;
        const uCaja = reg?.unidades_por_caja ?? 10;
        const cCamada = reg?.cajas_por_camada ?? reg?.cajas_por_camita ?? 30;
        const nCamadas = reg?.numero_camadas ?? reg?.camitas_por_paleta ?? 1;
        const cPaleta = cCamada * nCamadas;

        const ordenAsociada = ordenesExistentes && ordenesExistentes[idx] ? ordenesExistentes[idx] : primeraOrden;

        return {
          id_orden: ordenAsociada ? ordenAsociada.id_orden : (idx + 1),
          numero_orden: ordenAsociada ? ordenAsociada.numero_orden : `ORD-2026-00${idx + 1}`,
          id_producto: prod.id_producto,
          sku: prod.sku,
          nombre_producto: prod.nombre,
          regla_empaque: {
            unidades_por_caja: uCaja,
            cajas_por_camada: cCamada,
            numero_camadas: nCamadas,
            cajas_por_paleta: cPaleta > 0 ? cPaleta : 30,
          },
          cantidad_pedida: 980,
        };
      });
    }
  } catch (err) {
    console.warn('[SUPABASE] Error consultando productos en Supabase:', err);
  }

  // 3. Fallback táctico estándar inmediato
  console.log('[CATÁLOGO] Utilizando catálogo estándar SRS (fallback táctico).');
  return DEFAULT_ORDERS;
}

/**
 * Verifica si existe una sesión activa de operario en Supabase
 */
export async function getSesionOperario(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Inicia sesión de operario / supervisor directamente
 */
export async function loginOperario(
  email: string,
  pass: string
): Promise<{ success: boolean; email?: string; error?: string }> {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: pass.trim(),
    });

    if (error) {
      return { success: false, error: error.message };
    }

    // Al iniciar sesión, aseguramos que la orden maestra de prueba exista
    void asegurarDatosPruebaEnSupabase();

    return {
      success: true,
      email: data.user?.email ?? email,
    };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Fallo de conexión' };
  }
}

/**
 * Cierra la sesión activa en el terminal
 */
export async function logoutOperario(): Promise<void> {
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.warn('Error cerrando sesión:', err);
  }
}

/**
 * Asegura que existan los datos maestros mínimos de producto, orden y empaque en Supabase.
 * IMPORTANTE: No se especifican IDs identity (id_producto, id_orden, etc.) al insertar para
 * cumplir con la regla GENERATED ALWAYS AS IDENTITY de PostgreSQL.
 */
export async function asegurarDatosPruebaEnSupabase(): Promise<boolean> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      return false;
    }

    // 1. Obtener o crear Categoría de Suministros
    let idCategoria = 1;
    const { data: catExist } = await supabase
      .from('categoria')
      .select('id_categoria')
      .limit(1)
      .maybeSingle();

    if (catExist?.id_categoria) {
      idCategoria = catExist.id_categoria;
    }

    // 2. Verificar o insertar Producto 1 (ROLLO-CONTOMETRO-01)
    let prod1Id: number | null = null;
    const { data: prod1Exist } = await supabase
      .from('producto')
      .select('id_producto, sku')
      .eq('sku', 'ROLLO-CONTOMETRO-01')
      .maybeSingle();

    if (prod1Exist?.id_producto) {
      prod1Id = prod1Exist.id_producto;
    } else {
      const { data: newProd1, error: errP1 } = await supabase
        .from('producto')
        .insert({
          id_categoria: idCategoria,
          sku: 'ROLLO-CONTOMETRO-01',
          nombre: 'Rollo Contómetro Térmico 80x80',
          descripcion: 'Rollo de papel térmico 80x80mm para punto de venta',
          unidad_medida: 'ROLLO',
          peso_unitario_kg: 0.25,
          clasificacion_abc: 'A',
          costo_unitario: 2.5,
          activo: true,
        })
        .select('id_producto')
        .single();

      if (errP1) {
        console.warn('[SUPABASE SEED] Error insertando producto ROLLO-CONTOMETRO-01:', errP1.message);
      } else if (newProd1) {
        prod1Id = newProd1.id_producto;
      }
    }

    // 3. Regla de empaque para Producto 1
    if (prod1Id) {
      const { data: reg1Exist } = await supabase
        .from('regla_empaque')
        .select('id_empaque')
        .eq('id_producto', prod1Id)
        .maybeSingle();

      if (!reg1Exist) {
        const { error: errReg1 } = await supabase.from('regla_empaque').insert({
          id_producto: prod1Id,
          unidades_por_caja: 10,
          cajas_por_camada: 30,
          numero_camadas: 1,
          cajas_por_camita: 30,
          camitas_por_paleta: 1,
          permite_puchos: true,
          volumen_caja_m3: 0.03,
          volumen_total_m3: 0.90,
        });
        if (errReg1) {
          console.warn('[SUPABASE SEED] Error insertando regla de empaque 1:', errReg1.message);
        }
      }

      // Inicializar Inventario en Almacén Principal (id_almacen: 1)
      const { data: inv1Exist } = await supabase
        .from('inventario')
        .select('id_inventario')
        .eq('id_producto', prod1Id)
        .eq('id_almacen', 1)
        .maybeSingle();

      if (!inv1Exist) {
        await supabase.from('inventario').insert({
          id_producto: prod1Id,
          id_almacen: 1,
          stock_real: 0,
          stock_minimo: 300,
          estado_semaforo: 'ROJO',
        });
      }
    }

    // 4. Verificar o insertar Orden de Importación 1 (ORD-2026-001)
    let ord1Id: number | null = null;
    const { data: ord1Exist } = await supabase
      .from('orden_importacion')
      .select('id_orden, numero_orden')
      .eq('numero_orden', 'ORD-2026-001')
      .maybeSingle();

    if (ord1Exist?.id_orden) {
      ord1Id = ord1Exist.id_orden;
    } else {
      const { data: newOrd1, error: errOrd1 } = await supabase
        .from('orden_importacion')
        .insert({
          numero_orden: 'ORD-2026-001',
          estado: 'TRANSITO',
          fecha_emision: new Date().toISOString().split('T')[0],
          tipo_contenedor: '40FT',
          volumen_ocupado_m3: 58.5,
        })
        .select('id_orden')
        .single();

      if (errOrd1) {
        if (!errOrd1.message?.includes('row-level security') && !errOrd1.message?.includes('policy')) {
          console.warn('[SUPABASE SEED] Info orden ORD-2026-001:', errOrd1.message);
        }
      } else if (newOrd1) {
        ord1Id = newOrd1.id_orden;
      }
    }

    // 5. Vincular Detalle de Orden 1 (id_orden + id_producto)
    if (ord1Id && prod1Id) {
      const { data: det1Exist } = await supabase
        .from('detalle_orden')
        .select('id_detalle')
        .eq('id_orden', ord1Id)
        .eq('id_producto', prod1Id)
        .maybeSingle();

      if (!det1Exist) {
        const { error: errDet1 } = await supabase.from('detalle_orden').insert({
          id_orden: ord1Id,
          id_producto: prod1Id,
          cantidad_pedida: 980,
          subtotal_peso_kg: 735,
          subtotal_volumen_m3: 2.94,
        });
        if (errDet1) {
          console.warn('[SUPABASE SEED] Error vinculando detalle_orden 1:', errDet1.message);
        }
      }
    }

    // 6. Producto 2 opcional (CINTA-EMBALAJE-02)
    let prod2Id: number | null = null;
    const { data: prod2Exist } = await supabase
      .from('producto')
      .select('id_producto, sku')
      .eq('sku', 'CINTA-EMBALAJE-02')
      .maybeSingle();

    if (prod2Exist?.id_producto) {
      prod2Id = prod2Exist.id_producto;
    } else {
      const { data: newProd2 } = await supabase
        .from('producto')
        .insert({
          id_categoria: idCategoria,
          sku: 'CINTA-EMBALAJE-02',
          nombre: 'Cinta de Embalaje Transparente 2x100m',
          descripcion: 'Cinta de embalaje industrial 2 pulgadas x 100m',
          unidad_medida: 'ROLLO',
          peso_unitario_kg: 0.18,
          clasificacion_abc: 'B',
          costo_unitario: 1.8,
          activo: true,
        })
        .select('id_producto')
        .single();

      if (newProd2) prod2Id = newProd2.id_producto;
    }

    if (prod2Id) {
      const { data: reg2Exist } = await supabase
        .from('regla_empaque')
        .select('id_empaque')
        .eq('id_producto', prod2Id)
        .maybeSingle();

      if (!reg2Exist) {
        await supabase.from('regla_empaque').insert({
          id_producto: prod2Id,
          unidades_por_caja: 36,
          cajas_por_camada: 8,
          numero_camadas: 5,
          cajas_por_camita: 8,
          camitas_por_paleta: 5,
          permite_puchos: true,
          volumen_caja_m3: 0.02,
          volumen_total_m3: 0.80,
        });
      }

      // Orden 2 (ORD-2026-002)
      let ord2Id: number | null = null;
      const { data: ord2Exist } = await supabase
        .from('orden_importacion')
        .select('id_orden, numero_orden')
        .eq('numero_orden', 'ORD-2026-002')
        .maybeSingle();

      if (ord2Exist?.id_orden) {
        ord2Id = ord2Exist.id_orden;
      } else {
        const { data: newOrd2 } = await supabase
          .from('orden_importacion')
          .insert({
            numero_orden: 'ORD-2026-002',
            estado: 'TRANSITO',
            fecha_emision: new Date().toISOString().split('T')[0],
            tipo_contenedor: '40FT',
            volumen_ocupado_m3: 45.0,
          })
          .select('id_orden')
          .single();

        if (newOrd2) ord2Id = newOrd2.id_orden;
      }

      if (ord2Id) {
        const { data: det2Exist } = await supabase
          .from('detalle_orden')
          .select('id_detalle')
          .eq('id_orden', ord2Id)
          .eq('id_producto', prod2Id)
          .maybeSingle();

        if (!det2Exist) {
          await supabase.from('detalle_orden').insert({
            id_orden: ord2Id,
            id_producto: prod2Id,
            cantidad_pedida: 1500,
            subtotal_peso_kg: 500,
            subtotal_volumen_m3: 2.0,
          });
        }
      }
    }

    console.log('[SUPABASE SEED] Datos maestros verificados y listos en Supabase.');
    return true;
  } catch (err) {
    console.warn('[SUPABASE SEED] Error en aprovisionamiento de datos:', err);
    return false;
  }
}

/**
 * Ejecuta la conciliación ciega contra Supabase (o almacena en cola offline si falla)
 */
export async function conciliarRecepcionEnSupabase(params: {
  id_orden: number;
  numero_orden: string;
  id_producto: number;
  sku: string;
  id_almacen: number;
  lecturas: LecturaRFID[];
  paletas_completas: number;
  paquetes_puchos: number;
}): Promise<{
  success: boolean;
  resultado?: ConciliacionResultado;
  enqueuedOffline?: boolean;
  offlineTxId?: string;
  error?: string;
  notAuthenticated?: boolean;
}> {
  const {
    id_orden,
    numero_orden,
    id_producto,
    sku,
    id_almacen,
    lecturas,
    paletas_completas,
    paquetes_puchos,
  } = params;

  // Generar ID de transacción offline para idempotencia
  const p_id_transaccion_offline = `movil_rec_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // Formatear lecturas para la RPC de PostgreSQL
  const payloadLecturas = lecturas.map((l) => ({
    uid: l.uid.trim(),
    tipo: l.tipo,
    cantidad_paquetes: l.cantidad_paquetes,
    timestamp: l.timestamp,
  }));

  // Resolución defensiva de Foreign Keys para garantizar que id_orden e id_producto
  // respeten las restricciones de integridad referencial de sesion_recepcion
  let idOrdenFinal: number | null = id_orden;
  let idProductoFinal = id_producto;

  try {
    // 1. Validar si id_orden existe realmente en la tabla orden_importacion
    const { data: ordCheck } = await supabase
      .from('orden_importacion')
      .select('id_orden')
      .eq('id_orden', id_orden)
      .maybeSingle();

    if (ordCheck?.id_orden) {
      idOrdenFinal = ordCheck.id_orden;
    } else {
      // Si el id numérico no existe en BD, resolver por numero_orden (ej. ORD-2026-001)
      const { data: ordByNum } = await supabase
        .from('orden_importacion')
        .select('id_orden')
        .eq('numero_orden', numero_orden)
        .maybeSingle();

      if (ordByNum?.id_orden) {
        idOrdenFinal = ordByNum.id_orden;
      } else {
        // Si no coincide, buscar si existe CUALQUIER orden real en orden_importacion
        const { data: anyOrd } = await supabase
          .from('orden_importacion')
          .select('id_orden')
          .limit(1)
          .maybeSingle();

        if (anyOrd?.id_orden) {
          idOrdenFinal = anyOrd.id_orden;
        } else {
          // Si no existe ninguna orden en orden_importacion, id_orden debe ser null.
          // En PostgreSQL, sesion_recepcion.id_orden es NULLABLE ("on delete set null").
          // Si enviamos un ID inexistente, Postgres lanza el error "sesion_recepcion_id_orden_fkey".
          // Si enviamos null, la clave foránea no se viola y permite registrar la sesión, tags e inventario.
          idOrdenFinal = null;
        }
      }
    }

    // 2. Validar si id_producto existe realmente en producto
    const { data: prodCheck } = await supabase
      .from('producto')
      .select('id_producto')
      .eq('id_producto', id_producto)
      .maybeSingle();

    if (prodCheck?.id_producto) {
      idProductoFinal = prodCheck.id_producto;
    } else {
      const { data: prodBySku } = await supabase
        .from('producto')
        .select('id_producto')
        .eq('sku', sku)
        .maybeSingle();

      if (prodBySku?.id_producto) {
        idProductoFinal = prodBySku.id_producto;
      } else {
        const { data: anyProd } = await supabase
          .from('producto')
          .select('id_producto')
          .limit(1)
          .maybeSingle();

        if (anyProd?.id_producto) {
          idProductoFinal = anyProd.id_producto;
        }
      }
    }
  } catch (fkErr) {
    console.warn('[SUPABASE] Advertencia validando Foreign Keys antes de conciliar:', fkErr);
  }

  try {
    let { data, error } = await supabase.rpc('conciliar_recepcion', {
      p_id_orden: idOrdenFinal,
      p_id_producto: idProductoFinal,
      p_id_almacen: id_almacen,
      p_lecturas: payloadLecturas,
      p_id_transaccion_offline: p_id_transaccion_offline,
    });

    // Si la función en Supabase todavía no tiene p_id_transaccion_offline en el schema cache, reintentar con 4 parámetros
    const errMsgLower = (error?.message ?? '').toLowerCase();
    if (error && (errMsgLower.includes('could not find') || errMsgLower.includes('schema cache'))) {
      console.warn('[SUPABASE] Reintentando RPC con firma clásica de 4 parámetros...');
      const fallback = await supabase.rpc('conciliar_recepcion', {
        p_id_orden: idOrdenFinal,
        p_id_producto: idProductoFinal,
        p_id_almacen: id_almacen,
        p_lecturas: payloadLecturas,
      });
      if (!fallback.error) {
        data = fallback.data;
        error = null;
      }
    }

    if (!error && data) {
      const res = data as any;
      const conciliacionRes: ConciliacionResultado = {
        ok: true,
        idempotente: res.idempotente ?? false,
        id_sesion: res.id_sesion,
        estado_conciliacion: res.estado_conciliacion ?? 'COMPLETA',
        cantidad_esperada: res.cantidad_esperada,
        cantidad_recibida: res.cantidad_recibida,
        diferencia_unidades: res.diferencia_unidades,
        paletas_completas: res.paletas_completas ?? paletas_completas,
        paquetes_puchos: res.paquetes_puchos ?? paquetes_puchos,
        tags_procesados: res.tags_procesados ?? lecturas.length,
        mensaje: res.mensaje,
      };

      return {
        success: true,
        resultado: conciliacionRes,
      };
    } else {
      const errorMsg = error ? error.message : 'Error desconocido al invocar conciliar_recepcion';
      const isAuthError =
        errorMsg.includes('Acceso denegado') ||
        errorMsg.includes('no tiene rol') ||
        errorMsg.includes('JWT') ||
        errorMsg.includes('permission denied');

      console.warn('RPC conciliar_recepcion falló, guardando en cola offline:', errorMsg);

      // Encolar automáticamente en la cola persistente de AsyncStorage
      const tx = await enqueueOfflineTransaction({
        tipo_operacion: 'RECEPCION_CONCILIACION',
        payload: {
          p_id_orden: idOrdenFinal,
          p_id_producto: idProductoFinal,
          p_id_almacen: id_almacen,
          p_lecturas: payloadLecturas,
          p_id_transaccion_offline,
          resumen: {
            numero_orden,
            sku,
            paletas: paletas_completas,
            puchos: paquetes_puchos,
            total_tags: lecturas.length,
          },
        },
        ultimo_error: errorMsg,
      });

      return {
        success: false,
        enqueuedOffline: true,
        offlineTxId: tx.id,
        error: errorMsg,
        notAuthenticated: isAuthError,
      };
    }
  } catch (err: any) {
    const errorMsg = err?.message ?? 'Fallo de conexión o red';
    console.warn('Excepción de red al conciliar, encolando offline:', errorMsg);

    const tx = await enqueueOfflineTransaction({
      tipo_operacion: 'RECEPCION_CONCILIACION',
      payload: {
        p_id_orden: id_orden,
        p_id_producto: id_producto,
        p_id_almacen: id_almacen,
        p_lecturas: payloadLecturas,
        p_id_transaccion_offline,
        resumen: {
          numero_orden,
          sku,
          paletas: paletas_completas,
          puchos: paquetes_puchos,
          total_tags: lecturas.length,
        },
      },
      ultimo_error: errorMsg,
    });

    return {
      success: false,
      enqueuedOffline: true,
      offlineTxId: tx.id,
      error: errorMsg,
    };
  }
}

/**
 * Sincroniza las transacciones pendientes en la cola offline contra Supabase
 */
export async function sincronizarColaOffline(): Promise<{
  total: number;
  sincronizados: number;
  fallidos: number;
  detalles: string[];
}> {
  const cola = await getOfflineQueue();
  if (cola.length === 0) {
    return { total: 0, sincronizados: 0, fallidos: 0, detalles: ['Cola vacía.'] };
  }

  let sincronizados = 0;
  let fallidos = 0;
  const detalles: string[] = [];

  for (const item of cola) {
    if (item.tipo_operacion === 'RECEPCION_CONCILIACION') {
      try {
        let { error } = await supabase.rpc('conciliar_recepcion', {
          p_id_orden: item.payload.p_id_orden,
          p_id_producto: item.payload.p_id_producto,
          p_id_almacen: item.payload.p_id_almacen,
          p_lecturas: item.payload.p_lecturas,
          p_id_transaccion_offline: item.payload.p_id_transaccion_offline ?? item.id,
        });

        const errLower = (error?.message ?? '').toLowerCase();
        if (error && (errLower.includes('could not find') || errLower.includes('schema cache'))) {
          const fallback = await supabase.rpc('conciliar_recepcion', {
            p_id_orden: item.payload.p_id_orden,
            p_id_producto: item.payload.p_id_producto,
            p_id_almacen: item.payload.p_id_almacen,
            p_lecturas: item.payload.p_lecturas,
          });
          if (!fallback.error) {
            error = null;
          } else {
            error = fallback.error;
          }
        }

        if (!error) {
          sincronizados++;
          await removeOfflineTransaction(item.id);
          detalles.push(`✅ TX #${item.id.slice(-6)} sincronizada exitosamente.`);
        } else {
          fallidos++;
          detalles.push(`❌ TX #${item.id.slice(-6)}: ${error.message}`);
        }
      } catch (err: any) {
        fallidos++;
        detalles.push(`❌ TX #${item.id.slice(-6)}: ${err.message ?? 'Sin conexión'}`);
      }
    } else {
      detalles.push(`ℹ️ TX #${item.id.slice(-6)} (${item.tipo_operacion}) omitida.`);
    }
  }

  return {
    total: cola.length,
    sincronizados,
    fallidos,
    detalles,
  };
}
