"""Tests for lib.telemetry — transcript parsing."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from lib.paths import Config
from lib import telemetry


def _write_transcript(
    dirpath: Path,
    cwd: str,
    input_tokens: int,
    output_tokens: int,
    days_ago: float = 0.0,
) -> None:
    """Write one JSONL line with the given usage + cwd + timestamp."""
    dirpath.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(tz=timezone.utc) - timedelta(days=days_ago)
    record = {
        "timestamp": ts.isoformat().replace("+00:00", "Z"),
        "cwd": cwd,
        "sessionId": "test",
        "message": {
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 0,
            },
        },
    }
    with (dirpath / "session.jsonl").open("a") as f:
        f.write(json.dumps(record) + "\n")


def _make_config(transcripts_dir: Path) -> Config:
    return Config(
        stalled_days=3,
        dead_days=14,
        similarity_threshold=0.55,
        max_regens=3,
        score_threshold=75,
        use_llm=False,
        domain_weights={
            "cybersecurity": 1.0, "systems": 1.0, "data": 1.0,
            "ai_ml": 1.0, "networking": 1.0, "devtools": 1.0,
        },
        transcripts_dir=transcripts_dir,
        max_weekly_tokens=50_000_000,
        max_session_tokens=4_000_000,
        auto_suggest_below_score=75,
    )


def test_missing_dir_returns_zeros(tmp_path: Path) -> None:
    cfg = _make_config(tmp_path / "no-such-dir")
    report = telemetry.collect(cfg)
    assert report.all_time.total_tokens == 0
    assert report.weekly.total_tokens == 0


def test_attributes_tokens_to_project_by_cwd(tmp_path: Path) -> None:
    transcripts = tmp_path / "transcripts"
    _write_transcript(
        transcripts / "proj-alpha",
        cwd="/Users/x/dev/daily-projects/alpha",
        input_tokens=100,
        output_tokens=50,
    )
    _write_transcript(
        transcripts / "proj-beta",
        cwd="/Users/x/dev/daily-projects/beta",
        input_tokens=200,
        output_tokens=70,
    )
    cfg = _make_config(transcripts)
    report = telemetry.collect(cfg)
    assert report.per_project["alpha"].input_tokens == 100
    assert report.per_project["alpha"].output_tokens == 50
    assert report.per_project["beta"].input_tokens == 200


def test_weekly_excludes_old_entries(tmp_path: Path) -> None:
    transcripts = tmp_path / "transcripts"
    _write_transcript(
        transcripts / "proj",
        cwd="/Users/x/dev/daily-projects/p",
        input_tokens=100,
        output_tokens=50,
        days_ago=0.0,
    )
    _write_transcript(
        transcripts / "proj",
        cwd="/Users/x/dev/daily-projects/p",
        input_tokens=500,
        output_tokens=500,
        days_ago=30.0,
    )
    cfg = _make_config(transcripts)
    report = telemetry.collect(cfg)
    assert report.all_time.total_tokens == 100 + 50 + 500 + 500
    assert report.weekly.total_tokens == 100 + 50


def test_report_to_dict_has_expected_keys(tmp_path: Path) -> None:
    cfg = _make_config(tmp_path / "empty")
    report = telemetry.collect(cfg)
    d = report.to_dict()
    assert "weekly" in d
    assert "all_time" in d
    assert "per_project" in d
    assert "weekly_percent_used" in d
