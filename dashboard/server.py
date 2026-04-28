import http.server
import shlex
import shutil
import socketserver
import json
import os
import re
import subprocess
import sys
import time
from collections import defaultdict, Counter
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse, parse_qs

# Make the daily-builder lib importable
_DB_ROOT = os.path.expanduser("~/daily-builder")
if _DB_ROOT not in sys.path:
    sys.path.insert(0, _DB_ROOT)

try:
    from lib.paths import Config
    from lib.project_state import get_state, get_progress, list_projects
    from lib import telemetry as _telemetry
    from lib import evaluate as _evaluate
    _LIB_OK = True
except ImportError as _lib_err:
    _LIB_OK = False
    print(f"[dashboard] lib import failed: {_lib_err}", file=sys.stderr)

PORT = 8765
DASHBOARD_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECTS_DIR = os.path.expanduser("~/dev/daily-projects")
ARCHIVE_DIR = os.path.join(PROJECTS_DIR, "_archive")
HISTORY_FILE = os.path.expanduser("~/daily-builder/project_history.md")
WISHLIST_FILE = os.path.expanduser("~/daily-builder/wishlist.md")
LOG_FILE = os.path.expanduser("~/daily-builder/session.log")
START_SCRIPT = os.path.expanduser("~/daily-builder/start.sh")

SKIP_DIRS = {
    '.git', '.venv', 'venv', 'env', 'node_modules', '__pycache__',
    'dist', 'build', '.next', '.cache', 'target', '.idea', '.vscode',
    'coverage', '.pytest_cache', '.mypy_cache', '.ruff_cache', 'site-packages',
}

LANG_BY_EXT = {
    '.py': 'Python', '.pyi': 'Python',
    '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
    '.ts': 'TypeScript', '.tsx': 'TypeScript', '.jsx': 'JavaScript',
    '.go': 'Go',
    '.rs': 'Rust',
    '.html': 'HTML', '.htm': 'HTML',
    '.css': 'CSS', '.scss': 'SCSS', '.sass': 'SCSS',
    '.md': 'Markdown', '.mdx': 'Markdown',
    '.json': 'JSON',
    '.yaml': 'YAML', '.yml': 'YAML',
    '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell',
    '.toml': 'TOML',
    '.sql': 'SQL',
    '.vue': 'Vue',
    '.svelte': 'Svelte',
    '.java': 'Java',
    '.kt': 'Kotlin', '.kts': 'Kotlin',
    '.swift': 'Swift',
    '.c': 'C', '.h': 'C',
    '.cpp': 'C++', '.cc': 'C++', '.hpp': 'C++',
    '.rb': 'Ruby',
    '.php': 'PHP',
}

LANG_COLORS = {
    'Python': '#3776ab', 'JavaScript': '#f7df1e', 'TypeScript': '#3178c6',
    'Go': '#00add8', 'Rust': '#dea584', 'HTML': '#e34c26', 'CSS': '#563d7c',
    'SCSS': '#c6538c', 'Markdown': '#5478b3', 'JSON': '#cbcb41',
    'YAML': '#cb171e', 'Shell': '#89e051', 'TOML': '#9c4221', 'SQL': '#e38c00',
    'Vue': '#41b883', 'Svelte': '#ff3e00', 'Java': '#b07219',
    'Kotlin': '#a97bff', 'Swift': '#fa7343', 'C': '#555555',
    'C++': '#f34b7d', 'Ruby': '#cc342d', 'PHP': '#4f5d95', 'Other': '#888',
}


def _log(msg: str) -> None:
    print(f"[dashboard] {msg}", file=sys.stderr, flush=True)


def _run_git(project_dir, *args, timeout=5):
    if not os.path.isdir(os.path.join(project_dir, '.git')):
        return None
    try:
        r = subprocess.run(
            ['git', '-C', project_dir, *args],
            capture_output=True, text=True, timeout=timeout,
        )
        return r.stdout if r.returncode == 0 else None
    except (subprocess.SubprocessError, FileNotFoundError) as e:
        _log(f"git {' '.join(args)} failed in {project_dir}: {e}")
        return None


_GENERATED_RE = re.compile(
    r'(^|/)('
    r'package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|'
    r'poetry\.lock|uv\.lock|Pipfile\.lock|Cargo\.lock|Gemfile\.lock|'
    r'composer\.lock|go\.sum|'
    r'node_modules|vendor|dist|build|\.next|\.cache|coverage|'
    r'__pycache__|\.venv|venv|target|\.terraform'
    r')(/|$)',
    re.IGNORECASE,
)


def _is_generated(path):
    return bool(_GENERATED_RE.search(path))


def _git_log_full(project_dir, limit=200):
    out = _run_git(
        project_dir, 'log', f'-{limit}',
        '--pretty=format:__C__%H|%h|%an|%at|%s', '--numstat',
    )
    if out is None:
        return []
    commits = []
    cur = None
    for line in out.splitlines():
        if line.startswith('__C__'):
            if cur:
                commits.append(cur)
            parts = line[5:].split('|', 4)
            if len(parts) < 5:
                cur = None
                continue
            cur = {
                'sha': parts[0], 'short': parts[1], 'author': parts[2],
                'timestamp': int(parts[3]), 'subject': parts[4],
                'additions': 0, 'deletions': 0,
                'files_changed': 0, 'files': [],
            }
        elif cur and line.strip():
            parts = line.split('\t')
            if len(parts) == 3:
                add, dele, fname = parts
                if _is_generated(fname):
                    continue
                try:
                    add_n = int(add) if add != '-' else 0
                    del_n = int(dele) if dele != '-' else 0
                except ValueError:
                    add_n = del_n = 0
                cur['additions'] += add_n
                cur['deletions'] += del_n
                cur['files_changed'] += 1
                if len(cur['files']) < 20:
                    cur['files'].append({'path': fname, 'add': add_n, 'del': del_n})
    if cur:
        commits.append(cur)
    return commits


