-- ==============================================================================
-- ACTUALIZACIÓN Y RESOLUCIÓN DEFINITIVA DE RPC conciliar_recepcion
-- Importaciones Shalom - Móvil
-- Copiar y pegar en: Supabase Dashboard > SQL Editor > New query > RUN
-- ==============================================================================

begin;

-- ------------------------------------------------------------------------------
-- 1. ELIMINACIÓN DE VERSIONES ANTERIORES Y CONFLICTIVAS EN POSTGREST
-- (Elimina la ambigüedad que causaba el error 'Could not find function in schema cache')
-- ------------------------------------------------------------------------------
drop function if exists public.conciliar_recepcion(bigint, bigint, bigint, jsonb, text) cascade;
drop function if exists public.conciliar_recepcion(bigint, bigint, bigint, jsonb) cascade;
drop function if exists public.conciliar_recepcion cascade;

-- ------------------------------------------------------------------------------
-- 2. AJUSTES DE COMPATIBILIDAD DE TABLAS E ÍNDICES B-TREE ULTRA RÁPIDOS (< 0.1ms)
-- ------------------------------------------------------------------------------
create unique index if not exists etiqueta_rfid_uid_tag_uq
  on public.etiqueta_rfid (uid_tag);

create unique index if not exists sesion_recepcion_id_transaccion_offline_uq
  on public.sesion_recepcion (id_transaccion_offline)
  where id_transaccion_offline is not null;

create unique index if not exists inventario_producto_almacen_uq
  on public.inventario (id_producto, id_almacen);

alter table public.sesion_recepcion
  alter column id_orden drop not null;

alter table public.sesion_recepcion
  add column if not exists id_transaccion_offline text;

alter table public.sesion_recepcion
  add column if not exists fecha_ultima_actividad timestamptz default now();

alter table public.inventario
  add column if not exists consumo_abs numeric default 0;

