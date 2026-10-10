-- ==============================================================================
-- SCRIPT DE AJUSTE Y SEMBRADO MAESTRO PARA SUPABASE (IMPORTACIONES SHALOM)
-- Copiar y pegar completo en: Supabase Dashboard > SQL Editor > New query > RUN
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. CORRECCIÓN DE RESTRICCIÓN NOT NULL EN SESION_RECEPCION
-- ------------------------------------------------------------------------------
alter table if exists public.sesion_recepcion
  alter column id_orden drop not null;

alter table if exists public.sesion_recepcion
  add column if not exists id_transaccion_offline text unique;

-- ------------------------------------------------------------------------------
-- 2. CATEGORÍA Y PROVEEDOR (INSERT SEGURO SIN CONFLICTOS)
-- ------------------------------------------------------------------------------
insert into public.categoria (nombre, descripcion, activo)
select 'Suministros y Empaques', 'Artículos para despacho y punto de venta', true
where not exists (
  select 1 from public.categoria where nombre = 'Suministros y Empaques'
);

insert into public.proveedor (razon_social, calificacion_otif, tiempo_lead_time_dias, activo)
select 'Zhejiang Shalom Trading Co., Ltd.', 96.5, 35, true
where not exists (
  select 1 from public.proveedor where razon_social = 'Zhejiang Shalom Trading Co., Ltd.'
);

-- ------------------------------------------------------------------------------
-- 3. PRODUCTOS MAESTROS (ON CONFLICT SKU)
-- ------------------------------------------------------------------------------
insert into public.producto (
  id_categoria, sku, nombre, descripcion,
  unidad_medida, peso_unitario_kg, clasificacion_abc, costo_unitario, activo
)
values (
  (select id_categoria from public.categoria where nombre = 'Suministros y Empaques' limit 1),
  'ROLLO-CONTOMETRO-01', 'Rollo Contómetro Térmico 80x80',
  'Rollo de papel térmico para POS y comprobantes', 'ROLLO', 0.250, 'A', 2.50, true
)
on conflict (sku) do update set
  nombre = excluded.nombre, costo_unitario = excluded.costo_unitario, activo = true;

insert into public.producto (
  id_categoria, sku, nombre, descripcion,
  unidad_medida, peso_unitario_kg, clasificacion_abc, costo_unitario, activo
)
values (
  (select id_categoria from public.categoria where nombre = 'Suministros y Empaques' limit 1),
  'CINTA-EMBALAJE-02', 'Cinta de Embalaje Transparente 2x100m',
  'Cinta de embalaje industrial para sellado de cajas', 'ROLLO', 0.180, 'B', 1.80, true
)
on conflict (sku) do update set
  nombre = excluded.nombre, costo_unitario = excluded.costo_unitario, activo = true;

-- ------------------------------------------------------------------------------
-- 4. REGLAS DE EMPAQUE (LIMPIEZA E INSERCIÓN DIRECTA SIN ERROR 42P10)
-- ------------------------------------------------------------------------------
delete from public.regla_empaque
where id_producto in (
  select id_producto from public.producto where sku in ('ROLLO-CONTOMETRO-01', 'CINTA-EMBALAJE-02')
);

insert into public.regla_empaque (
  id_producto, unidades_por_caja, cajas_por_camada, numero_camadas,
  cajas_por_camita, camitas_por_paleta, permite_puchos, volumen_caja_m3, volumen_total_m3
)
select p.id_producto, 10, 30, 1, 30, 1, true, 0.0300, 0.9000
from public.producto p
where p.sku = 'ROLLO-CONTOMETRO-01';

insert into public.regla_empaque (
  id_producto, unidades_por_caja, cajas_por_camada, numero_camadas,
  cajas_por_camita, camitas_por_paleta, permite_puchos, volumen_caja_m3, volumen_total_m3
)
select p.id_producto, 36, 8, 5, 8, 5, true, 0.0200, 0.8000
from public.producto p
where p.sku = 'CINTA-EMBALAJE-02';

-- ------------------------------------------------------------------------------
-- 5. ÓRDENES DE IMPORTACIÓN Y DETALLES EN TRÁNSITO
-- ------------------------------------------------------------------------------
insert into public.orden_importacion (
  numero_orden, id_proveedor, estado, fecha_emision, tipo_contenedor, volumen_ocupado_m3
)
values (
  'ORD-2026-001',
  (select id_proveedor from public.proveedor limit 1),
  'TRANSITO', current_date, '40FT', 58.5
)
on conflict (numero_orden) do update set estado = 'TRANSITO';

