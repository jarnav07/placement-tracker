# Placement Table Audit Skill

## Purpose

Use this skill whenever the placement tracker needs a **complete audit of the `public.placements` table**. The goal is to make the database trustworthy enough that the website can be used as the user's primary placement-search tracker.

This is an **exhaustive audit**, not a spot check.

## Non-negotiable rules

1. **Review every row.** Never sample rows or stop after finding a few problems.
2. **Review every relevant column in every row.** Do not only check company, role, status and link.
3. **Web-verify current facts.** Prefer the employer's official careers/job page. Use reputable secondary sources only when an official source is unavailable or insufficient.
4. **Never invent facts.** When an employer has not published a fact, use explicit wording such as `TBC`, `Vacancy dependent`, `Not stated on vacancy page`, or `Programme dependent`.
5. **Never delete a whole existing entry without explicit user approval.** Bad entries may be corrected, reattributed, or marked appropriately, but whole-row deletion requires asking first.
6. **Split distinct opportunities.** If one company offers multiple materially different industrial placements/internships, create a separate database row for each opportunity. Each row should represent one actionable opportunity, not a generic employer.
7. **Preserve application tracking.** Never overwrite user application-tracking fields (`app_status`, `date_applied`, `cv_version`, `referral_contact`, `interview_date`, `outcome`, personal notes) unless the user explicitly asks for that.
8. **Preserve location tracking.** Do not replace valid location data with generic values when a more specific location is known.
9. **Use the original traffic-light priority taxonomy.** The database value must remain one of:
   - `APPLY_IMMEDIATELY` = red = **Apply Now**
   - `APPLY_WHEN_OPENING` = orange = **Prepare to Apply**
   - `HIGH_PRIORITY_WATCH` = yellow = **High Priority**
   - `GOOD_BACKUP` = green = **Good Backup**
   - `LOW_PRIORITY` = grey = **Low Priority**
10. `application_status` and `overall_priority` are different concepts. Status says **when/how available**; priority says **how strongly the user should pursue it**.
11. Every row must have both a meaningful application status (`Open Now`, `Opening Soon`, `Expected`, `Not Yet Published`, or `Closed` where appropriate) and one traffic-light priority.
12. Do not silently normalize away distinctions that matter to the UI. In particular, support `Opening Soon` consistently even if older data contains `Opens Soon`.
13. After changing data, run verification queries. A write is incomplete until the post-write audit passes.

## Exact audit scope

For every row, inspect all of these fields. Grouping is for workflow only; every field still must be considered.

### Identity and location

- `id`
- `company`
- `sector`
- `country`
- `city`
- `website`
- `careers_page`

Check that company naming is clean, employer-specific, and not values such as `See Gradcracker listing` or scraped HTML. Correct malformed attribution where the source clearly identifies the actual employer. Do not delete the row merely because it is malformed.

### Opportunity definition

- `specific_role`
- `department`
- `engineering_area`
- `placement_type`
- `placement_duration`
- `placement_start_date`
- `placement_end_date`

The row must represent a concrete opportunity or a clearly defined vacancy-dependent student opportunity. If a source reveals multiple materially different roles, split them into separate rows.

### Recruitment timing

- `application_status`
- `exact_opening_date`
- `exact_deadline`
- `deadline_type`
- `date_info_verified`
- `application_link`

Distinguish:

- **Open Now**: a current actionable vacancy/application is live.
- **Opening Soon**: a future cycle or employer-confirmed opening is approaching and the relevant opportunity is not yet actionable.
- **Expected**: likely/recurring opportunity, but no sufficiently confirmed near-term opening.
- **Not Yet Published**: a programme/cycle exists but the relevant next intake is explicitly not published yet.
- **Closed**: the specific opportunity/cycle is confirmed closed and should remain for historical/application tracking where needed.

Never use a date copied from an old vacancy as the current opening date unless the source supports the inference and it is labelled as historical/expected.

### Eligibility and practical constraints

- `degree_requirements`
- `min_grade_requirement`
- `year_of_study_requirement`
- `required_technical_skills`
- `citizenship_requirement`
- `right_to_work_requirement`
- `security_clearance_requirement`
- `visa_requirement`

Check these against the current role or official student-placement programme. Do not infer that a user can work somewhere merely because a role exists. Where citizenship/RTW/visa varies by role or location, record that nuance.

### Compensation

- `salary`
- `salary_period`
- `other_benefits`

Only record salary when supported by the current role/programme or a clearly applicable employer programme. Distinguish annual salary, hourly rate, monthly stipend, and unpaid/unspecified correctly.

### User-specific fit and relevance

