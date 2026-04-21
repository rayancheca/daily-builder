"""Shared pytest fixtures — daily-builder test suite."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest


@pytest.fixture
def tmp_project(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """An empty project directory with a git repo initialized."""
    import subprocess

    project = tmp_path / "demo-project"
    project.mkdir()
    subprocess.run(
        ["git", "init", "-q"], cwd=project, check=True
    )
    subprocess.run(
        ["git", "config", "user.email", "t@t"], cwd=project, check=True
    )
    subprocess.run(
        ["git", "config", "user.name", "t"], cwd=project, check=True
    )
    return project


def _commit(
    project: Path,
    msg: str,
    file_name: str | None = None,
    content: str | None = None,
) -> None:
    import subprocess
    import uuid

    # Default to a fresh file per commit so git never reports "nothing to commit."
    file_name = file_name or f"note_{uuid.uuid4().hex[:8]}.txt"
    content = content if content is not None else f"{msg}\n{uuid.uuid4().hex}\n"
    (project / file_name).write_text(content)
    subprocess.run(["git", "add", "-A"], cwd=project, check=True)
    subprocess.run(
        ["git", "commit", "-q", "-m", msg], cwd=project, check=True
    )


@pytest.fixture
def commit(tmp_project: Path):
    def _c(msg: str, **kwargs):
        _commit(tmp_project, msg, **kwargs)
    return _c