insert into public.orden_importacion (
  numero_orden, id_proveedor, estado, fecha_emision, tipo_contenedor, volumen_ocupado_m3
)
values (
  'ORD-2026-002',
  (select id_proveedor from public.proveedor limit 1),
  'TRANSITO', current_date, '40FT', 45.0
)
on conflict (numero_orden) do update set estado = 'TRANSITO';

delete from public.detalle_orden
where id_orden in (
  select id_orden from public.orden_importacion where numero_orden in ('ORD-2026-001', 'ORD-2026-002')
);

insert into public.detalle_orden (
  id_orden, id_producto, cantidad_pedida, subtotal_peso_kg, subtotal_volumen_m3
)
select o.id_orden, p.id_producto, 980, 735.0, 2.94
from public.orden_importacion o
cross join public.producto p
where o.numero_orden = 'ORD-2026-001' and p.sku = 'ROLLO-CONTOMETRO-01';

insert into public.detalle_orden (
  id_orden, id_producto, cantidad_pedida, subtotal_peso_kg, subtotal_volumen_m3
)
select o.id_orden, p.id_producto, 1500, 500.0, 2.00
from public.orden_importacion o
cross join public.producto p
where o.numero_orden = 'ORD-2026-002' and p.sku = 'CINTA-EMBALAJE-02';

-- ------------------------------------------------------------------------------
-- 6. INVENTARIO EN ALMACÉN PRINCIPAL (ID: 1)
-- ------------------------------------------------------------------------------
insert into public.inventario (id_producto, id_almacen, stock_real, stock_minimo, estado_semaforo)
select p.id_producto, 1, 0, 300, 'ROJO'
from public.producto p
where p.sku in ('ROLLO-CONTOMETRO-01', 'CINTA-EMBALAJE-02')
on conflict (id_producto, id_almacen) do nothing;

-- ------------------------------------------------------------------------------
-- 7. POLÍTICAS RLS PARA LECTURA Y OPERARIOS
-- ------------------------------------------------------------------------------
drop policy if exists "producto_lectura" on public.producto;
create policy "producto_lectura" on public.producto for select to authenticated using (true);

drop policy if exists "regla_empaque_lectura" on public.regla_empaque;
create policy "regla_empaque_lectura" on public.regla_empaque for select to authenticated using (true);

drop policy if exists "orden_importacion_lectura" on public.orden_importacion;
create policy "orden_importacion_lectura" on public.orden_importacion for select to authenticated using (true);

drop policy if exists "detalle_orden_lectura" on public.detalle_orden;
create policy "detalle_orden_lectura" on public.detalle_orden for select to authenticated using (true);

drop policy if exists "almacen_lectura" on public.almacen;
create policy "almacen_lectura" on public.almacen for select to authenticated using (true);

alter table public.sesion_recepcion enable row level security;
drop policy if exists "sesion_recepcion_todas" on public.sesion_recepcion;
create policy "sesion_recepcion_todas" on public.sesion_recepcion for all to authenticated using (true) with check (true);

alter table public.recepcion_lectura enable row level security;
drop policy if exists "recepcion_lectura_todas" on public.recepcion_lectura;
create policy "recepcion_lectura_todas" on public.recepcion_lectura for all to authenticated using (true) with check (true);

alter table public.etiqueta_rfid enable row level security;
drop policy if exists "etiqueta_rfid_todas" on public.etiqueta_rfid;
create policy "etiqueta_rfid_todas" on public.etiqueta_rfid for all to authenticated using (true) with check (true);

alter table public.conciliacion_ciega enable row level security;
drop policy if exists "conciliacion_ciega_todas" on public.conciliacion_ciega;
create policy "conciliacion_ciega_todas" on public.conciliacion_ciega for all to authenticated using (true) with check (true);

alter table public.inventario enable row level security;
drop policy if exists "inventario_operario" on public.inventario;
create policy "inventario_operario" on public.inventario for all to authenticated using (true) with check (true);

alter table public.movimiento enable row level security;
drop policy if exists "movimiento_operario" on public.movimiento;
create policy "movimiento_operario" on public.movimiento for all to authenticated using (true) with check (true);

