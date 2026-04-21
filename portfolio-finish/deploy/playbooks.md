# Deploy Playbooks

Exact steps for shipping each common stack. Always prefer MCP tools and
slash commands over raw CLI when both are available.

---

## Preflight — applies to every deploy

Before any deploy:

- [ ] Code runs locally without errors
- [ ] `npm run build` / equivalent succeeds
- [ ] No secrets in commits — check with `git log -p | grep -iE
      "(api[_-]?key|secret|password|token|bearer)"` and eyeball matches
- [ ] `.env.example` present if env vars are needed; `.env` is gitignored
- [ ] `README.md` exists and has install/run instructions
- [ ] `package.json` `"name"` matches repo (or is explicitly
      scoped/renamed on purpose)
- [ ] GitHub repo is public (portfolio-finish mirrors are public by
      design)

---

## Vercel — for Next.js, Vite, React, Svelte, Astro, static

### First-time Vercel setup in this Claude Code session

```
# Authenticate (once per session if not already authenticated)
call mcp__plugin_vercel_vercel__authenticate
# Wait for user to complete auth flow, then:
call mcp__plugin_vercel_vercel__complete_authentication
```

Or use the slash command: `/vercel:bootstrap` which handles auth plus
project linking.

### Per-repo deploy flow

1. **Verify build locally**
   ```bash
   npm install
   npm run build
   ```

2. **Link the repo to Vercel** (if not already linked)
   Use `/vercel:bootstrap` — it runs preflight checks, creates the
   Vercel project, detects framework, sets up initial env vars.

3. **Set environment variables**
   - Identify required vars from `.env.example` or code
   - Use `/vercel:env` to add them to Preview and Production scopes
   - Never paste secrets into shell or logs — use the Vercel dashboard
     or MCP tool with care

4. **Deploy**
   ```
   /vercel:deploy         # preview deploy
   /vercel:deploy prod    # promote to production
   ```

5. **Verify**
   - Load the production URL in a browser
   - Click through key routes
   - Check `/vercel:status` for build health

6. **Wire the homepage**
   ```bash
   gh repo edit --homepage "https://<project>.vercel.app"
   ```

7. **Update README**
   Add near the top:
   ```markdown
   **Live:** [https://<project>.vercel.app](https://<project>.vercel.app)
   ```

### Next.js specifics

- If using App Router: `/vercel:nextjs` has current patterns
- If using Server Components: cache behavior matters — see
  `/vercel:next-cache-components`
- If upgrading Next version: `/vercel:next-upgrade`

### AI features on Vercel

- AI SDK: `/vercel:ai-sdk`
- AI Gateway (for model routing / failover): `/vercel:ai-gateway`
- Chat UIs: `/vercel:chat-sdk`

### Storage on Vercel

- Blob storage, Edge Config, Neon Postgres (via marketplace), Upstash
  Redis (via marketplace): see `/vercel:vercel-storage` and
  `/vercel:marketplace`

---

## Netlify — for static sites, Jamstack, when Vercel doesn't fit

Use when:
- Form handling without a backend (Netlify Forms)
- Heavy edge functions with CDN requirements
- Existing Netlify account / preference
- Repo has `netlify.toml` already

### Flow

1. **Project setup**
   Use Netlify MCP tools (`mcp__claude_ai_Netlify__netlify-project-services-updater`)
   to create / link the project.

2. **Env vars**
   `mcp__claude_ai_Netlify__netlify-project-services-updater` with env
   var payload.

3. **Deploy**
   Netlify auto-deploys on push to main once the GitHub integration
   is set up. Confirm via MCP status tools.

4. **Homepage + README** — same as Vercel flow

---

## GitHub Pages — for pure static sites, docs, portfolios

Use when:
- No build step OR a simple static build
- No backend needed
- Project fits GitHub's free tier (1GB, 100GB/mo bandwidth)

### Static HTML (no build)

1. **Enable Pages**
   ```bash
   gh api repos/:owner/:repo/pages -X POST \
     -f source='{"branch":"main","path":"/"}'
   ```
   Or via UI if CLI is fiddly.

2. **Verify** — load `https://<user>.github.io/<repo>/`

3. **Homepage + README** — same as above

### SPA with build step (Vite, CRA)

Use a GitHub Actions workflow. Create `.github/workflows/pages.yml`:

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ./dist  # adjust for your framework
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/deploy-pages@v4
        id: deployment
