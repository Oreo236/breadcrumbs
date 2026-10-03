-- Breadcrumbs initial schema + RLS

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null,
  created_at timestamptz default now()
);

create type adventure_status as enum ('planned', 'active', 'completed');

create table adventures (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  title text not null,
  summary text,
  prompt text not null,
  constraints jsonb not null default '{}',
  start_lat double precision not null,
  start_lng double precision not null,
  route_polyline text,
  status adventure_status not null default 'planned',
  join_code text unique not null,
  created_at timestamptz default now(),
  completed_at timestamptz
);

create table adventure_members (
  adventure_id uuid references adventures(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz default now(),
  primary key (adventure_id, user_id)
);

create table stops (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures(id) on delete cascade,
  order_index int not null,
  name text not null,
  google_place_id text,
  lat double precision not null,
  lng double precision not null,
  address text,
  description text,
  est_minutes int,
  est_cost numeric,
  challenge text,
  dropped_at timestamptz,
  dropped_by uuid references profiles(id)
);

create table photos (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures(id) on delete cascade,
  stop_id uuid not null references stops(id) on delete cascade,
  user_id uuid not null references profiles(id),
  storage_path text not null,
  created_at timestamptz default now()
);

-- Helper: is the current user a member of this adventure?
create or replace function is_adventure_member(_adventure_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from adventure_members
    where adventure_id = _adventure_id and user_id = auth.uid()
  );
$$;

-- Join an adventure by code. security definer so a non-member can look up the code.
create or replace function join_adventure(code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _adventure_id uuid;
begin
  select id into _adventure_id from adventures where join_code = upper(code);

  if _adventure_id is null then
    raise exception 'Invalid join code';
  end if;

  insert into adventure_members (adventure_id, user_id, role)
  values (_adventure_id, auth.uid(), 'member')
  on conflict (adventure_id, user_id) do nothing;

  return _adventure_id;
end;
$$;

alter table profiles enable row level security;
alter table adventures enable row level security;
alter table adventure_members enable row level security;
alter table stops enable row level security;
alter table photos enable row level security;

-- profiles: anyone authenticated can read profiles (needed for contributor names/avatars),
-- but can only write their own.
create policy "profiles are readable by authenticated users"
  on profiles for select
  to authenticated
  using (true);

create policy "users can insert their own profile"
  on profiles for insert
  to authenticated
  with check (id = auth.uid());

create policy "users can update their own profile"
  on profiles for update
  to authenticated
  using (id = auth.uid());

-- adventures
-- Owner is checked directly (not just is_adventure_member) because
-- insert().select() does an immediate read-back of the new row, before the
-- owner has been added to adventure_members - without this it would fail RLS.
create policy "owner or member can read their adventures"
  on adventures for select
  to authenticated
  using (owner_id = auth.uid() or is_adventure_member(id));

create policy "owner can insert adventures"
  on adventures for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "owner can update their adventure"
  on adventures for update
  to authenticated
  using (owner_id = auth.uid());

-- adventure_members
create policy "members can read membership of their adventures"
  on adventure_members for select
  to authenticated
  using (is_adventure_member(adventure_id));

create policy "owner can add themself as a member on create"
  on adventure_members for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from adventures a where a.id = adventure_id and a.owner_id = auth.uid())
  );

-- stops
create policy "members can read stops"
  on stops for select
  to authenticated
  using (is_adventure_member(adventure_id));

create policy "owner can insert stops"
  on stops for insert
  to authenticated
  with check (
    exists (select 1 from adventures a where a.id = adventure_id and a.owner_id = auth.uid())
  );

create policy "members can drop a breadcrumb (update stop)"
  on stops for update
  to authenticated
  using (is_adventure_member(adventure_id));

-- photos
create policy "members can read photos"
  on photos for select
  to authenticated
  using (is_adventure_member(adventure_id));

create policy "members can add photos as themself"
  on photos for insert
  to authenticated
  with check (user_id = auth.uid() and is_adventure_member(adventure_id));

-- storage: private "photos" bucket, members of the adventure folder can read/write
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

create policy "members can read adventure photos in storage"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'photos'
    and is_adventure_member((storage.foldername(name))[1]::uuid)
  );

create policy "members can upload adventure photos to storage"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'photos'
    and is_adventure_member((storage.foldername(name))[1]::uuid)
  );
