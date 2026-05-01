"""Multi-agent deep evaluator.

Spawns 6 specialised `claude -p` agents in parallel (ThreadPoolExecutor),
each reading actual source code.  Aggregates results into a DeepEvaluation
and writes an `improvements.md` spec file to the project directory.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ── Skip dirs (mirrors evaluate.py) ────────────────────────────────────────

_SKIP_DIRS = {
    ".git", "node_modules", "dist", "build", ".next", ".cache",
    "venv", ".venv", "__pycache__", "target", ".terraform", "coverage",
    "vendor",
}

_ALL_CODE_EXTS = {
    ".py", ".go", ".ts", ".tsx", ".js", ".jsx", ".rs", ".java", ".kt",
    ".swift", ".cpp", ".c", ".h", ".hpp", ".rb", ".php", ".sh", ".mjs",
    ".cjs", ".json", ".yaml", ".yml", ".toml", ".dockerfile",
}

_FRONTEND_EXTS = {".tsx", ".jsx", ".vue", ".svelte", ".css", ".scss", ".html"}


# ── Dataclasses ─────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class AgentResult:
    name: str
    score: int
    critical: list[str]
    high: list[str]
    medium: list[str]
    low: list[str]
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "score": self.score,
            "critical": list(self.critical),
            "high": list(self.high),
            "medium": list(self.medium),
            "low": list(self.low),
            "error": self.error,
        }


@dataclass(frozen=True)
class DeepEvaluation:
    project: str
    composite_score: int
    agents: list[AgentResult]
    generated_at: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "project": self.project,
            "composite_score": self.composite_score,
            "agents": [a.to_dict() for a in self.agents],
            "generated_at": self.generated_at,
        }


# ── File collection ──────────────────────────────────────────────────────────

def _collect_files(
    project_dir: Path,
    preferred_exts: set[str],
    max_chars: int = 20_000,
) -> str:
    """Walk project_dir, collect files matching preferred_exts first, then
    all code files if under budget.  Returns annotated multi-file string."""

    def _should_skip(path: Path) -> bool:
        return any(part in _SKIP_DIRS for part in path.parts)

    preferred: list[Path] = []
    fallback: list[Path] = []

    for entry in sorted(project_dir.rglob("*")):
        if not entry.is_file():
            continue
        if _should_skip(entry):
            continue
        ext = entry.suffix.lower()
        if ext in preferred_exts:
            preferred.append(entry)
        elif ext in _ALL_CODE_EXTS:
            fallback.append(entry)

    collected = preferred + fallback
    parts: list[str] = []
    total = 0

    for path in collected:
        if total >= max_chars:
            break
        try:
            content = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        rel = path.relative_to(project_dir)
        header = f"--- {rel} ---\n"
        available = max_chars - total
        if available <= len(header):
            break
        chunk = content[: available - len(header)]
        parts.append(header + chunk)
        total += len(header) + len(chunk)

    return "\n".join(parts)


def _collect_for_code_quality(project_dir: Path) -> str:
    """Source files only — skip test files."""
    preferred = {".py", ".go", ".ts", ".tsx", ".js", ".rs", ".java", ".kt", ".swift", ".cpp", ".c"}
    all_pref: list[Path] = []
    fallback: list[Path] = []

    def _should_skip(path: Path) -> bool:
        return any(part in _SKIP_DIRS for part in path.parts)

    for entry in sorted(project_dir.rglob("*")):
        if not entry.is_file():
            continue
        if _should_skip(entry):
            continue
        name_lower = entry.name.lower()
        is_test = "test" in name_lower
        ext = entry.suffix.lower()
        if is_test:
            continue
        if ext in preferred:
            all_pref.append(entry)
        elif ext in _ALL_CODE_EXTS:
            fallback.append(entry)

    collected = all_pref + fallback
    parts: list[str] = []
    total = 0
    max_chars = 20_000

    for path in collected:
        if total >= max_chars:
            break
        try:
            content = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        rel = path.relative_to(project_dir)
        header = f"--- {rel} ---\n"
        available = max_chars - total
        if available <= len(header):
            break
        chunk = content[: available - len(header)]
        parts.append(header + chunk)
        total += len(header) + len(chunk)

    return "\n".join(parts)


def _collect_for_tests(project_dir: Path) -> str:
    """Test files first, then source files."""
    code_exts = {".py", ".go", ".ts", ".tsx", ".js"}

    def _should_skip(path: Path) -> bool:
        return any(part in _SKIP_DIRS for part in path.parts)

    test_files: list[Path] = []
    source_files: list[Path] = []

    for entry in sorted(project_dir.rglob("*")):
        if not entry.is_file():
            continue
        if _should_skip(entry):
            continue
        ext = entry.suffix.lower()
        if ext not in code_exts:
            continue
        name_lower = entry.name.lower()
        if "test" in name_lower or "spec" in name_lower:
            test_files.append(entry)
        else:
            source_files.append(entry)

    collected = test_files + source_files
    parts: list[str] = []
    total = 0
    max_chars = 20_000

    for path in collected:
        if total >= max_chars:
            break
        try:
            content = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        rel = path.relative_to(project_dir)
        header = f"--- {rel} ---\n"
        available = max_chars - total
        if available <= len(header):
            break
        chunk = content[: available - len(header)]
        parts.append(header + chunk)
        total += len(header) + len(chunk)

    return "\n".join(parts)


def _collect_for_docs(project_dir: Path) -> str:
    """README first (full), then up to 5 key source files."""
    parts: list[str] = []
    total = 0
    max_chars = 20_000

    readme = next((p for p in project_dir.glob("README*") if p.is_file()), None)
    if readme:
        try:
            content = readme.read_text(encoding="utf-8", errors="replace")
            header = f"--- {readme.name} ---\n"
            chunk = content[: max_chars - len(header)]
            parts.append(header + chunk)
            total += len(header) + len(chunk)
        except OSError:
            pass

    def _should_skip(path: Path) -> bool:
        return any(part in _SKIP_DIRS for part in path.parts)

    key_exts = {".py", ".go", ".ts", ".tsx", ".js", ".rs"}
    source_files: list[Path] = []

    for entry in sorted(project_dir.rglob("*")):
        if not entry.is_file():
            continue
        if _should_skip(entry):
            continue
        if entry == readme:
            continue
        if entry.suffix.lower() in key_exts:
            source_files.append(entry)

    for path in source_files[:5]:
        if total >= max_chars:
            break
        try:
            content = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        rel = path.relative_to(project_dir)
        header = f"--- {rel} ---\n"
        available = max_chars - total
        if available <= len(header):
            break
        chunk = content[: available - len(header)]
        parts.append(header + chunk)
        total += len(header) + len(chunk)

    return "\n".join(parts)


def _has_frontend_files(project_dir: Path) -> bool:
    def _should_skip(path: Path) -> bool:
        return any(part in _SKIP_DIRS for part in path.parts)

    for entry in project_dir.rglob("*"):
        if not entry.is_file():
            continue
        if _should_skip(entry):
            continue
        if entry.suffix.lower() in _FRONTEND_EXTS:
            return True
    return False


# ── Agent runner ─────────────────────────────────────────────────────────────

_AGENT_PROMPT_TEMPLATE = """\
You are a {role} reviewing the "{project_name}" project.

