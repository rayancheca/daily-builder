# Portfolio Finish — Operator Reference

Quick reference for running the portfolio-finish workflow. Read this
once, then bookmark.

---

## Start a session on a repo

```bash
# Clone the public mirror if you haven't
gh repo clone rayancheca/<repo-public-name>
cd <repo-public-name>

# Launch Claude Code, pointing at the launch prompt
claude --dangerously-skip-permissions < ~/daily-builder/portfolio-finish/prompts/launch.md
```

Or interactive:

```bash
cd <repo-public-name>
claude --dangerously-skip-permissions
```

Then paste:
```
Read ~/daily-builder/portfolio-finish/prompts/launch.md and follow it
exactly. Begin with Phase 0.
```

---

## Pause cleanly mid-session

Press `Ctrl+C` once. The agent will:
1. Commit or stash pending work
2. Update `POLISH_LOG.md`
3. Update `portfolio.md` status to `in-progress`
4. Push to origin

---

## Resume a paused repo

Same command as starting a session — the agent reads `POLISH_LOG.md`
and picks up where it left off.

```bash
cd <repo-public-name>
claude --dangerously-skip-permissions
```

Then paste: `Read POLISH_LOG.md and resume from the documented next action.`

---

## See overall progress

```bash
cat ~/daily-builder/portfolio-finish/state.md
cat ~/daily-builder/portfolio-finish/portfolio.md
```

Or open them in an editor — they're plain markdown.

---

## Prep: make originals private, create public mirrors

For each repo in `~/dev/daily-projects/`:

```bash
# 1. Make original private
gh repo edit rayancheca/<original-name> --visibility private --accept-visibility-change-consequences

# 2. Create a public mirror
ORIG=<original-name>
MIRROR="${ORIG}-v2"  # or rename however you like

# Clone the original, push to a new public repo
git clone "https://github.com/rayancheca/${ORIG}.git" "${MIRROR}"
cd "${MIRROR}"
gh repo create "rayancheca/${MIRROR}" --public --description "(migrated for portfolio-finish)"
git remote set-url origin "https://github.com/rayancheca/${MIRROR}.git"
git push -u origin main
cd ..
```

Batch script for all 42 (adjust names):

```bash
for dir in ~/dev/daily-projects/*/; do
  ORIG=$(basename "$dir")
  MIRROR="${ORIG}-v2"
  echo "=== Migrating $ORIG → $MIRROR ==="
  # ... (the commands above)
done
```

Run this manually for the first few to verify behavior before batch
running.

---

## MCP tools available — quick index

Authentication required once per session for paid services.

### Vercel
- `mcp__plugin_vercel_vercel__authenticate` — start auth flow
- `mcp__plugin_vercel_vercel__complete_authentication` — finish auth
- (others accessible after auth; the agent can discover them)

### Netlify
- `mcp__claude_ai_Netlify__netlify-project-services-reader` —
  read project data
- `mcp__claude_ai_Netlify__netlify-project-services-updater` —
  modify projects, env vars
- `mcp__claude_ai_Netlify__netlify-deploy-services-reader` —
  inspect deploys
- `mcp__claude_ai_Netlify__netlify-deploy-services-updater` —
  trigger deploys
- `mcp__claude_ai_Netlify__netlify-extension-services-*` —
  extensions (forms, functions, etc.)
- `mcp__claude_ai_Netlify__netlify-team-services-reader` —
  team/account info

### GitHub
Use `gh` CLI for everything.

### Google Workspace (Drive, Calendar, Gmail)
Only if a repo integrates with them.

### Notion
Only if a repo integrates with Notion.

---

## Slash commands (skills) most useful here

### Deploy
- `/vercel:bootstrap` — first-time Vercel setup
- `/vercel:deploy` — deploy (append `prod` for production)
- `/vercel:env` — env var management
- `/vercel:status` — deployment status
- `/vercel:marketplace` — install DB/auth integrations

### Stack-specific
- `/vercel:nextjs` — Next.js guidance
- `/vercel:ai-sdk` — AI SDK integration
- `/vercel:ai-gateway` — LLM routing
- `/vercel:chat-sdk` — chat interfaces
- `/vercel:next-cache-components` — Next 16 caching
- `/vercel:auth` — auth integrations (Clerk, Auth0, Descope)
- `/vercel:vercel-storage` — storage options

