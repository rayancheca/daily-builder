# Dashboard Polish Session — Brief for Claude Code

You are Claude Code, about to audit and polish the `daily-builder` mission-control
dashboard. Read this entire brief, then read the four core files below before
touching anything. Work slowly. Verify every change in the browser.

---

## What daily-builder is

Autonomous project builder. `~/daily-builder/start.sh` launches a Claude Code
session that scaffolds and builds a CS/security portfolio project from scratch,
then pushes to GitHub. The dashboard is the operator's window into every past
and in-flight project. It must be accurate, fast, visually sharp, and
interactive.

---

## Read these first (in order, fully)

1. `~/daily-builder/dashboard/index.html` — page structure and tile grid
2. `~/daily-builder/dashboard/app.js` — client logic, SSE, all renders (large)
3. `~/daily-builder/dashboard/server.py` — backend, data shape, all endpoints
4. `~/daily-builder/dashboard/style.css` — styling tokens and components

Also skim:
- `~/daily-builder/start.sh` — what produces the data you display
- `~/daily-builder/project_history.md` — canonical record of past projects
- `~/daily-builder/lib/*.py` — helpers added in the prior session (evaluator,
  project-state, pick-domain, dedupe, telemetry)
- Any project under `~/dev/daily-projects/<name>/` — look at how `state.md`
  and `CLAUDE.md` are shaped

Do NOT skim. Read 1–4 in full.

---

## Context: what just shipped before you

The immediately prior session added a lot of new backend surface. You inherit it:

- **New server endpoints** (all under `/api/…`):
  - `POST /api/project/:name/resume` — spawns a Terminal.app window running
    `start.sh` against that project
  - `POST /api/project/:name/archive` — moves project dir to `_archive/`
  - `POST /api/project/:name/evaluate` — runs the evaluator
  - `POST /api/project/:name/polish` — runs the finishing pass
  - `GET  /api/wishlist` / `POST /api/wishlist` — read/write `wishlist.md`
  - `GET  /api/quota` — Max quota telemetry
  - `GET  /api/evaluations` — per-project scores
- **Abandonment detection** — projects now carry a `stalled` flag when
  `state.md` claims IN_PROGRESS but git has no commits for N days (N from
  `~/daily-builder/config.toml`)
- **Evaluator scores** — each project has an `evaluation.json` with a
  heuristic score, an LLM qualitative review, and a list of issues
- **Max-quota tile data** — tokens consumed per session, rolling weekly window
- **Wishlist** — `~/daily-builder/wishlist.md` is a real data source now

Your job is to surface all of this cleanly in the UI and fix what was already
broken before these additions landed.

---

## KNOWN BUGS (fix first)

### CRITICAL: Progress indicator lies

The dashboard shows step counts like "11 of 14" when the running agent is
actually on step 13 of 20+. Root cause suspected:

- Parser counts entries in `state.md`'s `## Next steps` and `## Completed
  steps` sections. Those are agent-maintained and frequently wrong — documented
  in `~/.claude/projects/-Users-rayankarimcheca-daily-builder/memory/`.
- The canonical plan lives in `CLAUDE.md` as a numbered implementation list.
- Ground truth for "what's done" is git commit history, not `state.md`.

**Fix approach:**
1. Extract the total number of implementation steps from `CLAUDE.md` by
   regex-matching numbered headings in the plan section.
2. Count `feat:` / `fix:` commits in git log for the "completed" number.
3. If `CLAUDE.md` has no parseable numbered plan, degrade gracefully: show
   "N commits" instead of "N of M."
4. Stop trusting `state.md` counts anywhere. Keep reading `state.md` for the
   free-text "In progress" label — that's still useful — but never for step
   arithmetic.

Write the new logic in `lib/project_state.py` if possible (shared with the
rest of the system), not inline in `server.py`.

### Other likely bugs — verify and fix if real

- **Activity calendar double-counts**: if two projects share a commit hash
  (rebases, cherry-picks), the calendar may tick the cell twice. Dedupe by
  `(sha, date)`.
- **Heatmap timezone**: "When you build" uses whatever tz `datetime.fromtimestamp`
  defaults to. Verify local time is respected; make it explicit with `astimezone`.
- **Filter pills**: `data-status` filter on the project grid doesn't persist
  across reconnect. Write to localStorage, restore on mount.
- **Reconnect button**: `onclick="reconnect()"` — does it actually refetch
  tile data or only re-open the SSE stream? Should do both.
- **Sort select**: same localStorage persistence gap as filters.
- **Language totals**: header files (`.h`, `.hpp`) are classified as C/C++ by
  extension — verify this isn't misattributing in polyglot repos.

---

## Audit checklist

### Data correctness
- [ ] Progress indicator fixed (see above)
- [ ] `stalled` state from `lib/project_state.py` is surfaced as a pill on
      project cards AND as a filter option
- [ ] Evaluator score displayed on each project card (colored chip, 0–100)
- [ ] Wishlist panel shows unused entries, with add/remove controls
- [ ] Max-quota tile replaces the old "cost" wording everywhere
- [ ] Every derived number cross-checks against git as canonical source

### Visual quality (follow `~/.claude/rules/web/design-quality.md`)
- [ ] Hero row actually pulls the eye first — not just a bigger tile
- [ ] Spacing rhythm has intent — not uniform padding on everything
- [ ] Empty states designed for zero projects (fresh user) and for "all
      projects shipped" (everything complete)
- [ ] Loading skeletons match the shape of content they stand in for
- [ ] Dark surfaces layered — differentiate card, tile, drawer, modal
- [ ] JetBrains Mono used intentionally (commit hashes, durations, code) —
      not sprinkled
- [ ] Status pills (building / shipped / stalled) are visually distinct at
      a glance, not just text colors

### Interactions
- [ ] Drawer: keyboard navigable, focus trap when open, Escape closes
- [ ] Command palette (⌘K): every promised action wired to a real endpoint
- [ ] Action buttons (resume/archive/polish/evaluate): show loading state,
      surface errors as toasts, confirm before destructive actions (archive)
- [ ] Resume button actually spawns the Terminal window — verify on macOS
- [ ] Sort + filter preferences persist across reload
- [ ] Filter pills keyboard accessible (Tab + Enter)
- [ ] Search bar (⌘K) is the palette trigger, not a duplicate input

### Accessibility (WCAG 2.2, target Lighthouse a11y ≥ 95)
- [ ] Contrast ratios on all muted greys — verify against dark surfaces
- [ ] ARIA labels on every icon-only button
- [ ] Skip-to-main-content link
- [ ] `prefers-reduced-motion` respected for ticker, toasts, sparkline,
      calendar animations
- [ ] Screen reader announcements on SSE tile updates (aria-live region)
- [ ] Focus indicators visible on every interactive element

### Performance (target Lighthouse perf ≥ 85)
- [ ] `app.js` is 43KB — identify dead code paths, extract into modules
- [ ] `style.css` is 40KB — audit for unused selectors
- [ ] Chart.js: does the canvas redraw on every SSE tick? Debounce + only
      update when underlying data changed
- [ ] Calendar renders 365+ DOM nodes — verify it's acceptable, or switch
      to CSS grid with a single container and data-attributes
- [ ] SSE payload: is the server sending deltas or full state every tick?
      Full state every tick is lazy — send only what changed

### Responsive
- [ ] <768px: does the 12-col grid collapse sensibly? Test on actual mobile
- [ ] Landscape mobile: hero row doesn't overflow
- [ ] >1920px: doesn't stretch into ugly whitespace — cap max-width or
      add a meaningful wide layout

### Code quality
- [ ] `app.js` → split into `modules/` by concern: charts, drawer, palette,
      ticker, commits, projects
- [ ] `server.py` → separate HTTP routing from data computation; data
      functions should be importable from tests
- [ ] Add type hints to `server.py` where missing (dataclasses for
      response shapes)
- [ ] Add a `tests/` directory with pytest — cover the data-computation
      functions, not the HTTP layer. Target 80% on new code.
- [ ] No `print()` for logging — use `logging` module

---

## Quality bar

- Runs end-to-end at `http://localhost:8765` with zero console errors
- Zero placeholder features — every button, filter, tab works
- Zero regressions vs. current functionality (verify each surface manually
  before committing)
- Lighthouse: accessibility ≥ 95, performance ≥ 85 (localhost)
- Visual: does not look like a generic shadcn/Tailwind template. The
  design should feel opinionated — layered surfaces, real hierarchy,
  motion that clarifies flow
- Respects `~/.claude/rules/web/*.md` (coding style, testing, performance,
  patterns, design-quality, security)

---

## Don't

- Don't rewrite from scratch — edit in place, preserve the feel
- Don't touch anything outside `~/daily-builder/dashboard/` and
  `~/daily-builder/lib/project_state.py` (that one is shared)
- Don't add new features beyond this brief — polish is the job
- Don't add external JS dependencies beyond Chart.js (already loaded)
- Don't use emojis in the UI
- Don't skip the browser verification step for any change

---

## Deliverables

1. Every bug under "Known bugs" fixed and verified live
2. Every checkbox in the audit checklist addressed — or explicitly skipped
   with a reason in the final commit message
3. `~/daily-builder/dashboard/CHANGELOG.md` listing what changed, grouped
   by audit-section headings
4. Commits follow `fix(dashboard): ...` / `feat(dashboard): ...` /
   `refactor(dashboard): ...` convention — small, scoped, reviewable
5. Push to `main` when the checklist is complete

---

## Session protocol

- Read state.md if one exists in the dashboard dir (none currently — you
  may create one to track progress across this multi-hour audit)
- After each audit section, commit and push
- If you hit a wall, document in commit message and move on — don't stall
- End of session: update CHANGELOG.md with everything done and a short
  punch list of what's left