Re-evaluate all of:

- `cv_fit`
- `aerospace_relevance`
- `rocket_space_relevance`
- `f1_motorsport_relevance`
- `aero_cfd_relevance`
- `propulsion_relevance`
- `controls_avionics_relevance`
- `prestige`
- `career_value`
- `overall_priority`
- `why_it_fits`
- `potential_weaknesses`

The scores must be based on the **specific role**, not merely the employer's industry.

### Application tracking fields

Read but normally preserve unchanged:

- `app_status`
- `date_applied`
- `cv_version`
- `cover_letter_required`
- `referral_contact`
- `interview_date`
- `outcome`
- `notes`

Do not erase personal tracking because the employer information changed.

### Source provenance

- `source_url`
- `source_type`
- `source_date_checked`
- `source_verified`
- `created_at`
- `updated_at`

Update provenance after verification. Prefer first-party employer evidence.

## User-fit model

Use the user's current profile when assigning fit/relevance. The current target profile is:

- UK university student studying Aerospace Engineering.
- Strong academic performance.
- Aerospace/space/rocketry focus.
- Rocket design, avionics/telemetry, CAD/CFD and flight-testing experience.
- Formula Student / motorsport engineering experience.
- Programming/CS capability.
- UK passport / UK right to work.

Do not use sensitive personal information beyond what is necessary for eligibility checks.

### Scoring guidance

Scores should be 0–10 and role-specific:

- `cv_fit`: how strongly the user's actual CV matches the role's technical/academic profile.
- `aerospace_relevance`: direct aerospace engineering relevance.
- `rocket_space_relevance`: direct launch/spacecraft/space-systems relevance.
- `f1_motorsport_relevance`: direct F1/motorsport relevance.
- `aero_cfd_relevance`: aerodynamic/CFD/simulation relevance.
- `propulsion_relevance`: propulsion/energy/powertrain relevance.
- `controls_avionics_relevance`: controls, avionics, embedded, telemetry, GNC or related relevance.
- `prestige`: employer/role signalling value.
- `career_value`: expected usefulness for the user's long-term aerospace/space/motorsport goals.

Do **not** give a generic engineering role a 9–10 in every category merely because the employer is aerospace or automotive. Score the actual duties.

### Traffic-light priority rules

Use the five original states:

**🔴 APPLY_IMMEDIATELY — Apply Now**

Use when a strong-fit role is currently open and the user should act now rather than merely monitor it. Typical triggers: excellent CV fit, high career value, and a live application window.

**🟠 APPLY_WHEN_OPENING — Prepare to Apply**

Use when the role is a high-value target with a known/strongly expected near-term opening but applications are not yet live. The user should prepare CV/cover letter/application materials now.

**🟡 HIGH_PRIORITY_WATCH — High Priority**

Use for excellent strategic targets where timing is uncertain, vacancy-dependent, or not close enough to justify the orange/red action state.

**🟢 GOOD_BACKUP — Good Backup**

Use for worthwhile roles with credible fit/relevance but lower strategic value, weaker match, or greater uncertainty than the high-priority group.

**⚪ LOW_PRIORITY — Low Priority**

Use for materially less relevant opportunities, weak CV fit, poor strategic alignment, or roles that are technically possible but not worth prioritising over stronger alternatives.

Do not assign priority solely from company prestige. The action state must reflect **fit + relevance + timing + practical attainability**.

## Web-research procedure

For each row:

1. Open the `application_link` or `careers_page`.
2. Search the employer if the supplied link is stale, dead, generic, or suspicious.
3. Verify the role exists and the employer/location are correct.
4. Check current opening status and dates.
5. Check duration/start date.
6. Check academic/eligibility requirements.
7. Check technical requirements.
8. Check salary/benefits when published.
9. Check work authorization/citizenship/clearance/visa constraints where relevant.
10. Record the best supporting `source_url` and update the verification date.
11. If a current official source cannot be found, do not fabricate certainty; downgrade the status to the appropriate `Expected`, `Not Yet Published`, or `Vacancy dependent` state.

For roles that matter especially to the user, corroborate with a second reputable source when practical (for example a current employer vacancy plus an established careers aggregator). Do not let secondary sources override an official employer page without a reason.

## Role splitting rules

Split a company into multiple rows when any of the following differ materially:

- job title/function
- engineering discipline
- location
- duration/start cycle
- eligibility requirements
- application URL
- application window
- user-fit/relevance profile

Example: five distinct SES internships must be five rows, not one generic SES row.

Do **not** split merely because the same programme has multiple office locations unless they are separately actionable vacancies with different application information.

