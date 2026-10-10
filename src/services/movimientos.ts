import { supabase } from '../lib/supabase';
import {
  HistorialKardexItem,
  ItemDespachoMovimiento,
  ResultadoDespachoMovimiento,
  TipoPaleta,
} from '../types';

/**
 * Consulta un tag RFID en Supabase para validar si está activo y apto para despacho
 * Detecta además si el producto ya cuenta con un PUCHO activo en el almacén (regla de oro).
 */
export async function consultarTagParaMovimiento(
  uid: string,
  id_almacen: number
): Promise<{ success: boolean; data?: ItemDespachoMovimiento; error?: string }> {
  try {
    const cleanUid = uid.trim().toUpperCase();

    // 1. Consultar etiqueta activa en el almacén
    const { data: tag, error: tagErr } = await supabase
      .from('etiqueta_rfid')
      .select(`
        id_etiqueta,
        uid_tag,
        id_producto,
        tipo_paleta,
        cantidad_paquetes,
        cantidad_actual,
        estado,
        id_almacen_actual,
        producto:id_producto (
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
      `)
      .eq('uid_tag', cleanUid)
      .eq('id_almacen_actual', id_almacen)
      .eq('estado', 'ACTIVA')
      .maybeSingle();

    if (tagErr) {
      return { success: false, error: tagErr.message };
    }

    if (!tag) {
      return {
        success: false,
        error: `El tag RFID "${cleanUid}" no existe o no se encuentra ACTIVO en este almacén.`,
      };
    }

    const prod = tag.producto as any;
    const regla = Array.isArray(prod?.regla_empaque) ? prod.regla_empaque[0] : prod?.regla_empaque;
    const unidadesPorCaja = Number(regla?.unidades_por_caja) || 10;
    const paquetesActuales = Number(tag.cantidad_paquetes) || 1;
    const unidadesActuales = Number(tag.cantidad_actual) || (paquetesActuales * unidadesPorCaja);
    const tipoPaletaActual: TipoPaleta = (tag.tipo_paleta as TipoPaleta) || 'COMPLETO';

    // 2. Comprobar si ya existe OTRO pucho activo para este producto en el almacén
    const { data: puchoExistente } = await supabase
      .from('etiqueta_rfid')
      .select('uid_tag')
      .eq('id_producto', prod.id_producto)
      .eq('id_almacen_actual', id_almacen)
      .eq('tipo_paleta', 'PUCHO')
      .eq('estado', 'ACTIVA')
      .neq('uid_tag', cleanUid)
      .limit(1)
      .maybeSingle();

    const yaExisteOtroPucho = !!puchoExistente;
    const uidOtroPucho = puchoExistente?.uid_tag;

    const item: ItemDespachoMovimiento = {
      id_etiqueta: tag.id_etiqueta,
      uid_tag: cleanUid,
      id_producto: prod.id_producto,
      sku: prod.sku || 'SIN-SKU',
      nombre_producto: prod.nombre || 'Producto sin nombre',
      tipo_paleta_actual: tipoPaletaActual,
      cantidad_paquetes_actual: paquetesActuales,
      cantidad_unidades_actual: unidadesActuales,
      unidades_por_caja: unidadesPorCaja,
      tipo_movimiento: 'DESPACHO_COMPLETO',
      paquetes_a_retirar: paquetesActuales,
      unidades_a_retirar: unidadesActuales,
      nuevo_tipo_paleta: tipoPaletaActual,
      paquetes_restantes: 0,
      unidades_restantes: 0,
      motivo: 'Despacho de almacén',
      yaExisteOtroPucho,
      uidOtroPucho,
    };

    return { success: true, data: item };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error consultando tag RFID' };
  }
}

/**
 * Ejecuta en Supabase el lote de despachos y retiros parciales de forma atómica.
 */
