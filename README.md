# b1141-confidence-verdict

The `confidence-weighted-verdict` GEDL model. Same conventions as
`b1141-likert-poll`: one repo, `/backend` + `/frontend`, HashRouter, the
CORS wildcard fix, Postgres for config and (optionally) persisted
responses, anonymous per-browser token so a "change your mind" revision
replaces the live count rather than adding to it.

## What's different from the likert repo

- **Two-part submission**: students pick one option, then a confidence
  level (1–5 by default, configurable), submitted together.
- **Heatmap, not a bar chart**: the aggregate view is an options × confidence
  grid. Confidence runs left to right; cell colour intensity shows how many
  responses landed in that cell. If an activity has a `correct_option` set
  (for a future concept-check use, not Week One's opinion question), that
  row renders in red instead of blue, so a confidently-wrong cluster is
  visible at a glance.
- **`correct_option` is optional** — `NULL` for opinion questions like Week
  One's "Who is excluded?", set to one of the option strings for a concept
  check. Nothing else in the schema or UI changes between the two uses.

## Structure

```
backend/
  server.js
  schema.sql        Run once; creates tables + seeds Week One
frontend/
  src/
    Respond.jsx      /#/respond/{id} — pick option, pick confidence
    Control.jsx      /#/control/{id} — heatmap, reveal/clear
    Heatmap.jsx       shared by both views
```

## Setting up the database

```sql
CREATE DATABASE b1141_confidence_verdict;
```

Then, connected to that database, run `backend/schema.sql` in full — same
`psql` approach as the likert repo. It creates `activities` and
`responses`, and seeds:

```
b1141-w1-least-shared-benefit
```

— Week One's "Who is excluded?" question, four options, no correct answer
set.

## Routes

- `/#/respond/{id}` — e.g. `/#/respond/b1141-w1-least-shared-benefit`
- `/#/control/{id}` — same id, your view

## Deploying to Coolify

Identical steps to `b1141-likert-poll`:

1. Push this repo to `github.com/allanhewitt/b1141-confidence-verdict`
2. Create the database and run `schema.sql`
3. Backend: Base Directory `/backend`, port 4000, not a static site.
   Env vars: `DATABASE_URL` (internal Postgres URL), `PORT=4000`,
   `ALLOWED_ORIGINS=*`, `PERSIST_RESPONSES`.
4. Frontend: Base Directory `/frontend`, Publish Directory `/dist`, port
   80, static site ticked. `VITE_API_BASE` set at **buildtime**, pointing
   at the backend's deployed URL.

## Adding future weeks

One `INSERT` into `activities`, no redeploy — same pattern as the likert
repo. `options` is a JSON array (`'["A", "B", "C"]'::jsonb`); leave
`correct_option` as `NULL` for an opinion question or set it to one of
the option strings for a concept check.
