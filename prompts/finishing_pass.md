# Finishing Pass — Polish a Built Project

You are Claude Code, invoked on a daily-builder project that has already
been built but needs polish to reach portfolio-worthy quality. This is
NOT a building session. Core features already exist. Your job is taste
and presentation.

## Read first (in order)

1. `~/daily-builder/prompts/rules/quality_bar.md`
2. `~/daily-builder/prompts/rules/session_protocol.md`
3. `~/daily-builder/prompts/rules/code_rules.md`
4. The project's `CLAUDE.md`
5. The project's `state.md`
6. The project's `README.md`
7. The project's `evaluation.json` if present — targets the gaps named there

## Scope — what this pass does

This pass touches only these categories of work:

1. **README** — comprehensive rewrite: problem, what it does, how it
   works technically, how to run, screenshots, live link if deployed,
   tech stack, badges
2. **UI polish** — if the project has any visual surface, make it look
   genuinely good. Follows `~/.claude/rules/web/design-quality.md`. No
   default template looks.
3. **Demo material** — screenshots in `docs/screenshots/`, optional
   demo GIF if there's a user flow worth capturing
4. **Code hygiene** — remove TODOs that were left behind, dead code,
   `console.log` / `print(` debug statements, placeholder comments
5. **Tests** — add tests for the most important surface if they're
   missing. Target 80% coverage pragmatically.
6. **Dependencies** — audit for outdated or unused deps, update minor
   versions, remove unused
7. **Repo metadata** — `gh repo edit --description ...`, topics, homepage
   URL if deployed

## Scope — what this pass does NOT do

- Do not add new features
- Do not rewrite architecture
- Do not change language or framework
- Do not deploy — that's a separate pass (see
  `~/daily-builder/portfolio-finish/`)

## Workflow

### Phase 0 — Context
Read the files listed above. State: "Finishing-pass context loaded for
<project>. Heuristic score in evaluation.json was X, LLM score was Y.
Top 3 gaps named in the evaluation: [...]. Targeting those first."

### Phase 1 — Prioritize
List the gaps from `evaluation.json` (if present) ordered by impact.
Present your plan:
1. README rewrite
2. UI polish pass (if applicable)
3. Test additions
4. Code hygiene sweep
5. Dependency audit
6. Repo metadata

### Phase 2 — Execute
One category at a time. Atomic commits. Conventional-commit messages
(`docs:`, `style:`, `test:`, `chore:`, `refactor:`). Run everything
that can be run after each change.

### Phase 3 — Verify
Before closing:
- Re-run the evaluator: `python3 -m daily_builder.evaluate <project_dir>`
  (or the actual invocation — see `~/daily-builder/lib/evaluate.py`)
- Confirm score improved
- Check the quality bar from `~/daily-builder/prompts/rules/quality_bar.md`

### Phase 4 — Close
- `git add -A && git commit -m "chore: finishing pass complete"`
- `git push`
- Update `state.md`: if it wasn't already COMPLETE, mark it COMPLETE
- Report final score and what changed

## Quality bar

A finishing pass is NOT done until:
- [ ] README is comprehensive (problem, what, how, run, screenshots,
      tech stack)
- [ ] Zero TODO / FIXME / debug statements in committed code
- [ ] UI (if any) is not a default template look
- [ ] Tests exist for core logic
- [ ] Repo description and topics set on GitHub
- [ ] Evaluator score >= 85 (if achievable in scope — if not, document
      what's blocking in POLISH_LOG.md)

## Do not

- Do not add features outside the scope list above
- Do not deploy in this pass
- Do not change state.md Status from IN PROGRESS to COMPLETE unless
  the quality bar is actually met
- Do not skip the verifier run at the end
