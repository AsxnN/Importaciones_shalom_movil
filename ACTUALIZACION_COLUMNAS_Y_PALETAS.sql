-- ==============================================================================
-- ACTUALIZACIÓN DE COMPATIBILIDAD Y VISUALIZACIÓN DE PALETAS (IMPORTACIONES SHALOM)
-- Copiar y pegar en: Supabase Dashboard > SQL Editor > New query > RUN
-- ==============================================================================

-- 1. AGREGAR COLUMNAS DE FECHA POR SI SE DESEAN AUDITAR NATIVAMENTE EN BD
alter table if exists public.etiqueta_rfid 
  add column if not exists created_at timestamptz default now();

alter table if exists public.recepcion_lectura
  add column if not exists created_at timestamptz default now();

-- 2. ASIGNAR PRIVILEGIOS DE LECTURA PARA APP MÓVIL
grant select on public.etiqueta_rfid to authenticated, anon;
grant select on public.recepcion_lectura to authenticated, anon;
grant select on public.producto to authenticated, anon;
grant select on public.regla_empaque to authenticated, anon;
grant select on public.almacen to authenticated, anon;
grant select on public.movimiento to authenticated, anon;

-- 3. POLÍTICAS RLS DE LECTURA GENERAL (EVITA QUE RLS OCULTE REGISTROS DE PALETAS)
drop policy if exists "etiqueta_rfid_lectura_all" on public.etiqueta_rfid;
create policy "etiqueta_rfid_lectura_all" on public.etiqueta_rfid for select using (true);

drop policy if exists "recepcion_lectura_lectura_all" on public.recepcion_lectura;
create policy "recepcion_lectura_lectura_all" on public.recepcion_lectura for select using (true);

drop policy if exists "producto_lectura_all" on public.producto;
create policy "producto_lectura_all" on public.producto for select using (true);

drop policy if exists "regla_empaque_lectura_all" on public.regla_empaque;
create policy "regla_empaque_lectura_all" on public.regla_empaque for select using (true);

drop policy if exists "movimiento_lectura_all" on public.movimiento;
create policy "movimiento_lectura_all" on public.movimiento for select using (true);
