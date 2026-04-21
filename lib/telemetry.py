"""Claude Code transcript parsing for Max-quota telemetry.

Reads `~/.claude/projects/<slug>/*.jsonl`, attributes token usage to the
cwd recorded on each message, and rolls up per-project and per-week totals.
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

from .paths import TRANSCRIPTS_DIR, Config


@dataclass(frozen=True)
class UsageSnapshot:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_tokens: int = 0
    cache_read_tokens: int = 0
    messages: int = 0

    @property
    def total_tokens(self) -> int:
        return (
            self.input_tokens
            + self.output_tokens
            + self.cache_creation_tokens
            + self.cache_read_tokens
        )

    def merged(self, other: "UsageSnapshot") -> "UsageSnapshot":
        return UsageSnapshot(
            input_tokens=self.input_tokens + other.input_tokens,
            output_tokens=self.output_tokens + other.output_tokens,
            cache_creation_tokens=(
                self.cache_creation_tokens + other.cache_creation_tokens
            ),
            cache_read_tokens=self.cache_read_tokens + other.cache_read_tokens,
            messages=self.messages + other.messages,
        )

    def to_dict(self) -> dict:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cache_creation_tokens": self.cache_creation_tokens,
            "cache_read_tokens": self.cache_read_tokens,
            "messages": self.messages,
            "total_tokens": self.total_tokens,
        }


@dataclass
class _Accumulator:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_tokens: int = 0
    cache_read_tokens: int = 0
    messages: int = 0

    def add_usage(self, usage: dict) -> None:
        self.input_tokens += int(usage.get("input_tokens", 0) or 0)
        self.output_tokens += int(usage.get("output_tokens", 0) or 0)
        self.cache_creation_tokens += int(
            usage.get("cache_creation_input_tokens", 0) or 0
        )
        self.cache_read_tokens += int(usage.get("cache_read_input_tokens", 0) or 0)
        self.messages += 1

    def snapshot(self) -> UsageSnapshot:
        return UsageSnapshot(
            input_tokens=self.input_tokens,
            output_tokens=self.output_tokens,
            cache_creation_tokens=self.cache_creation_tokens,
            cache_read_tokens=self.cache_read_tokens,
            messages=self.messages,
        )


@dataclass(frozen=True)
class TelemetryReport:
    weekly: UsageSnapshot
    all_time: UsageSnapshot
    per_project: dict[str, UsageSnapshot]
    weekly_quota: int
    max_session_tokens: int
    generated_at: datetime

    def to_dict(self) -> dict:
        pct = (
            (self.weekly.total_tokens / self.weekly_quota) * 100.0
            if self.weekly_quota > 0
            else 0.0
        )
        return {
            "weekly": self.weekly.to_dict(),
            "weekly_quota_tokens": self.weekly_quota,
            "weekly_percent_used": round(pct, 2),
            "all_time": self.all_time.to_dict(),
            "per_project": {
                name: snap.to_dict() for name, snap in self.per_project.items()
            },
            "max_session_tokens": self.max_session_tokens,
            "generated_at": self.generated_at.isoformat(),
        }


def _iter_transcripts(transcripts_dir: Path) -> Iterable[Path]:
    if not transcripts_dir.is_dir():
        return []
    return transcripts_dir.glob("*/*.jsonl")


def _parse_timestamp(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        return datetime.fromisoformat(raw).astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def _project_key_from_cwd(cwd: str | None) -> str | None:
    if not cwd:
        return None
    path = Path(cwd)
    parts = path.parts
    try:
        idx = parts.index("daily-projects")
    except ValueError:
        return None
    if idx + 1 >= len(parts):
        return None
    return parts[idx + 1]


def collect(
    config: Config | None = None,
    now: datetime | None = None,
) -> TelemetryReport:
    """Walk all transcripts and build a full telemetry report."""

    cfg = config or Config.load()
    now = now or datetime.now(tz=timezone.utc)
    one_week_ago = now - timedelta(days=7)

    weekly = _Accumulator()
    all_time = _Accumulator()
    per_project: dict[str, _Accumulator] = defaultdict(_Accumulator)

    transcripts_dir = cfg.transcripts_dir or TRANSCRIPTS_DIR

    for jsonl in _iter_transcripts(transcripts_dir):
        try:
            with jsonl.open("r", encoding="utf-8", errors="replace") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        record = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    message = record.get("message")
                    if not isinstance(message, dict):
                        continue
                    usage = message.get("usage")
                    if not isinstance(usage, dict):
                        continue

                    all_time.add_usage(usage)

                    ts = _parse_timestamp(record.get("timestamp"))
                    if ts and ts >= one_week_ago:
                        weekly.add_usage(usage)

                    cwd = record.get("cwd")
                    key = _project_key_from_cwd(cwd)
                    if key:
                        per_project[key].add_usage(usage)
        except OSError:
            continue

    return TelemetryReport(
        weekly=weekly.snapshot(),
        all_time=all_time.snapshot(),
        per_project={name: acc.snapshot() for name, acc in per_project.items()},
        weekly_quota=cfg.max_weekly_tokens,
        max_session_tokens=cfg.max_session_tokens,
        generated_at=now,
    )


def project_usage(
    project_name: str, config: Config | None = None
) -> UsageSnapshot:
    """Return lifetime token usage for a specific project."""

    report = collect(config)
    return report.per_project.get(project_name, UsageSnapshot())
