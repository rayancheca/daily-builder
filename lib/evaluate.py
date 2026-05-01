"""Post-build evaluator.

Two passes:

1. Heuristic — runs in seconds, stdlib-only, produces an objective score
   from filesystem + git signals.
2. LLM qualitative — shells out to `claude -p` using the Max subscription
   (zero incremental cost) to get a taste-based review.

Produces `evaluation.json` inside the project directory and returns the
combined result so callers can decide whether to flag the repo for a
finishing pass.
"""

from __future__ import annotations

import json
import re
import subprocess
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .deep_evaluate import DeepEvaluation
from .deep_evaluate import deep_evaluate as _deep_evaluate
from .deep_evaluate import write_improvements_md
from .paths import Config, PROMPTS_DIR
from .project_state import get_progress, get_state

_TODO_RE = re.compile(
    r"\b(TODO|FIXME|XXX|HACK|WIP)\b", re.IGNORECASE
)
_DEBUG_RE = re.compile(
    r"\b(console\.log|print\(|fmt\.Println|dbg!)",
)
_SECRET_HINTS = re.compile(
    r"(api[_-]?key|secret|password|token|bearer)\s*[:=]\s*[\"']?[A-Za-z0-9_\-]{12,}",
    re.IGNORECASE,
)
_CODE_EXTS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".go", ".c", ".cc", ".cpp",
    ".h", ".hpp", ".rb", ".java", ".kt", ".rs", ".swift", ".php",
    ".sh", ".mjs", ".cjs",
}
_SKIP_DIRS = {
    ".git", "node_modules", "dist", "build", ".next", ".cache",
    "venv", ".venv", "__pycache__", "target", ".terraform", "coverage",
    "vendor",
}


@dataclass(frozen=True)
class HeuristicResult:
    score: int
    checks: dict[str, dict[str, Any]]

    def to_dict(self) -> dict[str, Any]:
        return {"score": self.score, "checks": self.checks}


@dataclass(frozen=True)
class LLMResult:
    score: int | None
    summary: str
    strengths: list[str]
    gaps: list[str]
    deployability: str
    raw_output: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "score": self.score,
            "summary": self.summary,
            "strengths": self.strengths,
            "gaps": self.gaps,
            "deployability": self.deployability,
        }


@dataclass(frozen=True)
class Evaluation:
    project: str
    score: int
    heuristic: HeuristicResult
    llm: LLMResult | None
    needs_finishing_pass: bool
    generated_at: str
    deep: DeepEvaluation | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "project": self.project,
            "score": self.score,
            "heuristic": self.heuristic.to_dict(),
            "llm": self.llm.to_dict() if self.llm else None,
            "deep": self.deep.to_dict() if self.deep else None,
            "needs_finishing_pass": self.needs_finishing_pass,
            "generated_at": self.generated_at,
        }


def _iter_code_files(project_dir: Path, limit: int = 500) -> list[Path]:
    collected: list[Path] = []
    for entry in project_dir.rglob("*"):
        if len(collected) >= limit:
            break
        if not entry.is_file():
            continue
        if any(part in _SKIP_DIRS for part in entry.parts):
            continue
        if entry.suffix.lower() not in _CODE_EXTS:
            continue
        collected.append(entry)
    return collected


def _check_readme(project_dir: Path) -> dict[str, Any]:
    readme = next(
        (p for p in project_dir.glob("README*") if p.is_file()),
        None,
    )
    if not readme:
        return {"pass": False, "points": 0, "max": 15, "detail": "no README"}
    try:
        text = readme.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return {"pass": False, "points": 0, "max": 15, "detail": "unreadable README"}

    length = len(text)
    has_install = bool(re.search(r"##\s*(install|setup|getting\s*started|run)", text, re.IGNORECASE))
    has_usage = bool(re.search(r"##\s*(usage|example|how it works)", text, re.IGNORECASE))
    has_code_block = "```" in text

    points = 0
    if length >= 200:
        points += 5
    if length >= 800:
        points += 4
    if has_install:
        points += 3
    if has_usage:
        points += 2
    if has_code_block:
        points += 1

    return {
        "pass": points >= 10,
        "points": points,
        "max": 15,
        "detail": f"{length} chars, install={has_install}, usage={has_usage}, code_block={has_code_block}",
    }


