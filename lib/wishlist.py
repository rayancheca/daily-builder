"""Wishlist helpers shared by start.sh and the dashboard.

The wishlist file lives at ``~/daily-builder/wishlist.md`` and has two
sections:

    ## Unused      -- pending ideas as ``- [ ] ...``
    ## Used        -- completed ideas as ``- [x] ...`` (auto-moved on pick)

Curated alternates live in ``~/daily-builder/curated.md`` and are
LLM-generated riffs on the user's actual wishlist. They appear as a
second selectable group in ``start.sh`` wishlist mode and are
regenerated silently when the wishlist changes.
"""

from __future__ import annotations

import hashlib
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

WISHLIST_FILE = Path(os.path.expanduser("~/daily-builder/wishlist.md"))
CURATED_FILE = Path(os.path.expanduser("~/daily-builder/curated.md"))

_UNUSED_RE = re.compile(r"(##\s*Unused\s*\n)(.*?)(?=\n##|\Z)", re.DOTALL)
_USED_RE = re.compile(r"(##\s*Used\s*\n)(.*?)(?=\n##|\Z)", re.DOTALL)
_BOX_OPEN = re.compile(r"^- \[ \]\s+(.+?)\s*$", re.MULTILINE)
_BOX_DONE = re.compile(r"^- \[x\]\s+(.+?)\s*$", re.MULTILINE)
_PLACEHOLDER = "add your own"


@dataclass(frozen=True)
class WishlistView:
    unused: List[str]
    used: List[str]
    curated: List[str]


def read_wishlist() -> WishlistView:
    """Return current Unused, Used, and Curated lists."""
    unused = _read_section(WISHLIST_FILE, _UNUSED_RE, _BOX_OPEN)
    used = _read_section(WISHLIST_FILE, _USED_RE, _BOX_DONE)
    curated = _read_curated()
    return WishlistView(unused=unused, used=used, curated=curated)


def add_unused(text: str) -> None:
    """Append a new idea to the Unused section, creating the file if needed."""
    text = text.strip()
    if not text:
        return
    if not WISHLIST_FILE.exists():
        WISHLIST_FILE.write_text(
            "# Project Wishlist\n\n## Unused\n\n- [ ] " + text + "\n\n## Used\n\n",
            encoding="utf-8",
        )
        return
    content = WISHLIST_FILE.read_text(encoding="utf-8")
    match = _UNUSED_RE.search(content)
    if not match:
        content = content.rstrip() + "\n\n## Unused\n\n- [ ] " + text + "\n"
    else:
        block = match.group(2).rstrip("\n")
        new_block = (block + "\n" if block else "") + "- [ ] " + text + "\n"
        content = content[: match.start(2)] + new_block + content[match.end(2):]
    WISHLIST_FILE.write_text(content, encoding="utf-8")


def mark_built(item: str) -> bool:
    """Move ``item`` from Unused → Used (as ``- [x]``).

    Returns True if the move happened, False if no matching Unused entry
    was found.
    """
    if not WISHLIST_FILE.exists():
        return False
    content = WISHLIST_FILE.read_text(encoding="utf-8")

    unused_match = _UNUSED_RE.search(content)
    if not unused_match:
        return False
    unused_block = unused_match.group(2)

    pattern = re.compile(r"^- \[ \]\s+" + re.escape(item) + r"\s*$\n?", re.MULTILINE)
    new_unused, n = pattern.subn("", unused_block)
    if n == 0:
        return False
    new_unused = re.sub(r"\n{3,}", "\n\n", new_unused)

    content = content[: unused_match.start(2)] + new_unused + content[unused_match.end(2):]

    used_match = _USED_RE.search(content)
    if not used_match:
        content = content.rstrip() + "\n\n## Used\n\n- [x] " + item + "\n"
    else:
        block = used_match.group(2).rstrip("\n")
        new_used = (block + "\n" if block else "") + "- [x] " + item + "\n"
        content = content[: used_match.start(2)] + new_used + content[used_match.end(2):]

    WISHLIST_FILE.write_text(content, encoding="utf-8")
    return True


def curated_is_stale() -> bool:
    """Return True iff `ensure_curated()` would call the LLM right now.

    Lets `start.sh` decide whether to print the "refreshing…" spinner
    instead of showing it unconditionally on every wishlist iteration.
    """
    if not WISHLIST_FILE.exists():
        return False
    unused = _read_section(WISHLIST_FILE, _UNUSED_RE, _BOX_OPEN)
    if not unused:
        return False
    return _wishlist_hash(unused) != _curated_cached_hash() or not CURATED_FILE.exists()


