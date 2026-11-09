-- Smart Investments Today — initial schema (Phase 1 foundation).
--
-- NOT YET RUN: no Supabase project was connected when this was written, so this file
-- has not been applied or tested. Apply with `supabase db push` and review first.
--
-- Scope: the tables Phase 1–3 need (properties, owners, sales, distress signals,
-- valuations, analyses, saved searches, adapter cache and usage, audit log), plus the
-- contact/compliance tables that the outreach guardrails will write to in Phase 4.
-- Row-level security: every row belongs to a workspace; only members of that workspace
-- can see it. Two people today, multi-tenant later, same rules.

create extension if not exists "pgcrypto";

-- ---------- Workspaces ----------

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create or replace function is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from workspace_members m where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

-- ---------- Shared public-record data (same for every workspace) ----------
-- Public records are not tenant-specific. Signed-in users can read; only the
-- service role (ingest jobs) can write.

create table properties (
  id uuid primary key default gen_random_uuid(),
  county text not null check (county in ('miami-dade', 'broward', 'palm-beach')),
  folio text not null,
  address text,
  unit text,
  city text,
  zip text,
  lat double precision,
  lng double precision,
  use_code text,
  use_description text,
  property_type text,
  beds numeric,
  baths numeric,
  half_baths numeric,
  floors numeric,
  units numeric,
  heated_sqft numeric,
  total_sqft numeric,
  lot_sqft numeric,
  year_built int,
  assessed_value numeric,
  assessment_year int,
  last_transfer_date date,
  last_transfer_price numeric,
  -- provenance for the whole row; field-level overrides go in field_sources
  source text not null,
  source_as_of timestamptz,
  fetched_at timestamptz not null default now(),
  field_sources jsonb not null default '{}'::jsonb,
  unique (county, folio)
);
create index properties_zip_idx on properties (zip);
create index properties_address_idx on properties (county, address);

create table owners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'unknown' check (kind in ('individual', 'company', 'trust', 'government', 'unknown')),
  mailing_address text,
  mailing_city text,
  mailing_state text,
  mailing_zip text,
  mailing_country text,
  sunbiz_document_number text,
  source text not null,
  fetched_at timestamptz not null default now()
);
create index owners_name_idx on owners (name);

create table property_owners (
  property_id uuid not null references properties (id) on delete cascade,
  owner_id uuid not null references owners (id) on delete cascade,
  position int not null default 1,
  is_current boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (property_id, owner_id)
);

create table sales (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties (id) on delete cascade,
  sale_date date not null,
  price numeric,
  is_market_sale boolean,
  source text not null,
  fetched_at timestamptz not null default now(),
  unique (property_id, sale_date, price)
);
create index sales_date_idx on sales (sale_date);

create table distress_signals (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties (id) on delete cascade,
  type text not null,
  case_number text,
  description text,
  status text,
  amount numeric,
  opened_at date,
  closed_at date,
  is_open boolean not null default true,
  source text not null,
  source_as_of timestamptz,
  fetched_at timestamptz not null default now(),
  first_seen_at timestamptz not null default now(),
  unique (property_id, type, case_number)
);
create index distress_open_idx on distress_signals (property_id) where is_open;

-- Paid API responses are stored here so the same property is never paid for twice in 30 days.
create table adapter_cache (
  adapter_id text not null,
  cache_key text not null,
  response jsonb not null,
  cost_usd numeric not null default 0,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  primary key (adapter_id, cache_key)
);

create table adapter_usage (
  adapter_id text not null,
  month date not null,
  calls int not null default 0,
  cost_usd numeric not null default 0,
  primary key (adapter_id, month)
);

alter table properties enable row level security;
alter table owners enable row level security;
alter table property_owners enable row level security;
alter table sales enable row level security;
alter table distress_signals enable row level security;
alter table adapter_cache enable row level security;
alter table adapter_usage enable row level security;

