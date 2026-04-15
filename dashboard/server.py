import http.server
import socketserver
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime

PORT = 8765
DASHBOARD_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECTS_DIR = os.path.expanduser("~/dev/daily-projects")
HISTORY_FILE = os.path.expanduser("~/daily-builder/project_history.md")
LOG_FILE = os.path.expanduser("~/daily-builder/session.log")


def _log(msg: str) -> None:
    print(f"[dashboard] {msg}", file=sys.stderr, flush=True)


def _git_commit_subjects(project_dir: str) -> list[str]:
    """Return commit subjects in chronological order, skipping pure scaffolding."""
    if not os.path.isdir(os.path.join(project_dir, ".git")):
        return []
    try:
        result = subprocess.run(
            ["git", "-C", project_dir, "log", "--reverse", "--pretty=format:%s"],
            capture_output=True,
            text=True,
            timeout=2,
        )
    except (subprocess.SubprocessError, FileNotFoundError) as exc:
        _log(f"git log failed for {project_dir}: {exc}")
        return []
    if result.returncode != 0:
        return []
    subjects = [s.strip() for s in result.stdout.splitlines() if s.strip()]
    return [s for s in subjects if not re.match(r"^(chore|docs):\s*scaffold", s, re.I)]

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
                'date': m.group(1),
                'repo_name': m.group(2).strip(),
                'domain': '', 'description': '',
                'tech_stack': '', 'status': 'UNKNOWN', 'github': ''
            }
        elif current and line.startswith('- '):
            line = line[2:]
            if line.startswith('Domain:'):
                current['domain'] = line.replace('Domain:', '').strip()
            elif line.startswith('Description:'):
                current['description'] = line.replace('Description:', '').strip()
            elif line.startswith('Tech stack:'):
                current['tech_stack'] = line.replace('Tech stack:', '').strip()
            elif line.startswith('Status:'):
                current['status'] = line.replace('Status:', '').strip()
            elif line.startswith('GitHub:'):
                current['github'] = line.replace('GitHub:', '').strip()
    if current:
        projects.append(current)
    return list(reversed(projects))


def parse_active_project():
    if not os.path.exists(PROJECTS_DIR):
        return None
    try:
        dirs = sorted(os.listdir(PROJECTS_DIR), reverse=True)
    except:
        return None
    for name in dirs:
        project_dir = os.path.join(PROJECTS_DIR, name)
        state_path = os.path.join(project_dir, 'state.md')
        if not os.path.exists(state_path):
            continue
        with open(state_path) as f:
            content = f.read()
        status_match = re.search(r'## Status\s*\n\s*([A-Z ]+)', content)
        status_value = status_match.group(1).strip() if status_match else ''
        if status_value == 'COMPLETE':
            continue
        mtime = os.path.getmtime(state_path)
        project = {
            'name': name,
            'status': 'IN PROGRESS',
            'session': '1',
            'in_progress': '',
            'next_steps': [],
            'completed': [],
            'last_modified': datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M')
        }
        m = re.search(r'## Session count\n(\d+)', content)
        if m:
            project['session'] = m.group(1)
        m = re.search(r'## In progress\n(.+?)(?=\n##)', content, re.DOTALL)
        if m:
            project['in_progress'] = m.group(1).strip()
        m = re.search(r'## Next steps\n(.+?)(?=\n##)', content, re.DOTALL)
        if m:
            steps = [s.lstrip('0123456789. ') for s in m.group(1).strip().split('\n') if s.strip()]
            project['next_steps'] = steps
        m = re.search(r'## Completed steps\n(.+?)(?=\n##)', content, re.DOTALL)
        if m:
            comp = m.group(1).strip()
            if comp and comp != 'None yet.':
                project['completed'] = [re.sub(r'^[-\s]+', '', s) for s in comp.split('\n') if s.strip()]

        # state.md is the agent's self-report — but Claude often forgets to update it.
        # Git commits are the ground truth for "work that actually shipped", so use
        # them as a fallback signal when the declared step count lags real history.
        commits = _git_commit_subjects(project_dir)
        if len(commits) > len(project['completed']):
            _log(f"{name}: state.md reports {len(project['completed'])} completed, "
                 f"git has {len(commits)} commits — using git as source of truth")
            project['completed'] = commits
            commit_mtime = os.path.getmtime(os.path.join(project_dir, '.git'))
            if commit_mtime > mtime:
                project['last_modified'] = datetime.fromtimestamp(commit_mtime).strftime('%Y-%m-%d %H:%M')
        return project
    return None

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
            'time': time_str[11:],
            'date': time_str[:10],
            'message': msg,
            'type': entry_type
        })
    return entries

def count_sessions():
    if not os.path.exists(LOG_FILE):
        return 0
    with open(LOG_FILE) as f:
        content = f.read()
    return len(re.findall(r'Session started', content))

def get_data():
    return {
        'active': parse_active_project(),
        'history': parse_history(),
        'session_log': parse_session_log(),
        'session_count': count_sessions(),
        'last_updated': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    }


def _watched_paths():
    paths = [HISTORY_FILE, LOG_FILE]
    if os.path.isdir(PROJECTS_DIR):
        for name in os.listdir(PROJECTS_DIR):
            project_dir = os.path.join(PROJECTS_DIR, name)
            if not os.path.isdir(project_dir):
                continue
            paths.append(os.path.join(project_dir, 'state.md'))
            paths.append(os.path.join(project_dir, '.git'))
            paths.append(os.path.join(project_dir, '.git', 'HEAD'))
            paths.append(os.path.join(project_dir, '.git', 'refs', 'heads'))
    return paths


def fingerprint() -> str:
    """Cheap signature of every file the dashboard renders. Changes ⇒ push."""
    parts = []
    for p in _watched_paths():
        try:
            st = os.stat(p)
            parts.append(f"{p}:{st.st_mtime_ns}:{st.st_size}")
        except (FileNotFoundError, NotADirectoryError, PermissionError):
            parts.append(f"{p}:-")
    return "|".join(parts)

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/data':
            data = get_data()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(data).encode())
        elif self.path == '/api/stream':
            self._serve_stream()
        elif self.path in ('/', '/index.html'):
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            with open(os.path.join(DASHBOARD_DIR, 'index.html'), 'rb') as f:
                self.wfile.write(f.read())
        else:
            self.send_response(404)
            self.end_headers()

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
                    payload = json.dumps(get_data()).encode()
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


print(f"Dashboard running at http://localhost:{PORT}")
with ThreadedServer(("", PORT), Handler) as httpd:
    httpd.serve_forever()