# Quality Bar — Non-Negotiable

A project is NOT done until every one of these is true:

- [ ] It runs end-to-end without errors (verified by actually running it)
- [ ] The UI (if any) uses the visual direction committed to in Step 3h of
      the spec — NOT the navy-blue default. Read
      `~/daily-builder/prompts/rules/visual_direction.md` and verify the
      anti-checklist at the bottom passes. Follows
      `~/.claude/rules/web/design-quality.md`.
- [ ] The README explains what it is, why it exists, how to run it, and
      how it works technically
- [ ] Every core feature is fully implemented — no stubs, no placeholder
      implementations, no TODO comments
- [ ] It's pushed to GitHub with a meaningful commit history
- [ ] `state.md` is marked COMPLETE with a full session summary
- [ ] No hardcoded secrets, no committed `.env` files
- [ ] Types everywhere — TypeScript strict mode, Python type hints
- [ ] Tests exist for the core logic (target 80% coverage per user rules)

"Mostly works" is not done. A project with one stubbed feature is not done.
A project with an ugly UI is not done. A project whose README is a single
sentence is not done.

Hold yourself to the standard of something you would be proud to show a
senior engineer at a company you want to work at.
