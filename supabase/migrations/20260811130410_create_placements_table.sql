/*
# Create placements table for the 2027-28 Industrial Placement Tracker

1. New Tables
- `placements` — a comprehensive industrial placement tracker. Each row is a
  placement opportunity at a specific company with full details across company
  info, placement info, recruitment, eligibility, compensation, CV-fit scoring,
  application tracking, and sourcing.
  Columns (50 total):
  - id (uuid, PK)
  - company (text, not null)
  - sector (text) — Aerospace & Defence / Rockets & Space / F1 & Motorsport / Propulsion / Research
  - country (text)
  - city (text)
  - website (text)
  - careers_page (text)
  - specific_role (text)
  - department (text)
  - engineering_area (text)
  - placement_type (text) — Industrial Placement / Year in Industry / etc.
  - placement_duration (text)
  - placement_start_date (text)
  - placement_end_date (text)
  - application_status (text) — Open Now / Opening Soon / Expected / Not Yet Published / Closed
  - exact_opening_date (text)
  - exact_deadline (text)
  - deadline_type (text) — Rolling / Fixed / TBC
  - date_info_verified (text)
  - application_link (text)
  - degree_requirements (text)
  - min_grade_requirement (text)
  - year_of_study_requirement (text)
  - required_technical_skills (text)
  - citizenship_requirement (text)
  - right_to_work_requirement (text)
  - security_clearance_requirement (text)
  - visa_requirement (text)
  - salary (text)
  - salary_period (text)
  - other_benefits (text)
  - cv_fit (integer 1-10)
  - aerospace_relevance (integer 1-10)
  - rocket_space_relevance (integer 1-10)
  - f1_motorsport_relevance (integer 1-10)
  - aero_cfd_relevance (integer 1-10)
  - propulsion_relevance (integer 1-10)
  - controls_avionics_relevance (integer 1-10)
  - prestige (integer 1-10)
  - career_value (integer 1-10)
  - overall_priority (text) — APPLY_IMMEDIATELY / APPLY_WHEN_OPENING / HIGH_PRIORITY_WATCH / GOOD_BACKUP / LOW_PRIORITY
  - why_it_fits (text)
  - potential_weaknesses (text)
  - app_status (text) — Not Applied / Applied / Interview / Offer / Rejected
  - date_applied (text)
  - cv_version (text)
  - cover_letter_required (text)
  - referral_contact (text)
  - interview_date (text)
  - outcome (text)
  - notes (text)
  - source_url (text)
  - source_type (text)
  - source_date_checked (text)
  - source_verified (text)
  - created_at (timestamptz, default now())
  - updated_at (timestamptz, default now())

2. Automation
- update_updated_at_column() trigger function bumps updated_at on UPDATE.

3. Realtime
- Add `placements` to supabase_realtime publication.

4. Security
- Enable RLS. Single-tenant public board: anon + authenticated CRUD with USING(true).
*/

CREATE TABLE IF NOT EXISTS placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company text NOT NULL,
  sector text,
  country text,
  city text,
  website text,
  careers_page text,
  specific_role text,
  department text,
  engineering_area text,
  placement_type text,
  placement_duration text,
  placement_start_date text,
  placement_end_date text,
  application_status text,
  exact_opening_date text,
  exact_deadline text,
  deadline_type text,
  date_info_verified text,
  application_link text,
  degree_requirements text,
  min_grade_requirement text,
  year_of_study_requirement text,
  required_technical_skills text,
  citizenship_requirement text,
  right_to_work_requirement text,
  security_clearance_requirement text,
  visa_requirement text,
  salary text,
  salary_period text,
  other_benefits text,
  cv_fit integer,
  aerospace_relevance integer,
  rocket_space_relevance integer,
  f1_motorsport_relevance integer,
  aero_cfd_relevance integer,
  propulsion_relevance integer,
  controls_avionics_relevance integer,
  prestige integer,
  career_value integer,
  overall_priority text,
  why_it_fits text,
  potential_weaknesses text,
  app_status text DEFAULT 'Not Applied',
  date_applied text,
  cv_version text,
  cover_letter_required text,
  referral_contact text,
  interview_date text,
  outcome text,
  notes text,
  source_url text,
  source_type text,
  source_date_checked text,
  source_verified text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE placements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_placements" ON placements;
CREATE POLICY "anon_select_placements" ON placements FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_placements" ON placements;
CREATE POLICY "anon_insert_placements" ON placements FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_placements" ON placements;
CREATE POLICY "anon_update_placements" ON placements FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_placements" ON placements;
CREATE POLICY "anon_delete_placements" ON placements FOR DELETE
  TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger AS $
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS placements_updated_at ON placements;
CREATE TRIGGER placements_updated_at BEFORE UPDATE ON placements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE placements;