When splitting an existing generic row:

- preserve the original row as the first concrete opportunity where possible;
- create additional rows for the other concrete opportunities;
- copy only facts that genuinely apply to each new row;
- re-score each new row independently;
- never copy application-tracking data from one role into another user's application record.

## Safe-write procedure

Before writes:

1. Take a full row-count snapshot.
2. Take a full list of IDs.
3. Save any rows with existing application-tracking data.
4. Confirm there are no duplicate IDs or impossible values.

During writes:

- Prefer targeted `UPDATE`s keyed by `id`.
- Use `INSERT`s only when adding a genuinely distinct opportunity.
- Never issue `DELETE FROM placements` as part of this skill.
- Never use a broad company-wide update when roles need different values.
- Preserve user tracking columns unless specifically changing them.

If a whole entry appears completely invalid or should be removed, stop and ask the user rather than deleting it.

## Required post-audit verification

After all writes, run checks that prove:

1. Every original ID still exists.
2. New IDs correspond only to intentional split opportunities.
3. No `overall_priority` is null or outside the five allowed values.
4. Every row has an allowed `application_status`.
5. Every row has `specific_role` populated with a meaningful value.
6. Every row has non-null relevance/fit scores in the expected 0–10 range.
7. `source_verified` and `source_date_checked` are populated.
8. No application-tracking fields were accidentally erased.
9. No duplicate role+company+location records were unintentionally created.
10. The five traffic-light priority counts reconcile exactly with the table count.
11. Application-status counts reconcile exactly with the table count.
12. The UI's priority-filter labels map correctly to database values.

A useful final SQL check is conceptually:

```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE overall_priority IS NULL) AS priority_null,
  COUNT(*) FILTER (WHERE specific_role IS NULL OR trim(specific_role) = '') AS role_null,
  COUNT(*) FILTER (WHERE source_verified IS NULL OR trim(source_verified) = '') AS verification_null,
  COUNT(*) FILTER (WHERE source_date_checked IS NULL OR trim(source_date_checked) = '') AS checked_date_null,
  COUNT(*) FILTER (WHERE cv_fit IS NULL OR cv_fit < 0 OR cv_fit > 10) AS bad_cv_fit,
  COUNT(*) FILTER (WHERE aerospace_relevance IS NULL OR aerospace_relevance < 0 OR aerospace_relevance > 10) AS bad_aero,
  COUNT(*) FILTER (WHERE rocket_space_relevance IS NULL OR rocket_space_relevance < 0 OR rocket_space_relevance > 10) AS bad_space,
  COUNT(*) FILTER (WHERE f1_motorsport_relevance IS NULL OR f1_motorsport_relevance < 0 OR f1_motorsport_relevance > 10) AS bad_f1,
  COUNT(*) FILTER (WHERE aero_cfd_relevance IS NULL OR aero_cfd_relevance < 0 OR aero_cfd_relevance > 10) AS bad_cfd,
  COUNT(*) FILTER (WHERE propulsion_relevance IS NULL OR propulsion_relevance < 0 OR propulsion_relevance > 10) AS bad_propulsion,
  COUNT(*) FILTER (WHERE controls_avionics_relevance IS NULL OR controls_avionics_relevance < 0 OR controls_avionics_relevance > 10) AS bad_controls
FROM placements;
```

Then separately verify:

```sql
SELECT overall_priority, COUNT(*)
FROM placements
GROUP BY overall_priority
ORDER BY overall_priority;
```

and:

```sql
SELECT application_status, COUNT(*)
FROM placements
GROUP BY application_status
ORDER BY application_status;
```

All expected null/error counts should be zero unless the relevant field is intentionally permitted to remain unknown and explicitly documented.

## Handling "100% accurate"

The audit should aim for the highest-confidence result possible, but never pretend that an unpublished future opening date, salary, deadline, or eligibility rule is known. Distinguish **verified fact**, **historical/recurring pattern**, and **unknown/TBC** in the stored text.

The final report should state:

- total rows reviewed;
- rows split/added;
- rows corrected;
- rows that could not be fully verified;
- current counts by traffic-light priority;
- current counts by application status;
- confirmation that no whole entries were deleted;
- any items that require user approval because deletion would otherwise be appropriate.

## Completion standard

Do not report the audit as complete unless:

- every row was inspected;
- every field was considered;
- current web verification was attempted for every opportunity;
- distinct roles were split where necessary;
- traffic-light priority is restored and populated;
- application status is populated and consistent;
- fit/relevance scores were recalculated for the specific role;
- provenance was updated;
- post-write verification passed;
- no whole rows were deleted without explicit user approval.