def _check_git_activity(project_dir: Path) -> dict[str, Any]:
    state = get_state(project_dir)
    commit_count = state.commit_count
    feat_count = state.feat_commit_count

    points = 0
    if commit_count >= 1:
        points += 2
    if commit_count >= 5:
        points += 3
    if feat_count >= 3:
        points += 3
    if feat_count >= 6:
        points += 2
    if state.is_shipped:
        points += 5

    return {
        "pass": points >= 10,
        "points": min(points, 15),
        "max": 15,
        "detail": (
            f"{commit_count} commits, {feat_count} conventional, "
            f"status={state.status}"
        ),
    }


def _check_tests(project_dir: Path) -> dict[str, Any]:
    patterns = [
        "test*.py", "*_test.py", "*_test.go", "*.test.ts", "*.test.tsx",
        "*.test.js", "*.spec.ts", "*.spec.js",
    ]
    total = 0
    for pat in patterns:
        total += sum(
            1
            for p in project_dir.rglob(pat)
            if p.is_file() and not any(part in _SKIP_DIRS for part in p.parts)
        )

    test_dirs = [d for d in project_dir.rglob("tests") if d.is_dir()]
    test_dirs += [d for d in project_dir.rglob("test") if d.is_dir()]

    has_tests = total > 0 or any(
        True for d in test_dirs if list(d.rglob("*.py")) or list(d.rglob("*.go"))
    )

    points = 0
    if has_tests:
        points += 5
    if total >= 3:
        points += 3
    if total >= 10:
        points += 2

    return {
        "pass": has_tests,
        "points": min(points, 10),
        "max": 10,
        "detail": f"{total} test files found",
    }


