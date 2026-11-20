-- =====================================================================
-- Plataforma de tests · 03_profesor_alumnos.sql
-- Permite que el PROFESOR (sesión iniciada, correo en public.profesores)
-- dé de alta, cambie el código o dé de baja alumnos desde Kronos.
-- Ejecutar una vez en Supabase → SQL Editor. Se puede repetir sin problema.
--
-- Kronos NUNCA envía el código en claro: manda su hash,
--   sha256('plataforma-tests:' || CÓDIGO_EN_MAYÚSCULAS_SIN_GUION)  en hexadecimal,
-- que es exactamente lo que calcula public._hash_codigo().
-- =====================================================================

-- Alta o actualización de un grupo y sus alumnos, en una sola llamada.
-- p_alumnos = [{ "id": "TDA2-07", "hash": "<64 hex>", "activo": true }, …]
create or replace function public.profe_alta_alumnos(p_grupo text, p_nombre text, p_alumnos jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb; n int := 0;
begin
  if not public.es_profesor() then raise exception 'no_autorizado'; end if;
  if p_grupo !~ '^[A-Z0-9]{2,12}$' then raise exception 'grupo_no_valido'; end if;
  if jsonb_typeof(p_alumnos) is distinct from 'array' or jsonb_array_length(p_alumnos) > 60 then
    raise exception 'lista_no_valida';
  end if;
  insert into public.grupos(id, nombre) values (p_grupo, left(coalesce(nullif(p_nombre, ''), p_grupo), 60))
  on conflict (id) do update set nombre = excluded.nombre;
  for a in select * from jsonb_array_elements(p_alumnos) loop
    if (a ->> 'id') !~ ('^' || p_grupo || '-[0-9]{2,3}$') then raise exception 'id_no_valido: %', a ->> 'id'; end if;
    if (a ->> 'hash') !~ '^[0-9a-f]{64}$' then raise exception 'hash_no_valido: %', a ->> 'id'; end if;
    insert into public.alumnos(id, grupo, codigo_hash, activo)
    values (a ->> 'id', p_grupo, a ->> 'hash', coalesce((a ->> 'activo')::boolean, true))
    on conflict (id) do update set codigo_hash = excluded.codigo_hash, activo = excluded.activo, grupo = excluded.grupo;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'alumnos', n);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_repetido');   -- dos alumnos con el mismo código: Kronos genera otro
end $$;

-- Dar de baja (no borra sus intentos: dejan de poder entrar y salen como inactivos)
create or replace function public.profe_baja_alumno(p_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_profesor() then raise exception 'no_autorizado'; end if;
  update public.alumnos set activo = false where id = p_id;
  return jsonb_build_object('ok', found);
end $$;

revoke all on function public.profe_alta_alumnos(text, text, jsonb) from public, anon;
revoke all on function public.profe_baja_alumno(text)               from public, anon;
grant execute on function public.profe_alta_alumnos(text, text, jsonb) to authenticated;
grant execute on function public.profe_baja_alumno(text)               to authenticated;
