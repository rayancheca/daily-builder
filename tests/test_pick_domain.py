"""Tests for lib.pick_domain — recency-weighted LRU."""

from __future__ import annotations

import random
from datetime import date
from pathlib import Path

import pytest

from lib.paths import Config
from lib.pick_domain import pick, parse_history


def _history(tmp_path: Path, entries: list[tuple[str, str]]) -> Path:
    """entries: [(date_iso, domain_key_label)] — writes a history file."""
    lines = ["# Project History\n\n## Built Projects\n"]
    label_map = {
        "cybersecurity": "Cybersecurity and Offensive/Defensive Security Tools",
        "systems": "Systems Programming and Low-Level CS",
        "data": "Big Data, Data Engineering and Analytics Pipelines",
        "ai_ml": "AI/ML Engineering and Applied Intelligence",
        "networking": "Network Engineering and Distributed Systems",
        "devtools": "Developer Tooling, CLIs and Platform Engineering",
    }
    for i, (d, key) in enumerate(entries):
        label = label_map.get(key, key)
        lines.append(
            f"\n{d} — example-project-{i}\n"
            f"- Domain: {label}\n"
            f"- Description: x\n"
            f"- Tech stack: python\n"
            f"- Status: COMPLETE\n"
            f"- GitHub: https://github.com/x/y\n"
        )
    path = tmp_path / "project_history.md"
    path.write_text("\n".join(lines))
    return path


def test_empty_history_picks_first(tmp_path: Path) -> None:
    path = tmp_path / "history.md"
    path.write_text("# History\n")
    cfg = Config._defaults()
    result = pick(path, cfg, today=date(2026, 4, 21), rng=random.Random(0))
    assert result.key in {"cybersecurity", "systems", "data", "ai_ml", "networking", "devtools"}
    assert "never used" in result.reason


def test_picks_lru_domain(tmp_path: Path) -> None:
    path = _history(
        tmp_path,
        [
            ("2026-04-15", "cybersecurity"),
            ("2026-04-10", "systems"),
            ("2026-04-01", "data"),
            ("2026-03-20", "ai_ml"),
            ("2026-03-10", "networking"),
        ],
    )
    cfg = Config._defaults()
    result = pick(path, cfg, today=date(2026, 4, 21), rng=random.Random(0))
    assert result.key == "devtools"
    assert "never used" in result.reason


def test_weights_affect_pick(tmp_path: Path) -> None:
    path = _history(
        tmp_path,
        [
            ("2026-04-20", "cybersecurity"),  # 1 day ago
            ("2026-04-10", "systems"),        # 11 days ago
        ],
    )
    weights = {
        "cybersecurity": 1.0,
        "systems": 10.0,  # heavy weight — should beat days-ago
        "data": 0.01,
        "ai_ml": 0.01,
        "networking": 0.01,
        "devtools": 0.01,
    }
    cfg = Config(
        stalled_days=3,
        dead_days=14,
        similarity_threshold=0.55,
        max_regens=3,
        score_threshold=75,
        use_llm=False,
        domain_weights=weights,
        transcripts_dir=Path("~/.claude/projects").expanduser(),
        max_weekly_tokens=50_000_000,
        max_session_tokens=4_000_000,
        auto_suggest_below_score=75,
    )
    result = pick(path, cfg, today=date(2026, 4, 21), rng=random.Random(0))
    assert result.key == "systems"


def test_weight_zero_excludes_domain(tmp_path: Path) -> None:
    path = tmp_path / "history.md"
    path.write_text("# empty\n")
    weights = {k: 1.0 for k in ("cybersecurity", "systems", "data", "ai_ml", "networking", "devtools")}
    weights["cybersecurity"] = 0
    cfg = Config(
        stalled_days=3, dead_days=14, similarity_threshold=0.55, max_regens=3,
        score_threshold=75, use_llm=False, domain_weights=weights,
        transcripts_dir=Path("~/.claude/projects").expanduser(),
        max_weekly_tokens=50_000_000, max_session_tokens=4_000_000,
        auto_suggest_below_score=75,
    )
    for _ in range(10):
        r = pick(path, cfg, today=date(2026, 4, 21))
        assert r.key != "cybersecurity"


def test_parse_history_handles_empty(tmp_path: Path) -> None:
    assert parse_history(tmp_path / "nonexistent") == {}


def test_parse_history_reads_entries(tmp_path: Path) -> None:
    path = _history(tmp_path, [("2026-04-15", "systems")])
    entries = parse_history(path)
    assert "systems" in entries
    assert entries["systems"] == date(2026, 4, 15)
