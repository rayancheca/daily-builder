"""Idea-diversity guard.

Stdlib-only TF-IDF cosine similarity against past projects. If a proposed
idea is too close to anything already built, caller asks the LLM to try
again.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from .paths import Config

_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9+#.-]{1,}")

_STOP_WORDS = frozenset(
    [
        "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
        "has", "have", "in", "is", "it", "its", "of", "on", "or", "that",
        "the", "this", "to", "was", "were", "will", "with", "using",
        "uses", "built", "build", "project", "tool", "system", "based",
        "simple", "real", "time",
    ]
)


@dataclass(frozen=True)
class PastProject:
    name: str
    tagline: str
    tech_stack: str
    domain: str


@dataclass(frozen=True)
class SimilarityResult:
    too_similar: bool
    max_score: float
    most_similar_name: str | None
    threshold: float


def _tokenize(text: str) -> list[str]:
    return [
        token.lower()
        for token in _TOKEN_RE.findall(text)
        if token.lower() not in _STOP_WORDS and len(token) > 1
    ]


def parse_past_projects(history_file: Path) -> list[PastProject]:
    """Parse `project_history.md` into structured past-project records."""

    if not history_file.exists():
        return []

    try:
        content = history_file.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []

    entry_pattern = re.compile(
        r"\d{4}-\d{2}-\d{2}\s*—\s*(?P<name>\S+)\s*\n"
        r"(?P<body>(?:[-\s].*\n){1,15})",
    )
    field_pattern = re.compile(r"^\s*-\s*(\w[\w ]*?):\s*(.+)$", re.MULTILINE)

    projects: list[PastProject] = []

    for block in entry_pattern.finditer(content):
        name = block.group("name").strip().rstrip(".,")
        body = block.group("body")

        fields: dict[str, str] = {}
        for match in field_pattern.finditer(body):
            key = match.group(1).strip().lower().replace(" ", "_")
            fields[key] = match.group(2).strip()

        projects.append(
            PastProject(
                name=name,
                tagline=fields.get("description", ""),
                tech_stack=fields.get("tech_stack", ""),
                domain=fields.get("domain", ""),
            )
        )

    return projects


def _compute_idf(documents: list[list[str]]) -> dict[str, float]:
    n = len(documents) or 1
    doc_freq: Counter[str] = Counter()
    for doc in documents:
        for token in set(doc):
            doc_freq[token] += 1

    return {
        token: math.log((1 + n) / (1 + df)) + 1.0
        for token, df in doc_freq.items()
    }


def _tfidf_vector(tokens: list[str], idf: dict[str, float]) -> dict[str, float]:
    tf = Counter(tokens)
    if not tf:
        return {}
    max_tf = max(tf.values())
    return {
        token: (count / max_tf) * idf.get(token, 1.0)
        for token, count in tf.items()
    }


def _cosine(a: dict[str, float], b: dict[str, float]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(a[k] * b[k] for k in a.keys() & b.keys())
    norm_a = math.sqrt(sum(v * v for v in a.values()))
    norm_b = math.sqrt(sum(v * v for v in b.values()))
    if not norm_a or not norm_b:
        return 0.0
    return dot / (norm_a * norm_b)


def _idea_text(idea: dict) -> str:
    parts = [
        str(idea.get("full_name", "")),
        str(idea.get("repo_name", "")),
        str(idea.get("tagline", "")),
        str(idea.get("problem", "")),
        " ".join(str(t) for t in idea.get("tech_stack", [])),
        " ".join(str(f) for f in idea.get("core_features", [])),
    ]
    return " ".join(p for p in parts if p)


def _past_text(project: PastProject) -> str:
    return " ".join(
        filter(None, [project.name, project.tagline, project.tech_stack])
    )


def check(
    idea: dict,
    history_file: Path,
    config: Config | None = None,
) -> SimilarityResult:
    """Check a generated idea against past projects."""

    cfg = config or Config.load()
    past = parse_past_projects(history_file)
    if not past:
        return SimilarityResult(
            too_similar=False,
            max_score=0.0,
            most_similar_name=None,
            threshold=cfg.similarity_threshold,
        )

    past_docs = [_tokenize(_past_text(p)) for p in past]
    idea_doc = _tokenize(_idea_text(idea))

    all_docs = past_docs + [idea_doc]
    idf = _compute_idf(all_docs)

    idea_vec = _tfidf_vector(idea_doc, idf)
    if not idea_vec:
        return SimilarityResult(
            too_similar=False,
            max_score=0.0,
            most_similar_name=None,
            threshold=cfg.similarity_threshold,
        )

    scored = [
        (p.name, _cosine(idea_vec, _tfidf_vector(doc, idf)))
        for p, doc in zip(past, past_docs)
    ]
    scored.sort(key=lambda x: x[1], reverse=True)

    most_similar_name, max_score = scored[0]
    return SimilarityResult(
        too_similar=max_score >= cfg.similarity_threshold,
        max_score=max_score,
        most_similar_name=most_similar_name,
        threshold=cfg.similarity_threshold,
    )