export async function ejecutarDespachoMovimientos(
  id_almacen: number,
  items: ItemDespachoMovimiento[],
  id_almacen_destino?: number
): Promise<ResultadoDespachoMovimiento> {
  try {
    if (items.length === 0) {
      return { ok: false, items_procesados: 0, unidades_totales_retiradas: 0, mensaje: 'No hay items para despachar.' };
    }

    const payload = items.map((i) => {
      const destId = i.id_almacen_destino ?? id_almacen_destino ?? id_almacen;
      // Truncar motivo a 80 caracteres de forma defensiva para no exceder columnas varchar
      const cleanMotivo = (i.motivo || 'Despacho de almacén').trim().slice(0, 80);

      return {
        uid_tag: i.uid_tag,
        tipo_movimiento: i.tipo_movimiento,
        paquetes_a_retirar: i.tipo_movimiento === 'RETIRO_PARCIAL' ? i.paquetes_a_retirar : i.cantidad_paquetes_actual,
        motivo: cleanMotivo,
        id_almacen_destino: destId,
      };
    });

    const { data, error } = await supabase.rpc('ejecutar_movimiento_despacho', {
      p_id_almacen: id_almacen,
      p_movimientos: payload,
    });

    if (error) {
      return {
        ok: false,
        items_procesados: 0,
        unidades_totales_retiradas: 0,
        mensaje: error.message,
      };
    }

    const res = data as any;
    return {
      ok: res?.ok ?? true,
      items_procesados: res?.items_procesados ?? items.length,
      unidades_totales_retiradas: res?.unidades_totales_retiradas ?? 0,
      mensaje: res?.mensaje ?? 'Despachos procesados exitosamente.',
      detalles: res?.detalles ?? [],
    };
  } catch (err: any) {
    return {
      ok: false,
      items_procesados: 0,
      unidades_totales_retiradas: 0,
      mensaje: err?.message || 'Error de conexión al procesar despacho',
    };
  }
}

/**
 * Consulta el historial general de movimientos (Kardex) para el Módulo 8.
 */
export async function fetchHistorialKardex(filtros?: {
  id_almacen?: number;
  tipo?: string;
  rangoDias?: number;
  limite?: number;
}): Promise<HistorialKardexItem[]> {
  try {
    let query = supabase
      .from('movimiento')
      .select(`
        id_movimiento,
        tipo,
        cantidad_afectada,
        motivo,
        fecha_hora,
        destino_almacen,
        producto:id_producto (
          sku,
          nombre
        ),
        usuario:id_usuario (
          nombre_completo
        ),
        almacen:destino_almacen (
          nombre
        )
      `)
      .order('id_movimiento', { ascending: false })
      .limit(filtros?.limite ?? 50);

    if (filtros?.id_almacen && filtros.id_almacen > 0) {
      query = query.eq('destino_almacen', filtros.id_almacen);
    }

    if (filtros?.tipo && filtros.tipo !== 'TODOS') {
      if (filtros.tipo === 'INGRESOS') {
        query = query.like('tipo', 'INGRESO%');
      } else if (filtros.tipo === 'DESPACHOS') {
        query = query.eq('tipo', 'DESPACHO_COMPLETO');
      } else if (filtros.tipo === 'PUCHOS') {
        query = query.in('tipo', ['RETIRO_PARCIAL', 'INGRESO_PUCHO']);
      }
    }

    if (filtros?.rangoDias && filtros.rangoDias > 0) {
      const fechaLimite = new Date();
      fechaLimite.setDate(fechaLimite.getDate() - filtros.rangoDias);
      query = query.gte('fecha_hora', fechaLimite.toISOString());
    }

    const { data, error } = await query;

    if (error || !data) {
      console.warn('[KARDEX] Error consultando movimientos:', error?.message);
      return [];
    }

    return data.map((m: any) => {
      const prod = Array.isArray(m.producto) ? m.producto[0] : m.producto;
      const user = Array.isArray(m.usuario) ? m.usuario[0] : m.usuario;
      const alm = Array.isArray(m.almacen) ? m.almacen[0] : m.almacen;

      return {
        id_movimiento: m.id_movimiento,
        fecha: m.fecha_hora || new Date().toISOString(),
        tipo: m.tipo || 'MOVIMIENTO',
        cantidad_afectada: Number(m.cantidad_afectada) || 0,
        motivo: m.motivo || 'Sin motivo especificado',
        producto_sku: prod?.sku || 'DESCONOCIDO',
        producto_nombre: prod?.nombre || 'Producto General',
        usuario_nombre: user?.nombre_completo || 'Operario',
        almacen_nombre: alm?.nombre || 'Almacén Principal',
      };
    });
  } catch (err) {
    console.warn('[KARDEX] Excepción consultando historial:', err);
    return [];
  }
}