def _check_no_stubs(project_dir: Path) -> dict[str, Any]:
    files = _iter_code_files(project_dir)
    if not files:
        return {"pass": True, "points": 10, "max": 10, "detail": "no code files"}

    todo_hits: list[str] = []
    debug_hits: list[str] = []
    for path in files:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for line_no, line in enumerate(text.splitlines(), 1):
            if _TODO_RE.search(line):
                todo_hits.append(f"{path.name}:{line_no}")
            elif _DEBUG_RE.search(line):
                debug_hits.append(f"{path.name}:{line_no}")

    todo_penalty = min(len(todo_hits), 5)
    debug_penalty = min(len(debug_hits) // 2, 3)
    points = max(0, 10 - todo_penalty - debug_penalty)

    return {
        "pass": points >= 8,
        "points": points,
        "max": 10,
        "detail": (
            f"{len(todo_hits)} TODO/FIXME, {len(debug_hits)} debug statements"
        ),
    }


def _check_secrets(project_dir: Path) -> dict[str, Any]:
    hits: list[str] = []
    for path in project_dir.rglob("*"):
        if not path.is_file():
            continue
        if any(part in _SKIP_DIRS for part in path.parts):
            continue
        if path.suffix.lower() not in _CODE_EXTS and path.name not in {
            ".env", ".env.local", ".env.production"
        }:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if path.name.startswith(".env"):
            if path.name not in {".env.example", ".env.sample"} and "=" in text:
                hits.append(f"committed .env: {path.name}")
        if _SECRET_HINTS.search(text):
            hits.append(str(path.relative_to(project_dir)))

    points = 10 if not hits else max(0, 10 - 3 * len(hits))
    return {
        "pass": not hits,
        "points": points,
        "max": 10,
        "detail": f"{len(hits)} potential secret hits" + (
            f": {hits[:3]}" if hits else ""
        ),
    }


def _check_runs(project_dir: Path) -> dict[str, Any]:
    manifests = {
        "package.json": "npm",
        "requirements.txt": "pip",
        "pyproject.toml": "pip",
        "go.mod": "go",
        "Cargo.toml": "cargo",
    }
    found = [m for m in manifests if (project_dir / m).exists()]
    if not found:
        return {
            "pass": False,
            "points": 0,
            "max": 10,
            "detail": "no recognizable manifest",
        }

    points = 7
    if (project_dir / "README.md").exists():
        try:
            text = (project_dir / "README.md").read_text(
                encoding="utf-8", errors="replace"
            )
            if re.search(r"```bash|```sh", text):
                points = 10
        except OSError:
            pass

    return {
        "pass": True,
        "points": points,
        "max": 10,
        "detail": f"manifests: {found}",
    }


def _check_state_complete(project_dir: Path) -> dict[str, Any]:
    state = get_state(project_dir)
    if state.is_shipped:
        return {"pass": True, "points": 10, "max": 10, "detail": "shipped"}
    if state.status == "building":
        return {
            "pass": False,
            "points": 3,
            "max": 10,
            "detail": "building, not yet complete",
        }
    if state.status == "stalled":
        return {
            "pass": False,
            "points": 0,
            "max": 10,
            "detail": f"stalled ({state.reason})",
        }
    return {
        "pass": False,
        "points": 0,
        "max": 10,
        "detail": f"status={state.status}",
    }


def _check_progress(project_dir: Path) -> dict[str, Any]:
    completed, total, display = get_progress(project_dir)
    if total is None:
        points = min(completed, 10)
        return {
            "pass": completed >= 5,
            "points": points,
            "max": 10,
            "detail": display,
        }
    if total == 0:
        return {"pass": False, "points": 0, "max": 10, "detail": "no plan"}
    ratio = completed / total
    points = int(round(ratio * 10))
    return {
        "pass": ratio >= 0.9,
        "points": min(points, 10),
        "max": 10,
        "detail": display,
    }


def heuristic_score(project_dir: Path) -> HeuristicResult:
    """Run all heuristic checks and return a 0–100 score."""

    checks = {
        "readme": _check_readme(project_dir),
        "git_activity": _check_git_activity(project_dir),
        "tests": _check_tests(project_dir),
        "no_stubs": _check_no_stubs(project_dir),
        "no_secrets": _check_secrets(project_dir),
        "runs": _check_runs(project_dir),
        "state_complete": _check_state_complete(project_dir),
        "progress": _check_progress(project_dir),
    }
    total = sum(c["points"] for c in checks.values())
    max_total = sum(c["max"] for c in checks.values())
    score = int(round((total / max_total) * 100)) if max_total else 0
    return HeuristicResult(score=score, checks=checks)


def _llm_prompt(project_dir: Path) -> str:
    prompt_path = PROMPTS_DIR / "evaluate.md"
    base = ""
    if prompt_path.exists():
        try:
            base = prompt_path.read_text(encoding="utf-8")
        except OSError:
            base = ""

    readme_text = ""
    readme = next(
        (p for p in project_dir.glob("README*") if p.is_file()),
        None,
    )
    if readme:
        try:
            readme_text = readme.read_text(encoding="utf-8", errors="replace")[:8000]
        except OSError:
            pass

    tree_lines: list[str] = []
    for path in sorted(project_dir.rglob("*")):
        if len(tree_lines) >= 80:
            break
        if any(part in _SKIP_DIRS for part in path.parts):
            continue
        rel = path.relative_to(project_dir)
        depth = len(rel.parts) - 1
        if depth > 2:
            continue
        prefix = "  " * depth
        tree_lines.append(f"{prefix}{rel.name}")
    tree_block = "\n".join(tree_lines)

    return (
        f"{base}\n\n---\n"
        f"## Project: {project_dir.name}\n\n"
        f"### README\n\n```\n{readme_text}\n```\n\n"
        f"### File tree (trimmed)\n\n```\n{tree_block}\n```\n"
    )


def _parse_llm_output(output: str) -> LLMResult:
    """Best-effort extraction of score + sections from the LLM response."""

    score: int | None = None
    match = re.search(r"score[^0-9]*(\d{1,3})", output, re.IGNORECASE)
    if match:
        try:
            raw = int(match.group(1))
            if 0 <= raw <= 100:
                score = raw
        except ValueError:
            pass

    def _pull(section: str) -> list[str]:
        pat = re.compile(
            rf"##\s*{section}.*?\n(.*?)(?:\n##\s|\Z)",
            re.IGNORECASE | re.DOTALL,
        )
        m = pat.search(output)
        if not m:
            return []
        items = re.findall(r"^\s*[-*]\s*(.+)$", m.group(1), flags=re.MULTILINE)
        return [i.strip() for i in items if i.strip()]

    strengths = _pull("strengths")
    gaps = _pull("gaps") or _pull("weaknesses") or _pull("issues")

    deploy_match = re.search(
        r"##\s*deployability.*?\n(.*?)(?:\n##\s|\Z)",
        output,
        re.IGNORECASE | re.DOTALL,
    )
    deployability = (
        deploy_match.group(1).strip() if deploy_match else ""
    )

    summary_match = re.search(
        r"##\s*summary.*?\n(.*?)(?:\n##\s|\Z)",
        output,
        re.IGNORECASE | re.DOTALL,
    )
    summary = summary_match.group(1).strip() if summary_match else ""

    return LLMResult(
        score=score,
        summary=summary,
        strengths=strengths,
        gaps=gaps,
        deployability=deployability,
        raw_output=output,
    )


def llm_review(project_dir: Path, timeout: int = 180) -> LLMResult | None:
    """Shell out to `claude -p` for a qualitative review. None on failure."""

    prompt = _llm_prompt(project_dir)
    try:
        result = subprocess.run(
            ["claude", "--dangerously-skip-permissions", "-p", prompt],
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(project_dir),
        )
    except (FileNotFoundError, subprocess.SubprocessError):
        return None

    if result.returncode != 0 or not result.stdout:
        return None

    return _parse_llm_output(result.stdout)


def evaluate(
    project_dir: Path,
    config: Config | None = None,
    use_llm: bool | None = None,
) -> Evaluation:
    """Run the full evaluation and write evaluation.json to the project dir."""

    cfg = config or Config.load()
    use_llm = cfg.use_llm if use_llm is None else use_llm

    heuristic = heuristic_score(project_dir)
    llm: LLMResult | None = None

    if use_llm:
        llm = llm_review(project_dir)

    deep: DeepEvaluation | None = None
    if use_llm:
        try:
            deep = _deep_evaluate(project_dir)
            write_improvements_md(project_dir, deep)
        except Exception:
            pass  # deep eval failure is non-fatal

    if deep and llm and llm.score is not None:
        score = int(round(heuristic.score * 0.2 + deep.composite_score * 0.5 + llm.score * 0.3))
    elif deep:
        score = int(round(heuristic.score * 0.3 + deep.composite_score * 0.7))
    elif llm and llm.score is not None:
        score = int(round((heuristic.score + llm.score) / 2))
    else:
        score = heuristic.score

    needs_pass = score < cfg.auto_suggest_below_score

    evaluation = Evaluation(
        project=project_dir.name,
        score=score,
        heuristic=heuristic,
        llm=llm,
        deep=deep,
        needs_finishing_pass=needs_pass,
        generated_at=datetime.now(tz=timezone.utc).isoformat(),
    )

    try:
        (project_dir / "evaluation.json").write_text(
            json.dumps(evaluation.to_dict(), indent=2) + "\n",
            encoding="utf-8",
        )
    except OSError:
        pass

    return evaluation


def record_in_history(
    project_name: str, evaluation: Evaluation, history_file: Path
) -> None:
    """Append / update the evaluation row inside project_history.md."""

    if not history_file.exists():
        return

    marker = f"\n- Evaluation score:"
    score_line = f"- Evaluation score: {evaluation.score}/100 (heuristic: {evaluation.heuristic.score})"

    try:
        content = history_file.read_text(encoding="utf-8")
    except OSError:
        return

    entry_pattern = re.compile(
        rf"(\d{{4}}-\d{{2}}-\d{{2}}\s*—\s*{re.escape(project_name)}\s*\n"
        rf"(?:[-\s].*\n){{1,15}})",
    )
    match = entry_pattern.search(content)
    if not match:
        return

    block = match.group(1)
    if "Evaluation score:" in block:
        new_block = re.sub(
            r"- Evaluation score:.*",
            score_line,
            block,
        )
    else:
        lines = block.rstrip("\n").splitlines()
        insert_idx = len(lines)
        for i, line in enumerate(lines):
            if line.lower().startswith("- github:"):
                insert_idx = i + 1
                break
        lines.insert(insert_idx, score_line)
        new_block = "\n".join(lines) + "\n"

    updated = content[: match.start()] + new_block + content[match.end() :]
    try:
        history_file.write_text(updated, encoding="utf-8")
    except OSError:
        pass
