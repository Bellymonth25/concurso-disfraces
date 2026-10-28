-- =============================================================
--  Concurso de Disfraces — esquema de Supabase
--  Pega TODO este archivo en Supabase → SQL Editor → Run.
--  Antes de correrlo, cambia el correo de la última sección
--  por el correo con el que el host va a iniciar sesión.
-- =============================================================

-- ---------- Tablas ----------

-- Quién es host (admin). Solo estos correos pueden manejar el concurso.
create table if not exists public.admins (
  email text primary key
);

-- Estado general del concurso (siempre una sola fila, id = 1)
create table if not exists public.game (
  id int primary key default 1 check (id = 1),
  phase text not null default 'setup' check (phase in ('setup', 'running', 'finished')),
  cuts int[] not null default '{25,10,5,1}',
  votes_plan int[] not null default '{3,2,2,1}',
  current_round_id bigint,
  winner_ids uuid[] not null default '{}',
  theme text not null default 'clasico',
  updated_at timestamptz not null default now()
);
alter table public.game add column if not exists theme text not null default 'clasico';
-- Modo desfile: la TV muestra a los concursantes y el host pone a uno en pantalla completa
alter table public.game add column if not exists showcase boolean not null default false;
alter table public.game add column if not exists spotlight_id uuid;
insert into public.game (id) values (1) on conflict (id) do nothing;

create table if not exists public.contestants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  photo_url text,
  created_at timestamptz not null default now()
);

-- Código personal de cada concursante (secreto: solo el host lo ve)
create table if not exists public.contestant_codes (
  contestant_id uuid primary key references public.contestants (id) on delete cascade,
  code text not null unique
);

create table if not exists public.rounds (
  id bigint generated always as identity primary key,
  number int not null,                 -- número que se muestra ("Ronda 2")
  stage int not null,                  -- índice dentro de game.cuts
  cut int not null,                    -- cuántos pasan
  votes_per_voter int not null,
  status text not null default 'ready' check (status in ('ready', 'open', 'closed', 'revealed')),
  ends_at timestamptz,
  candidate_ids uuid[] not null,
  qualified_ids uuid[] not null default '{}',
  is_tiebreak boolean not null default false,
  vote_count int not null default 0,
  voter_count int not null default 0,
  created_at timestamptz not null default now()
);

-- Qué celular es de qué concursante (para que no se vote a sí mismo)
create table if not exists public.device_links (
  device_id text primary key,
  contestant_id uuid not null references public.contestants (id) on delete cascade
);

create table if not exists public.votes (
  id bigint generated always as identity primary key,
  round_id bigint not null references public.rounds (id) on delete cascade,
  device_id text not null,
  contestant_id uuid not null references public.contestants (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (round_id, device_id, contestant_id)
);
create index if not exists votes_round_device on public.votes (round_id, device_id);

-- ---------- Helpers ----------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where email = auth.jwt() ->> 'email');
$$;

create or replace function public.server_now() returns timestamptz
language sql stable as $$ select now(); $$;

-- ---------- Permisos de tablas ----------
-- Explícitos, para que funcione aunque "Automatically expose new tables" esté apagado.
-- Lo que cada quien puede ver o cambiar de verdad lo deciden las políticas RLS de abajo.
grant usage on schema public to anon, authenticated;
grant select on public.game, public.contestants, public.rounds to anon, authenticated;
grant select, insert, update, delete on public.game, public.contestants, public.rounds,
  public.contestant_codes, public.votes, public.admins to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------- Seguridad (RLS) ----------

alter table public.admins            enable row level security;
alter table public.game              enable row level security;
alter table public.contestants       enable row level security;
alter table public.contestant_codes  enable row level security;
alter table public.rounds            enable row level security;
alter table public.device_links      enable row level security;
alter table public.votes             enable row level security;

-- Todos pueden LEER el juego, concursantes y rondas; solo el host escribe.
drop policy if exists game_read on public.game;
create policy game_read on public.game for select using (true);
drop policy if exists game_admin on public.game;
create policy game_admin on public.game for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists contestants_read on public.contestants;
create policy contestants_read on public.contestants for select using (true);
drop policy if exists contestants_admin on public.contestants;
create policy contestants_admin on public.contestants for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists rounds_read on public.rounds;
create policy rounds_read on public.rounds for select using (true);
drop policy if exists rounds_admin on public.rounds;
create policy rounds_admin on public.rounds for all using (public.is_admin()) with check (public.is_admin());

-- Códigos y votos: solo el host. Los invitados votan con la función cast_vote.
drop policy if exists codes_admin on public.contestant_codes;
create policy codes_admin on public.contestant_codes for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists votes_admin on public.votes;
create policy votes_admin on public.votes for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists admins_self on public.admins;
create policy admins_self on public.admins for select using (public.is_admin());
-- device_links: sin políticas → nadie la lee directo, solo las funciones.

