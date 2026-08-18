# Placement Tracker

A full-stack placement and internship tracking dashboard built with **React, TypeScript, Vite and Supabase**. Placement Tracker helps you discover opportunities, prioritise roles, track applications, and keep your placement search organised in one place.

## Features

### Opportunity discovery
- Browse placement and internship opportunities from the central Supabase database.
- Search by company, role and other placement information.
- Filter by application status, sector, geography and priority.
- Sort opportunities by deadline, relevance, CV fit and company name.
- Track opening dates and deadlines, including roles that are not yet open.
- Highlight high-value opportunities using CV-fit and relevance scoring.

### Application tracking
- Track the complete application journey from **Not Applied** through **Saved, Applied, Assessment, Interview, Final Interview, Offer, Accepted, Rejected** and **Withdrawn**.
- Record application dates, CV versions, cover-letter requirements, referral contacts, interview dates, outcomes and notes.
- Keep application information attached to the relevant placement rather than maintaining a separate tracker.

### Personal organisation
- Mark roles as **Not Interested** and move them out of the main opportunity view without deleting them.
- Keep detailed placement information including location, salary, requirements, technical skills, work-authorisation requirements and links.
- Export placement data for offline analysis or personal records.

### Responsive interface
- Full desktop dashboard for high-information workflows.
- Dedicated mobile layout designed for touch screens and smaller displays.
- Shared data and functionality across desktop and mobile.

### Live data and automation
- Supabase provides the application database and realtime updates.
- Automated role-monitoring scripts can update placement availability.
- GitHub Actions can run repository automation and deploy the frontend automatically.
- GitHub Pages hosts the production frontend.

## Tech stack

| Technology | Purpose |
| --- | --- |
| React | Frontend UI and application state |
| TypeScript | Type-safe application code |
| Vite | Development server and production builds |
| Supabase | PostgreSQL database, API and realtime updates |
| GitHub Actions | Automation and deployment |
| GitHub Pages | Static frontend hosting |
| XLSX | Spreadsheet export |

## Project structure

```text
placement_tracker/
├── src/
│   ├── components/       # Reusable UI components
│   ├── lib/              # Supabase client and shared data logic
│   ├── App.tsx           # Main application
│   ├── App.css           # Desktop styling
│   ├── mobile.css        # Mobile-specific styling
│   └── index.css         # Global styles
├── scripts/
│   ├── role-monitor.mjs  # Placement availability monitoring
│   └── ...               # Verification and maintenance scripts
├── .github/workflows/    # GitHub Actions workflows
├── package.json
├── vite.config.ts
└── README.md
```

## Getting started

### Prerequisites

- Node.js 20+ (Node.js 22 is recommended for the current GitHub Actions workflow)
- npm
- A Supabase project

### 1. Clone the repository

```bash
git clone https://github.com/jarnav07/placement_tracker.git
cd placement_tracker
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure Supabase

Create a local `.env` file in the project root:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_OR_PUBLISHABLE_KEY
```

`VITE_SUPABASE_URL` must be the **Supabase project URL**. Do not use the REST endpoint ending in `/rest/v1/`.

For the browser application, use the Supabase **anon/publishable** key. Never expose a `service_role` key through a `VITE_*` variable or client-side code.

> `.env` files containing real credentials should never be committed to the repository.

### 4. Start the development server

```bash
npm run dev
```

Vite will provide a local development URL in the terminal.

### 5. Create a production build

```bash
npm run build
```

To preview the production build locally:

```bash
npm run preview
```

## Supabase

The frontend connects to Supabase through `src/lib/supabase.ts`. The browser client uses the public project URL and anon/publishable key, while privileged automation should use protected GitHub Actions secrets rather than frontend environment variables.

The database stores placement information and application-tracking fields, including:

- Placement status and opening/deadline information
- Company, role, sector and location
- Salary and benefits
- Degree and eligibility requirements
- CV-fit and relevance scores
- Application stage and dates
- CV and cover-letter information
- Referrals, interviews, outcomes and notes
- Not-interested state

Database security should be enforced with Supabase Row Level Security (RLS) policies appropriate to the deployment.

## Automated maintenance (discovery + audit)

A GitHub Actions workflow (`.github/workflows/placement-maintenance.yml`) runs **twice a day** (04:00 and 16:00 UTC) and can also be triggered manually from the Actions tab.

