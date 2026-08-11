/*
# Create roles table for a live roles board

1. New Tables
- `roles` — a public job/role board. Each row is a role/position with details
  and a lifecycle status that drives what visitors see.
  Columns:
  - `id` (uuid, primary key)
  - `title` (text, not null) — role name, e.g. "Senior Product Designer"
  - `department` (text, not null) — team/area, e.g. "Design"
  - `location` (text, not null) — e.g. "Remote (US)" or "London, UK"
  - `employment_type` (text, not null default 'Full-time') — Full-time / Part-time / Contract
  - `description` (text) — longer role description
  - `salary_range` (text) — e.g. "$120k – $150k"
  - `status` (text, not null default 'draft') — one of: draft, live, open, closed
      draft  = not yet visible
      live   = published on the board, not yet accepting applications
      open   = accepting applications now
      closed = no longer accepting applications
  - `application_open_at` (timestamptz) — when applications open
  - `application_close_at` (timestamptz) — when applications close
  - `created_at` (timestamptz, default now())
  - `updated_at` (timestamptz, default now()) — refreshed on update via trigger

2. Automation
- `update_updated_at_column()` trigger function bumps `updated_at` on every UPDATE.
- A trigger on `roles` calls it BEFORE UPDATE.

3. Realtime
- Add `roles` to the `supabase_realtime` publication so the frontend receives
  live INSERT / UPDATE / DELETE events.

4. Security
- Enable RLS on `roles`.
- This is a single-tenant, no-auth public board: all four CRUD policies use
  `TO anon, authenticated` with `USING (true)` / `WITH CHECK (true)` because the
  data is intentionally public/shared.

5. Seed Data
- Insert seven sample roles across Design, Engineering, Product, Marketing,
  Operations, and People, with a mix of statuses (live, open, closed) so the
  board is populated on first load.
*/

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  department text NOT NULL,
  location text NOT NULL,
  employment_type text NOT NULL DEFAULT 'Full-time',
  description text,
  salary_range text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','live','open','closed')),
  application_open_at timestamptz,
  application_close_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_roles" ON roles;
CREATE POLICY "anon_select_roles" ON roles FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_roles" ON roles;
CREATE POLICY "anon_insert_roles" ON roles FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_roles" ON roles;
CREATE POLICY "anon_update_roles" ON roles FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_roles" ON roles;
CREATE POLICY "anon_delete_roles" ON roles FOR DELETE
  TO anon, authenticated USING (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS roles_updated_at ON roles;
CREATE TRIGGER roles_updated_at BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE roles;

-- Seed data
INSERT INTO roles (title, department, location, employment_type, description, salary_range, status, application_open_at, application_close_at) VALUES
  ('Senior Product Designer', 'Design', 'Remote (US)', 'Full-time', 'Own end-to-end product design for our core platform, partnering with PMs and engineers to ship delightful experiences.', '$140k – $175k', 'open', now() - interval '3 days', now() + interval '25 days'),
  ('Staff Frontend Engineer', 'Engineering', 'Remote (Global)', 'Full-time', 'Lead architecture for our React/TypeScript frontend and mentor a team of five engineers.', '$170k – $210k', 'open', now() - interval '1 day', now() + interval '30 days'),
  ('Product Manager, Growth', 'Product', 'London, UK', 'Full-time', 'Drive the growth roadmap — experimentation, onboarding funnels, and activation.', '£80k – £105k', 'live', now() + interval '5 days', now() + interval '35 days'),
  ('Content Marketing Lead', 'Marketing', 'New York, NY', 'Full-time', 'Build and execute our content strategy across blog, social, and lifecycle channels.', '$110k – $140k', 'open', now() - interval '7 days', now() + interval '14 days'),
  ('Operations Analyst', 'Operations', 'Austin, TX', 'Full-time', 'Analyze and optimize our internal operations, reporting, and vendor workflows.', '$85k – $105k', 'live', now() + interval '10 days', now() + interval '40 days'),
  ('People Partner', 'People', 'Remote (EU)', 'Full-time', 'Support hiring managers and employees across EMEA, driving People Ops excellence.', '€70k – €90k', 'closed', now() - interval '60 days', now() - interval '5 days'),
  ('Backend Engineer, Platform', 'Engineering', 'Berlin, DE', 'Full-time', 'Design and build scalable platform services in Go and Postgres.', '€95k – €125k', 'open', now() - interval '2 days', now() + interval '28 days')
ON CONFLICT DO NOTHING;