def _git_status(project_dir):
    out = _run_git(project_dir, 'status', '--porcelain')
    if out is None:
        return {'clean': True, 'modified': [], 'added': [], 'untracked': []}
    modified, added, untracked = [], [], []
    for line in out.splitlines():
        if not line:
            continue
        code = line[:2]
        path = line[3:]
        if code.strip() == '??':
            untracked.append(path)
        elif 'M' in code:
            modified.append(path)
        elif 'A' in code:
            added.append(path)
    return {
        'clean': not (modified or added or untracked),
        'modified': modified, 'added': added, 'untracked': untracked,
    }


def _git_remote_url(project_dir):
    out = _run_git(project_dir, 'remote', 'get-url', 'origin')
    if not out:
        return None
    url = out.strip()
    if url.startswith('git@github.com:'):
        url = 'https://github.com/' + url[len('git@github.com:'):]
    if url.endswith('.git'):
        url = url[:-4]
    return url


def _git_branch(project_dir):
    out = _run_git(project_dir, 'rev-parse', '--abbrev-ref', 'HEAD')
    return out.strip() if out else None


def _walk_files(project_dir, max_files=2000):
    files = []
    for root, dirs, fnames in os.walk(project_dir):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith('.')]
        for fname in fnames:
            if fname.startswith('.') or fname.endswith('.pyc'):
                continue
            full = os.path.join(root, fname)
            rel = os.path.relpath(full, project_dir)
            try:
                st = os.stat(full)
            except OSError:
                continue
            ext = os.path.splitext(fname)[1].lower()
            files.append({
                'path': rel, 'name': fname, 'size': st.st_size,
                'mtime': st.st_mtime, 'ext': ext,
                'lang': LANG_BY_EXT.get(ext, 'Other'),
            })
            if len(files) >= max_files:
                return files
    return files


def _count_lines(filepath):
    try:
        with open(filepath, 'rb') as f:
            return sum(1 for _ in f)
    except OSError:
        return 0


def _language_stats(files, project_dir):
    by_lang = defaultdict(lambda: {'files': 0, 'lines': 0, 'bytes': 0})
    for f in files:
        if f['lang'] == 'Other' or _is_generated(f['path']):
            continue
        by_lang[f['lang']]['files'] += 1
        by_lang[f['lang']]['bytes'] += f['size']
        if f['size'] < 500_000:
            by_lang[f['lang']]['lines'] += _count_lines(os.path.join(project_dir, f['path']))
    return [
        {'lang': lang, 'color': LANG_COLORS.get(lang, '#888'), **stats}
        for lang, stats in sorted(by_lang.items(), key=lambda kv: -kv[1]['lines'])
    ]


def _readme_content(project_dir, max_chars=12000):
    for name in ('README.md', 'readme.md', 'Readme.md'):
        path = os.path.join(project_dir, name)
        if os.path.exists(path):
            try:
                with open(path) as f:
                    return f.read(max_chars)
            except OSError:
                continue
    return None


def _build_file_tree(files):
    tree = {'name': '/', 'type': 'dir', 'children': {}}
    for f in files:
        parts = f['path'].split(os.sep)
        node = tree
        for i, part in enumerate(parts):
            is_last = i == len(parts) - 1
            children = node.setdefault('children', {})
            if part not in children:
                children[part] = {
                    'name': part,
                    'type': 'file' if is_last else 'dir',
                    'children': {} if not is_last else None,
                    'size': f['size'] if is_last else 0,
                    'lang': f['lang'] if is_last else None,
                }
            node = children[part]

    def to_list(n):
        out = {'name': n['name'], 'type': n['type']}
        if n['type'] == 'file':
            out['size'] = n.get('size', 0)
            out['lang'] = n.get('lang')
        else:
            kids = n.get('children') or {}
            out['children'] = sorted(
                [to_list(c) for c in kids.values()],
                key=lambda x: (x['type'] == 'file', x['name']),
            )
        return out
    return to_list(tree)


def parse_history():
    projects = []
    if not os.path.exists(HISTORY_FILE):
        return projects
    with open(HISTORY_FILE) as f:
        lines = f.readlines()
    current = None
    for line in lines:
        line = line.strip()
        m = re.match(r'(\d{4}-\d{2}-\d{2}) — (.+)', line)
        if m:
            if current:
                projects.append(current)
            current = {
                'date': m.group(1), 'repo_name': m.group(2).strip(),
                'domain': '', 'description': '', 'tech_stack': '',
                'status': 'UNKNOWN', 'github': '',
            }
        elif current and line.startswith('- '):
            line = line[2:]
            for key in ('Domain', 'Description', 'Tech stack', 'Status', 'GitHub'):
                if line.startswith(key + ':'):
                    field = key.lower().replace(' ', '_')
                    current[field] = line.replace(key + ':', '').strip()
                    break
    if current:
        projects.append(current)
    return list(reversed(projects))