### Quality
- `/code-review` — review uncommitted changes
- `/security-review` — security scan before deploy
- `/e2e-testing` — write Playwright tests
- `/test-coverage` — coverage audit
- `/simplify` — review for clarity and cleanup

### Design / polish
- `/frontend-design` — for genuine UI intervention
- `/seo` — technical SEO audit
- `/ui-demo` — record Playwright-driven demo GIFs

### Platform
- `/github-ops` — GitHub issue/PR/release operations
- `/vercel:verification` — end-to-end deploy verification

---

## Common deploy recipes (one-liners)

### Next.js to Vercel (fresh)
```
/vercel:bootstrap
/vercel:deploy prod
gh repo edit --homepage "https://<project>.vercel.app"
```

### Vite React to Vercel
```
/vercel:deploy prod
```
(Vercel auto-detects Vite)

### Static HTML to GitHub Pages
```bash
gh api repos/:owner/:repo/pages -X POST \
  -f source='{"branch":"main","path":"/"}'
```

### FastAPI to Railway
```bash
npx -y @railway/cli login
npx -y @railway/cli init
npx -y @railway/cli up
```

### Go web app to Fly.io
```bash
fly launch
fly deploy
fly open
```

### Go CLI tool
```bash
git tag v0.1.0
git push --tags
# GitHub Actions with goreleaser handles the rest
```

---

## Troubleshooting

### Claude Code hangs in a session
Press `Ctrl+C` once. It saves state. Resume later.

### Deploy fails with "missing env var"
```bash
# Check what's set
/vercel:env
# Add what's missing
/vercel:env add
```

### Build works locally but fails in CI / on Vercel
- Node version mismatch — pin in `package.json` `"engines"`
- Platform-specific native deps — check `optionalDependencies`
- Missing env vars in build scope (separate from runtime scope)

### GitHub Pages 404s on routed SPA pages
- Add a 404.html that redirects to index.html
- Or switch to Vercel

### Vercel deploys but images / fonts 404
- Check `base` path in `vite.config.ts`
- Check `next.config.js` `basePath`

### "POLISH_LOG out of sync with reality"
Don't try to reconcile by hand. Ask the agent to re-scan and
regenerate the log from current state.

---

## Stop signals

If at any point the user says any of these, the agent stops immediately
and awaits instructions:

- "stop"
- "pause"
- "wait"
- "hold on"
- Ctrl+C

The agent does NOT interpret these as "keep working but slower." It
stops, commits/stashes, updates logs, and waits.

---

## What goes where

| File | Purpose | Updated by |
|------|---------|-----------|
| `CLAUDE.md` | Standing instructions | Rarely (by you) |
| `state.md` | Overall progress across all repos | Agent, every session |
| `portfolio.md` | Per-repo database (table) | Agent, every session |
| `reference.md` | This file — quick ref for you | Rarely (by you) |
| `README.md` | User-facing how-to-use | Rarely (by you) |
| `prompts/launch.md` | Entry prompt for agent | Rarely (by you) |
| `prompts/workflow.md` | Detailed loop | Rarely (by you) |
| `deploy/playbooks.md` | Deploy recipes by stack | When new platforms are added |
| `<repo>/POLISH_LOG.md` | Per-repo progress log | Agent, every session |

---

## FAQ

**Q: Can I work on multiple repos in parallel with two Claude sessions?**
Yes, but they must be on different repos. Each session is independent.
Just be careful that `portfolio.md` and `state.md` edits don't race —
if both finish at the same time, one may need a manual merge.

**Q: What if a repo can't be deployed?**
Document why in `POLISH_LOG.md`. Mark `deploy_url: n/a (<reason>)` in
`portfolio.md`. The repo can still be "shipped" in the sense of
being portfolio-ready — a CLI tool with GitHub Releases counts.

**Q: What if a repo is fundamentally broken beyond repair?**
Tell the agent. It will propose either a rewrite-in-place or a clean
restart. The user decides. No repos get abandoned.

**Q: Where are deploys actually hosted?**
Depends on stack. Vercel for most JS/TS. Netlify as alternative.
GitHub Pages for static. Railway / Fly.io for Python/Go backends.
All free tiers where possible.

**Q: What about keeping deploys alive long-term?**
Free tier deploys last indefinitely for most services. Railway's free
trial is limited but Fly.io's free allowance is ongoing for small
apps. Document trial expirations in `POLISH_LOG.md` if relevant.
