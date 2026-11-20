-- =====================================================================
-- Kiron · 05_datos_prueba.sql  (fase 0)
-- SOLO PARA EL PROYECTO DE PRUEBAS. Crea un grupo y 5 alumnos INVENTADOS para ensayar.
-- Ejecutar después de 01_esquema.sql y 03_profesor_alumnos.sql. Se puede repetir.
--
-- Códigos de prueba (se escriben en la pantalla de acceso, con o sin guion):
--   PRUEBA-01 → AAA-222    PRUEBA-02 → BBB-333    PRUEBA-03 → CCC-444
--   PRUEBA-04 → DDD-555    PRUEBA-05 → EEE-666
-- Aquí no hay ningún dato personal: son números y códigos inventados.
--
-- SEGURO: si la base ya tiene alumnos que no son de prueba, este script se niega a ejecutarse.
-- Así no se puede lanzar por error en el proyecto real.
-- =====================================================================

do $$
begin
  if exists (select 1 from public.alumnos where id not like 'PRUEBA-%') then
    raise exception 'Esta base tiene alumnos reales. 05_datos_prueba.sql es solo para el proyecto de pruebas: no se ha cambiado nada.';
  end if;
end $$;

insert into public.grupos(id, nombre) values ('PRUEBA', 'Grupo de pruebas')
on conflict (id) do update set nombre = excluded.nombre;

insert into public.alumnos(id, grupo, codigo_hash, activo) values
  ('PRUEBA-01', 'PRUEBA', public._hash_codigo('AAA222'), true),
  ('PRUEBA-02', 'PRUEBA', public._hash_codigo('BBB333'), true),
  ('PRUEBA-03', 'PRUEBA', public._hash_codigo('CCC444'), true),
  ('PRUEBA-04', 'PRUEBA', public._hash_codigo('DDD555'), true),
  ('PRUEBA-05', 'PRUEBA', public._hash_codigo('EEE666'), true)
on conflict (id) do update set codigo_hash = excluded.codigo_hash, activo = excluded.activo, grupo = excluded.grupo;

-- Comprobación: debe salir 5
select count(*) as alumnos_de_prueba from public.alumnos where grupo = 'PRUEBA';
