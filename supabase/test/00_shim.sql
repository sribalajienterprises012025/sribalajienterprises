-- =============================================================================
-- Supabase-compatible shim for local migration testing.
--
-- Recreates just enough of a Supabase project — the auth and storage schemas,
-- the anon/authenticated/service_role roles, and the default grants — for the
-- migrations in ../migrations to run and for the RLS policies to be exercised
-- against a real Postgres.
--
-- This file is NEVER applied to the Supabase project. Supabase provides all of
-- it already. See scripts/test-db.sh.
-- =============================================================================

create extension if not exists "pgcrypto";

create schema if not exists auth;
create schema if not exists storage;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth, storage to anon, authenticated, service_role;

-- --- auth ---------------------------------------------------------------------

create table if not exists auth.users (
  id           uuid primary key default gen_random_uuid(),
  email        text unique,
  created_at   timestamptz not null default now()
);

/**
 * Supabase sets request.jwt.claims on each request and auth.uid() reads the
 * `sub` claim out of it. Tests impersonate a user by setting the same GUC.
 */
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')
  )::uuid;
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

grant execute on function auth.uid(), auth.jwt(), auth.role()
  to anon, authenticated, service_role;

-- --- storage ------------------------------------------------------------------

create table if not exists storage.buckets (
  id                  text primary key,
  name                text not null,
  public              boolean not null default false,
  file_size_limit     bigint,
  allowed_mime_types  text[],
  created_at          timestamptz not null default now()
);

create table if not exists storage.objects (
  id           uuid primary key default gen_random_uuid(),
  bucket_id    text references storage.buckets (id) on delete cascade,
  name         text not null,
  owner        uuid,
  created_at   timestamptz not null default now()
);

alter table storage.objects enable row level security;

/**
 * Mirrors Supabase's storage.foldername: the path segments with the filename
 * dropped, so 'biz-id/vehicle/v-id/rc.pdf' yields {biz-id,vehicle,v-id} and
 * [1] is the tenant key the storage policies check.
 */
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select case
    when array_length(string_to_array(name, '/'), 1) <= 1 then '{}'::text[]
    else (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
  end;
$$;

grant execute on function storage.foldername(text) to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;

-- Supabase grants table privileges to anon/authenticated as tables are created;
-- RLS is what actually restricts access. Same default here, or every policy
-- test would fail on a plain permission error before RLS was reached.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
