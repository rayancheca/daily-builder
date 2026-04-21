# Portfolio Finish Workflow — Detailed Loop

This file describes every phase of the portfolio-finish loop in detail.
Read `CLAUDE.md` first. Read this second. Then execute.

---

## Phase 0 — Context priming

### Read order (mandatory)

1. `~/daily-builder/portfolio-finish/CLAUDE.md`
2. `~/daily-builder/portfolio-finish/state.md`
3. `~/daily-builder/portfolio-finish/portfolio.md`
4. `~/daily-builder/portfolio-finish/deploy/playbooks.md`
5. This file (`workflow.md`)
6. The current repo's context — see below

### Current repo context

From the repo root (your working directory):

- `README.md` — what the original author claimed
- `package.json` / `requirements.txt` / `pyproject.toml` / `go.mod` /
  `Cargo.toml` — stack truth
- Any `CLAUDE.md` — the original daily-builder spec
- Any `state.md` — the original daily-builder progress tracker
  (often stale per user's memory — cross-check with git)
- Any `POLISH_LOG.md` — prior portfolio-finish session output
- `git log --oneline -30` — what actually shipped
- `git status` — what's pending
- Top-level files and folder structure (use `ls -la` and `tree -L 2`)
- Any `.env.example`, `.env.sample`, or config files
- Any CI config (`.github/workflows/`, `.gitlab-ci.yml`)

### First message to the user

Your opening message must confirm context is loaded. Use this template:

```
I've loaded context for <repo-name>.

Here's what I see at a glance:
- Stack: <detected from manifest files>
- Last commit: <hash> <message> (<relative date>)
- Git status: <clean | N changes>
- README says: <one-sentence of the claim>

Starting Phase 1 (scan). This usually takes 15–30 minutes. I'll come
back with a structured report when done.
```

Then proceed to Phase 1 without waiting for a reply.

---

## Phase 1 — Scan (15–30 minutes of real work)

Explore the repo with intent. The goal is to build a true mental model
of the project.

### Scan checklist

- [ ] Read the full README
- [ ] Read the full `CLAUDE.md` if it exists (the original spec)
- [ ] Read every non-trivial source file in a logical order (entry
      points first, then modules)
- [ ] Install dependencies: `npm install` / `pip install -r
      requirements.txt` / `go mod download` / whatever applies
- [ ] Run the project locally. ACTUALLY RUN IT. Don't assume.
  - Web app: start the dev server, load in a browser, click around
  - CLI: run with `--help`, run the main commands, check output
  - Backend API: start it, hit endpoints with `curl` or equivalent
  - Library: run the tests
- [ ] Note every error, every broken path, every visual glitch
- [ ] Run existing tests: do they pass? What's covered?
- [ ] Grep for TODO, FIXME, HACK, XXX — collect them
- [ ] Grep for `console.log`, `print(` (Python debug), `fmt.Println`
      (Go debug) — collect them
- [ ] Check for secrets accidentally committed: `git log -p |
      grep -iE "api[_-]?key|secret|password|token"` (manually review
      matches)
- [ ] Assess UI quality if applicable — load every page, every route
- [ ] Assess README quality — does it explain what this is, why it
      exists, how to run, how it works technically?
- [ ] Check for tests directory — what % of code is covered?
- [ ] Verify dependencies aren't wildly outdated — run
      `npm outdated` / `pip list --outdated` / equivalent

### Deployability scan

Also assess:
- Is there a build step? Does it work?
- Are there env vars needed? Is there a `.env.example`?
- Is there a backend component? What service would host it?
- Is there a database? Can it use a free-tier managed service?
- Are there scheduled jobs / background workers?
- Is there websocket or SSE that limits serverless options?
- Does the README claim a live URL that no longer exists?

### Output of Phase 1

Your internal notes, organized enough to feed Phase 2. Do NOT send
output to the user yet.

---

## Phase 2 — Report to user

Present your findings in exactly this format. No deviation.

````markdown
## <Repo Name>

### What it does
<One paragraph, 3–5 sentences. Technical and specific. Explain what
problem it solves and how. Avoid marketing language.>

### What's done (verified working)
- <Bullet: specific feature that actually works>
- <Bullet: specific feature that actually works>
- ...

### What's incomplete or broken
- [CRITICAL] <Issue that blocks deploy or breaks core flow>
- [HIGH] <Issue that degrades usefulness>
- [MEDIUM] <Issue worth fixing>
- [LOW] <Polish-level issue>

### What could be added (stretch)
- <Feature with one-line tradeoff: effort vs value>
- ...

### Proposed plan (ordered)
1. <Concrete step with file/module named>
2. <Concrete step>
3. ...
N. Deploy to <platform> at <URL pattern>

### Deployability
- **Stack:** <detected, e.g. "Next.js 14 (App Router) + TypeScript + Tailwind">
- **Recommended deploy:** <platform> — <one-line reason>
- **Blockers before deploy:**
  - <env var needed>
  - <backend service to provision>
  - <build config issue>
- **Estimated total session time:** <X hours>

### Questions for you before I execute
1. <Specific tradeoff question with options laid out>
2. <Specific tradeoff question>
3. <Specific tradeoff question>
````

### Quality bar for the report

- Every bullet is specific, not vague. "Fix UI" is wrong. "Navbar
  collapses incorrectly on iOS Safari <768px" is right.
- Severity tags on incomplete items are real assessments, not guesses
- The plan is ordered by dependency, not wishful thinking
- Questions are real tradeoffs — if there's no real choice, don't
  invent one. 2–5 questions is typical. 10 is too many.
- Estimated time is realistic. Don't lowball.

---

## Phase 3 — Q&A

Wait for the user's answers. Do not proceed. If their answers are
vague, ask targeted follow-ups:

- "You said 'make it look nicer' — by that do you mean the hero
  section specifically, or site-wide polish?"
- "You said 'skip auth for now' — should I remove the auth code, or
  leave it but use a mock?"

When the user answers "you decide" or similar, make a clear decision
and state it explicitly before executing:

> "You said to pick. I'm going to <decision> because <reason>. If you
> disagree, tell me now before I start."

Then wait 10 seconds for objection (in practice, wait for the next
message or proceed if no objection arrives quickly — user said
infinite budget so waiting is fine).

---

## Phase 4 — Execute

Work through the plan step by step. Atomic commits.

### Execution protocol

For each step in the plan:

1. State what you're about to do (short — one line in chat):
   > "Step 3: adding error boundary around the chart component."
2. Do the work
3. Run the code / load the page / execute the test
4. Verify it works. If it doesn't, debug until it does.
5. Update `POLISH_LOG.md` with:
   ```
   ### Step <N>: <description>
   - <what changed>
   - <files touched>
   - Commit: <hash> (after you commit)
   ```
6. `git add -A && git commit -m "<type>: <description>"`
7. Move to next step

### When you hit something unexpected

Budget is infinite but attention isn't. If you hit something that
meaningfully changes the plan:

- **Small surprise** (dep doesn't install, test framework different
  than expected): solve it, document in POLISH_LOG, keep going
- **Medium surprise** (feature is more broken than you thought, will
  take 3× longer): update your estimate in POLISH_LOG, tell the user,
  keep going
- **Big surprise** (repo is fundamentally different than README
  describes; critical feature is impossible as designed): STOP. Tell
  the user. Ask how to proceed.

### Progressive polish

Don't leave polish for the end. After core features work:
- UI polish immediately (doesn't need to wait for backend)
- README improvements as you understand the code better
- Tests written alongside fixes, not as a final batch
- Screenshots / demo GIF added once UI is stable

---

## Phase 5 — Deploy (if applicable)

Only enter this phase if:
- The repo has a runnable deployable form (not a raw library or
  unfinished CLI experiment)
- Phase 4 is actually complete (quality bar met locally)

### Deploy preflight

Before invoking any deploy tool:

- [ ] Local build succeeds with zero errors (`npm run build` /
      equivalent)
- [ ] Local runtime verified (you loaded it, it worked)
- [ ] `.env.example` exists and is accurate
- [ ] No secrets committed
- [ ] `README.md` documents how to deploy (even though you're about
      to do it yourself, document it for future humans)
- [ ] GitHub repo metadata sane (description, topics)

### Deploy

Follow the matching playbook in `deploy/playbooks.md`:
- Next.js → Vercel playbook
- Static HTML → Vercel or GitHub Pages playbook
- Python backend → Railway / Fly playbook
- Go binary → GitHub Releases playbook
- ...

Use MCP tools (Vercel, Netlify) in preference to raw CLI. Use
`/vercel:deploy`, `/vercel:bootstrap`, `/vercel:env` slash commands
where they help.

### Post-deploy verification

- [ ] Live URL responds with 200
- [ ] Key pages load (not just the root)
- [ ] Key interactions work (form submit, data load, whatever the
      core flow is)
- [ ] Meta tags and OG image present (for anything shareable)
- [ ] `gh repo edit --homepage <url>` sets the GitHub homepage field
- [ ] Live URL added to README near the top (badge or link)
- [ ] Screenshot of the live site added to README (optional, strongly
      encouraged for UI-heavy projects)

---

## Phase 6 — Log and close

### Update `POLISH_LOG.md` in the repo

Final section should read:

```markdown
## Session complete — <date>

### Summary
<2–3 sentences: what state the repo was in, what you did, what state
it's in now>

### Shipped
- <key change>
- <key change>

### Decided against
- <thing the user or you decided to defer, with reason>

### Live URL
<url>

### Quality bar
- [x] Every feature fully implemented
- [x] Code runs end-to-end
- [x] UI polished (or: N/A)
- [x] README comprehensive
- [x] Tests added (coverage: X%)
- [x] No secrets committed
- [x] Deployed (or: N/A — CLI tool, see releases)
- [x] POLISH_LOG current

### Time spent
<honest estimate>
```

### Update `~/daily-builder/portfolio-finish/portfolio.md`

Find the row for this repo. Update:
- `status` → `shipped` (or `in-progress` if paused)
- `deploy_url` → live URL if applicable
- `last_touched` → today's date
- `polish_score` → self-assessed 0–100
- `notes` → one-line summary

### Update `~/daily-builder/portfolio-finish/state.md`

- Increment `shipped` count
- Move repo from `## Queued` to `## Shipped`
- Add entry to `## Recently completed`

### Final commit and push

In the repo:
```bash
git add -A
git commit -m "chore: portfolio-finish complete"
git push
```

In the portfolio-finish dir:
```bash
git add -A  # if this dir is git-tracked; otherwise skip
```

### Final message to user

```
<Repo Name> is complete.

Live: <URL>
Commits this session: N
Time spent: ~X hours

Quality bar: all met.

Summary of what shipped:
- <bullet>
- <bullet>

What I decided against and why:
- <bullet>

Ready for the next repo when you are. Suggestion based on portfolio.md
priority: <next repo name>.
```

---

## Pause and resume protocol

If the user pauses mid-session (Ctrl+C, or says "let's stop here"):

1. Commit or stash pending work with a clear message
2. Update `POLISH_LOG.md` with:
   - Current phase
   - Step you were on
   - Exact next action (function name, file, what it needs to do)
   - Any state that's in your head that isn't in files
3. `portfolio.md` status → `in-progress`
4. `git push`
5. Confirm to user: "Paused cleanly. Resume with: `cd <repo> &&
   claude --dangerously-skip-permissions`"

On resume, the agent reads POLISH_LOG and picks up exactly where
left off.

---

## Anti-patterns — what ruins a session

- Reading five files and jumping straight to code
- Skipping Phase 2 because "the plan is obvious"
- Over-asking in Phase 3 (asking about every tiny thing)
- Under-asking in Phase 3 (not asking about a real tradeoff)
- Batching commits ("I'll commit at the end")
- Deploying before local works
- Marking complete when tests fail
- Leaving TODOs, stubs, or `console.log` behind
- Not updating POLISH_LOG / portfolio.md / state.md
- Ignoring `~/.claude/rules/` user rules
- Using a framework version or approach that isn't in the repo
  already without asking