-- ---------- Funciones públicas ----------

-- El concursante escribe su código y su celular queda ligado a su disfraz.
create or replace function public.join_with_code(p_code text, p_device text)
returns table (id uuid, name text)
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select cc.contestant_id into v_id from contestant_codes cc where cc.code = upper(trim(p_code));
  if v_id is null then return; end if;
  insert into device_links (device_id, contestant_id) values (p_device, v_id)
    on conflict (device_id) do update set contestant_id = excluded.contestant_id;
  return query select c.id, c.name from contestants c where c.id = v_id;
end;
$$;

-- Votar. Todas las reglas se revisan aquí, no en el navegador.
create or replace function public.cast_vote(p_device text, p_round bigint, p_choices uuid[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype;
  v_self uuid;
  v_n int := coalesce(array_length(p_choices, 1), 0);
begin
  select * into r from rounds where rounds.id = p_round for update;
  if not found then raise exception 'Esa ronda no existe'; end if;
  if r.status <> 'open' or (r.ends_at is not null and now() > r.ends_at) then
    raise exception 'La votación ya está cerrada';
  end if;
  if v_n < 1 or v_n > r.votes_per_voter then
    raise exception 'Puedes votar por entre 1 y % disfraces', r.votes_per_voter;
  end if;
  if (select count(distinct x) from unnest(p_choices) x) <> v_n then
    raise exception 'No puedes repetir un disfraz';
  end if;
  if not (p_choices <@ r.candidate_ids) then
    raise exception 'Ese disfraz ya no está en concurso';
  end if;
  select contestant_id into v_self from device_links where device_id = p_device;
  if v_self is not null and v_self = any (p_choices) then
    raise exception 'No puedes votar por ti mismo 😏';
  end if;
  if exists (select 1 from votes where round_id = p_round and device_id = p_device) then
    raise exception 'Ya votaste en esta ronda';
  end if;

  insert into votes (round_id, device_id, contestant_id)
    select p_round, p_device, x from unnest(p_choices) x;
  update rounds set vote_count = vote_count + v_n, voter_count = voter_count + 1 where rounds.id = p_round;
end;
$$;

-- Conteo público. Mientras no se revele, NO dice de quién es cada barra.
create or replace function public.round_tally(p_round bigint)
returns table (contestant_id uuid, votes int)
language plpgsql stable security definer set search_path = public as $$
declare r rounds%rowtype;
begin
  select * into r from rounds where rounds.id = p_round;
  if not found then return; end if;
  return query
    select case when r.status = 'revealed' then c.cid else null end,
           coalesce(count(v.id), 0)::int as n
    from unnest(r.candidate_ids) as c(cid)
    left join votes v on v.round_id = p_round and v.contestant_id = c.cid
    group by c.cid
    order by n desc;
end;
$$;

-- Conteo real para el host.
create or replace function public.admin_tally(p_round bigint)
returns table (contestant_id uuid, votes int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo el host'; end if;
  return query
    select c.cid, coalesce(count(v.id), 0)::int
    from rounds r
    cross join lateral unnest(r.candidate_ids) as c(cid)
    left join votes v on v.round_id = p_round and v.contestant_id = c.cid
    where r.id = p_round
    group by c.cid;
end;
$$;

-- Reiniciar el concurso (borra rondas y votos; deja a los concursantes).
create or replace function public.reset_game()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo el host'; end if;
  update game set phase = 'setup', current_round_id = null, winner_ids = '{}', showcase = false, spotlight_id = null, updated_at = now() where id = 1;
  delete from votes where true;
  delete from rounds where true;
end;
$$;

grant execute on function public.join_with_code(text, text) to anon, authenticated;
grant execute on function public.cast_vote(text, bigint, uuid[]) to anon, authenticated;
grant execute on function public.round_tally(bigint) to anon, authenticated;
grant execute on function public.server_now() to anon, authenticated;
grant execute on function public.admin_tally(bigint) to authenticated;
grant execute on function public.reset_game() to authenticated;

-- ---------- Tiempo real ----------
do $$
begin
  begin alter publication supabase_realtime add table public.game;        exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.rounds;      exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.contestants; exception when duplicate_object then null; end;
end $$;

-- ---------- Fotos (Storage) ----------
insert into storage.buckets (id, name, public) values ('photos', 'photos', true)
  on conflict (id) do update set public = true;

drop policy if exists photos_admin_insert on storage.objects;
create policy photos_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_admin());
drop policy if exists photos_admin_update on storage.objects;
create policy photos_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and public.is_admin());
drop policy if exists photos_admin_delete on storage.objects;
create policy photos_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_admin());

-- ---------- Host ----------
-- ⚠️ CAMBIA ESTE CORREO por el del host (el mismo que crearás en Authentication → Users)
insert into public.admins (email) values ('host@ejemplo.com') on conflict do nothing;
