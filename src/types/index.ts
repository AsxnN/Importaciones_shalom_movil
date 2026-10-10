export type TipoPaleta = 'COMPLETO' | 'PUCHO';

export interface LecturaRFID {
  uid: string;
  tipo: TipoPaleta;
  cantidad_paquetes: number; // 0 para COMPLETO, >0 para PUCHO
  timestamp: string;
}

export interface ReglaEmpaque {
  unidades_por_caja: number;
  cajas_por_camada: number;
  numero_camadas: number;
  cajas_por_paleta: number;
}

export interface OrdenRecepcion {
  id_orden: number;
  numero_orden: string;
  id_producto: number;
  sku: string;
  nombre_producto: string;
  regla_empaque: ReglaEmpaque;
  cantidad_pedida: number;
}

export interface SesionPausada {
  orden: OrdenRecepcion;
  id_almacen: number;
  lecturas: LecturaRFID[];
  total_paletas_completas: number;
  total_paquetes_puchos: number;
  pausado_en: string;
}

export interface TransaccionOffline {
  id: string; // UUID local
  tipo_operacion: 'RECEPCION_CONCILIACION' | 'MOVIMIENTO_STOCK' | 'AUDITORIA_ERI';
  payload: {
    p_id_orden: number | null;
    p_id_producto: number;
    p_id_almacen: number;
    p_lecturas: {
      uid: string;
      tipo: TipoPaleta;
      cantidad_paquetes: number;
      timestamp?: string;
    }[];
    p_id_transaccion_offline: string;
    resumen?: {
      numero_orden: string;
      sku: string;
      paletas: number;
      puchos: number;
      total_tags: number;
    };
  };
  creado_en: string;
  intentos_sincronizacion: number;
  ultimo_error?: string;
}

export interface Almacen {
  id_almacen: number;
  nombre: string;
  tipo?: string;
  capacidad_m3?: number;
  activo?: boolean;
}

export interface ConciliacionResultado {
  ok: boolean;
  idempotente?: boolean;
  id_sesion?: number;
  estado_conciliacion: 'COMPLETA' | 'SOBRANTES' | 'FALTANTES';
  cantidad_esperada?: number;
  cantidad_recibida?: number;
  diferencia_unidades?: number;
  paletas_completas?: number;
  paquetes_puchos?: number;
  tags_procesados?: number;
  mensaje?: string;
}

export interface MovimientoStockItem {
  id_movimiento: number;
  tipo: string;
  cantidad_afectada: number;
  fecha_hora: string;
  almacen_destino?: string;
  motivo?: string;
}

export interface StockAlmacenItem {
  id_almacen: number;
  nombre_almacen: string;
  stock_real: number;
  stock_minimo: number;
  estado_semaforo: 'VERDE' | 'AMARILLO' | 'ROJO' | string;
}

export interface ConsultaManualProductoResultado {
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
  filtro_almacen_id: number;
  stock_total: number;
  stock_minimo_total: number;
  estado_semaforo_global: 'VERDE' | 'AMARILLO' | 'ROJO' | string;
  desglose_almacenes: StockAlmacenItem[];
  movimientos: MovimientoStockItem[];
}

export interface FichaTagRFID {
  encontrado: boolean;
  uid_tag: string;
  estado_tag?: string;
  tipo_paleta?: TipoPaleta;
  cantidad_paquetes?: number;
  cantidad_actual?: number;
  almacen_nombre?: string;
  id_almacen?: number;
  fecha_registro?: string;
  orden_asociada?: string;
  sesion_id?: number;
  producto?: {
    id_producto: number;
    sku: string;
    nombre: string;
    descripcion?: string;
    categoria?: string;
    unidad_medida: string;
    clasificacion_abc?: string;
    regla_empaque: ReglaEmpaque;
  };
  inventario_almacen?: {
    stock_real: number;
    stock_minimo: number;
    estado_semaforo: 'VERDE' | 'AMARILLO' | 'ROJO' | string;
  };
  mensaje_error?: string;
}

export interface PaletaBodegaItem {
  id_etiqueta: number;
  uid_tag: string;
  tipo_paleta: TipoPaleta;
  cantidad_paquetes: number;
  cantidad_actual: number;
  estado: string;
  id_almacen: number;
  nombre_almacen: string;
  id_producto: number;
  sku: string;
  nombre_producto: string;
  unidad_medida: string;
  unidades_por_caja: number;
  fecha_registro: string;
}

export interface ItemDespachoMovimiento {
  id_etiqueta: number;
  uid_tag: string;
  id_producto: number;
  sku: string;
  nombre_producto: string;
  tipo_paleta_actual: TipoPaleta;
  cantidad_paquetes_actual: number;
  cantidad_unidades_actual: number;
  unidades_por_caja: number;
  tipo_movimiento: 'DESPACHO_COMPLETO' | 'RETIRO_PARCIAL';
  paquetes_a_retirar: number;
  unidades_a_retirar: number;
  nuevo_tipo_paleta: TipoPaleta;
  paquetes_restantes: number;
  unidades_restantes: number;
  motivo: string;
  id_almacen_destino?: number;
  nombre_almacen_destino?: string;
  yaExisteOtroPucho: boolean;
  uidOtroPucho?: string;
}

export interface ResultadoDespachoMovimiento {
  ok: boolean;
  items_procesados: number;
  unidades_totales_retiradas: number;
  mensaje: string;
  detalles?: string[];
}

export interface HistorialKardexItem {
  id_movimiento: number;
  fecha: string;
  tipo: string;
  cantidad_afectada: number;
  motivo: string;
  producto_sku: string;
  producto_nombre: string;
  usuario_nombre?: string;
  almacen_nombre?: string;
}

export type ScreenId =
  | 'LOGIN'
  | 'SELECT_ALMACEN'
  | 'STANDBY'
  | 'MAIN_MENU'
  | 'MOD_1_STOCK'
  | 'MOD_2_MOVIMIENTOS'
  | 'MOD_3_RECEPCION'
  | 'MOD_4_AUDITORIA'
  | 'MOD_5_COLA_OFFLINE'
  | 'MOD_6_INFO'
  | 'MOD_7_CONFIG'
  | 'MOD_8_HISTORIAL';

