-- ============================================================
--  BØNNEBOGEN — databaseopsætning
--  Kør hele denne fil i Supabase → SQL Editor → New query → Run
--  Den kan køres flere gange uden at ødelægge noget.
-- ============================================================

-- ------------------------------------------------------------
-- 1. PROFILER (ét navn pr. bruger)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  color        text not null default 'cobalt',   -- 'cobalt' eller 'jade'
  created_at   timestamptz not null default now()
);

-- Opret automatisk en profil når en bruger oprettes i Supabase Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'display_name', ''),
      initcap(split_part(new.email, '@', 1))
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 2. KAFFER
-- ------------------------------------------------------------
create table if not exists public.coffees (
  id          uuid primary key default gen_random_uuid(),
  seq         bigint generated always as identity,   -- løbenummer: #001, #002 ...
  created_by  uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  roaster     text,
  origin      text,
  place       text,
  brew_method text,
  image_path  text,
  created_at  timestamptz not null default now()
);

create index if not exists coffees_created_at_idx on public.coffees (created_at desc);

-- ------------------------------------------------------------
-- 3. BEDØMMELSER — én pr. person pr. kaffe
-- ------------------------------------------------------------
create table if not exists public.ratings (
  id         uuid primary key default gen_random_uuid(),
  coffee_id  uuid not null references public.coffees(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  stars      smallint not null check (stars between 1 and 5),
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (coffee_id, user_id)
);

create index if not exists ratings_coffee_idx on public.ratings (coffee_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ratings_touch on public.ratings;
create trigger ratings_touch
  before update on public.ratings
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
--    Alle indloggede brugere kan se alt (I er kun jer to).
--    Man kan kun skrive/slette sine egne rækker.
-- ------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.coffees  enable row level security;
alter table public.ratings  enable row level security;

drop policy if exists "profiles: læs alle"      on public.profiles;
drop policy if exists "profiles: opdater egen"  on public.profiles;
create policy "profiles: læs alle"     on public.profiles for select to authenticated using (true);
create policy "profiles: opdater egen" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "coffees: læs alle"    on public.coffees;
drop policy if exists "coffees: opret egen"  on public.coffees;
drop policy if exists "coffees: ret egen"    on public.coffees;
drop policy if exists "coffees: slet egen"   on public.coffees;
create policy "coffees: læs alle"   on public.coffees for select to authenticated using (true);
create policy "coffees: opret egen" on public.coffees for insert to authenticated with check (created_by = auth.uid());
create policy "coffees: ret egen"   on public.coffees for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "coffees: slet egen"  on public.coffees for delete to authenticated using (created_by = auth.uid());

drop policy if exists "ratings: læs alle"   on public.ratings;
drop policy if exists "ratings: opret egen" on public.ratings;
drop policy if exists "ratings: ret egen"   on public.ratings;
drop policy if exists "ratings: slet egen"  on public.ratings;
create policy "ratings: læs alle"   on public.ratings for select to authenticated using (true);
create policy "ratings: opret egen" on public.ratings for insert to authenticated with check (user_id = auth.uid());
create policy "ratings: ret egen"   on public.ratings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "ratings: slet egen"  on public.ratings for delete to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------
-- 5. BILLEDLAGER
--    Privat bucket — appen henter signerede links der udløber.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('kaffebilleder', 'kaffebilleder', false)
on conflict (id) do nothing;

drop policy if exists "billeder: læs"       on storage.objects;
drop policy if exists "billeder: upload"    on storage.objects;
drop policy if exists "billeder: slet egne" on storage.objects;
create policy "billeder: læs" on storage.objects for select to authenticated
  using (bucket_id = 'kaffebilleder');
create policy "billeder: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'kaffebilleder');
create policy "billeder: slet egne" on storage.objects for delete to authenticated
  using (bucket_id = 'kaffebilleder' and owner = auth.uid());

-- ------------------------------------------------------------
-- FÆRDIG. Der er ikke mere at køre.
--
-- Appen giver jer automatisk hver jeres farve (kobolt og jade)
-- efter hvem der oprettede sin bruger først.
--
-- Vil I rette et navn, kan I gøre det her — ret e-mailen:
--   update public.profiles set display_name = 'Mette'
--   where id = (select id from auth.users where email = 'mette@mail.dk');
-- ------------------------------------------------------------
