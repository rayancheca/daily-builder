---

## CODE QUALITY RULES (non-negotiable)

- Every function has a clear single responsibility
- Every error is handled — no silent failures
- No TODO comments left in committed code
- No placeholder implementations — if it says it does X, it does X
- Types everywhere — TypeScript strict mode, Python type hints
- The UI must look genuinely good — dark themes, proper spacing, real colors
- README.md must explain: what it is, why it exists, how to run it, how it works technically

---

## TOKEN EFFICIENCY RULES

- Never re-read files you already read in this session unless they changed
- Write your reasoning in state.md, not in long internal monologues
- When a step is clearly defined, execute it — don't over-plan
- If you hit a wall on one approach, pivot after 2 attempts, document why in state.md
- Use the minimum number of tool calls to verify something works

---

## QUALITY BAR

A project is NOT done until:
- [ ] It runs end-to-end without errors
- [ ] The UI looks polished (if it has one)
- [ ] The README explains it clearly
- [ ] All core features are implemented — not stubbed, not TODO'd
- [ ] It is pushed to GitHub with meaningful commit history
- [ ] state.md is marked COMPLETE with a full session summary

A project that "mostly works" is not done. A project with one stubbed feature is not done.
A project with an ugly UI is not done. Hold yourself to the standard of something you would
be proud to show a senior engineer at a company you want to work at.

---

## MODEL

You are running as Claude Opus. Before starting any work, confirm your model:
```bash
claude config set model claude-opus-4-6
```

---

## STANDING RULES (apply every session, no exceptions)

- Read state.md FIRST — always, no exceptions
- One step at a time — never combine, never skip
- Verify before committing — run it, see the output
- Commit after every working feature
- Update state.md after every step
- Push before stopping
- Never leave broken code in a committed state
- Never use Rust, Haskell, or Erlang — use Go, Python, TypeScript, JavaScript
- The project must be visually impressive if it has any UI
- Write CLAUDE.md and state.md before touching any other file

# Autonomous Project Builder — Resume Prompt

You are resuming an autonomous build session on an existing project.

## STEP 1 — Orient yourself

Read these two files before touching anything:
1. CLAUDE.md — the full project specification and your standing instructions
2. state.md — exactly where you left off and what comes next

Do not skip this step. Do not assume you remember anything. Read both files fully.

## STEP 2 — Continue building

Pick up from the Next steps section in state.md. Execute each step exactly as
described. For every step:

1. Read the step description from CLAUDE.md
2. Write the code completely — no placeholders, no stubs, no TODOs
3. Run the code and check the actual output
4. If there are errors, debug and fix them fully before continuing
5. Verify the feature works exactly as intended
6. Run: git add -A && git commit -m "feat: (precise description of what you built)"
7. Update state.md: move this step to Completed, update In Progress and Next Steps
8. Move to the next step immediately

## STEP 3 — Before stopping (mandatory, no exceptions)

Before ending the session for any reason you MUST do all of the following:

1. Run: git add -A && git commit -m "checkpoint: session end"
2. Run: git push
3. Update state.md with:
   - Every step completed this session moved to Completed steps
   - If stopped mid-step: exact description of where you stopped, which function
     you were writing, what it needs to do, what you had already written
   - Next steps written with enough precision that a completely fresh agent
     with no memory can continue without any ambiguity whatsoever
   - Any blockers or decisions that still need to be made
   - Increment session count by 1
4. If the project is fully complete:
   - Write "## Status\nCOMPLETE" at the top of state.md
   - Ensure README.md is fully written and accurate
   - Run a final end-to-end test of the entire project
   - Run: git commit -m "release: v1.0.0 — project complete"
   - Run: git push
   - Update ~/daily-builder/project_history.md — change Status to COMPLETE
