"""Pick which domain today's project should target.

Replaces the broken `day-of-month mod 6` rotation with a recency-weighted
least-recently-used picker that respects user weights in config.json.
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from .paths import DOMAINS, DOMAIN_LABEL_TO_KEY, Config


@dataclass(frozen=True)
class DomainPick:
    key: str
    label: str
    reason: str


def parse_history(history_file: Path) -> dict[str, date]:
    """Return {domain_key: most_recent_build_date} from project_history.md."""

    if not history_file.exists():
        return {}

    try:
        content = history_file.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return {}

    entries: dict[str, date] = {}

    block_pattern = re.compile(
        r"(?P<date>\d{4}-\d{2}-\d{2})\s*—\s*\S.*?\n(?:.*\n){0,20}?"
        r"^\s*-\s*Domain:\s*(?P<domain>.+)$",
        flags=re.MULTILINE,
    )

    for match in block_pattern.finditer(content):
        try:
            entry_date = date.fromisoformat(match.group("date"))
        except ValueError:
            continue

        domain_raw = match.group("domain").strip().rstrip(" .")
        key = _domain_label_to_key(domain_raw)
        if key is None:
            continue

        existing = entries.get(key)
        if existing is None or entry_date > existing:
            entries[key] = entry_date

    return entries


def _domain_label_to_key(label: str) -> str | None:
    """Map a free-text domain label to a known key."""

    normalized = label.lower()

    if label in DOMAIN_LABEL_TO_KEY:
        return DOMAIN_LABEL_TO_KEY[label]

    keywords = [
        ("cybersecurity", ["cyber", "security", "offensive", "defensive", "infosec"]),
        ("systems", ["systems programming", "low-level", "low level", "systems ", "kernel", "bytecode"]),
        ("data", ["data eng", "big data", "analytics", "pipeline", "etl"]),
        ("ai_ml", ["ai/ml", "ai ", "machine learning", "ml engineering", "applied intel"]),
        ("networking", ["network", "distributed system"]),
        ("devtools", ["developer tool", "cli", "platform eng", "dev tool", "tooling"]),
    ]
    for key, patterns in keywords:
        for pattern in patterns:
            if pattern in normalized:
                return key

    return None


def pick(
    history_file: Path,
    config: Config | None = None,
    today: date | None = None,
    rng: random.Random | None = None,
) -> DomainPick:
    """Choose the next domain.

    Score = days_since_last_used * weight. Highest score wins. Never-used
    domains score as if 9999 days ago so they surface first. Ties are
    broken randomly.
    """

    cfg = config or Config.load()
    today = today or date.today()
    rng = rng or random.Random()

    history = parse_history(history_file)

    scored: list[tuple[str, float, int]] = []
    for key, label in DOMAINS:
        weight = cfg.domain_weights.get(key, 1.0)
        if weight <= 0:
            continue
        last = history.get(key)
        days_since = (today - last).days if last else 9999
        score = days_since * weight
        scored.append((key, score, days_since))

    if not scored:
        return DomainPick(
            key=DOMAINS[0][0],
            label=DOMAINS[0][1],
            reason="no domains enabled in config; fell back to first",
        )

    max_score = max(s for _, s, _ in scored)
    top = [(k, d) for k, s, d in scored if s == max_score]
    chosen_key, days_since = rng.choice(top)
    label = next(lbl for k, lbl in DOMAINS if k == chosen_key)

    if days_since >= 9999:
        reason = f"never used '{chosen_key}' before"
    else:
        reason = (
            f"'{chosen_key}' last used {days_since}d ago "
            f"(weighted score = {max_score:g})"
        )

    return DomainPick(key=chosen_key, label=label, reason=reason)