Each run does two things, in order:

1. **Discover** (`npm run discover`, `scripts/placement-discovery.mjs`) — searches for new **2027-start** student placements in aerospace, space, rockets, satellites, motorsport and general engineering, verifies each candidate's programme, exact role, intake and opening status, and inserts only confirmed valid entries.
2. **Audit** (`npm run audit`, `scripts/placement-audit.mjs`) — re-verifies **every** placement row and updates `application_status` (and, when verified, opening date, deadline and link) so cards reflect the latest availability.

### Verification safety rules

- Only placements that **start in 2027** are tracked. A closed **2026** intake is never treated as a closed **2027** intake.
- A role is only added or flipped to **Open Now** when the exact student role, the 2027 intake and a direct application entry are all verified on official employer sources.
- Unverifiable roles are left unchanged or marked **Not Yet Published** / **Expected** rather than guessed.
- The audit **never deletes rows** and **never touches** your application-tracking fields (`app_status`, dates, CV version, referral, interview, outcome, notes, Not Interested).

### Required GitHub Actions secrets

| Secret | Purpose |
| --- | --- |
| `SUPABASE_URL` (or `VITE_SUPABASE_URL`) | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged Supabase access for the automation |
| `OPENAI_API_KEY` | Powers web research and rigorous verification |

Optional: `OPENAI_MODEL` (defaults to `gpt-4o-mini`). **Do not put `SUPABASE_SERVICE_ROLE_KEY` or `OPENAI_API_KEY` into the frontend or any `VITE_*` variable.**

### Recommended one-time setup: automated backups

Before each audit the script calls a backup function if it exists. Apply `supabase/migrations/20260818000000_create_placements_backup.sql` in the Supabase SQL editor once to enable automatic point-in-time backups (`placements_backup_YYYY_MM_DD_HH24_MI_SS`).

### Legacy scripts

`npm run monitor` (`scripts/role-monitor.mjs`) remains a read-only link-reachability check. The older `job-discovery.mjs`, `gradcracker-discovery.mjs`, `reliable-role-verification.mjs` and `ai-role-status.mjs` scripts are superseded by the new pipeline and are not used by the workflow.

## GitHub Pages deployment

The production frontend is deployed automatically through GitHub Actions.

The deployment flow is:

```text
Push to main
    ↓
GitHub Actions
    ↓
npm ci
    ↓
npm run build
    ↓
Upload Vite dist/ artifact
    ↓
GitHub Pages
```

For the GitHub Actions deployment to access Supabase during the Vite build, configure these repository secrets under **Settings → Secrets and variables → Actions**:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Any privileged automation should use separate non-`VITE_` secrets such as `SUPABASE_SERVICE_ROLE_KEY`.

## Development workflow

The project is designed to work with both local development and Bolt.

Recommended workflow:

1. Make changes in Bolt or locally.
2. Test the application locally where practical.
3. Commit changes to `main`.
4. GitHub Actions builds and deploys the production site.
5. Verify the deployment after the workflow completes.

When changing the UI, preserve the shared application logic and Supabase data model. Mobile-specific presentation can be modified independently of the desktop presentation.

## Security notes

- Never commit `.env` files containing real credentials.
- Never expose a Supabase `service_role` key in browser code.
- Only public/anon or publishable Supabase credentials should be used in `VITE_*` variables.
- Treat GitHub Actions secrets as sensitive credentials.
- Keep database access protected by appropriate Supabase RLS policies.

## Available npm scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run build` | Type-check and create the production build |
| `npm run preview` | Preview the production build locally |
| `npm run monitor` | Run the read-only placement link monitor |
| `npm run discover` | Discover and verify new 2027 student placements |
| `npm run audit` | Re-verify every placement and update availability |
| `npm run verify-tracking-features` | Verify protected application/location tracking functionality |

## Contributing

For changes to the tracker:

1. Create a focused change rather than modifying unrelated functionality.
2. Preserve existing application-tracking and location-tracking behaviour.
3. Test both desktop and mobile layouts for UI changes.
4. Run `npm run build` before committing where possible.
5. Keep credentials and private configuration out of Git.

## License

This repository is currently maintained as a personal project. No open-source license has been specified.
