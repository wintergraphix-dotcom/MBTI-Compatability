create table if not exists public.chemistry_groups (
  group_id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.chemistry_groups enable row level security;

create policy "chemistry_groups_select_anon"
on public.chemistry_groups
for select
to anon
using (true);

create policy "chemistry_groups_insert_anon"
on public.chemistry_groups
for insert
to anon
with check (true);

create policy "chemistry_groups_update_anon"
on public.chemistry_groups
for update
to anon
using (true)
with check (true);

alter publication supabase_realtime add table public.chemistry_groups;