def parse_state_file(project_dir):
    state_path = os.path.join(project_dir, 'state.md')
    if not os.path.exists(state_path):
        return None
    with open(state_path) as f:
        content = f.read()
    status_match = re.search(r'## Status\s*\n\s*([A-Z ]+)', content)
    status = status_match.group(1).strip() if status_match else 'UNKNOWN'
    state = {
        'status': status, 'session': '1', 'in_progress': '',
        'completed': [], 'next_steps': [],
    }
    m = re.search(r'## Session count\n(\d+)', content)
    if m:
        state['session'] = m.group(1)
    m = re.search(r'## In progress\n(.+?)(?=\n##)', content, re.DOTALL)
    if m:
        state['in_progress'] = m.group(1).strip()
    m = re.search(r'## Next steps\n(.+?)(?=\n##)', content, re.DOTALL)
    if m:
        state['next_steps'] = [
            re.sub(r'^\d+\.\s*', '', s).strip()
            for s in m.group(1).strip().split('\n') if s.strip()
        ]
    m = re.search(r'## Completed steps\n(.+?)(?=\n##)', content, re.DOTALL)
    if m:
        comp = m.group(1).strip()
        if comp and comp != 'None yet.':
            state['completed'] = [
                re.sub(r'^[-\s]+', '', s).strip()
                for s in comp.split('\n') if s.strip()
            ]
    return state


def project_summary(name):
    project_dir = os.path.join(PROJECTS_DIR, name)
    if not os.path.isdir(project_dir):
        return None
    state = parse_state_file(project_dir)
    log = _git_log_full(project_dir, limit=200)
    status = state['status'] if state else 'UNKNOWN'
    completed = state['completed'] if state else []
    next_steps = state['next_steps'] if state else []
    git_subjects = [c['subject'] for c in reversed(log)
                    if not re.match(r'^(chore|docs):\s*scaffold', c['subject'], re.I)]
    if len(git_subjects) > len(completed):
        completed = git_subjects
    state_path = os.path.join(project_dir, 'state.md')
    state_mtime = os.path.getmtime(state_path) if os.path.exists(state_path) else 0
    git_dir = os.path.join(project_dir, '.git')
    git_mtime = os.path.getmtime(git_dir) if os.path.isdir(git_dir) else 0

    # Authoritative status and progress (git-derived, per lib/project_state.py).
    auth_status = status
    auth_reason = ''
    progress_display = f"{len(log)} commits"
    progress_completed = len(log)
    progress_total = None
    evaluation = _read_evaluation(project_dir)

    if _LIB_OK:
        try:
            ps = get_state(Path(project_dir))
            auth_status = ps.status
            auth_reason = ps.reason
            completed_n, total_n, disp = get_progress(Path(project_dir))
            progress_completed = completed_n
            progress_total = total_n
            progress_display = disp
        except Exception as exc:  # noqa: BLE001 — dashboard must not crash
            _log(f"project_state failed for {name}: {exc}")

    return {
        'name': name, 'status': status,
        'authoritative_status': auth_status,
        'authoritative_reason': auth_reason,
        'stalled': auth_status in ('stalled', 'dead'),
        'progress_completed': progress_completed,
        'progress_total': progress_total,
        'progress_display': progress_display,
        'evaluation': evaluation,
        'session': state['session'] if state else '1',
        'in_progress': state['in_progress'] if state else '',
        'completed': completed, 'next_steps': next_steps,
        'commit_count': len(log),
        'additions': sum(c['additions'] for c in log),
        'deletions': sum(c['deletions'] for c in log),
        'first_commit': log[-1]['timestamp'] if log else None,
        'last_commit': log[0]['timestamp'] if log else None,
        'last_modified': max(state_mtime, git_mtime),
        'github': _git_remote_url(project_dir),
        'branch': _git_branch(project_dir),
    }


def _read_evaluation(project_dir):
    """Read evaluation.json if present; return None otherwise."""
    eval_path = os.path.join(project_dir, 'evaluation.json')
    if not os.path.isfile(eval_path):
        return None
    try:
        with open(eval_path) as f:
            data = json.load(f)
        return {
            'score': data.get('score'),
            'heuristic_score': (data.get('heuristic') or {}).get('score'),
            'llm_score': (data.get('llm') or {}).get('score') if data.get('llm') else None,
            'needs_finishing_pass': data.get('needs_finishing_pass', False),
            'generated_at': data.get('generated_at'),
        }
    except (OSError, json.JSONDecodeError):
        return None


def all_projects():
    if not os.path.isdir(PROJECTS_DIR):
        return []
    out = []
    for name in sorted(os.listdir(PROJECTS_DIR)):
        full = os.path.join(PROJECTS_DIR, name)
        if not os.path.isdir(full):
            continue
        s = project_summary(name)
        if s:
            out.append(s)
    return out


ACTIVE_WINDOW_SECONDS = 30 * 60  # treat recent git activity within 30 min as "live"