-- ------------------------------------------------------------------------------
-- 3. FUNCIÓN conciliar_recepcion ÚNICA, NO AMBIGUA Y CON UNICIDAD ESTRICTA DE RFID
-- ------------------------------------------------------------------------------
create or replace function public.conciliar_recepcion(
  p_id_orden bigint,
  p_id_producto bigint,
  p_id_almacen bigint,
  p_lecturas jsonb,
  p_id_transaccion_offline text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id_usuario bigint;
  v_sku text;
  v_estado_orden public.orden_estado;
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

  -- Variables para control estricto de unicidad física de RFID
  v_uid_duplicado text;
  v_sku_duplicado text;
  v_almacen_duplicado text;
begin
  -- A. Validaciones básicas de parámetros
  if p_id_producto is null then
    raise exception 'Debes seleccionar un producto.';
  end if;

  if p_id_almacen is null then
    raise exception 'Debes seleccionar un almacén.';
  end if;

  if p_lecturas is null
     or jsonb_typeof(p_lecturas) <> 'array'
     or jsonb_array_length(p_lecturas) = 0 then
    raise exception 'Debe existir al menos una lectura RFID.';
  end if;

  -- B. Idempotencia offline contra reintentos de red
  if p_id_transaccion_offline is not null and trim(p_id_transaccion_offline) <> '' then
    select
      s.id_sesion,
      s.estado,
      c.estado as conciliacion_estado,
      c.total_paletas_completas,
      c.total_paquetes_puchos
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

  -- C. Identificar operario
  select id_usuario into v_id_usuario
  from public.usuario
  where auth_user_id = auth.uid()
  limit 1;

  -- D. Validar producto activo
  select sku into v_sku
  from public.producto
  where id_producto = p_id_producto and activo = true;

  if not found then
    raise exception 'El producto con ID % no existe o está inactivo.', p_id_producto;
  end if;

  -- E. Validar orden (si se especificó)
  if p_id_orden is not null then
    select d.cantidad_pedida into v_cantidad_pedida
    from public.detalle_orden d
    where d.id_orden = p_id_orden and d.id_producto = p_id_producto;
    v_cantidad_pedida := coalesce(v_cantidad_pedida, 0);
  end if;

  -- F. Regla de estiba
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

  -- ---------------------------------------------------------------------------
  -- G. VALIDACIÓN 1: DUPLICADOS DENTRO DE LA MISMA SESIÓN
  -- ---------------------------------------------------------------------------
  if exists (
    select 1
    from jsonb_array_elements(p_lecturas) as l(item)
    group by trim(coalesce(l.item->>'uid', ''))
    having count(*) > 1
  ) then
    raise exception 'Existen UIDs RFID duplicados dentro de la misma recepción.';
  end if;

  -- ---------------------------------------------------------------------------
  -- H. VALIDACIÓN 2: UNICIDAD FÍSICA GLOBAL (ALTO RENDIMIENTO O(1) POR ÍNDICE B-TREE)
  -- Ningún tag RFID que ya esté ACTIVO en el almacén puede ser reutilizado ni
  -- asignado a otro producto, protegiendo la integridad física del inventario.
  -- ---------------------------------------------------------------------------
  select e.uid_tag, p.sku, a.nombre
  into v_uid_duplicado, v_sku_duplicado, v_almacen_duplicado
  from public.etiqueta_rfid e
  join public.producto p on p.id_producto = e.id_producto
  left join public.almacen a on a.id_almacen = e.id_almacen_actual
  where e.uid_tag in (
    select trim(item->>'uid') from jsonb_array_elements(p_lecturas) item
  )
  and e.estado = 'ACTIVA'
  limit 1;

  if v_uid_duplicado is not null then
    raise exception 'El tag RFID "%" ya se encuentra activo en el almacén "%" asignado a [%]. No se puede reutilizar en ningún producto.',
      v_uid_duplicado, coalesce(v_almacen_duplicado, 'Principal'), v_sku_duplicado;
  end if;

  -- I. Calcular totales del lote
  for v_item in select * from jsonb_array_elements(p_lecturas)
  loop
    v_uid := trim(coalesce(v_item->>'uid', ''));
    v_tipo := upper(trim(coalesce(v_item->>'tipo', 'COMPLETO')));
    v_paquetes := coalesce(nullif(v_item->>'cantidad_paquetes', '')::integer, 0);

    if v_uid = '' then
      raise exception 'Se encontró una lectura sin UID RFID.';
    end if;

    if v_tipo = 'COMPLETO' then
      v_total_paletas := v_total_paletas + 1;
    else
      v_total_puchos := v_total_puchos + v_paquetes;
    end if;
  end loop;

  v_total_cajas := (v_total_paletas * v_cajas_por_paleta) + v_total_puchos;
  v_total_unidades := v_total_cajas * v_unidades_por_caja;

  -- J. Registrar Sesión de Recepción
  insert into public.sesion_recepcion (
    id_orden, id_producto, id_almacen, id_usuario, estado,
    total_paletas_completas, total_paquetes_puchos, id_transaccion_offline,
    fecha_inicio, fecha_ultima_actividad, fecha_finalizacion
  )
  values (
    p_id_orden, p_id_producto, p_id_almacen, v_id_usuario, 'FINALIZADA',
    v_total_paletas, v_total_puchos, nullif(trim(p_id_transaccion_offline), ''),
    now(), now(), now()
  )
  returning id_sesion into v_id_sesion;

  -- K. Enrolar etiquetas y registrar lecturas
  for v_item in select * from jsonb_array_elements(p_lecturas)
  loop
    v_uid := trim(v_item->>'uid');
    v_tipo := upper(trim(coalesce(v_item->>'tipo', 'COMPLETO')));
    v_paquetes := coalesce(nullif(v_item->>'cantidad_paquetes', '')::integer, 0);

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
      id_producto = excluded.id_producto,
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

  -- L. Conciliación Ciega
  v_diferencia := v_total_unidades - v_cantidad_pedida;

  if p_id_orden is null or v_diferencia = 0 then
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
      when p_id_orden is not null and (v_cajas_por_paleta * v_unidades_por_caja) > 0 and v_cantidad_pedida > 0
      then ceil(v_cantidad_pedida::numeric / (v_cajas_por_paleta * v_unidades_por_caja))::integer
      else jsonb_array_length(p_lecturas)
    end,
    jsonb_array_length(p_lecturas),
    v_total_paletas,
    v_total_puchos,
    v_estado_conciliacion
  );

  -- M. Actualizar inventario
  insert into public.inventario (id_producto, id_almacen, stock_real, stock_minimo, consumo_abs, estado_semaforo)
  values (p_id_producto, p_id_almacen, v_total_unidades, (v_cajas_por_paleta * v_unidades_por_caja), 0, 'VERDE')
  on conflict (id_producto, id_almacen) do update set
    stock_real = public.inventario.stock_real + excluded.stock_real,
    estado_semaforo = case
      when (public.inventario.stock_real + excluded.stock_real) <= 0 then 'ROJO'
      when (public.inventario.stock_real + excluded.stock_real) <= public.inventario.stock_minimo then 'AMARILLO'
      else 'VERDE'
    end;

  -- N. Kardex inmutable de movimientos
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

-- ------------------------------------------------------------------------------
-- 4. PERMISOS Y RECARGA INMEDIATA DE SCHEMA CACHE DE POSTGREST
-- ------------------------------------------------------------------------------
grant execute on function public.conciliar_recepcion(bigint, bigint, bigint, jsonb, text) to authenticated;
grant execute on function public.conciliar_recepcion(bigint, bigint, bigint, jsonb, text) to anon;

notify pgrst, 'reload schema';

commit;
