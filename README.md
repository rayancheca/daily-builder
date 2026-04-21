# daily-builder

An autonomous portfolio builder that turns idle compute into shipped GitHub
projects. Every session runs an LRU domain picker, generates a fresh idea,
de-duplicates it against history, hands the spec to Claude Code, builds the
thing, and grades the result.

Comes with a live mission-control dashboard that tells you — at a glance —
what's building, what's stalled, what's shipped, how good each one is, and
how much of your Max subscription you've burned this week.

![Dashboard](docs/dashboard.png)

---

## What it does

- **Generates portfolio-worthy project ideas** scoped to 2–4 Claude Code sessions,
  rotated across 6 domains (security / systems / data / AI-ML / networking /
  devtools) by least-recently-used frequency
- **Deduplicates ideas** via stdlib TF-IDF cosine similarity against
  `project_history.md`; auto-regenerates if too close to a past project
- **Three input modes**: `surprise` (LRU auto-pick), `guided` (you pick domain
  + free-text angle), `wishlist` (pick from your backlog file)
- **Evaluates every build** at session exit with an 8-check heuristic score
  (README, git activity, tests, stubs, secrets, runnability, state, progress)
  plus an optional qualitative LLM review via `claude -p`
- **Detects stalled projects** via git mtime (not `state.md`, which lies)
- **Tracks Max token usage** by parsing Claude Code transcripts — per project,
  per week, per message
- **Dashboard** with live SSE, clickable activity calendar drilling into
  per-day commit timelines, stat cards opening to detail charts, drawer
  actions to resume/polish/evaluate/archive any project

---

## Install

```bash
git clone https://github.com/rayancheca/daily-builder ~/daily-builder
cd ~/daily-builder

# Python venv (for pytest; the main scripts use stdlib only)
python3 -m venv venv
venv/bin/pip install pytest

# Verify
venv/bin/python -m pytest tests/ -q
```

