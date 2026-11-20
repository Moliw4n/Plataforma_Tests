-- =====================================================================
-- Kiron · 04_latido.sql  (fase 0)
-- «Latido» anti-pausa: el plan gratuito de Supabase pausa un proyecto tras una semana sin
-- actividad. Una tarea de GitHub Actions llama a latido() cada 3 días y así nunca está quieto.
-- Ejecutar en Supabase → SQL Editor → New query → Run. Se puede repetir sin romper nada.
--
-- No toca ninguna tabla existente. Crea una tabla nueva (latidos) y una función nueva (latido).
-- =====================================================================

create table if not exists public.latidos (
  id      bigint generated always as identity primary key,
  momento timestamptz not null default now()
);
create index if not exists latidos_momento_idx on public.latidos(momento);

-- Cerrada por defecto, como todo lo demás: la web pública no lee ni escribe la tabla.
alter table public.latidos enable row level security;
revoke all on public.latidos from anon, authenticated;

-- latido(): escribe una fila como máximo cada hora (aunque alguien la llame mil veces no crece
-- la tabla) y borra las de más de 30 días. Devuelve {ok, escrito}.
create or replace function public.latido() returns jsonb
language plpgsql security definer set search_path = public as $$
declare escrito boolean := false;
begin
  if not exists (select 1 from public.latidos where momento > now() - interval '1 hour') then
    insert into public.latidos default values;
    delete from public.latidos where momento < now() - interval '30 days';
    escrito := true;
  end if;
  return jsonb_build_object('ok', true, 'escrito', escrito);
end $$;

revoke all on function public.latido() from public;
grant execute on function public.latido() to anon, authenticated;
