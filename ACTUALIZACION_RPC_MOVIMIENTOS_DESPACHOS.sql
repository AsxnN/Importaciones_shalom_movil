-- ==============================================================================
-- ACTUALIZACIÓN Y RPC PARA MÓDULO 2: MOVIMIENTOS Y DESPACHOS
-- Sistema Táctico Shalom Móvil
-- Copiar y pegar en: Supabase Dashboard > SQL Editor > New query > RUN
-- ==============================================================================

begin;

-- ------------------------------------------------------------------------------
-- 1. CORRECCIÓN DE COLUMNAS: EVITAR "VALUE TOO LONG FOR TYPE CHARACTER VARYING(100)"
-- ------------------------------------------------------------------------------
alter table if exists public.movimiento
  alter column motivo type text;

alter table if exists public.inventario
  add column if not exists consumo_abs numeric default 0;

-- ------------------------------------------------------------------------------
-- 2. FUNCIÓN ejecutar_movimiento_despacho CON DESTINO Y REGLA DE MÁXIMO 1 PUCHO
-- ------------------------------------------------------------------------------
create or replace function public.ejecutar_movimiento_despacho(
  p_id_almacen bigint,
  p_movimientos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id_usuario bigint;
  v_item jsonb;
  v_uid text;
  v_tipo_mov text;
  v_motivo text;
  v_paquetes_a_retirar integer;
  v_id_almacen_destino bigint;
  v_nombre_destino text;
  v_nombre_origen text;

  -- Variables de la etiqueta
  v_id_etiqueta bigint;
  v_id_producto bigint;
  v_sku text;
  v_nombre_prod text;
  v_tipo_paleta_actual public.tipo_paleta;
  v_paquetes_actual integer;
  v_unidades_actual numeric;
  v_unidades_por_caja integer;

  -- Variables de cálculo
  v_unidades_retiradas numeric;
  v_paquetes_restantes integer;
  v_unidades_restantes numeric;
  v_motivo_kardex text;

  -- Regla de máximo 1 pucho
  v_uid_pucho_existente text;

  -- Acumuladores de respuesta
  v_total_items integer := 0;
  v_total_unidades_retiradas numeric := 0;
  v_detalles text[] := array[]::text[];
begin
  -- A. Validaciones básicas
  if p_id_almacen is null then
    raise exception 'Debes seleccionar un almacén origen válido.';
  end if;

  select nombre into v_nombre_origen
  from public.almacen
  where id_almacen = p_id_almacen;

  if p_movimientos is null
     or jsonb_typeof(p_movimientos) <> 'array'
     or jsonb_array_length(p_movimientos) = 0 then
    raise exception 'Debe existir al menos un movimiento a procesar.';
  end if;

  -- B. Identificar operario autenticado
  select id_usuario into v_id_usuario
  from public.usuario
  where auth_user_id = auth.uid()
  limit 1;

  -- C. Procesar cada tag del lote de despacho
  for v_item in select * from jsonb_array_elements(p_movimientos)
  loop
    v_uid := trim(coalesce(v_item->>'uid_tag', ''));
    v_tipo_mov := upper(trim(coalesce(v_item->>'tipo_movimiento', 'DESPACHO_COMPLETO')));
    v_paquetes_a_retirar := coalesce(nullif(v_item->>'paquetes_a_retirar', '')::integer, 0);
    v_motivo := trim(coalesce(v_item->>'motivo', 'Despacho de almacén'));
    
    -- Destino seleccionado para el movimiento
    v_id_almacen_destino := coalesce(nullif(v_item->>'id_almacen_destino', '')::bigint, p_id_almacen);

    select nombre into v_nombre_destino
    from public.almacen
    where id_almacen = v_id_almacen_destino;

    if v_nombre_destino is null then
      v_nombre_destino := 'Destino General';
    end if;

    if v_uid = '' then
      raise exception 'Se encontró un registro sin UID de etiqueta RFID.';
    end if;

    -- Obtener datos de la etiqueta activa en el almacén origen
    select
      e.id_etiqueta,
      e.id_producto,
      p.sku,
      p.nombre,
      e.tipo_paleta,
      coalesce(e.cantidad_paquetes, 1),
      coalesce(e.cantidad_actual, 0),
      coalesce(r.unidades_por_caja, 1)
    into
      v_id_etiqueta,
      v_id_producto,
      v_sku,
      v_nombre_prod,
      v_tipo_paleta_actual,
      v_paquetes_actual,
      v_unidades_actual,
      v_unidades_por_caja
    from public.etiqueta_rfid e
    join public.producto p on p.id_producto = e.id_producto
    left join public.regla_empaque r on r.id_producto = e.id_producto
    where e.uid_tag = v_uid
      and (e.id_almacen_actual = p_id_almacen or e.id_almacen_actual is null)
      and e.estado = 'ACTIVA'
    limit 1;

    if v_id_etiqueta is null then
      raise exception 'El tag RFID "%" no está activo en este almacén o no existe.', v_uid;
    end if;

    -- -------------------------------------------------------------------------
    -- REGLA DE ORO DE ALMACÉN: MÁXIMO 1 PUCHO POR PRODUCTO
    -- Si es retiro parcial y la paleta actual es COMPLETA, pasará a ser PUCHO.
    -- Pero NUNCA puede haber más de 1 paleta pucho activa por producto en almacén.
    -- -------------------------------------------------------------------------
    if v_tipo_mov = 'RETIRO_PARCIAL' then
      if v_paquetes_a_retirar <= 0 then
        raise exception 'Para retiro parcial del tag %, especifica paquetes mayor a cero.', v_uid;
      end if;

      if v_paquetes_a_retirar > v_paquetes_actual then
        raise exception 'No puedes retirar % cajas del tag % porque solo cuenta con % cajas.',
          v_paquetes_a_retirar, v_uid, v_paquetes_actual;
      end if;

      -- Si la paleta era COMPLETO y se va a convertir en PUCHO, verificar que no exista ya otro pucho
      if v_tipo_paleta_actual = 'COMPLETO' and v_paquetes_a_retirar < v_paquetes_actual then
        select e2.uid_tag into v_uid_pucho_existente
        from public.etiqueta_rfid e2
        where e2.id_producto = v_id_producto
          and e2.id_almacen_actual = p_id_almacen
          and e2.tipo_paleta = 'PUCHO'
          and e2.estado = 'ACTIVA'
          and e2.uid_tag <> v_uid
        limit 1;

        if v_uid_pucho_existente is not null then
          raise exception 'RESTRICCIÓN DE ORDEN: El producto [%] ya tiene una paleta con PUCHO activa (Tag "%"). Debes consumir o despachar primero el pucho existente antes de abrir una nueva paleta.',
            v_sku, v_uid_pucho_existente;
        end if;
      end if;

      -- Calcular afectación parcial
      v_unidades_retiradas := v_paquetes_a_retirar * v_unidades_por_caja;
      v_paquetes_restantes := v_paquetes_actual - v_paquetes_a_retirar;
      v_unidades_restantes := v_unidades_actual - v_unidades_retiradas;

      if v_paquetes_restantes <= 0 or v_unidades_restantes <= 0 then
        -- Se retiró todo: pasa a inactiva
        update public.etiqueta_rfid
        set estado = 'INACTIVA',
            cantidad_paquetes = 0,
            cantidad_actual = 0
        where id_etiqueta = v_id_etiqueta;

        v_detalles := array_append(v_detalles,
          format('Tag %s (%s): Retiro total de %s cajas (-%s u) a %s. Paleta agotada.',
            v_uid, v_sku, v_paquetes_actual, v_unidades_retiradas, v_nombre_destino));
      else
        -- Queda remanente: Pasa a ser PUCHO
        update public.etiqueta_rfid
        set tipo_paleta = 'PUCHO',
            cantidad_paquetes = v_paquetes_restantes,
            cantidad_actual = v_unidades_restantes,
            estado = 'ACTIVA'
        where id_etiqueta = v_id_etiqueta;

        v_detalles := array_append(v_detalles,
          format('Tag %s (%s): Retiro parcial de %s cajas (-%s u) a %s. Remanente: %s cajas (Nuevo PUCHO).',
            v_uid, v_sku, v_paquetes_a_retirar, v_unidades_retiradas, v_nombre_destino, v_paquetes_restantes));
      end if;

    elsif v_tipo_mov = 'DESPACHO_COMPLETO' then
      -- Retiro completo de la paleta
      v_unidades_retiradas := v_unidades_actual;

      -- Si se transfiere a otro almacén en el sistema, la paleta pasa al nuevo almacén
      if v_id_almacen_destino <> p_id_almacen and v_id_almacen_destino > 0 then
        update public.etiqueta_rfid
        set id_almacen_actual = v_id_almacen_destino,
            estado = 'ACTIVA'
        where id_etiqueta = v_id_etiqueta;

        v_detalles := array_append(v_detalles,
          format('Tag %s (%s): Transferencia completa de %s cajas a %s.',
            v_uid, v_sku, v_paquetes_actual, v_nombre_destino));
      else
        -- Despacho externo / salida
        update public.etiqueta_rfid
        set estado = 'INACTIVA',
            cantidad_paquetes = 0,
            cantidad_actual = 0
        where id_etiqueta = v_id_etiqueta;

        v_detalles := array_append(v_detalles,
          format('Tag %s (%s): Despacho completo de %s cajas (-%s u) a %s.',
            v_uid, v_sku, v_paquetes_actual, v_unidades_retiradas, v_nombre_destino));
      end if;

    else
      raise exception 'Tipo de movimiento inválido: "%". Use DESPACHO_COMPLETO o RETIRO_PARCIAL.', v_tipo_mov;
    end if;

    -- D. Descontar del inventario del almacén origen
    update public.inventario
    set stock_real = greatest(0, stock_real - v_unidades_retiradas),
        consumo_abs = coalesce(consumo_abs, 0) + v_unidades_retiradas,
        estado_semaforo = case
          when (greatest(0, stock_real - v_unidades_retiradas)) <= 0 then 'ROJO'
          when (greatest(0, stock_real - v_unidades_retiradas)) <= stock_minimo then 'AMARILLO'
          else 'VERDE'
        end
    where id_producto = v_id_producto
      and id_almacen = p_id_almacen;

    -- Si el destino es otro almacén interno, incrementar stock en destino
    if v_id_almacen_destino <> p_id_almacen and v_id_almacen_destino > 0 then
      insert into public.inventario (id_producto, id_almacen, stock_real, stock_minimo, consumo_abs, estado_semaforo)
      values (v_id_producto, v_id_almacen_destino, v_unidades_retiradas, 100, 0, 'VERDE')
      on conflict (id_producto, id_almacen) do update set
        stock_real = public.inventario.stock_real + excluded.stock_real,
        estado_semaforo = case
          when (public.inventario.stock_real + excluded.stock_real) <= 0 then 'ROJO'
          when (public.inventario.stock_real + excluded.stock_real) <= public.inventario.stock_minimo then 'AMARILLO'
          else 'VERDE'
        end;
    end if;

    -- E. Registrar movimiento en Kardex inmutable
    -- CUIDADO: La columna motivo puede ser varchar(100).
    -- Aplicamos substring defensivo a máximo 90 caracteres para garantizar que nunca falle.
    v_motivo_kardex := substring(
      format('%s a %s | Tag %s: %s cj (-%s u)',
        case when v_tipo_mov = 'RETIRO_PARCIAL' then 'Retiro Parcial' else 'Despacho' end,
        v_nombre_destino,
        v_uid,
        coalesce(v_paquetes_a_retirar, v_paquetes_actual),
        v_unidades_retiradas
      ) from 1 for 95
    );

    insert into public.movimiento (
      id_usuario,
      id_producto,
      tipo,
      cantidad_afectada,
      destino_almacen,
      motivo
    )
    values (
      v_id_usuario,
      v_id_producto,
      v_tipo_mov,
      -v_unidades_retiradas,
      v_id_almacen_destino,
      v_motivo_kardex
    );

    v_total_items := v_total_items + 1;
    v_total_unidades_retiradas := v_total_unidades_retiradas + v_unidades_retiradas;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'items_procesados', v_total_items,
    'unidades_totales_retiradas', v_total_unidades_retiradas,
    'mensaje', format('Se ejecutaron %s despachos a %s exitosamente (-%s unidades).',
      v_total_items, v_nombre_destino, v_total_unidades_retiradas),
    'detalles', to_jsonb(v_detalles)
  );
end;
$$;

-- ------------------------------------------------------------------------------
-- 3. PERMISOS Y RECARGA INMEDIATA DE SCHEMA CACHE
-- ------------------------------------------------------------------------------
grant execute on function public.ejecutar_movimiento_despacho(bigint, jsonb) to authenticated;
grant execute on function public.ejecutar_movimiento_despacho(bigint, jsonb) to anon;

notify pgrst, 'reload schema';

commit;