Requires:
- macOS or Linux with bash, Python 3.11+, git
- [Claude Code CLI](https://claude.com/claude-code) authenticated
- [GitHub CLI](https://cli.github.com) for repo creation
- Optional: `osascript` (macOS) for dashboard "Resume in Terminal" buttons

---

## Usage

```bash
bash ~/daily-builder/start.sh
```

One command. Behavior:

1. Dashboard boots at `http://localhost:8765`
2. Detects unfinished project (via git activity, not `state.md`) → prompts to resume
3. Otherwise prompts mode: `s` surprise / `g` guided / `w` wishlist
4. Generates idea → dedupe check → regen if too similar → up to 3 attempts
5. Approve → `gh repo create` → writes `CLAUDE.md` + `state.md`
6. Claude Code launches, builds the project
7. On exit, evaluator runs → writes `evaluation.json` + appends score to history

Other modes:

```bash
bash start.sh --polish <repo>     # dedicated finishing-pass session
bash start.sh --evaluate <repo>   # just score it
bash start.sh --resume <repo>     # resume a specific project
bash start.sh --mode guided       # skip the mode prompt
```

---

## The dashboard

Open `http://localhost:8765`. Everything is clickable.

- **Activity calendar** scrolls to recent days automatically. Click any green
  square for that day's commits, hourly breakdown, and per-project stats.
- **Stat cards** (Streak / Shipped / Commits) open detail modals — 60-day
  streak chart, full shipped list with eval scores, velocity graph.
- **Project cards** show authoritative status (Building/Shipped/**Stalled**),
  eval score chip, git-derived progress. Click one → drawer with actions:
  - **▶ Resume** — spawns Terminal.app running `start.sh --resume`
  - **◆ Polish** — spawns Terminal running `start.sh --polish`
  - **✓ Evaluate** — in-place, card refreshes with new score
  - **⊘ Archive** — moves to `_archive/` after confirm
- **Wishlist panel** (★ button in topbar) — add one-liner ideas, delete with
  the × button. Picks flow into `start.sh → wishlist mode`.
- **Token Usage tile** — weekly breakdown (input / output / cache-write /
  cache-read), messages count, top 5 projects by usage. Click a project row
  to open its drawer.

---

## Architecture

```
~/daily-builder/
├── start.sh                    # the only script you run
├── config.json                 # all thresholds: stalled days, dedupe cutoff, etc.
├── wishlist.md                 # your idea backlog
├── project_history.md          # append-only log + eval scores
├── lib/
│   ├── paths.py                # typed Config loader
│   ├── project_state.py        # git-derived authoritative status
│   ├── pick_domain.py          # LRU + weighted domain picker
│   ├── dedupe.py               # stdlib TF-IDF similarity
│   ├── telemetry.py            # Claude Code transcript parser
│   └── evaluate.py             # heuristic + LLM evaluator
├── prompts/
│   ├── generate_idea.md        # domain-aware idea prompt
│   ├── evaluate.md             # LLM evaluation rubric
│   ├── finishing_pass.md       # polish-only session brief
│   ├── new_project.md          # full build spec (legacy, kept intact)
│   ├── dashboard_polish.md     # separate-session dashboard audit brief
│   └── rules/                  # modular agent rules
│       ├── quality_bar.md
│       ├── session_protocol.md
│       └── code_rules.md
├── dashboard/
│   ├── server.py               # Python stdlib HTTP server + SSE
│   ├── index.html
│   ├── app.js                  # Chart.js + vanilla JS
│   └── style.css               # OKLCH tokens, no framework
├── portfolio-finish/           # separate workflow for finishing/shipping existing repos
└── tests/                      # pytest, all stdlib targets
```

### Data sources — single source of truth

| Question | Source |
|----------|--------|
| Is a project shipped? | git commit history + `state.md` cross-check |
| How much progress? | git feat/fix commit count vs. numbered plan in `CLAUDE.md` |
| Is a project stalled? | `days_since_last_commit >= stalled_days` (config) |
| Token usage? | `~/.claude/projects/**/*.jsonl` message-usage fields |
| Evaluation score? | 8 heuristic checks + LLM qualitative pass |
| Idea too similar? | TF-IDF cosine against `project_history.md` entries |

`state.md` is trusted for *display labels only*, never for counts or gating.

---

## Configuration

All knobs in `config.json`:

```json
{
  "abandonment": { "stalled_days": 3, "dead_days": 14 },
  "dedupe":      { "similarity_threshold": 0.55, "max_regens": 3 },
  "evaluator":   { "score_threshold": 75, "use_llm": true },
  "domain":      { "weights": { "cybersecurity": 1.0, "systems": 1.0, "data": 1.0, "ai_ml": 1.0, "networking": 1.0, "devtools": 1.0 } },
  "telemetry":   { "transcripts_dir": "~/.claude/projects", "max_weekly_tokens": 10000000000, "max_session_tokens": 1000000000 },
  "finishing_pass": { "auto_suggest_below_score": 75 }
}
```

Set a domain weight to `0` to exclude it. Raise another to bias toward it.

---

## Running the dashboard remotely

The dashboard is a local-only HTTP server that reads `~/dev/daily-projects/`
and `~/.claude/projects/` — real local filesystem access. It **cannot be
deployed to Vercel, Netlify, or any serverless platform** without a full
rewrite (they have no access to your desktop's filesystem).

To access it from another device (phone, laptop while traveling), use a
secure tunnel. The dashboard keeps running on your desktop; the tunnel
exposes it over a temporary public URL.

### Cloudflare Tunnel (recommended — free, persistent)

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:8765
```

Prints a URL like `https://something-random.trycloudflare.com` — works
anywhere, TLS-terminated by Cloudflare. Kill with Ctrl+C.

### ngrok (quick one-off)

```bash
brew install ngrok
ngrok http 8765
```

### Tailscale (for your own devices only)

```bash
brew install --cask tailscale
# Install on every device, then:
# http://<your-mac-name>:8765
```

Tailscale is the cleanest for personal use — no tunnel latency, no
randomly-changing URLs, devices reach each other over a private mesh.

---

## Testing

```bash
venv/bin/python -m pytest tests/ -v
```

27 tests across 5 modules — `project_state`, `pick_domain`, `dedupe`,
`evaluate`, `telemetry`. All stdlib-only assertions, no mocks beyond tmp git
repos and synthetic transcripts.

---

## License

MIT.
