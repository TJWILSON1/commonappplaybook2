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
