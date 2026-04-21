"""Shared path constants and config loader for daily-builder."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT: Path = Path.home() / "daily-builder"
PROJECTS_DIR: Path = Path.home() / "dev" / "daily-projects"
ARCHIVE_DIR: Path = PROJECTS_DIR / "_archive"

HISTORY_FILE: Path = ROOT / "project_history.md"
WISHLIST_FILE: Path = ROOT / "wishlist.md"
CONFIG_FILE: Path = ROOT / "config.json"
SESSION_LOG: Path = ROOT / "session.log"
BUILD_LOG: Path = ROOT / "build.log"

PROMPTS_DIR: Path = ROOT / "prompts"
LIB_DIR: Path = ROOT / "lib"
TESTS_DIR: Path = ROOT / "tests"
DASHBOARD_DIR: Path = ROOT / "dashboard"

TRANSCRIPTS_DIR: Path = Path.home() / ".claude" / "projects"

DOMAINS: tuple[tuple[str, str], ...] = (
    ("cybersecurity", "Cybersecurity and Offensive/Defensive Security Tools"),
    ("systems", "Systems Programming and Low-Level CS"),
    ("data", "Big Data, Data Engineering and Analytics Pipelines"),
    ("ai_ml", "AI/ML Engineering and Applied Intelligence"),
    ("networking", "Network Engineering and Distributed Systems"),
    ("devtools", "Developer Tooling, CLIs and Platform Engineering"),
)

DOMAIN_LABEL_TO_KEY: dict[str, str] = {label: key for key, label in DOMAINS}
DOMAIN_KEY_TO_LABEL: dict[str, str] = {key: label for key, label in DOMAINS}


@dataclass(frozen=True)
class Config:
    """Typed view over config.json. Use `Config.load()` to construct."""

    stalled_days: int
    dead_days: int
    similarity_threshold: float
    max_regens: int
    score_threshold: int
    use_llm: bool
    domain_weights: dict[str, float]
    transcripts_dir: Path
    max_weekly_tokens: int
    max_session_tokens: int
    auto_suggest_below_score: int

    @classmethod
    def load(cls, path: Path | None = None) -> "Config":
        path = path or CONFIG_FILE
        if not path.exists():
            return cls._defaults()
        try:
            raw: dict[str, Any] = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            return cls._defaults()

        abandonment = raw.get("abandonment", {})
        dedupe = raw.get("dedupe", {})
        evaluator = raw.get("evaluator", {})
        domain = raw.get("domain", {})
        telemetry = raw.get("telemetry", {})
        finishing = raw.get("finishing_pass", {})

        weights: dict[str, float] = {
            key: float(domain.get("weights", {}).get(key, 1.0))
            for key, _ in DOMAINS
        }

        transcripts = telemetry.get("transcripts_dir", "~/.claude/projects")

        return cls(
            stalled_days=int(abandonment.get("stalled_days", 3)),
            dead_days=int(abandonment.get("dead_days", 14)),
            similarity_threshold=float(dedupe.get("similarity_threshold", 0.55)),
            max_regens=int(dedupe.get("max_regens", 3)),
            score_threshold=int(evaluator.get("score_threshold", 75)),
            use_llm=bool(evaluator.get("use_llm", True)),
            domain_weights=weights,
            transcripts_dir=Path(transcripts).expanduser(),
            max_weekly_tokens=int(telemetry.get("max_weekly_tokens", 50_000_000)),
            max_session_tokens=int(telemetry.get("max_session_tokens", 4_000_000)),
            auto_suggest_below_score=int(
                finishing.get("auto_suggest_below_score", 75)
            ),
        )

    @classmethod
    def _defaults(cls) -> "Config":
        weights = {key: 1.0 for key, _ in DOMAINS}
        return cls(
            stalled_days=3,
            dead_days=14,
            similarity_threshold=0.55,
            max_regens=3,
            score_threshold=75,
            use_llm=True,
            domain_weights=weights,
            transcripts_dir=Path("~/.claude/projects").expanduser(),
            max_weekly_tokens=500_000_000,
            max_session_tokens=20_000_000,
            auto_suggest_below_score=75,
        )
