-- Run this in your Supabase SQL Editor (supabase.com → your project → SQL Editor)

-- 1. Create the profiles table
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text unique not null,
  has_paid boolean default false,
  stripe_session_id text,
  paid_at timestamptz,
  created_at timestamptz default now()
);

-- 2. Enable Row Level Security (RLS) — important for security
alter table public.profiles enable row level security;

-- 3. Policy: users can only read their own profile
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- 4. Policy: service role can do everything (your server uses this)
create policy "Service role full access"
  on public.profiles for all
  using (true)
  with check (true);

-- Done! Your profiles table is ready.

-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEW SUBMISSIONS (run this to enable the essay/short review add-ons)
-- ─────────────────────────────────────────────────────────────────────────────

-- 5. Create submissions table
create table if not exists public.submissions (
  id uuid default gen_random_uuid() primary key,
  session_id text not null,
  type text not null check (type in ('essay_review', 'short_review')),
  email text,
  file_path text not null,
  file_url text,
  reviewed boolean default false,
  submitted_at timestamptz default now()
);

-- 6. Enable RLS on submissions
alter table public.submissions enable row level security;

-- 7. Service role full access (your server uses this to insert/read)
create policy "Service role full access on submissions"
  on public.submissions for all
  using (true)
  with check (true);

-- 8. Create the storage bucket for review files
-- Go to: Supabase Dashboard → Storage → New Bucket
-- Name: reviews
-- Public: OFF (private bucket — files accessed via signed URLs only)
-- Or run this if your Supabase version supports it:
-- insert into storage.buckets (id, name, public) values ('reviews', 'reviews', false)
-- on conflict do nothing;

-- 9. Storage policy — allow server (service role) to upload and read
-- These are applied automatically when using the service role key in server.js
-- No additional SQL needed for storage if using service role on the backend.
