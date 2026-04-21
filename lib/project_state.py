"""Authoritative project-state derivation.

`state.md` lies. This module derives truth from git + filesystem, and treats
`state.md` as a hint only. Used by the dashboard, the builder, and the
evaluator so there is exactly one definition of "is this project done."
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from .paths import Config

Status = Literal["empty", "building", "stalled", "shipped", "dead"]


@dataclass(frozen=True)
class ProjectState:
    """Everything the rest of the system needs to know about a project dir."""

    name: str
    path: Path
    status: Status
    state_md_status: str | None
    last_commit_at: datetime | None
    last_commit_hash: str | None
    last_commit_subject: str | None
    commit_count: int
    feat_commit_count: int
    days_since_last_commit: int | None
    reason: str

    @property
    def is_stalled(self) -> bool:
        return self.status == "stalled"

    @property
    def is_shipped(self) -> bool:
        return self.status == "shipped"

    @property
    def is_building(self) -> bool:
        return self.status == "building"


def _run_git(project_dir: Path, *args: str, timeout: int = 5) -> str | None:
    if not (project_dir / ".git").is_dir():
        return None
    try:
        result = subprocess.run(
            ["git", "-C", str(project_dir), *args],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return result.stdout if result.returncode == 0 else None
    except (subprocess.SubprocessError, FileNotFoundError):
        return None


def _read_state_md(project_dir: Path) -> str | None:
    state_path = project_dir / "state.md"
    if not state_path.exists():
        return None
    try:
        content = state_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None

    match = re.search(
        r"^##\s*Status\s*\n+\s*([A-Z ]+)",
        content,
        flags=re.MULTILINE | re.IGNORECASE,
    )
    if match:
        return match.group(1).strip().upper()
    return None


def _parse_commit_log(log_output: str) -> list[dict]:
    commits: list[dict] = []
    for line in log_output.splitlines():
        parts = line.split("|", 3)
        if len(parts) < 4:
            continue
        sha, short, at, subject = parts
        try:
            ts = datetime.fromtimestamp(int(at), tz=timezone.utc)
        except (TypeError, ValueError):
            continue
        commits.append(
            {
                "sha": sha,
                "short": short,
                "at": ts,
                "subject": subject,
            }
        )
    return commits


def get_state(project_dir: Path, config: Config | None = None) -> ProjectState:
    """Derive the authoritative status of a single project."""

    cfg = config or Config.load()
    name = project_dir.name

    if not project_dir.is_dir():
        return ProjectState(
            name=name,
            path=project_dir,
            status="empty",
            state_md_status=None,
            last_commit_at=None,
            last_commit_hash=None,
            last_commit_subject=None,
            commit_count=0,
            feat_commit_count=0,
            days_since_last_commit=None,
            reason="directory does not exist",
        )

    state_md_status = _read_state_md(project_dir)

    log_output = _run_git(
        project_dir, "log", "--pretty=format:%H|%h|%at|%s", "-200"
    )
    commits = _parse_commit_log(log_output or "")

    if not commits:
        return ProjectState(
            name=name,
            path=project_dir,
            status="empty",
            state_md_status=state_md_status,
            last_commit_at=None,
            last_commit_hash=None,
            last_commit_subject=None,
            commit_count=0,
            feat_commit_count=0,
            days_since_last_commit=None,
            reason="no git history",
        )

    latest = commits[0]
    commit_count = len(commits)
    feat_commit_count = sum(
        1
        for c in commits
        if re.match(r"^(feat|fix|perf|refactor)(\([^)]+\))?:", c["subject"])
    )

    now = datetime.now(tz=timezone.utc)
    days_since = (now - latest["at"]).days

    status: Status
    reason: str

    state_says_complete = (state_md_status or "").startswith("COMPLETE")
    state_says_in_progress = (state_md_status or "").startswith("IN PROGRESS")

    if state_says_complete and commit_count >= 2:
        status = "shipped"
        reason = "state.md marks COMPLETE and git has real commits"
    elif days_since >= cfg.dead_days and not state_says_complete:
        status = "dead"
        reason = f"no git activity for {days_since} days (>= {cfg.dead_days})"
    elif state_says_in_progress and days_since >= cfg.stalled_days:
        status = "stalled"
        reason = (
            f"state.md says IN PROGRESS but no commits for {days_since} days "
            f"(>= {cfg.stalled_days})"
        )
    elif days_since >= cfg.stalled_days and not state_says_complete:
        status = "stalled"
        reason = (
            f"no git activity for {days_since} days and not marked complete"
        )
    elif commit_count >= 10 and days_since <= 1 and not state_says_complete:
        status = "building"
        reason = "active commit cadence"
    elif commit_count < 3:
        status = "building"
        reason = "early stage, few commits"
    else:
        status = "building"
        reason = "commits within recency window"

    return ProjectState(
        name=name,
        path=project_dir,
        status=status,
        state_md_status=state_md_status,
        last_commit_at=latest["at"],
        last_commit_hash=latest["short"],
        last_commit_subject=latest["subject"],
        commit_count=commit_count,
        feat_commit_count=feat_commit_count,
        days_since_last_commit=days_since,
        reason=reason,
    )


def get_progress(project_dir: Path) -> tuple[int, int | None, str]:
    """Return (completed, total_or_None, display_string).

    Completed = count of feat/fix/perf/refactor commits.
    Total     = numbered steps parsed from CLAUDE.md's implementation plan,
                or None if we can't parse one.

    This is the source of truth for the dashboard's progress indicator.
    state.md counts are ignored entirely.
    """

    log_output = _run_git(
        project_dir, "log", "--pretty=format:%s", "-500"
    )
    subjects = (log_output or "").splitlines()
    completed = sum(
        1
        for s in subjects
        if re.match(r"^(feat|fix|perf|refactor)(\([^)]+\))?:", s)
    )

    total: int | None = None
    claude_md = project_dir / "CLAUDE.md"
    if claude_md.exists():
        try:
            content = claude_md.read_text(encoding="utf-8", errors="replace")
        except OSError:
            content = ""
        total = _parse_total_steps(content)

    if total is not None and total > 0:
        display = f"{min(completed, total)} of {total}"
    else:
        display = f"{completed} commits"

    return completed, total, display


def _parse_total_steps(claude_md_content: str) -> int | None:
    """Count numbered implementation steps in CLAUDE.md.

    We look for the implementation-plan region and count lines like
    "1. ..." or "### Step 1" or "## Step 1". If the document has no
    obvious plan, return None.
    """

    plan_section = _extract_plan_section(claude_md_content)
    if not plan_section:
        return None

    step_pattern = re.compile(
        r"^(?:#{1,4}\s*Step\s+(\d+)|(\d+)\.\s+\S)",
        flags=re.MULTILINE | re.IGNORECASE,
    )
    numbers: list[int] = []
    for match in step_pattern.finditer(plan_section):
        raw = match.group(1) or match.group(2)
        try:
            numbers.append(int(raw))
        except (TypeError, ValueError):
            continue

    if not numbers:
        return None

    return max(numbers)


def _extract_plan_section(content: str) -> str:
    """Pull the implementation-plan region from CLAUDE.md if marked."""

    patterns = [
        r"#+\s*Implementation\s+(?:Plan|Steps).*",
        r"#+\s*Full Implementation Plan.*",
        r"#+\s*Build\s+Plan.*",
        r"#+\s*Steps\b.*",
    ]
    for pattern in patterns:
        match = re.search(
            pattern, content, flags=re.IGNORECASE | re.MULTILINE
        )
        if not match:
            continue

        # Body starts after the heading's newline — don't let the "next heading"
        # search re-match the same line we just found.
        body_start = match.end()
        if body_start < len(content) and content[body_start] == "\n":
            body_start += 1

        next_heading = re.search(
            r"^#{1,3}\s+\S",
            content[body_start:],
            flags=re.MULTILINE,
        )
        body_end = (
            body_start + next_heading.start() if next_heading else len(content)
        )
        return content[match.start():body_end]
    return content


def list_projects(
    projects_root: Path, config: Config | None = None
) -> list[ProjectState]:
    """Return ProjectState for every project directory under `projects_root`."""

    if not projects_root.is_dir():
        return []
    cfg = config or Config.load()

    results: list[ProjectState] = []
    for entry in sorted(projects_root.iterdir()):
        if not entry.is_dir() or entry.name.startswith("_"):
            continue
        results.append(get_state(entry, cfg))
    return results


def find_resumable(
    projects_root: Path, config: Config | None = None
) -> ProjectState | None:
    """Return the most recently-touched building-or-stalled project, if any."""

    candidates = [
        p
        for p in list_projects(projects_root, config)
        if p.status in {"building", "stalled"}
    ]
    if not candidates:
        return None
    candidates.sort(
        key=lambda p: p.last_commit_at or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return candidates[0]