def _latest_git_activity(project_dir):
    """Return the most recent mtime across HEAD, refs, and .git itself."""
    latest = 0
    for sub in ('.git', '.git/HEAD', '.git/index', '.git/COMMIT_EDITMSG'):
        try:
            latest = max(latest, os.path.getmtime(os.path.join(project_dir, sub)))
        except OSError:
            pass
    refs_dir = os.path.join(project_dir, '.git', 'refs', 'heads')
    if os.path.isdir(refs_dir):
        try:
            for fname in os.listdir(refs_dir):
                p = os.path.join(refs_dir, fname)
                try:
                    latest = max(latest, os.path.getmtime(p))
                except OSError:
                    pass
        except OSError:
            pass
    # Also check working-tree state.md mtime
    state_md = os.path.join(project_dir, 'state.md')
    try:
        latest = max(latest, os.path.getmtime(state_md))
    except OSError:
        pass
    return latest


def detect_active(projects):
    """Pick the truly-live project. Two-stage selection:

    1. A project whose state.md says IN PROGRESS *and* whose authoritative
       status is NOT 'shipped' is the live build. Claude often marks state.md
       COMPLETE prematurely, so we cross-check via authoritative_status.
    2. Otherwise — and ONLY if no project is genuinely shipped-but-recent —
       fall back to the most recent git activity within the active window.
       Critically: never promote a project that is authoritatively 'shipped'
       (eval done, release commit landed) to ACTIVE just because git mtime
       is fresh. That happens whenever you push polish or rewrite history,
       and it lies to the dashboard.

    Returns either a live project dict (with status='ACTIVE') or, when
    everything is shipped/idle, the most-recently-shipped project tagged
    status='SHIPPED' so the hero can render a "last shipped" view instead
    of pretending a build is in progress.
    """
    declared = next((p for p in projects
                     if p['status'] != 'COMPLETE'
                     and p.get('authoritative_status') != 'shipped'), None)
    if declared:
        return declared

    now = time.time()
    candidates = []
    for p in projects:
        if p.get('authoritative_status') == 'shipped':
            continue  # skip — eval is done, this is not an active build
        proj_dir = os.path.join(PROJECTS_DIR, p['name'])
        latest = _latest_git_activity(proj_dir)
        if latest and now - latest < ACTIVE_WINDOW_SECONDS:
            candidates.append((latest, p))

    if candidates:
        candidates.sort(key=lambda x: -x[0])
        latest_ts, p = candidates[0]
        p = dict(p)
        p['status'] = 'ACTIVE'
        p['live_signal'] = 'recent_git'
        p['last_activity'] = latest_ts
        if not p.get('in_progress'):
            log = _git_log_full(os.path.join(PROJECTS_DIR, p['name']), limit=1)
            if log:
                p['in_progress'] = f"latest: {log[0]['subject']}"
        return p

    # No live build. Surface the most recent ship so the hero can render
    # a "last shipped" mode instead of "no project running" emptiness.
    shipped = []
    for p in projects:
        if p.get('authoritative_status') != 'shipped':
            continue
        proj_dir = os.path.join(PROJECTS_DIR, p['name'])
        latest = _latest_git_activity(proj_dir)
        if latest:
            shipped.append((latest, p))
    if shipped:
        shipped.sort(key=lambda x: -x[0])
        latest_ts, p = shipped[0]
        p = dict(p)
        p['status'] = 'SHIPPED'  # explicit signal for the hero renderer
        p['live_signal'] = 'last_shipped'
        p['last_activity'] = latest_ts
        return p
    return None


def streak_calendar(projects, days=365):
    today = datetime.now().date()
    start = today - timedelta(days=days - 1)
    by_day = defaultdict(int)
    for p in projects:
        log = _git_log_full(os.path.join(PROJECTS_DIR, p['name']), limit=500)
        for c in log:
            d = datetime.fromtimestamp(c['timestamp']).date()
            if d >= start:
                by_day[d.isoformat()] += 1
    cal = []
    for i in range(days):
        d = start + timedelta(days=i)
        cal.append({
            'date': d.isoformat(),
            'count': by_day.get(d.isoformat(), 0),
            'weekday': d.weekday(),
        })
    return cal


def calc_streak(cal):
    today = datetime.now().date()
    by_day = {c['date']: c['count'] for c in cal}
    streak = 0
    d = today
    while by_day.get(d.isoformat(), 0) > 0:
        streak += 1
        d -= timedelta(days=1)
    return streak


def cross_stats(projects):
    total_commits = sum(p['commit_count'] for p in projects)
    total_adds = sum(p['additions'] for p in projects)
    total_dels = sum(p['deletions'] for p in projects)
    completed = sum(1 for p in projects if p['status'] == 'COMPLETE')
    lang_files = Counter()
    lang_lines = Counter()
    total_files = 0
    total_lines = 0
    for p in projects:
        proj_dir = os.path.join(PROJECTS_DIR, p['name'])
        files = _walk_files(proj_dir, max_files=800)
        for f in files:
            if f['lang'] == 'Other' or _is_generated(f['path']):
                continue
            lang_files[f['lang']] += 1
            total_files += 1
            if f['size'] < 500_000:
                n = _count_lines(os.path.join(proj_dir, f['path']))
                total_lines += n
                lang_lines[f['lang']] += n
    return {
        'total_projects': len(projects),
        'completed_projects': completed,
        'total_commits': total_commits,
        'total_additions': total_adds,
        'total_deletions': total_dels,
        'total_files': total_files,
        'total_lines': total_lines,
        'languages': [
            {
                'lang': l, 'count': n,
                'lines': lang_lines.get(l, 0),
                'color': LANG_COLORS.get(l, '#888'),
            }
            for l, n in lang_files.most_common(15)
        ],
    }


