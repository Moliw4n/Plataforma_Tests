-- =====================================================================
-- Kiron · 10_alumnos_carga.sql  (fase 2)
-- SOLO PARA EL PROYECTO DE PRUEBAS. Añade 20 alumnos INVENTADOS más (PRUEBA-06 … PRUEBA-25), hasta 25, para simular una clase entera
-- en el modo directo (npm run ensayo:simular -- directo …). Se ejecuta DESPUÉS de 05_datos_prueba.sql. Se puede repetir.
--
-- Códigos: LOAD06 … LOAD25 (PRUEBA-06 → LOAD06, PRUEBA-07 → LOAD07, …). Aquí no hay ningún dato personal.
--
-- SEGURO: si la base ya tiene alumnos que no son de prueba, este script se niega a ejecutarse (no se puede lanzar por error en el proyecto real).
-- =====================================================================

do $$
begin
  if exists (select 1 from public.alumnos where id not like 'PRUEBA-%') then
    raise exception 'Esta base tiene alumnos reales. 10_alumnos_carga.sql es solo para el proyecto de pruebas: no se ha cambiado nada.';
  end if;
  if not exists (select 1 from public.grupos where id = 'PRUEBA') then
    raise exception 'Falta el grupo PRUEBA: ejecuta antes 05_datos_prueba.sql.';
  end if;
end $$;

insert into public.alumnos(id, grupo, codigo_hash, activo)
select 'PRUEBA-' || lpad(n::text, 2, '0'), 'PRUEBA', public._hash_codigo('LOAD' || lpad(n::text, 2, '0')), true
  from generate_series(6, 25) n
on conflict (id) do update set codigo_hash = excluded.codigo_hash, activo = excluded.activo, grupo = excluded.grupo;

-- Comprobación: debe salir 25
select count(*) as alumnos_de_prueba from public.alumnos where grupo = 'PRUEBA';
