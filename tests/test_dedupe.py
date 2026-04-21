"""Tests for lib.dedupe — TF-IDF similarity check."""

from __future__ import annotations

from pathlib import Path

import pytest

from lib.dedupe import check, parse_past_projects
from lib.paths import Config


def _history(tmp_path: Path, entries: list[dict]) -> Path:
    lines = ["# Project History\n\n## Built Projects\n"]
    for i, e in enumerate(entries):
        lines.append(
            f"\n2026-04-{10+i:02d} — {e['name']}\n"
            f"- Domain: {e.get('domain', 'Devtools')}\n"
            f"- Description: {e['description']}\n"
            f"- Tech stack: {e['stack']}\n"
            f"- Status: COMPLETE\n"
            f"- GitHub: https://github.com/x/y\n"
        )
    path = tmp_path / "history.md"
    path.write_text("\n".join(lines))
    return path


def test_no_history_never_flags(tmp_path: Path) -> None:
    result = check({"tagline": "x"}, tmp_path / "nothing.md")
    assert not result.too_similar
    assert result.max_score == 0.0


def test_identical_idea_flags_as_similar(tmp_path: Path) -> None:
    history = _history(
        tmp_path,
        [
            {
                "name": "packet-replay-forge",
                "description": "Tactical PCAP dissection and traffic replay with protocol-aware mutation",
                "stack": "Python, Scapy, FastAPI, React, TypeScript",
            }
        ],
    )
    idea = {
        "full_name": "Packet Replay Forge",
        "repo_name": "packet-replay-forge",
        "tagline": "Tactical PCAP dissection and traffic replay with protocol-aware mutation",
        "tech_stack": ["Python", "Scapy", "FastAPI", "React", "TypeScript"],
        "core_features": ["PCAP parse", "Replay", "Mutation"],
    }
    result = check(idea, history)
    assert result.too_similar
    assert result.max_score > 0.55
    assert result.most_similar_name == "packet-replay-forge"


def test_different_idea_does_not_flag(tmp_path: Path) -> None:
    history = _history(
        tmp_path,
        [
            {
                "name": "packet-replay-forge",
                "description": "Tactical PCAP dissection and traffic replay",
                "stack": "Python, Scapy, FastAPI",
            }
        ],
    )
    idea = {
        "full_name": "ML Feature Store",
        "repo_name": "feature-store",
        "tagline": "A feature store with versioning and lineage tracking for ML teams",
        "tech_stack": ["Go", "PostgreSQL", "gRPC"],
        "core_features": ["Feature versioning", "Lineage graph", "Time-travel queries"],
    }
    result = check(idea, history)
    assert not result.too_similar
    assert result.max_score < 0.55


def test_parse_past_projects_handles_empty(tmp_path: Path) -> None:
    assert parse_past_projects(tmp_path / "nope.md") == []
