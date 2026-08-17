# b1141-confidence-verdict

The reusable `confidence-weighted-verdict` GEDL interaction model.

Students make a substantive judgement and state how confident they are. Those two choices place the learner at one point in a **selection × confidence space**. Before reveal, the learner can see only their own position. The rest of the room is hidden. At reveal, the frozen class landscape appears around them and the app gives personalised, non-evaluative feedback about where they sit within it.

The core experience is:

**choose → position → commit → anticipate → reveal → locate → interpret**

This is game-design-informed rather than gamified. The design uses space, hidden information, curiosity, surprise and consequential feedback without points, competition, rewards or a requirement to change one's mind.

## Essential interaction design

### 1. Selection × confidence creates a position

A response has two linked dimensions:

- substantive option / verdict;
- confidence (1–5 by default, configurable).

Together these locate the learner in a bounded two-dimensional possibility space.

### 2. The learner sees the space before the class

After committing, the student sees the full grid of possible positions with only one marked cell:

**YOU**

The rest of the cells remain concealed. The app explicitly asks the learner to anticipate whether the class will cluster around them, elsewhere, or spread across the space.

Before reveal, a learner may reposition themselves. At reveal their position is locked.

### 3. Reveal freezes and populates the landscape

At reveal, the backend freezes the cohort snapshot. The same grid is then populated with the class distribution, while the learner's own cell remains marked **YOU**.

The class result is therefore not just an aggregate chart. It is the newly revealed environment surrounding a position the learner created earlier.

### 4. Personal feedback is relational, not normative

The learner receives anonymous feedback derived from the frozen landscape:

- proportion of the rest of the class choosing the same verdict;
- number of other students occupying the exact same verdict × confidence cell;
- average confidence among classmates who chose the same verdict;
- whether the learner's confidence is higher, lower or close to that peer-group average.

The interface explicitly states that agreement is social information rather than evidence that a judgement is correct.

There is **no post-reveal change-your-answer phase** in the essential model. The intellectual work after reveal is interpretation of one's position and of the class landscape.

### 5. The class landscape becomes a discussion object

The aggregate view treats the room as a spatial pattern rather than only a winning option. It exposes neutral descriptive signals such as:

- whether a single verdict dominates;
- whether overall confidence is relatively high, cautious or mixed;
- how many cells in the possibility space are occupied;
- whether a smaller group appears unusually confident.

The lecturer can then discuss clusters, empty regions, confident minorities, uncertain majorities and divided judgement.

## Schell/game-design rationale

The model deliberately applies several ideas from Jesse Schell's *The Art of Game Design* to an educational interaction:

- **Essential experience:** the learner occupies an intellectual position and then discovers what that position means socially.
- **Space:** selection × confidence forms a rule-governed possibility space.
- **Secrets / hidden information:** the cohort landscape is concealed until reveal.
- **Curiosity and anticipation:** the empty landscape creates a question without requiring a second prediction response.
- **Surprise:** reveal can transform the perceived meaning of the learner's existing position.
- **Feedback:** the same class landscape produces different feedback for different learners because each entered it from a different position.
- **Interest curve:** choose → commit → hidden-space anticipation → reveal → personal interpretation.

This gives the confidence model a different characteristic interaction from the Likert-prediction model rather than applying one generic game mechanic everywhere.

## Projector display

The lecturer control includes **Open projector display ↗**, opening:

`/#/display/{activity-id}`

The projector view auto-refreshes and has a fullscreen control.

**Before reveal:**

- question and response count;
- the empty selection × confidence axes;
- no cohort positions;
- prompt asking where the room will cluster.

**After reveal:**

- frozen class landscape;
- most selected verdict;
- average confidence;
- proportion of high-confidence positions;
- number of occupied cells/options;
- neutral landscape signals and a discussion prompt.

## Lecturer control

Before reveal, the lecturer may privately see the live incoming landscape while student/projector views remain concealed. The lecturer can reveal manually where configured, or allow threshold/immediate reveal modes to operate.

After reveal, the lecturer sees the same frozen landscape plus descriptive summaries for discussion.

## Late participants

A student arriving after reveal may still place themselves and receive personalised feedback against the frozen cohort landscape. Their late position does **not** rewrite the class snapshot already encountered by everyone else.

## Structure

```text
backend/
  server.js
  schema.sql
frontend/
  src/
    Respond.jsx       /#/respond/{id}
    Control.jsx       /#/control/{id}
    Display.jsx       /#/display/{id}
    Heatmap.jsx       shared selection × confidence space
    styles.css        base application styling
    landscape.css     hidden/revealed landscape styling
```

## Live state and persistence

The in-memory session keeps:

- current pre-reveal responses;
- the frozen reveal snapshot;
- reveal state.

If `PERSIST_RESPONSES=true`, submissions continue to be stored as anonymous event rows. The additive `phase` and `reconsideration_scope` columns introduced during an earlier prototype remain in the schema for backwards compatibility; this model now writes only `phase='initial'` and leaves `reconsideration_scope` NULL.

Anonymous participant tokens are activity-scoped browser identifiers, not student identities.

## Routes

- `/#/respond/{id}`
- `/#/control/{id}`
- `/#/display/{id}`

Examples:

- `/#/respond/b1141-w1-least-shared-benefit`
- `/#/control/b1141-w1-least-shared-benefit`
- `/#/display/b1141-w1-least-shared-benefit`

## Deploying to Coolify

This release changes both backend and frontend, so deploy **backend first, then frontend**.

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

Content remains database-driven. Add a row to `activities`; no frontend code change is required. `options` is a JSON array. Leave `correct_option` as `NULL` for open judgement/opinion activities or set it to a valid option for a concept check.
