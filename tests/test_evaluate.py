"""Tests for lib.evaluate — heuristic scoring (LLM path is not unit-tested)."""

from __future__ import annotations

from pathlib import Path

import pytest

from lib.evaluate import heuristic_score, Evaluation, evaluate


def test_empty_dir_scores_low(tmp_path: Path) -> None:
    result = heuristic_score(tmp_path)
    assert result.score < 40


def test_basic_project_scores_above_empty(tmp_project: Path, commit) -> None:
    (tmp_project / "README.md").write_text(
        "# demo\n\nA long enough readme for detection.\n\n"
        "## Install\n```bash\nnpm install\n```\n"
        "## Usage\nSomething\n"
    )
    (tmp_project / "package.json").write_text('{"name":"demo"}')
    commit("feat: initial implementation")
    commit("feat: parser module")
    commit("fix: edge case")
    commit("test: add parser tests")
    (tmp_project / "test_parser.py").write_text("def test_x(): assert True\n")
    commit("test: coverage", file_name="test_parser.py", content="def test_x(): assert True\n")

    empty = heuristic_score(tmp_project.parent / "nonexistent")
    scored = heuristic_score(tmp_project)
    assert scored.score > empty.score
    assert scored.checks["readme"]["points"] > 0
    assert scored.checks["git_activity"]["points"] > 0


def test_todo_and_debug_hurt_score(tmp_project: Path, commit) -> None:
    (tmp_project / "bad.py").write_text(
        "# TODO: fix this\n"
        "# FIXME: broken\n"
        "print('debug')\n"
        "print('another debug')\n"
        "print('more debug')\n"
    )
    commit("feat: add code", file_name="bad.py", content=(tmp_project / "bad.py").read_text())
    result = heuristic_score(tmp_project)
    assert result.checks["no_stubs"]["points"] < 10


def test_committed_env_file_penalized(tmp_project: Path, commit) -> None:
    (tmp_project / ".env").write_text("SECRET_KEY=abc123def456ghi789\n")
    commit("feat: oops", file_name=".env", content="SECRET_KEY=abc123def456ghi789\n")
    result = heuristic_score(tmp_project)
    assert not result.checks["no_secrets"]["pass"]


def test_heuristic_max_is_100(tmp_path: Path) -> None:
    """Score is always bounded to [0, 100]."""
    result = heuristic_score(tmp_path)
    assert 0 <= result.score <= 100


def test_evaluate_writes_json(tmp_project: Path, commit) -> None:
    (tmp_project / "README.md").write_text("# demo\n")
    commit("feat: thing")
    result = evaluate(tmp_project, use_llm=False)
    assert (tmp_project / "evaluation.json").exists()
    assert isinstance(result, Evaluation)
    assert isinstance(result.score, int)
