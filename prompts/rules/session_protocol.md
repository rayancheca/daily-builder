# Session Protocol — Every Session, No Exceptions

## Before any work

- Read `state.md` FIRST, before touching any code
- Read `CLAUDE.md` second
- Verify your understanding by restating (one line) what you're working on
  and where you are

## During work

- One step at a time — never combine, never skip
- Verify before committing — run it, see the output, then commit
- Commit after every working feature with conventional-commit messages
  (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`,
  `style:`, `build:`, `ci:`)
- Update `state.md` after every completed step
- Never leave broken code in a committed state
- Never use `--no-verify`, `--force`, or any destructive git flag

## Ending a session

Before stopping, for any reason:

1. `git add -A && git commit -m "checkpoint: session end"` (if there are
   pending changes)
2. `git push`
3. Update `state.md`:
   - Every step completed this session moved to Completed
   - If paused mid-step: exact description of where you stopped, which
     function you were writing, what it needs to do, what you already
     wrote
   - Next steps written precisely enough that a fresh agent can resume
     with zero ambiguity — not "continue building" but the exact
     function, file, and behavior
   - Increment session count by 1
4. If the project is fully complete:
   - Set `## Status\nCOMPLETE` at the top of `state.md`
   - Ensure `README.md` is fully written
   - Run a final end-to-end test
   - `git commit -m "release: v1.0.0 — project complete"`
   - `git push`
   - Update `~/daily-builder/project_history.md` — mark Status as COMPLETE

## Token efficiency

- Do not re-read files you already read in this session unless they
  changed
- Write reasoning in `state.md`, not in long internal monologues
- Execute clearly-defined steps immediately — don't over-plan
- If an approach fails twice, pivot and document why in `state.md`
- Use the minimum number of tool calls to verify something works
