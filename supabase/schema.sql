create extension if not exists pgcrypto;

create table if not exists public.chemistry_public_groups (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  admin_key_hash text not null,
  default_active_person_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chemistry_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.chemistry_public_groups(id) on delete cascade,
  name text not null,
  type text not null,
  is_starter boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists chemistry_group_members_group_name_idx
on public.chemistry_group_members (group_id, lower(name));

alter table public.chemistry_public_groups enable row level security;
alter table public.chemistry_group_members enable row level security;

create policy "chemistry_public_groups_select_anon"
on public.chemistry_public_groups
for select
to anon
using (true);

create policy "chemistry_public_groups_insert_anon"
on public.chemistry_public_groups
for insert
to anon
with check (true);

create policy "chemistry_public_groups_update_anon"
on public.chemistry_public_groups
for update
to anon
using (true)
with check (true);

create policy "chemistry_group_members_select_anon"
on public.chemistry_group_members
for select
to anon
using (true);

create policy "chemistry_group_members_insert_anon"
on public.chemistry_group_members
for insert
to anon
with check (true);

create policy "chemistry_group_members_update_anon"
on public.chemistry_group_members
for update
to anon
using (true)
with check (true);

create policy "chemistry_group_members_delete_anon"
on public.chemistry_group_members
for delete
to anon
using (true);

alter publication supabase_realtime add table public.chemistry_public_groups;
alter publication supabase_realtime add table public.chemistry_group_members;