create policy "signed-in users read properties" on properties for select to authenticated using (true);
create policy "signed-in users read owners" on owners for select to authenticated using (true);
create policy "signed-in users read property_owners" on property_owners for select to authenticated using (true);
create policy "signed-in users read sales" on sales for select to authenticated using (true);
create policy "signed-in users read distress_signals" on distress_signals for select to authenticated using (true);
create policy "signed-in users read adapter_usage" on adapter_usage for select to authenticated using (true);
-- adapter_cache: no policies, so only the service role can read or write it.

-- ---------- Workspace-owned data ----------

create table settings (
  workspace_id uuid primary key references workspaces (id) on delete cascade,
  assumptions jsonb not null default '{}'::jsonb,
  score_weights jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table valuations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  property_id uuid not null references properties (id) on delete cascade,
  kind text not null check (kind in ('as_is', 'arv', 'rent')),
  low numeric,
  likely numeric,
  high numeric,
  comps jsonb not null default '[]'::jsonb,
  excluded_comps jsonb not null default '[]'::jsonb,
  source text not null,
  confidence text not null check (confidence in ('high', 'medium', 'low', 'estimate')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table analyses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  property_id uuid not null references properties (id) on delete cascade,
  inputs jsonb not null,
  outputs jsonb not null,
  grade text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  property_id uuid not null references properties (id) on delete cascade,
  stage text not null default 'new',
  hat text not null default 'investor' check (hat in ('investor', 'agent')),
  score int,
  score_reasons jsonb not null default '[]'::jsonb,
  assigned_to uuid references auth.users (id),
  dead_reason text,
  next_follow_up_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, property_id)
);

create table saved_searches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  criteria jsonb not null,
  alerts_enabled boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table d4d_pins (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  property_id uuid references properties (id),
  lat double precision not null,
  lng double precision not null,
  photo_path text,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

-- Contacts and outreach compliance (written by Phase 4; rules live in src/lib/compliance).
create table contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  owner_id uuid references owners (id),
  phone text,
  email text,
  time_zone text,
  on_do_not_call boolean, -- null = not checked yet, which blocks calling
  dnc_checked_at timestamptz,
  written_consent_at timestamptz,
  consent_evidence text,
  opted_out_at timestamptz,
  source text not null,
  created_at timestamptz not null default now()
);

create table activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  lead_id uuid references leads (id) on delete cascade,
  contact_id uuid references contacts (id),
  -- owner_id lets the 3-attempts-per-24-hours rule count across all of a person's numbers
  owner_id uuid references owners (id),
  kind text not null check (kind in ('manual_call', 'manual_text', 'automated_call', 'automated_text', 'voicemail_drop', 'mail', 'email', 'note', 'opt_out')),
  body text,
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);
create index activities_owner_time_idx on activities (owner_id, occurred_at desc);

create table audit_log (
  id bigint generated always as identity primary key,
  workspace_id uuid references workspaces (id) on delete cascade,
  user_id uuid references auth.users (id),
  action text not null,
  entity text,
  entity_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);

alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table settings enable row level security;
alter table valuations enable row level security;
alter table analyses enable row level security;
alter table leads enable row level security;
alter table saved_searches enable row level security;
alter table d4d_pins enable row level security;
alter table contacts enable row level security;
alter table activities enable row level security;
alter table audit_log enable row level security;

create policy "members read their workspace" on workspaces for select to authenticated using (is_workspace_member(id));
create policy "members read membership" on workspace_members for select to authenticated using (is_workspace_member(workspace_id));

create policy "members all settings" on settings for all to authenticated
  using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy "members all valuations" on valuations for all to authenticated
  using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy "members all analyses" on analyses for all to authenticated
  using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy "members all leads" on leads for all to authenticated
  using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy "members all saved_searches" on saved_searches for all to authenticated
  using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy "members all d4d_pins" on d4d_pins for all to authenticated
  using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy "members all contacts" on contacts for all to authenticated
  using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy "members all activities" on activities for all to authenticated
  using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
-- The audit log is append-only for members: they can add and read, never change or delete.
create policy "members read audit_log" on audit_log for select to authenticated using (is_workspace_member(workspace_id));
create policy "members append audit_log" on audit_log for insert to authenticated with check (is_workspace_member(workspace_id));
