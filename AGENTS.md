# AGENTS.md — Placement Tracker

## Purpose

Placement Tracker is a personal placement/internship discovery and application-tracking web app. It is designed around one central Supabase database and a React/Vite frontend. The project is used to discover student opportunities, assess whether applications are open or expected to open, prioritise roles, and track applications through to an outcome.

The repository is `jarnav07/placement_tracker`.

## Current baseline / save point

The current `main` branch is the restored project baseline established on 18 August 2026. A protected recovery branch exists:

- `savepoint-2026-08-18-restored-project`
- Commit: `676f1d0d5190e4e5550793d427b6f13a66e67be1`

Do not modify that save-point branch unless the user explicitly asks to replace the save point.

The current main codebase intentionally contains the GitHub Pages deployment workflow only. The previous role-discovery/audit workflows were removed after they caused repeated failures and incorrect database changes.

## Golden rules for agents

1. **Do not delete placement records.** A user request to audit, correct, classify, or update placements means update existing rows; it does not mean remove rows.
2. **Do not invent information.** Every role status, opening date, deadline, salary, eligibility requirement, location, link, or other factual field must be supported by evidence. If it cannot be verified, leave the field unchanged or explicitly mark it as unknown/not published rather than guessing.
3. **Search the actual student role.** The database is intended for university placements, industrial placements, internships, co-ops, and comparable student opportunities. Do not use graduate-only or experienced-hire vacancies as evidence for a student placement.
4. **Verify the exact programme/intake.** An expired 2026 vacancy is not evidence that a 2027 intake is closed. Conversely, a generic careers page is not evidence that a particular 2027 role is open.
5. **Distinguish opening date from start date.** A September 2027 placement start is not the same thing as applications opening in September 2026.
6. **Prefer explicit employer evidence.** If an employer says that applications for the next intake open on a specific date/month, that evidence overrides assumptions based on an expired vacancy. Countdown messages on the employer's current careers page are particularly important.
7. **Do not merge separate roles merely because they share an application portal.** Different companies/divisions/programmes can legitimately point to the same parent careers site.
8. **Do not alter unrelated functionality.** Make focused changes. In particular, do not redesign the mobile UI when fixing database or automation logic.
9. **Protect the application tracker.** Preserve application-stage, location, Not Interested, filtering, sorting, and tracking behaviour unless the user explicitly asks for a change.
10. **Test before claiming success.** A code change is not considered verified until the relevant build/test/deployment result confirms it.
11. **Never expose secrets.** Never commit `.env` files, Supabase service-role keys, OpenAI keys, or other credentials. Never put a service-role key in `VITE_*` variables or browser code.
12. **Do not claim to have performed searches or updates that were not actually performed.** Be explicit about what was checked and what remains unverified.

## Architecture

### Frontend

The application is a React 18 + TypeScript + Vite single-page application.

Important areas:

- `src/App.tsx` — main application and high-level UI/state orchestration.
- `src/components/` — reusable UI components.
- `src/lib/` — Supabase client and shared data-access logic.
- `src/App.css` — desktop/application styling.
- `src/mobile.css` — mobile-specific presentation.
- `src/index.css` — global styles.

There is a dedicated mobile presentation. Mobile and desktop should share the underlying placement/application data and business logic while allowing different presentation/layout.

### Backend / data

Supabase provides PostgreSQL, the API, and realtime data updates. The browser client is configured in `src/lib/supabase.ts` using:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Only public/anon/publishable credentials belong in browser environment variables.

Privileged database operations must use a protected server-side/automation secret such as `SUPABASE_SERVICE_ROLE_KEY` and must never be exposed to the frontend.

## Placement database

The principal table is:

- `public.placements`

The current project baseline contains **102 placement records**. The placement table is the source of truth for the opportunity board.

The data model contains information including, depending on the row/schema version:

- company
- role / specific role
- sector
- location / geography
- application link / career link
- opening/application status
- expected opening date/month
- deadline information
- salary and benefits
- degree/eligibility requirements
- technical skills
- CV-fit and relevance scores
- application stage and dates
- CV / cover-letter requirements
- referral/contact information
- interview information
- outcome/notes
- Not Interested state

Before changing database fields, inspect the actual current schema rather than assuming a column name or type from an old script.

### Recovery backup

A full database copy was created as a recovery point before continued auditing:

- `public.placements_backup_2026_08_18`

It was verified at creation time to contain the same **102 records** as `public.placements`.

Do not delete or repurpose this backup without explicit user permission. If a future database operation could materially risk the placement data, create/verify another backup first.

## Placement-status rules

When researching application opening status, use these rules:

### Open Now

Use only when there is current evidence that applications for the tracked student role/intake are actually accepting applications.

### Opening Soon

Use when the employer has explicitly confirmed that the relevant 2027 intake will open during 2026 and the opening date/month is sufficiently established. Example: an employer says applications open in September 2026 for a 2027 placement intake.

### Expected

Use when the employer has confirmed a future student programme/intake or established a recurring programme but has not yet published enough information to justify Open Now or Opening Soon for the tracked intake.

### Not Yet Published

Use when the employer has a relevant student programme but has not published the tracked 2027 intake/opening information, or when current evidence cannot establish the relevant intake.

### Closed

