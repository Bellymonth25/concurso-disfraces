-- =============================================================
--  Actualización: 3 rondas fijas + premiación con podio
--  Solo si ya habías corrido schema.sql antes. Pégalo en
--  Supabase → SQL Editor → Run. Se puede correr más de una vez.
-- =============================================================

-- Paso de la premiación: -1 empate · 0 finalistas · 1 3er lugar · 2 ganador · 3 podio
alter table public.game add column if not exists final_step int not null default 0;

-- Nuevos valores por defecto: Ronda 1 pasan 20, Ronda 2 pasan 6, podio de 3 · votos 3, 2, 1
alter table public.game alter column cuts set default '{20,6,3}';
alter table public.game alter column votes_plan set default '{3,2,1}';
update public.game set cuts = '{20,6,3}', votes_plan = '{3,2,1}' where id = 1 and array_length(cuts, 1) <> 3;

-- Reiniciar también regresa la premiación al inicio
create or replace function public.reset_game()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo el host'; end if;
  update game set phase = 'setup', current_round_id = null, winner_ids = '{}', showcase = false, spotlight_id = null, final_step = 0, updated_at = now() where id = 1;
  delete from votes where true;
  delete from rounds where true;
end;
$$;