def commit_velocity(projects, days=30):
    today = datetime.now().date()
    start = today - timedelta(days=days - 1)
    by_day = defaultdict(int)
    for p in projects:
        log = _git_log_full(os.path.join(PROJECTS_DIR, p['name']), limit=500)
        for c in log:
            d = datetime.fromtimestamp(c['timestamp']).date()
            if d >= start:
                by_day[d.isoformat()] += 1
    return [
        {'date': (start + timedelta(days=i)).isoformat(),
         'count': by_day.get((start + timedelta(days=i)).isoformat(), 0)}
        for i in range(days)
    ]


def hour_heatmap(projects):
    grid = [[0] * 24 for _ in range(7)]
    for p in projects:
        log = _git_log_full(os.path.join(PROJECTS_DIR, p['name']), limit=500)
        for c in log:
            dt = datetime.fromtimestamp(c['timestamp'])
            grid[dt.weekday()][dt.hour] += 1
    return grid


def parse_session_log():
    entries = []
    if not os.path.exists(LOG_FILE):
        return entries
    with open(LOG_FILE) as f:
        lines = f.readlines()
    for line in lines:
        line = line.strip()
        if not line:
            continue
        m = re.match(r'\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\] (.+)', line)
        if not m:
            continue
        time_str = m.group(1)
        msg = m.group(2)
        entry_type = 'start'
        if 'ERROR' in msg:
            entry_type = 'error'
        elif 'New project' in msg:
            entry_type = 'new'
        elif 'Resuming' in msg:
            entry_type = 'resume'
        elif 'ended' in msg:
            entry_type = 'end'
        entries.append({
            'time': time_str[11:], 'date': time_str[:10],
            'message': msg, 'type': entry_type,
        })
    return entries


def recent_commits_global(projects, limit=30):
    rows = []
    for p in projects:
        log = _git_log_full(os.path.join(PROJECTS_DIR, p['name']), limit=50)
        for c in log:
            rows.append({**c, 'project': p['name']})
    rows.sort(key=lambda x: -x['timestamp'])
    return rows[:limit]


def get_overview():
    projects = all_projects()
    history = parse_history()
    history_by_name = {h['repo_name']: h for h in history}
    for p in projects:
        h = history_by_name.get(p['name'])
        if h:
            p['domain'] = h.get('domain', '')
            p['description'] = h.get('description', '')
            p['tech_stack'] = h.get('tech_stack', '')
            if h.get('github'):
                p['github'] = h['github']
            if h.get('status') == 'COMPLETE':
                p['status'] = 'COMPLETE'
    active = detect_active(projects)
    if active and active.get('live_signal'):
        for p in projects:
            if p['name'] == active['name']:
                p['live_signal'] = active['live_signal']
                p['last_activity'] = active.get('last_activity')
                break
    cal = streak_calendar(projects, days=365)
    velocity = commit_velocity(projects, days=30)
    today_count = velocity[-1]['count'] if velocity else 0
    week_count = sum(v['count'] for v in velocity[-7:]) if velocity else 0
    return {
        'projects': projects,
        'active': active,
        'history': history,
        'session_log': parse_session_log(),
        'streak_calendar': cal,
        'streak': calc_streak(cal),
        'cross_stats': cross_stats(projects),
        'velocity': velocity,
        'heatmap': hour_heatmap(projects),
        'recent_commits': recent_commits_global(projects, limit=40),
        'today_commits': today_count,
        'week_commits': week_count,
        'last_updated': datetime.now().isoformat(),
    }


def get_project_detail(name):
    project_dir = os.path.join(PROJECTS_DIR, name)
    if not os.path.isdir(project_dir):
        return None
    summary = project_summary(name)
    if summary is None:
        return None
    files = _walk_files(project_dir)
    langs = _language_stats(files, project_dir)
    log = _git_log_full(project_dir, limit=200)
    status = _git_status(project_dir)
    readme = _readme_content(project_dir)
    tree = _build_file_tree(files)
    total_lines = sum(l['lines'] for l in langs)
    commits_by_day = defaultdict(int)
    for c in log:
        d = datetime.fromtimestamp(c['timestamp']).date().isoformat()
        commits_by_day[d] += 1
    return {
        **summary,
        'files': len(files),
        'file_tree': tree,
        'languages': langs,
        'commits': log,
        'git_status': status,
        'readme': readme,
        'total_lines': total_lines,
        'total_files': len(files),
        'commits_by_day': dict(commits_by_day),
    }