Use only when current evidence establishes that applications for the relevant tracked intake have closed and there is no stronger evidence that the next relevant intake is currently open/about to open.

**Critical:** an expired individual vacancy page does not automatically mean the programme is closed. Always check the employer's current programme/early-careers page for the next intake.

## Research methodology for role audits

For every individual placement being audited:

1. Read the database row and identify the exact company, role, programme, location, intake, and current link.
2. Search the employer's official careers/early-careers/student page for the exact programme.
3. Search the exact role title and relevant intake/year.
4. Check whether the employer has published the next application opening date/month.
5. Check whether the page contains a countdown, explicit opening statement, application window, deadline, or intake year.
6. Check that the opportunity is genuinely for students (industrial placement, internship, co-op, etc.).
7. Verify the application link points to the correct programme/role, not merely a generic or unrelated page.
8. Verify every other editable attribute that the evidence supports: role title, location, duration, start date, salary, degree requirements, eligibility, sector, skills, deadline, and status.
9. Do not overwrite a verified value with weaker evidence.
10. Update only the row being audited.
11. Never delete the row.
12. Record uncertainty rather than guessing.

When doing a large audit, process rows individually and maintain an explicit count. Never claim that all records were audited unless every record was actually checked.

## Application tracking

The application tracker supports a progression including:

`Not Applied → Saved → Applied → Assessment → Interview → Final Interview → Offer → Accepted / Rejected / Withdrawn`

Application-related information belongs with the placement record. Preserve existing tracking fields when updating role research.

## Not Interested

Not Interested is an organisational state, not a deletion mechanism. Marking a role Not Interested should move it out of the normal opportunity view while retaining the database record and its information.

Do not convert Not Interested into a database delete.

## UI rules

The project has a responsive desktop and mobile interface. The mobile UI is deliberately distinct from the desktop UI.

When making UI changes:

- inspect the existing implementation before changing it;
- preserve existing mobile-specific components and CSS;
- do not replace a mobile control with a desktop equivalent without explicit instruction;
- preserve the existing bottom navigation and mobile filtering behaviour;
- preserve the small Not Interested control in its existing mobile location unless the user explicitly requests a redesign;
- check safe-area spacing on iOS/mobile layouts;
- test both desktop and mobile after UI changes;
- avoid broad CSS rewrites for unrelated tasks.

If a UI element appears to have disappeared, first compare the current code with the recovery save point/known-good commit instead of inventing a replacement design.

## GitHub / deployment

The production frontend is hosted on GitHub Pages.

The current repository intentionally has a GitHub Pages deployment workflow at:

- `.github/workflows/deploy-pages.yml`

The deployment flow is:

```text
push to main
  → GitHub Actions
  → npm ci
  → npm run build
  → upload dist/ artifact
  → deploy to GitHub Pages
```

Required GitHub Actions repository secrets for the frontend build:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Do not recreate the removed role-monitor/full-audit workflows unless the user explicitly asks for them.

## Node/npm commands

The current `package.json` defines:

```text
npm run dev
npm run build
npm run preview
npm run monitor
npm run verify-tracking-features
```

`npm run build` runs TypeScript checking followed by the Vite production build:

```text
tsc -b && vite build
```

Use Node.js 20+; Node.js 22 is recommended.

## Automation scripts

The repository contains Node scripts under `scripts/`. These may include monitoring, verification, discovery, and maintenance utilities.

Do not assume that the presence of a script means it is currently scheduled or used by GitHub Actions. Inspect the current workflow configuration before stating that automation is active.

In particular, do not reintroduce the previous full-placement-audit workflow simply because an audit script exists or existed in an earlier revision.

## Supabase safety

For any direct database operation:

1. Inspect the target rows first.
2. Confirm the number of rows before and after.
3. Never use destructive SQL such as `DELETE` or `TRUNCATE` for a normal placement audit.
4. Prefer targeted `UPDATE` operations by primary key.
5. Do not modify schema unless explicitly requested.
6. Do not expose service-role credentials.
7. After bulk work, verify that the placement count has not changed.

If a user asks for a database restore, prefer restoring from the appropriate verified backup or an explicitly identified save point rather than reconstructing data from memory.

## Code-change discipline

Before modifying code:

- inspect the current file and its imports;
- inspect related components/CSS where relevant;
- check whether the requested functionality already exists;
- avoid duplicate implementations;
- make the smallest change that solves the problem;
- preserve unrelated functionality.

After modifying code:

- run `npm run build` where possible;
- inspect the resulting Git diff/changed files;
- do not claim success until the relevant command/workflow passes.

## Recovery strategy

There are two distinct recovery layers:

### Codebase

Use the Git branch:

`savepoint-2026-08-18-restored-project`

This points to the known-good restored project state and should be treated as immutable unless explicitly replaced.

### Database

Use:

`public.placements_backup_2026_08_18`

for the database recovery point created on 18 August 2026.

Never assume a Git rollback also rolls back Supabase data. Git and Supabase are separate systems.

## What an agent should do when unsure

If evidence conflicts:

1. prefer current official employer information;
2. distinguish programme-level information from a single expired vacancy;
3. distinguish application-opening dates from placement start dates;
4. distinguish student roles from graduate/experienced roles;
5. preserve the existing value rather than guessing;
6. explain the uncertainty to the user.

The priority is **correctness and preservation of existing data**, not making every field look complete.
