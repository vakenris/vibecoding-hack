-- Domain entities live in a versioned, typed per-user document. Revision CAS makes
-- task completion + points + feedback an indivisible transaction.
create table public.user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null check (state->>'version' = '1'),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.user_state enable row level security;
revoke all on public.user_state from anon, authenticated;
grant select on public.user_state to authenticated;
create policy "Read own state" on public.user_state for select to authenticated
  using ((select auth.uid()) = user_id);
-- No client write grants/policies. Only authenticated server actions using the
-- service role may apply validated commands; the service key never reaches JS bundles.
grant all on public.user_state to service_role;