```

For Vite projects, also add `base: '/<repo-name>/'` to `vite.config.ts`.

---

## Python backend — FastAPI / Flask

### Option A: Vercel Python runtime (serverless)

Best for low-traffic APIs without long-running state.

1. Add `vercel.json`:
   ```json
   {
     "builds": [
       { "src": "api/*.py", "use": "@vercel/python" }
     ],
     "routes": [
       { "src": "/(.*)", "dest": "/api/index.py" }
     ]
   }
   ```
2. Move app into `api/index.py` (or adapt structure)
3. Add `requirements.txt` with FastAPI / Flask + deps
4. `/vercel:deploy` — same flow as Next.js

### Option B: Railway (for long-running processes)

Best for: Django, Celery workers, WebSockets, persistent connections.

1. Install Railway CLI: `npm i -g @railway/cli` (session-local)
2. `railway login`
3. `railway init` inside the repo
4. `railway up` to deploy
5. `railway domain` to get public URL
6. Add env vars via `railway variables` or dashboard

### Option C: Fly.io

Best for: Docker-based Python apps, containers, high control.

1. Install `flyctl` (document install in session, don't install globally)
2. `fly launch` — auto-generates Dockerfile and fly.toml
3. Answer prompts: region, name, postgres yes/no
4. `fly deploy`
5. `fly open` to check

---

## Go backend

### Web server (Gin, Echo, Fiber, net/http)

**Fly.io is the default** — Go services run cheaply on Fly.

1. Add a minimal Dockerfile:
   ```dockerfile
   FROM golang:1.22 AS build
   WORKDIR /app
   COPY go.mod go.sum ./
   RUN go mod download
   COPY . .
   RUN CGO_ENABLED=0 GOOS=linux go build -o /out/app ./cmd/server

   FROM gcr.io/distroless/static
   COPY --from=build /out/app /app
   EXPOSE 8080
   CMD ["/app"]
   ```
2. `fly launch` → `fly deploy`
3. `fly open`

---

## Go CLI tool

CLI tools don't "deploy" — they distribute.

### GitHub Releases with cross-compiled binaries

Use `goreleaser` (add `.goreleaser.yaml`) and a release workflow:

`.github/workflows/release.yml`:
```yaml
name: release
on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - uses: goreleaser/goreleaser-action@v6
        with:
          args: release --clean
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

`.goreleaser.yaml`:
```yaml
builds:
  - env: [CGO_ENABLED=0]
    goos: [linux, darwin, windows]
    goarch: [amd64, arm64]
archives:
  - format: tar.gz
    format_overrides:
      - goos: windows
        format: zip
```

Then tag and push:
```bash
git tag v0.1.0
git push --tags
```

Update README with install instructions:
```markdown
## Install

```bash
go install github.com/<user>/<repo>/cmd/<name>@latest
```

Or download from [releases](https://github.com/<user>/<repo>/releases).
```

---

## Node CLI tool

Publish to npm.

1. Ensure `package.json` has:
   ```json
   {
     "name": "<unique-name>",
     "version": "0.1.0",
     "bin": { "<cmd>": "./bin/cli.js" },
     "files": ["bin/", "dist/"]
   }
   ```
2. `npm login` (user must do this interactively)
3. `npm publish --access public`
4. README install:
   ```markdown
   ```bash
   npm install -g <name>
   ```
   ```

---

## Python CLI tool

Publish to PyPI.

1. Ensure `pyproject.toml` is modern (setuptools / hatch / pdm)
2. Install build tools: `pip install build twine` (session-local venv)
3. `python -m build`
4. `twine upload dist/*` (user provides PyPI token)
5. README install: `pip install <name>`

---

## Static portfolio / landing page

Vercel is the default. GitHub Pages works. Pick Vercel if the repo has
any build step or if you want edge features later.

---

## Database provisioning

Every deploy that needs a DB should use a free managed service:

- **Postgres** → Neon (via Vercel Marketplace) or Supabase
- **Redis / KV** → Upstash (via Vercel Marketplace)
- **SQLite at edge** → Turso
- **MongoDB** → MongoDB Atlas free tier

For Vercel projects, prefer Marketplace installs — env vars are
auto-provisioned.

---

## AI / LLM keys

If a project calls an AI API:

- Prefer **Vercel AI Gateway** (`/vercel:ai-gateway`) — single key,
  multi-provider, built-in failover
- Otherwise: set provider keys in Vercel/Railway env vars (Preview +
  Production scopes)
- Never commit keys; never echo them in logs

---

## Auth

Use managed auth unless the repo already has its own:

- **Clerk** (native Vercel Marketplace) — easiest for Next.js
- **Auth0** — mature, broad
- **Descope** — simpler flows

See `/vercel:auth` for Next.js-specific integration patterns.

---

## Post-deploy — always

1. `gh repo edit --homepage "<live-url>"`
2. Add `<live-url>` to README (near top, bold, with a "Live demo" label)
3. Add repo topics if missing: `gh repo edit --add-topic <topic>`
4. Ensure repo description is crisp and accurate
5. Take a screenshot, save to `docs/screenshot.png` or similar, reference
   in README
6. Optional: record a 10–20s demo GIF (use the `ui-demo` skill for
   Playwright-driven recordings)
7. If the site has meaningful content: run `/seo` skill for a quick
   SEO audit — title, meta description, OG image, sitemap

---

## Troubleshooting

### "Vercel build succeeded but site is blank"
- Check browser console
- Check that `dist` or `.next` is the right output dir
- Check `next.config.js` / `vite.config.ts` `base` path

### "GH Pages 404s on refresh for SPA routes"
- SPA fallback: symlink `404.html` to `index.html` in the build
- Or use `vercel.json` rewrites instead (switch platform)

### "Vercel can't find function handler"
- `vercel.json` `routes` vs `rewrites` mismatch
- File must be under `/api/` for serverless
- Check function runtime (nodejs20.x, python3.11)

### "Railway sleeps after inactivity"
- Free tier apps sleep — document this in README or upgrade

### "Fly.io deploy fails on build"
- Check Dockerfile syntax
- Ensure `.dockerignore` doesn't exclude needed files
- `fly logs` after failed deploy

### "Secrets showing up in build logs"
- Vercel/Netlify both mask detected secrets; if yours isn't masked,
  it's already leaked — rotate immediately