def ensure_curated(force: bool = False) -> List[str]:
    """Generate curated alternates if stale; return the current list.

    Stale = curated.md missing OR wishlist hash differs from cached hash.
    Generation calls ``claude -p`` synchronously with a tight prompt;
    failures are non-fatal (returns whatever curated.md already has, or []).
    """
    if not WISHLIST_FILE.exists():
        return []

    unused = _read_section(WISHLIST_FILE, _UNUSED_RE, _BOX_OPEN)
    if not unused:
        return _read_curated()  # nothing to riff on

    current_hash = _wishlist_hash(unused)
    cached_hash = _curated_cached_hash()

    if not force and CURATED_FILE.exists() and cached_hash == current_hash:
        return _read_curated()

    suggestions = _generate_curated_via_claude(unused)
    if not suggestions:
        return _read_curated()

    body_lines = ["# Curated Suggestions",
                  "",
                  f"<!-- hash: {current_hash} -->",
                  "<!-- LLM-generated alternates riffing on Unused wishlist entries. -->",
                  "<!-- Regenerated automatically when wishlist.md changes. -->",
                  "",
                  "## Suggestions",
                  ""]
    for s in suggestions:
        body_lines.append("- [ ] " + s)
    body_lines.append("")
    CURATED_FILE.write_text("\n".join(body_lines), encoding="utf-8")
    return suggestions


def _read_curated() -> List[str]:
    if not CURATED_FILE.exists():
        return []
    text = CURATED_FILE.read_text(encoding="utf-8")
    items = _BOX_OPEN.findall(text)
    return [i.strip() for i in items if i.strip() and _PLACEHOLDER not in i.lower()]


def _curated_cached_hash() -> Optional[str]:
    if not CURATED_FILE.exists():
        return None
    text = CURATED_FILE.read_text(encoding="utf-8")
    m = re.search(r"<!--\s*hash:\s*([0-9a-f]+)\s*-->", text)
    return m.group(1) if m else None


def _wishlist_hash(items: List[str]) -> str:
    h = hashlib.sha256()
    for it in sorted(items):
        h.update(it.encode("utf-8"))
        h.update(b"\n")
    return h.hexdigest()[:16]


def _read_section(path: Path, section_re: re.Pattern, item_re: re.Pattern) -> List[str]:
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    match = section_re.search(text)
    if not match:
        return []
    items = item_re.findall(match.group(2))
    return [i.strip() for i in items if i.strip() and _PLACEHOLDER not in i.lower()]


_CURATED_PROMPT = """\
You are helping a developer expand their daily-build project wishlist.

Their existing ideas (one per line) are below. Generate exactly 6 NEW
project ideas that:

- Are alternates / variants — distinct enough to feel different, but in
  the same spirit as their actual interests
- Are technically substantial (real algorithms, real protocols, real
  systems work — not toy CRUD apps)
- Are completable in 2-4 build sessions
- Use Go, Python, TypeScript, JavaScript, or C — not Rust, Haskell, Elixir

Output FORMAT — exactly 6 lines, each one short title + colon + one-line
description, nothing else. No numbering. No prose. No markdown bullets.

EXAMPLE OUTPUT:
gossip-cluster-paint: real-time SWIM membership convergence visualizer over WebSocket
syscall-tracer: terminal flame-graph for syscall hot paths captured via dtrace

EXISTING IDEAS:
{ideas}
"""


def _generate_curated_via_claude(unused: List[str]) -> List[str]:
    """Call ``claude -p`` to produce alternates. Returns [] on any failure."""
    prompt = _CURATED_PROMPT.format(ideas="\n".join("- " + i for i in unused))
    try:
        result = subprocess.run(
            ["claude", "--dangerously-skip-permissions",
             "--model", "claude-haiku-4-5-20251001", "-p", prompt],
            capture_output=True, text=True, timeout=90,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return []
    if result.returncode != 0:
        return []

    out = result.stdout.strip()
    lines: List[str] = []
    for raw in out.splitlines():
        line = raw.strip()
        if not line:
            continue
        # Strip leading bullet / number / dash if Claude adds it.
        line = re.sub(r"^[-*•]\s*", "", line)
        line = re.sub(r"^\d+[.)]\s*", "", line)
        if len(line) < 8 or len(line) > 200:
            continue
        lines.append(line)
        if len(lines) >= 6:
            break
    return lines