-- ------------------------------------------------------------------------------
-- 8. FUNCIÓN conciliar_recepcion BLINDADA
-- ------------------------------------------------------------------------------
create or replace function public.conciliar_recepcion(
  p_id_orden bigint,
  p_id_producto bigint,
  p_id_almacen bigint,
  p_lecturas jsonb,
  p_id_transaccion_offline text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_id_usuario bigint;
  v_sku text;
  v_cantidad_pedida integer := 0;
  v_unidades_por_caja integer := 1;
  v_cajas_por_paleta integer := 1;
  v_total_paletas integer := 0;
  v_total_puchos integer := 0;
  v_total_cajas integer := 0;
  v_total_unidades numeric := 0;
  v_id_sesion bigint;
  v_item jsonb;
  v_uid text;
  v_tipo text;
  v_paquetes integer;
  v_cajas_item integer;
  v_unidades_item numeric;
  v_id_etiqueta bigint;
  v_estado_conciliacion public.conciliacion_estado;
  v_diferencia numeric;
  v_sesion_previa record;
begin
  if p_id_transaccion_offline is not null and trim(p_id_transaccion_offline) <> '' then
    select s.id_sesion, s.estado, c.estado as conciliacion_estado, c.total_paletas_completas, c.total_paquetes_puchos
    into v_sesion_previa
    from public.sesion_recepcion s
    left join public.conciliacion_ciega c on c.id_sesion = s.id_sesion
    where s.id_transaccion_offline = trim(p_id_transaccion_offline);

    if found then
      return jsonb_build_object(
        'ok', true,
        'idempotente', true,
        'mensaje', 'Transacción previamente procesada.',
        'id_sesion', v_sesion_previa.id_sesion,
        'estado_conciliacion', v_sesion_previa.conciliacion_estado,
        'paletas_completas', v_sesion_previa.total_paletas_completas,
        'paquetes_puchos', v_sesion_previa.total_paquetes_puchos
      );
    end if;
  end if;

  select id_usuario into v_id_usuario from public.usuario where auth_user_id = auth.uid() limit 1;

  select sku into v_sku from public.producto where id_producto = p_id_producto and activo = true;
  if not found then
    raise exception 'El producto ID % no existe o está inactivo.', p_id_producto;
  end if;

  if p_id_orden is not null then
    select cantidad_pedida into v_cantidad_pedida
    from public.detalle_orden
    where id_orden = p_id_orden and id_producto = p_id_producto;
    v_cantidad_pedida := coalesce(v_cantidad_pedida, 0);
  end if;

  select
    coalesce(r.unidades_por_caja, 1),
    case
      when coalesce(r.cajas_por_camada, 0) > 0 and coalesce(r.numero_camadas, 0) > 0
        then (r.cajas_por_camada * r.numero_camadas)
      when coalesce(r.cajas_por_camita, 0) > 0 and coalesce(r.camitas_por_paleta, 0) > 0
        then (r.cajas_por_camita * r.camitas_por_paleta)
      else 30
    end
  into v_unidades_por_caja, v_cajas_por_paleta
  from public.regla_empaque r
  where r.id_producto = p_id_producto;

  v_unidades_por_caja := coalesce(v_unidades_por_caja, 1);
  v_cajas_por_paleta := coalesce(v_cajas_por_paleta, 30);

  for v_item in select * from jsonb_array_elements(p_lecturas)
  loop
    v_uid := trim(coalesce(v_item->>'uid', ''));
    v_tipo := upper(trim(coalesce(v_item->>'tipo', 'COMPLETO')));
    v_paquetes := coalesce((v_item->>'cantidad_paquetes')::integer, 0);

    if v_tipo = 'COMPLETO' then
      v_total_paletas := v_total_paletas + 1;
    else
      v_total_puchos := v_total_puchos + v_paquetes;
    end if;
  end loop;

  v_total_cajas := (v_total_paletas * v_cajas_por_paleta) + v_total_puchos;
  v_total_unidades := v_total_cajas * v_unidades_por_caja;

  insert into public.sesion_recepcion (
    id_orden, id_producto, id_almacen, id_usuario, estado,
    total_paletas_completas, total_paquetes_puchos, id_transaccion_offline,
    fecha_inicio, fecha_finalizacion
  )
  values (
    p_id_orden, p_id_producto, p_id_almacen, v_id_usuario, 'FINALIZADA',
    v_total_paletas, v_total_puchos, nullif(trim(p_id_transaccion_offline), ''),
    now(), now()
  )
  returning id_sesion into v_id_sesion;

  for v_item in select * from jsonb_array_elements(p_lecturas)
  loop
    v_uid := trim(v_item->>'uid');
    v_tipo := upper(trim(coalesce(v_item->>'tipo', 'COMPLETO')));
    v_paquetes := coalesce((v_item->>'cantidad_paquetes')::integer, 0);

    if v_tipo = 'COMPLETO' then
      v_cajas_item := v_cajas_por_paleta;
      v_unidades_item := v_cajas_por_paleta * v_unidades_por_caja;
    else
      v_cajas_item := v_paquetes;
      v_unidades_item := v_paquetes * v_unidades_por_caja;
    end if;

    insert into public.etiqueta_rfid (
      uid_tag, id_producto, tipo_paleta, cantidad_paquetes, cantidad_actual, estado, id_almacen_actual
    )
    values (
      v_uid, p_id_producto, v_tipo::public.tipo_paleta, v_cajas_item, v_unidades_item, 'ACTIVA', p_id_almacen
    )
    on conflict (uid_tag) do update set
      tipo_paleta = excluded.tipo_paleta,
      cantidad_paquetes = excluded.cantidad_paquetes,
      cantidad_actual = excluded.cantidad_actual,
      estado = 'ACTIVA',
      id_almacen_actual = excluded.id_almacen_actual
    returning id_etiqueta into v_id_etiqueta;

    insert into public.recepcion_lectura (
      id_sesion, id_etiqueta, uid_tag, tipo_carga, cantidad_paquetes, cantidad_unidades, valido
    )
    values (
      v_id_sesion, v_id_etiqueta, v_uid, v_tipo::public.tipo_paleta, v_cajas_item, v_unidades_item, true
    );
  end loop;

  v_diferencia := v_total_unidades - v_cantidad_pedida;

  if v_cantidad_pedida = 0 or v_diferencia = 0 then
    v_estado_conciliacion := 'COMPLETA';
  elsif v_diferencia < 0 then
    v_estado_conciliacion := 'FALTANTES';
  else
    v_estado_conciliacion := 'SOBRANTES';
  end if;

  insert into public.conciliacion_ciega (
    id_sesion, tags_esperados, tags_leidos, total_paletas_completas, total_paquetes_puchos, estado
  )
  values (
    v_id_sesion,
    case
      when (v_cajas_por_paleta * v_unidades_por_caja) > 0 and v_cantidad_pedida > 0
      then ceil(v_cantidad_pedida::numeric / (v_cajas_por_paleta * v_unidades_por_caja))::integer
      else jsonb_array_length(p_lecturas)
    end,
    jsonb_array_length(p_lecturas),
    v_total_paletas,
    v_total_puchos,
    v_estado_conciliacion
  );

  insert into public.inventario (id_producto, id_almacen, stock_real, stock_minimo, estado_semaforo)
  values (p_id_producto, p_id_almacen, v_total_unidades, (v_cajas_por_paleta * v_unidades_por_caja), 'VERDE')
  on conflict (id_producto, id_almacen) do update set
    stock_real = public.inventario.stock_real + excluded.stock_real,
    estado_semaforo = case
      when (public.inventario.stock_real + excluded.stock_real) <= 0 then 'ROJO'
      when (public.inventario.stock_real + excluded.stock_real) <= public.inventario.stock_minimo then 'AMARILLO'
      else 'VERDE'
    end;

  insert into public.movimiento (
    id_usuario, id_producto, tipo, cantidad_afectada, destino_almacen, id_sesion, motivo
  )
  values (
    v_id_usuario, p_id_producto, 'INGRESO_COMPLETO', v_total_unidades, p_id_almacen, v_id_sesion,
    format('Recepción RFID Orden #%s [%s]: %s paletas + %s puchos = %s unidades (%s)',
      coalesce(p_id_orden::text, 'S/O'), v_sku, v_total_paletas, v_total_puchos, v_total_unidades, v_estado_conciliacion)
  );

  return jsonb_build_object(
    'ok', true,
    'idempotente', false,
    'id_sesion', v_id_sesion,
    'estado_conciliacion', v_estado_conciliacion,
    'cantidad_esperada', v_cantidad_pedida,
    'cantidad_recibida', v_total_unidades,
    'diferencia_unidades', v_diferencia,
    'paletas_completas', v_total_paletas,
    'paquetes_puchos', v_total_puchos,
    'tags_procesados', jsonb_array_length(p_lecturas)
  );
end;
$$;

grant execute on function public.conciliar_recepcion(bigint, bigint, bigint, jsonb, text) to authenticated;