def _watched_paths():
    paths = [HISTORY_FILE, LOG_FILE, WISHLIST_FILE]
    if os.path.isdir(PROJECTS_DIR):
        for name in os.listdir(PROJECTS_DIR):
            d = os.path.join(PROJECTS_DIR, name)
            if not os.path.isdir(d):
                continue
            paths.append(os.path.join(d, 'state.md'))
            paths.append(os.path.join(d, 'evaluation.json'))
            paths.append(os.path.join(d, '.git'))
            paths.append(os.path.join(d, '.git', 'HEAD'))
            paths.append(os.path.join(d, '.git', 'index'))
            paths.append(os.path.join(d, '.git', 'COMMIT_EDITMSG'))
            refs_dir = os.path.join(d, '.git', 'refs', 'heads')
            paths.append(refs_dir)
            if os.path.isdir(refs_dir):
                try:
                    for fname in os.listdir(refs_dir):
                        paths.append(os.path.join(refs_dir, fname))
                except OSError:
                    pass
    return paths


def fingerprint() -> str:
    parts = []
    for p in _watched_paths():
        try:
            st = os.stat(p)
            parts.append(f"{p}:{st.st_mtime_ns}:{st.st_size}")
        except (FileNotFoundError, NotADirectoryError, PermissionError):
            parts.append(f"{p}:-")
    return "|".join(parts)


# ── Wishlist helpers ─────────────────────────────────────────────

_WISHLIST_UNUSED_RE = re.compile(
    r"(##\s*Unused\s*\n)(.*?)(?=\n##|\Z)", re.DOTALL | re.IGNORECASE
)
_WISHLIST_USED_RE = re.compile(
    r"(##\s*Used\s*\n)(.*?)(?=\n##|\Z)", re.DOTALL | re.IGNORECASE
)


CURATED_FILE = os.path.expanduser("~/daily-builder/curated.md")


def _read_curated():
    if not os.path.isfile(CURATED_FILE):
        return []
    try:
        text = Path(CURATED_FILE).read_text(encoding='utf-8')
    except OSError:
        return []
    items = re.findall(r'^- \[ \]\s+(.+)$', text, re.MULTILINE)
    return [i.strip() for i in items if i.strip() and 'add your own' not in i.lower()]


def _read_wishlist():
    if not os.path.isfile(WISHLIST_FILE):
        return {'unused': [], 'used': [], 'curated': _read_curated()}
    try:
        content = Path(WISHLIST_FILE).read_text(encoding='utf-8')
    except OSError:
        return {'unused': [], 'used': [], 'curated': _read_curated()}

    unused_match = _WISHLIST_UNUSED_RE.search(content)
    used_match = _WISHLIST_USED_RE.search(content)

    def _extract(block, pattern):
        if not block:
            return []
        items = re.findall(pattern, block, re.MULTILINE)
        return [i.strip() for i in items if i.strip() and 'add your own' not in i.lower()]

    unused = _extract(
        unused_match.group(2) if unused_match else '',
        r'^- \[ \]\s+(.+)$',
    )
    used = _extract(
        used_match.group(2) if used_match else '',
        r'^- \[x\]\s+(.+)$',
    )
    return {'unused': unused, 'used': used, 'curated': _read_curated()}


def _wishlist_add(item: str) -> None:
    item = item.strip()
    if not item:
        return
    if not os.path.isfile(WISHLIST_FILE):
        Path(WISHLIST_FILE).write_text(
            "# Project Wishlist\n\n## Unused\n\n- [ ] " + item + "\n\n## Used\n\n",
            encoding='utf-8',
        )
        return
    content = Path(WISHLIST_FILE).read_text(encoding='utf-8')
    match = _WISHLIST_UNUSED_RE.search(content)
    if not match:
        content = content.rstrip() + "\n\n## Unused\n\n- [ ] " + item + "\n"
    else:
        block = match.group(2).rstrip('\n')
        new_block = block + ("\n" if block else "") + "- [ ] " + item + "\n"
        content = content[: match.start(2)] + new_block + content[match.end(2):]
    Path(WISHLIST_FILE).write_text(content, encoding='utf-8')


def _wishlist_remove(item: str) -> bool:
    if not os.path.isfile(WISHLIST_FILE):
        return False
    content = Path(WISHLIST_FILE).read_text(encoding='utf-8')
    match = _WISHLIST_UNUSED_RE.search(content)
    if not match:
        return False
    block = match.group(2)
    pattern = re.compile(r'^- \[ \]\s+' + re.escape(item) + r'\s*$', re.MULTILINE)
    new_block, n = pattern.subn('', block)
    if n == 0:
        return False
    new_block = re.sub(r'\n{3,}', '\n\n', new_block)
    content = content[: match.start(2)] + new_block + content[match.end(2):]
    Path(WISHLIST_FILE).write_text(content, encoding='utf-8')
    return True


# ── Quota telemetry ───────────────────────────────────────────────

def _build_quota():
    if not _LIB_OK:
        return {'error': 'lib not available'}
    try:
        report = _telemetry.collect()
        return report.to_dict()
    except Exception as exc:  # noqa: BLE001
        _log(f"quota collection failed: {exc}")
        return {'error': str(exc)}


# ── Evaluations aggregate ────────────────────────────────────────

def _list_evaluations():
    out = []
    if not os.path.isdir(PROJECTS_DIR):
        return out
    for name in sorted(os.listdir(PROJECTS_DIR)):
        project_dir = os.path.join(PROJECTS_DIR, name)
        if not os.path.isdir(project_dir) or name.startswith('_'):
            continue
        ev = _read_evaluation(project_dir)
        if ev:
            out.append({'name': name, **ev})
    return out


# ── Day detail ──────────────────────────────────────────────────