Your focus: {focus}

Source code:

{code}

Respond with ONLY a raw JSON object — no markdown, no prose, just JSON:
{{
  "score": <integer 0-100>,
  "critical": ["specific finding with file reference if possible", ...],
  "high": ["...", ...],
  "medium": ["...", ...],
  "low": ["...", ...]
}}

Rules:
- Score reflects current state, not potential
- Each finding: specific, actionable, name the file if applicable
- Max 4 items per level; fewer is fine if issues don't exist
- critical = security vulnerability / data loss / broken core functionality
- high = significant bug or quality issue that degrades the product
- medium = maintainability or completeness gap
- low = polish or nice-to-have improvement
"""


def _run_agent(
    agent_name: str,
    prompt: str,
    project_dir: Path,
    timeout: int = 120,
) -> AgentResult:
    """Run a single claude -p agent. Returns AgentResult with error set on failure."""
    try:
        result = subprocess.run(
            ["claude", "--dangerously-skip-permissions", "-p", prompt],
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(project_dir),
        )
    except FileNotFoundError:
        return AgentResult(
            name=agent_name, score=50,
            critical=[], high=[], medium=[], low=[],
            error="claude CLI not found in PATH",
        )
    except subprocess.TimeoutExpired:
        return AgentResult(
            name=agent_name, score=50,
            critical=[], high=[], medium=[], low=[],
            error=f"agent timed out after {timeout}s",
        )
    except subprocess.SubprocessError as exc:
        return AgentResult(
            name=agent_name, score=50,
            critical=[], high=[], medium=[], low=[],
            error=str(exc),
        )

    output = result.stdout or ""
    m = re.search(r"\{.*\}", output, re.DOTALL)
    if not m:
        return AgentResult(
            name=agent_name, score=50,
            critical=[], high=[], medium=[], low=[],
            error=f"no JSON in output (stderr: {result.stderr[:200]})",
        )

    try:
        data = json.loads(m.group())
    except json.JSONDecodeError as exc:
        return AgentResult(
            name=agent_name, score=50,
            critical=[], high=[], medium=[], low=[],
            error=f"JSON parse error: {exc}",
        )

    raw_score = data.get("score", 50)
    try:
        score = max(0, min(100, int(raw_score)))
    except (TypeError, ValueError):
        score = 50

    def _items(key: str) -> list[str]:
        raw = data.get(key, [])
        if not isinstance(raw, list):
            return []
        return [str(i).strip() for i in raw if str(i).strip()][:4]

    return AgentResult(
        name=agent_name,
        score=score,
        critical=_items("critical"),
        high=_items("high"),
        medium=_items("medium"),
        low=_items("low"),
        error=None,
    )


# ── Agent configs ─────────────────────────────────────────────────────────────

_AGENT_CONFIGS = [
    {
        "name": "code_quality",
        "role": "senior code reviewer",
        "focus": "code structure, naming conventions, error handling patterns, dead code, function complexity, and code smells",
        "tag": "CODE",
    },
    {
        "name": "test_coverage",
        "role": "QA engineer",
        "focus": "which critical code paths lack tests, test quality and isolation, missing edge cases, and overall coverage gaps",
        "tag": "TESTS",
    },
    {
        "name": "security",
        "role": "security auditor",
        "focus": "security vulnerabilities including injection, authentication/authorization issues, hardcoded secrets, insecure defaults, and OWASP top 10 risks",
        "tag": "SECURITY",
    },
    {
        "name": "architecture",
        "role": "software architect",
        "focus": "module design, separation of concerns, coupling between components, data flow clarity, and architectural anti-patterns",
        "tag": "ARCH",
    },
    {
        "name": "ui_ux",
        "role": "UX engineer",
        "focus": "user experience patterns, component design, error feedback, loading states, accessibility, and interaction design quality",
        "tag": "UI",
    },
    {
        "name": "documentation",
        "role": "technical writer",
        "focus": "README completeness and accuracy vs actual code, missing sections, setup instruction correctness, and whether the README sells the project",
        "tag": "DOCS",
    },
]

_AGENT_TAG = {cfg["name"]: cfg["tag"] for cfg in _AGENT_CONFIGS}


# ── Main entry points ────────────────────────────────────────────────────────

def deep_evaluate(project_dir: Path) -> DeepEvaluation:
    """Run all agents in parallel and return a DeepEvaluation."""
    project_name = project_dir.name
    has_frontend = _has_frontend_files(project_dir)

    # Build (code, agent_name) pairs
    tasks: list[tuple[str, str]] = []

    for cfg in _AGENT_CONFIGS:
        name = cfg["name"]
        role = cfg["role"]
        focus = cfg["focus"]

        if name == "ui_ux" and not has_frontend:
            continue

        if name == "code_quality":
            code = _collect_for_code_quality(project_dir)
        elif name == "test_coverage":
            code = _collect_for_tests(project_dir)
        elif name == "security":
            code = _collect_files(project_dir, _ALL_CODE_EXTS)
        elif name == "architecture":
            code = _collect_files(project_dir, _ALL_CODE_EXTS)
        elif name == "ui_ux":
            code = _collect_files(project_dir, _FRONTEND_EXTS)
        elif name == "documentation":
            code = _collect_for_docs(project_dir)
        else:
            code = _collect_files(project_dir, _ALL_CODE_EXTS)

        if not code.strip():
            code = "(no source files found)"

        prompt = _AGENT_PROMPT_TEMPLATE.format(
            role=role,
            project_name=project_name,
            focus=focus,
            code=code,
        )
        tasks.append((name, prompt))

    results: list[AgentResult] = []

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(_run_agent, name, prompt, project_dir): name
            for name, prompt in tasks
        }
        for future in as_completed(futures):
            results.append(future.result())

    # Sort deterministically
    name_order = [cfg["name"] for cfg in _AGENT_CONFIGS]
    results.sort(key=lambda r: name_order.index(r.name) if r.name in name_order else 99)

    # Composite score: exclude errored agents from mean
    valid_scores = [r.score for r in results if r.error is None]
    if valid_scores:
        composite = int(round(sum(valid_scores) / len(valid_scores)))
    elif results:
        composite = int(round(sum(r.score for r in results) / len(results)))
    else:
        composite = 50

    return DeepEvaluation(
        project=project_name,
        composite_score=composite,
        agents=results,
        generated_at=datetime.now(tz=timezone.utc).isoformat(),
    )


def write_improvements_md(project_dir: Path, deep_eval: DeepEvaluation) -> None:
    """Write improvements.md to the project directory."""
    project_name = deep_eval.project
    score = deep_eval.composite_score
    date_str = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")

    # Aggregate findings by level across all agents
    critical: list[str] = []
    high: list[str] = []
    medium: list[str] = []
    low: list[str] = []

    for agent in deep_eval.agents:
        tag = _AGENT_TAG.get(agent.name, agent.name.upper())
        for item in agent.critical:
            critical.append(f"- [ ] **[{tag}]** {item}")
        for item in agent.high:
            high.append(f"- [ ] **[{tag}]** {item}")
        for item in agent.medium:
            medium.append(f"- [ ] **[{tag}]** {item}")
        for item in agent.low:
            low.append(f"- [ ] **[{tag}]** {item}")

    def _section(items: list[str]) -> str:
        return "\n".join(items) if items else "_None identified._"

    # Agent scores table
    rows = "\n".join(
        f"| {agent.name} | {agent.score} |"
        for agent in deep_eval.agents
    )

    content = f"""\
# Improvement Spec — {project_name}
Generated: {date_str} · Composite score: {score}/100

> Implement improvements from Critical → Low priority.
> Mark each complete with [x] and commit after each priority block.

## Critical — Fix immediately
{_section(critical)}

## High — Fix before next publish
{_section(high)}

## Medium — Quality improvements
{_section(medium)}

## Low — Polish
{_section(low)}

## Agent scores
| Agent | Score |
|-------|-------|
{rows}

**Composite: {score}/100**
"""

    try:
        (project_dir / "improvements.md").write_text(content, encoding="utf-8")
    except OSError:
        pass
