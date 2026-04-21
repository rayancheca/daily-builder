# Portfolio — Repo Database

One row per repo. Updated by the agent at the end of every session.
The `status` column is the source of truth for "what needs attention
next."

---

## Status legend

- `queued` — never started in portfolio-finish
- `scanning` — agent is in Phase 1
- `planning` — agent is in Phase 2 or 3
- `in-progress` — agent is in Phase 4
- `deploying` — agent is in Phase 5
- `shipped` — complete, quality bar met, deploy live (or deploy n/a with reason)
- `blocked` — waiting on user input or external resolution
- `decided-against` — user opted to skip (rare; only with reason)

## Polish score legend

Self-assessed by the agent on a 0–100 scale:
- 90–100: portfolio-worthy, would show to a senior engineer
- 75–89: solid, minor gaps remain
- 60–74: functional but rough
- Below 60: needs more work

---

## Repos

| Repo | Stack | Status | Deploy URL | Polish | Last touched | Next action |
|------|-------|--------|-----------|--------|-------------|-------------|
| (populate on first session) | | | | | | |

---

## First-session bootstrap

On the very first portfolio-finish session, the agent should:

1. Run `gh repo list rayancheca --public --limit 100 --json
   name,description,primaryLanguage,updatedAt,homepageUrl,isArchived`
2. Filter out the originals (the ones now private) — the agent only
   cares about the public mirrors
3. Populate the table above, one row per repo, with:
   - `name` → Repo column
   - `primaryLanguage` + manifest detection → Stack
   - `status` → `queued`
   - `homepageUrl` → Deploy URL (empty if not set)
   - `updatedAt` → Last touched
   - `Next action` → `scan`
4. Commit this file to git if portfolio-finish is itself tracked

After bootstrap, the user decides which repo to start with, and the
agent begins its Phase 0 for that repo.

---

## Priority heuristics

If the user asks "which repo next?", the agent suggests by this order:

1. Any repo already `in-progress` (finish what's started)
2. Repos with the highest "portfolio impressiveness" signal:
   - Visual / UI projects (direct recruiter appeal)
   - AI / ML projects
   - Novel algorithm or systems-level projects
3. Repos that are close to done (low lift, big win)
4. Everything else