def _build_day_detail(date_str: str) -> dict:
    """Return all commits across all projects for a given YYYY-MM-DD."""
    try:
        target = datetime.strptime(date_str, '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return {'error': 'invalid date', 'date': date_str}

    day_start = datetime.combine(target, datetime.min.time()).timestamp()
    day_end = day_start + 86400

    projects_data = []
    totals = {'commits': 0, 'additions': 0, 'deletions': 0, 'files': 0}
    all_commits = []

    if os.path.isdir(PROJECTS_DIR):
        for name in sorted(os.listdir(PROJECTS_DIR)):
            proj_dir = os.path.join(PROJECTS_DIR, name)
            if not os.path.isdir(proj_dir) or name.startswith('_'):
                continue
            log = _git_log_full(proj_dir, limit=500)
            day_commits = [
                c for c in log
                if day_start <= c['timestamp'] < day_end
            ]
            if not day_commits:
                continue
            for c in day_commits:
                c_copy = {**c, 'project': name}
                all_commits.append(c_copy)
            proj_add = sum(c['additions'] for c in day_commits)
            proj_del = sum(c['deletions'] for c in day_commits)
            proj_files = sum(c['files_changed'] for c in day_commits)
            totals['commits'] += len(day_commits)
            totals['additions'] += proj_add
            totals['deletions'] += proj_del
            totals['files'] += proj_files
            projects_data.append({
                'name': name,
                'commit_count': len(day_commits),
                'additions': proj_add,
                'deletions': proj_del,
                'files': proj_files,
                'commits': day_commits,
            })

    all_commits.sort(key=lambda c: c['timestamp'])
    hourly = [0] * 24
    for c in all_commits:
        dt = datetime.fromtimestamp(c['timestamp'])
        hourly[dt.hour] += 1

    return {
        'date': date_str,
        'totals': totals,
        'projects': projects_data,
        'timeline': all_commits,
        'hourly': hourly,
    }


# ── Action handlers ──────────────────────────────────────────────

def _action_resume(name: str):
    """Spawn a visible Terminal.app window that runs start.sh --resume <name>."""
    cmd = f"bash {shlex.quote(START_SCRIPT)} --resume {shlex.quote(name)}"
    applescript = (
        f'tell application "Terminal"\n'
        f'  activate\n'
        f'  do script "{cmd}"\n'
        f'end tell'
    )
    try:
        subprocess.Popen(
            ['osascript', '-e', applescript],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return {'ok': True, 'action': 'resume', 'name': name}
    except (FileNotFoundError, subprocess.SubprocessError) as exc:
        return {'ok': False, 'error': str(exc)}


def _action_polish(name: str):
    cmd = f"bash {shlex.quote(START_SCRIPT)} --polish {shlex.quote(name)}"
    applescript = (
        f'tell application "Terminal"\n'
        f'  activate\n'
        f'  do script "{cmd}"\n'
        f'end tell'
    )
    try:
        subprocess.Popen(
            ['osascript', '-e', applescript],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return {'ok': True, 'action': 'polish', 'name': name}
    except (FileNotFoundError, subprocess.SubprocessError) as exc:
        return {'ok': False, 'error': str(exc)}


def _action_archive(name: str, project_dir: str):
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    target = os.path.join(ARCHIVE_DIR, name)
    suffix = 1
    while os.path.exists(target):
        target = os.path.join(ARCHIVE_DIR, f"{name}-{suffix}")
        suffix += 1
    try:
        shutil.move(project_dir, target)
        return {'ok': True, 'action': 'archive', 'name': name, 'moved_to': target}
    except OSError as exc:
        return {'ok': False, 'error': str(exc)}


def _action_evaluate(name: str, project_dir: str):
    if not _LIB_OK:
        return {'ok': False, 'error': 'lib not available'}
    try:
        result = _evaluate.evaluate(Path(project_dir))
        _evaluate.record_in_history(name, result, Path(HISTORY_FILE))
        return {'ok': True, 'action': 'evaluate', 'name': name, 'evaluation': result.to_dict()}
    except Exception as exc:  # noqa: BLE001
        _log(f"evaluate failed for {name}: {exc}")
        return {'ok': False, 'error': str(exc)}


class Handler(http.server.SimpleHTTPRequestHandler):
    def _json(self, data, status=200):
        body = json.dumps(data, default=str).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_file(self, path, ctype):
        try:
            with open(path, 'rb') as f:
                body = f.read()
        except OSError:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        p = u.path
        q = parse_qs(u.query)
        if p == '/api/data':
            self._json(get_overview())
            return
        if p == '/api/project':
            name = q.get('name', [''])[0]
            d = get_project_detail(name)
            self._json(d) if d else self._json({'error': 'not found'}, status=404)
            return
        if p == '/api/file':
            self._serve_project_file(q.get('proj', [''])[0], q.get('path', [''])[0])
            return
        if p == '/api/commit':
            self._serve_commit_diff(q.get('proj', [''])[0], q.get('sha', [''])[0])
            return
        if p == '/api/stream':
            self._serve_stream()
            return
        if p == '/api/wishlist':
            self._json(_read_wishlist())
            return
        if p == '/api/quota':
            self._json(_build_quota())
            return
        if p == '/api/evaluations':
            self._json(_list_evaluations())
            return
        if p == '/api/day':
            date_str = q.get('date', [''])[0]
            self._json(_build_day_detail(date_str))
            return
        if p in ('/', '/index.html'):
            self._serve_file(os.path.join(DASHBOARD_DIR, 'index.html'), 'text/html')
            return
        if p == '/style.css':
            self._serve_file(os.path.join(DASHBOARD_DIR, 'style.css'), 'text/css')
            return
        if p == '/app.js':
            self._serve_file(os.path.join(DASHBOARD_DIR, 'app.js'), 'application/javascript')
            return
        self.send_response(404)
        self.end_headers()

    def _read_body(self):
        length = int(self.headers.get('Content-Length', '0') or 0)
        if length <= 0 or length > 1_000_000:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {}

    def do_POST(self):
        u = urlparse(self.path)
        p = u.path
        body = self._read_body()

        if p == '/api/wishlist':
            item = (body.get('item') or '').strip()
            if not item:
                self._json({'error': 'item required'}, status=400)
                return
            _wishlist_add(item)
            self._json({'ok': True, 'item': item})
            return

        match = re.match(r'^/api/project/([^/]+)/(resume|archive|evaluate|polish)$', p)
        if match:
            name = match.group(1)
            action = match.group(2)
            project_dir = self._safe_project_dir(name)
            if not project_dir:
                self._json({'error': 'project not found'}, status=404)
                return

            if action == 'resume':
                self._json(_action_resume(name))
            elif action == 'archive':
                self._json(_action_archive(name, project_dir))
            elif action == 'evaluate':
                self._json(_action_evaluate(name, project_dir))
            elif action == 'polish':
                self._json(_action_polish(name))
            return

        self.send_response(404)
        self.end_headers()

    def do_DELETE(self):
        u = urlparse(self.path)
        p = u.path
        body = self._read_body()
        if p == '/api/wishlist':
            item = (body.get('item') or '').strip()
            if not item:
                self._json({'error': 'item required'}, status=400)
                return
            removed = _wishlist_remove(item)
            self._json({'ok': True, 'removed': removed})
            return
        self.send_response(404)
        self.end_headers()

    def _safe_project_dir(self, name):
        if not name:
            return None
        full = os.path.realpath(os.path.join(PROJECTS_DIR, name))
        root = os.path.realpath(PROJECTS_DIR)
        if not full.startswith(root + os.sep):
            return None
        return full if os.path.isdir(full) else None

    def _serve_project_file(self, name, file_path):
        project_dir = self._safe_project_dir(name)
        if not project_dir or not file_path:
            self._json({'error': 'invalid params'}, status=400)
            return
        full = os.path.realpath(os.path.join(project_dir, file_path))
        if not full.startswith(project_dir + os.sep):
            self._json({'error': 'path traversal blocked'}, status=403)
            return
        if not os.path.isfile(full):
            self._json({'error': 'not found'}, status=404)
            return
        try:
            st = os.stat(full)
            if st.st_size > 500_000:
                self._json({'error': 'file too large', 'size': st.st_size}, status=413)
                return
            with open(full, 'rb') as f:
                data = f.read()
            try:
                content = data.decode('utf-8')
            except UnicodeDecodeError:
                self._json({'error': 'binary file', 'size': st.st_size}, status=415)
                return
            self._json({
                'path': file_path, 'size': st.st_size, 'content': content,
                'lang': LANG_BY_EXT.get(os.path.splitext(file_path)[1].lower(), 'Other'),
            })
        except OSError as e:
            self._json({'error': str(e)}, status=500)

    def _serve_commit_diff(self, name, sha):
        project_dir = self._safe_project_dir(name)
        if not project_dir or not re.match(r'^[a-f0-9]{6,40}$', sha or ''):
            self._json({'error': 'invalid params'}, status=400)
            return
        diff = _run_git(project_dir, 'show', '--stat', '--patch', '--no-color', sha)
        if diff is None:
            self._json({'error': 'commit not found'}, status=404)
            return
        if len(diff) > 200_000:
            diff = diff[:200_000] + '\n... (truncated)'
        self._json({'sha': sha, 'diff': diff})

    def _serve_stream(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Connection', 'keep-alive')
        self.send_header('X-Accel-Buffering', 'no')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        last_fp = None
        last_heartbeat = 0.0
        try:
            while True:
                fp = fingerprint()
                if fp != last_fp:
                    payload = json.dumps(get_overview(), default=str).encode()
                    self.wfile.write(b"event: data\ndata: ")
                    self.wfile.write(payload)
                    self.wfile.write(b"\n\n")
                    self.wfile.flush()
                    last_fp = fp
                    last_heartbeat = time.monotonic()
                elif time.monotonic() - last_heartbeat > 15:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    last_heartbeat = time.monotonic()
                time.sleep(0.5)
        except (BrokenPipeError, ConnectionResetError):
            return

    def log_message(self, format, *args):
        pass


class ThreadedServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        """Swallow benign client-disconnect errors that happen on every SSE close.
        Anything else is still logged normally."""
        exc_type = sys.exc_info()[0]
        if exc_type in (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            return
        super().handle_error(request, client_address)


if __name__ == '__main__':
    print(f"Dashboard running at http://localhost:{PORT}")
    with ThreadedServer(("", PORT), Handler) as httpd:
        httpd.serve_forever()
