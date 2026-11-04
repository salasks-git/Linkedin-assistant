-- ==============================================================================
-- Supabase (PostgreSQL) Migration Script
-- Tables: profiles, posts (queue)
-- Row Level Security (RLS) configured for user data isolation
-- ==============================================================================

-- 1. Enable required PostgreSQL extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ==============================================================================
-- 2. Profiles Table
-- Stores user identity, onboarding status, and encrypted Gemini AI key
-- ==============================================================================
create table if not exists public.profiles (
    -- This application currently manages login in its own SQLite database.
    -- Keep the UUID as an application user ID rather than requiring Supabase Auth.
    id uuid primary key,
    email text,
    full_name text,
    avatar_url text,
    created_at timestamptz default now() not null,
    user_gemini_api_key text,
    ai_authorized boolean default false not null,
    updated_at timestamptz default now() not null
);

-- Index for fast user queries
create index if not exists idx_profiles_email on public.profiles(email);

-- ==============================================================================
-- 3. Posts / Queue Table
-- Stores draft, scheduled, and published LinkedIn posts
-- ==============================================================================
create table if not exists public.posts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references public.profiles(id) on delete cascade not null,
    content text not null,
    status text not null default 'draft' check (status in ('draft', 'scheduled', 'published', 'posted', 'failed')),
    scheduled_at timestamptz,
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null,
    image_paths jsonb default '[]'::jsonb,
    linkedin_post_id text
);

-- Indexes for performance
create index if not exists idx_posts_user_id on public.posts(user_id);
create index if not exists idx_posts_status on public.posts(status);
create index if not exists idx_posts_scheduled_at on public.posts(scheduled_at);

-- ==============================================================================
-- 4. Row Level Security (RLS) Policies
-- Enforces that users can only read, insert, update, and delete their own records
-- ==============================================================================

-- Enable RLS on both tables
alter table public.profiles enable row level security;
alter table public.posts enable row level security;

-- ------------------------------------------------------------------------------
-- Profiles RLS Policies
-- ------------------------------------------------------------------------------
drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
    on public.profiles for select to authenticated
    using ((select auth.uid()) = id);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
    on public.profiles for insert to authenticated
    with check ((select auth.uid()) = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
    on public.profiles for update to authenticated
    using ((select auth.uid()) = id)
    with check ((select auth.uid()) = id);

-- ------------------------------------------------------------------------------
-- Posts RLS Policies
-- ------------------------------------------------------------------------------
drop policy if exists "Users can read own posts" on public.posts;
create policy "Users can read own posts"
    on public.posts for select to authenticated
    using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own posts" on public.posts;
create policy "Users can insert own posts"
    on public.posts for insert to authenticated
    with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own posts" on public.posts;
create policy "Users can update own posts"
    on public.posts for update to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own posts" on public.posts;
create policy "Users can delete own posts"
    on public.posts for delete to authenticated
    using ((select auth.uid()) = user_id);

-- Existing deployments created from an earlier version may have added this
-- foreign key. Remove it so app-managed users do not need Supabase Auth rows.
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists avatar_url text;

-- The browser uses Supabase Auth but all application table access goes through
-- the backend's service-role client. Remove unused anonymous grants and
-- structural privileges that row-level policies do not constrain, while
-- preserving authenticated CRUD access under RLS and backend service access.
revoke all privileges on table public.profiles, public.posts from anon;
revoke truncate, references, trigger on table public.profiles, public.posts from authenticated;

-- Keep post media durable without making drafts publicly readable. The backend
-- uses its server-only service-role client and returns time-limited signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'post-images',
    'post-images',
    false,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

-- SQLAlchemy owns these server-side tables. They contain passwords, sessions,
-- and provider credentials, so they must never be exposed through the Data API.
create table if not exists public.users (
    id varchar primary key,
    username varchar,
    hashed_password varchar,
    linkedin_user_id varchar,
    name varchar,
    encrypted_token text,
    token_expires_at timestamp,
    user_gemini_api_key text,
    ai_provider varchar,
    ai_authorized_at timestamp,
    created_at timestamp
);
create table if not exists public.sessions (
    session_id varchar primary key,
    user_id varchar,
    is_master boolean default false,
    expires_at timestamp not null,
    created_at timestamp
);
create table if not exists public.local_posts (
    id serial primary key,
    user_id varchar,
    content text not null,
    scheduled_at timestamp,
    status varchar,
    linkedin_post_id varchar,
    image_paths text,
    created_at timestamp
);
create index if not exists ix_users_id on public.users(id);
create unique index if not exists ix_users_username on public.users(username);
create unique index if not exists ix_users_linkedin_user_id on public.users(linkedin_user_id);
create index if not exists ix_sessions_session_id on public.sessions(session_id);
create index if not exists ix_local_posts_id on public.local_posts(id);
create index if not exists ix_local_posts_user_id on public.local_posts(user_id);
alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.local_posts enable row level security;
revoke all privileges on table public.users, public.sessions, public.local_posts from anon, authenticated;
