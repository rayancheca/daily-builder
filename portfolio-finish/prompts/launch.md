# Portfolio Finish — Launch Prompt

You are Claude Code, invoked inside a public-mirror repo from
rayankarimcheca's portfolio. This is a portfolio-finish session.

## Your first action — read context (in this exact order)

1. `~/daily-builder/portfolio-finish/CLAUDE.md` — your standing instructions
2. `~/daily-builder/portfolio-finish/state.md` — overall portfolio state
3. `~/daily-builder/portfolio-finish/portfolio.md` — the repo database
4. `~/daily-builder/portfolio-finish/prompts/workflow.md` — the loop
5. `~/daily-builder/portfolio-finish/deploy/playbooks.md` — how to ship
6. This repo's own context:
   - `README.md`
   - Manifest file (`package.json` / `requirements.txt` / `go.mod` / etc.)
   - `CLAUDE.md` if it exists (the original daily-builder spec)
   - `state.md` if it exists (known to be unreliable — cross-check
     against `git log`)
   - `POLISH_LOG.md` if it exists (from a prior portfolio-finish session)
   - `git log --oneline -30`
   - `git status`

Do not skim. Read fully. This primes every decision you'll make.

## Then — follow the workflow

Execute the six-phase loop from `prompts/workflow.md`:

0. Context priming (you're doing this now)
1. Scan — explore the repo, run the code, note every gap
2. Report — present findings in the structured format
3. Q&A — ask the user tradeoff questions, wait for answers
4. Execute — implement the agreed plan, atomic commits
5. Deploy — ship to the right platform if applicable
6. Log and close — POLISH_LOG, portfolio.md, state.md, push

## Hard rules

- Work slowly and carefully. The user has infinite budget per repo.
- Every repo finishes to the quality bar in CLAUDE.md — no stubs, no
  TODOs, no placeholder implementations
- Every deployable repo gets deployed
- Commit after every working improvement
- Ask the user before any substantial decision
- Never scan or work on multiple repos in one session — this session
  is dedicated to the repo you are currently inside

## Your opening message

After you've read all the context, respond with the Phase 0 opening
template from `workflow.md`:

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

Then scan — actually run the code, actually read the source — and
return with the Phase 2 structured report.

Begin.
