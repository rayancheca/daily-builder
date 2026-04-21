"""Tests for lib.project_state — derives truth from git, not state.md."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from lib.paths import Config
from lib.project_state import get_state, get_progress


def _freeze_commit_time(project: Path, days_ago: int) -> None:
    """Rewrite the last commit's author/committer dates to days_ago."""
    import subprocess

    target = datetime.now(tz=timezone.utc) - timedelta(days=days_ago)
    iso = target.strftime("%Y-%m-%dT%H:%M:%S+0000")
    env = {
        "GIT_COMMITTER_DATE": iso,
        "GIT_AUTHOR_DATE": iso,
    }
    import os

    subprocess.run(
        [
            "git",
            "commit",
            "--amend",
            "--no-edit",
            "--date",
            iso,
        ],
        cwd=project,
        env={**os.environ, **env},
        check=True,
        capture_output=True,
    )


def test_empty_dir_reports_empty(tmp_path: Path) -> None:
    state = get_state(tmp_path / "nonexistent")
    assert state.status == "empty"


def test_git_without_commits_reports_empty(tmp_project: Path) -> None:
    state = get_state(tmp_project)
    assert state.status == "empty"
    assert state.commit_count == 0


def test_shipped_when_state_md_says_complete_and_has_commits(
    tmp_project: Path, commit
) -> None:
    commit("feat: first thing")
    commit("feat: second thing")
    (tmp_project / "state.md").write_text("## Status\nCOMPLETE\n")

    state = get_state(tmp_project)
    assert state.status == "shipped"
    assert state.commit_count >= 2
    assert state.feat_commit_count >= 2


def test_stalled_when_in_progress_and_stale(
    tmp_project: Path, commit
) -> None:
    commit("feat: stuff", file_name="a.txt")
    _freeze_commit_time(tmp_project, days_ago=10)
    (tmp_project / "state.md").write_text("## Status\nIN PROGRESS\n")

    state = get_state(tmp_project)
    assert state.status in ("stalled", "dead")


def test_state_md_lie_does_not_override_git(
    tmp_project: Path, commit
) -> None:
    """If state.md says COMPLETE but git has zero commits, NOT shipped."""
    (tmp_project / "state.md").write_text("## Status\nCOMPLETE\n")
    state = get_state(tmp_project)
    assert state.status == "empty"


def test_get_progress_counts_feat_commits(
    tmp_project: Path, commit
) -> None:
    commit("chore: scaffold")
    commit("feat: one")
    commit("fix: bug")
    commit("docs: readme")

    completed, total, display = get_progress(tmp_project)
    assert completed == 2
    assert total is None
    assert "commits" in display


def test_get_progress_respects_claude_md_plan(
    tmp_project: Path, commit
) -> None:
    commit("feat: one")
    commit("feat: two")
    (tmp_project / "CLAUDE.md").write_text(
        "# Plan\n\n## Implementation Plan\n\n"
        "1. Do thing A\n"
        "2. Do thing B\n"
        "3. Do thing C\n"
        "4. Do thing D\n"
        "5. Do thing E\n"
    )
    completed, total, display = get_progress(tmp_project)
    assert total == 5
    assert completed == 2
    assert display == "2 of 5"
