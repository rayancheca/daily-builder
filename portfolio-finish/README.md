# Portfolio Finish & Ship

A Claude Code-driven workflow for going through every repo in your
daily-builder portfolio, finishing whatever is incomplete, polishing
it to a recruiter-worthy standard, and shipping anything that can be
deployed for free.

**One repo per session. Interactive. Infinite budget per repo.**

---

## The problem this solves

You have 40+ auto-built repos from daily-builder. Some are complete,
some are half-finished, some deploy, some don't. None were designed
for a human to iterate on interactively. You want every single one
polished and shipped.

This project is the operator harness for that work.

---

## How it works

### Setup (once)

1. Make originals private:
   ```bash
   gh repo edit rayancheca/<name> --visibility private \
     --accept-visibility-change-consequences
   ```

2. Create public mirrors:
   ```bash
   git clone https://github.com/rayancheca/<name>.git <name>-v2
   cd <name>-v2
   gh repo create rayancheca/<name>-v2 --public
   git remote set-url origin https://github.com/rayancheca/<name>-v2.git
   git push -u origin main
   cd ..
   ```

   (See `reference.md` for a batch script.)

### Per repo (every session)

1. `cd` into the public mirror
2. Launch Claude Code:
   ```bash
   claude --dangerously-skip-permissions
   ```
3. Paste this to the agent:
   ```
   Read ~/daily-builder/portfolio-finish/prompts/launch.md and follow
   it exactly. Begin with Phase 0.
   ```
4. Agent reads its standing instructions, scans the repo, and comes
   back with a structured report
5. You answer its questions
6. Agent executes — finishes features, polishes UI, adds tests,
   improves README, deploys to Vercel/Netlify/etc. if applicable
7. Agent writes `POLISH_LOG.md` in the repo and updates the master
   trackers (`state.md`, `portfolio.md`) here
8. Done. Move to the next repo in a fresh session.

---

## The six-phase loop

See `prompts/workflow.md` for the full detail.

0. **Context priming** — read all the standing files + current repo
1. **Scan** — explore, run the code, note every gap
2. **Report** — present findings in a structured format
3. **Q&A** — ask targeted tradeoff questions, wait for answers
4. **Execute** — implement the agreed plan with atomic commits
5. **Deploy** — ship to the right platform if applicable
6. **Log and close** — update POLISH_LOG, portfolio.md, state.md, push

---

## File map

```
~/daily-builder/portfolio-finish/
├── CLAUDE.md                    # Standing agent instructions
├── README.md                    # This file — for you
├── reference.md                 # Operator quick-reference
├── state.md                     # Master progress tracker
├── portfolio.md                 # Repo database (one row per repo)
├── prompts/
│   ├── launch.md                # What to paste into Claude Code first
│   └── workflow.md              # Detailed six-phase loop
└── deploy/
    └── playbooks.md             # Deploy recipes by stack
```

---

## What makes a repo "done"

Every box ticked:

- Every promised feature fully implemented (no stubs, TODOs, placeholders)
- Runs end-to-end without errors (verified by actually running it)
- UI polished — doesn't look like a default template
- README is comprehensive: problem, what it does, how it works, how
  to run, screenshots, live link if deployed
- Tests exist for core logic, ~80% coverage
- No committed secrets, no hardcoded keys
- Meaningful commit history
- **If deployable: it IS deployed, live URL in README**

---

## What gets deployed where

| Stack | Default | Alt |
|-------|---------|-----|
| Next.js, Vite, React, Svelte, Astro | Vercel | Netlify |
| Static HTML | GitHub Pages | Vercel |
| FastAPI, Flask | Vercel Python | Railway, Fly.io |
| Django | Railway | Fly.io |
| Go web | Fly.io | Railway |
| Go CLI | GitHub Releases | Homebrew tap |
| Python CLI | PyPI | GitHub Releases |
| Node CLI | npm | GitHub Releases |
| Docker-only | Fly.io | Railway |

DB: Neon (Postgres), Upstash (Redis), Turso (SQLite).

All free tier.

---

## Why "one repo per session"?

1. **Context stays sharp** — Claude Code has a context window. Scanning
   42 repos blows it out. One repo stays focused.
2. **Decisions stay aligned** — each repo has different tradeoffs.
   Batching prevents you from giving each one real attention.
3. **Resumability** — if you pause, you only pause one repo's work.
4. **Quota-efficient** — quota is spent on execution, not on re-loading
   state from past repos you've already shipped.

---

## Related

- `~/daily-builder/` — the system that produced all these repos
- `~/daily-builder/prompts/dashboard_polish.md` — a separate brief
  for polishing the daily-builder mission-control dashboard
- `~/.claude/rules/` — your global coding standards, which the
  portfolio-finish agent respects

---

## FAQ

**Q: What if I only want to finish a repo but not deploy it?**
Tell the agent during Phase 3 (Q&A). It'll skip Phase 5 and mark
`deploy_url: n/a (user opted out)` in `portfolio.md`.

**Q: What if a repo is better rebuilt from scratch?**
Raise it to the agent. It'll propose a clean restart, preserving the
original commits on a `legacy/` branch. Never delete without approval.

**Q: What if I run out of Max quota mid-session?**
Pause with Ctrl+C. Agent saves state. Resume tomorrow.

**Q: Can I work on a repo manually between agent sessions?**
Yes. Commit your changes. Next agent session reads `git log` and
`POLISH_LOG.md` — it'll notice your edits and incorporate them.

**Q: What if I change my mind about a deploy platform?**
Tell the agent in Phase 3. Or, for already-deployed repos, open a
new session and ask it to migrate. The playbooks support all the
major options.
