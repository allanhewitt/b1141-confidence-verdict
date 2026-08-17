# b1141-confidence-verdict

The `confidence-weighted-verdict` GEDL model. Students make a substantive
judgement and state how confident they are, then encounter a frozen class
picture and explicitly decide whether to recalibrate their judgement,
confidence, both, or neither.

The model is intentionally game-design-informed rather than gamified. Its
core experience is:

**judge → state confidence → commit → anticipate → reveal → locate yourself → calibrate → resolve**

The reveal is consequential because each learner receives both the class
pattern and anonymous, personalised feedback about where their own
judgement/confidence sat within it.

## Essential interaction design

### 1. Initial commitment

Students submit two linked dimensions:

- a verdict/option;
- confidence (1–5 by default, configurable).

Before reveal they may correct or update that commitment. Once the class
picture is revealed, the latest pre-reveal position is frozen as their
`initial` state.

### 2. Frozen reveal snapshot

At reveal the backend snapshots the whole current cohort. This snapshot is
used for the confrontation even while later calibration changes the live
current responses. That prevents the evidence the learner encountered from
silently changing underneath them.

### 3. Personal feedback

The student heatmap marks the learner's own initial cell with **YOU** and
reports, anonymously:

- what proportion of the rest of the class chose the same verdict;
- average confidence among classmates who chose that verdict;
- whether the learner was more, less, or similarly confident relative to
  that peer subset.

The UI explicitly states that agreement is social information, not evidence
that a judgement is correct.

### 4. Explicit calibration

After reveal, the learner must choose one of four legitimate responses:

- reconsider judgement;
- reconsider confidence;
- reconsider both;
- keep both as they are.

If only one dimension is reopened, the other is technically locked. A final
submission is then stored as the learner's post-reveal resolution. Keeping
the original response is treated as an explicit intellectual action rather
than as failure to interact.

### 5. Cohort movement

The lecturer/projector views distinguish the frozen initial class picture
from the live/final class picture and summarise four actual outcomes:

- judgement only changed;
- confidence only changed;
- both changed;
- both retained.

This makes metacognitive movement visible without treating movement itself
as desirable.

## Projector display

The lecturer control includes **Open projector display ↗**, which opens:

`/#/display/{activity-id}`

The display auto-refreshes and includes a fullscreen control.

- **Before reveal:** question, response count/progress, results hidden.
- **During calibration:** frozen class heatmap, class-level summary and live
  resolution/movement counts.
- **Complete:** before/after heatmaps plus the cohort movement summary.

The lecturer can explicitly mark the activity complete, after which further
calibration submissions are closed.

## Heatmap

The aggregate view is an options × confidence grid. Confidence runs left to
right; cell colour intensity shows how many responses landed in that cell.
If an activity has a `correct_option` set (for a concept-check use), that row
is distinguished. `correct_option` remains optional and is `NULL` for
opinion/judgement activities.

## Structure

```
backend/
  server.js
  schema.sql
frontend/
  src/
    Respond.jsx      /#/respond/{id} — commitment, personal reveal, calibration
    Control.jsx      /#/control/{id} — lecturer controls and cohort movement
    Display.jsx      /#/display/{id} — projector/fullscreen presentation view
    Heatmap.jsx      shared heatmap with optional personal markers
```

## Live state and persistence

The in-memory session keeps:

- current responses;
- the frozen reveal snapshot;
- each learner's explicit reconsideration scope;
- whether reveal and completion have occurred.

If `PERSIST_RESPONSES=true`, every submission remains an event row in
Postgres. `responses.phase` distinguishes `initial` from
`reconsideration`; `reconsideration_scope` records `judgement`,
`confidence`, `both`, or `neither` for the post-reveal event.

The backend automatically applies the two additive response-table columns
at startup with `ADD COLUMN IF NOT EXISTS`, so an existing 2026–27 database
can be upgraded by redeploying the backend. `schema.sql` contains the same
safe upgrade statements for fresh/manual setup.

Anonymous participant tokens remain activity-scoped browser identifiers,
not student identities.

## Routes

- `/#/respond/{id}`
- `/#/control/{id}`
- `/#/display/{id}`

Examples:

- `/#/respond/b1141-w1-least-shared-benefit`
- `/#/control/b1141-w1-least-shared-benefit`
- `/#/display/b1141-w1-least-shared-benefit`

## Deploying to Coolify

As with the other B1141 models, this release changes both backend and
frontend, so deploy **backend first, then frontend**.

Backend:

- Base Directory `/backend`
- port 4000
- `DATABASE_URL`
- `PORT=4000`
- `ALLOWED_ORIGINS=*`
- `PERSIST_RESPONSES` as required

Frontend:

- Base Directory `/frontend`
- Publish Directory `/dist`
- static site enabled
- `VITE_API_BASE` available at build time and pointed at the deployed backend

## Adding future activities

Content remains database-driven. Add a row to `activities`; no frontend
code change is required. `options` is a JSON array. Leave `correct_option`
as `NULL` for open judgement/opinion activities or set it to a valid option
for a concept check.
