"""Parse `.claude-progress/STATE.md` into kanban-style task cards.

Canonical schema (see ~/.claude/skills/project-sync/SKILL.md):
    ## 进行中           -> in_progress
    ## 待办             -> pending
    ## 已完成           -> completed
    ## 阻塞项 / 待确认  -> pending + blocked flag

Heading text is matched by keyword (not exact equality), so suffixes like
"待办（按优先级）" or alias H2s like "待办 — 专题 A" still classify correctly.
Bullets / numbered items / `### H3` under a recognised section each become a card.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict


STATUS_KEYWORDS: dict[str, tuple[str, ...]] = {
    "in_progress": ("进行中", "in progress", "doing", "正在"),
    "pending":     ("下一步", "next", "todo", "待办", "to do", "to-do"),
    "blocked":     ("阻塞", "blocked", "待确认"),
    "completed":   ("最近完成", "已完成", "completed", "done", "recently completed"),
}


def classify_heading(heading: str) -> str | None:
    h = heading.lower()
    for status, kws in STATUS_KEYWORDS.items():
        for kw in kws:
            if kw in h:
                return status
    return None


@dataclass
class Card:
    id: str
    status: str
    subject: str
    description: str = ""
    section: str = ""
    blocked: bool = False


_BULLET_RE = re.compile(r"^(\s*)(?:\d+\.|[-*])\s+(.+)$")
_BOLD_LEAD_RE = re.compile(r"^\*\*([^*]+)\*\*\s*[：:—\-]?\s*(.*)$")
_H3_RE = re.compile(r"^###\s+(.+)$")
# A bullet whose entire content is a parenthesised placeholder (留空 / empty / 暂无 ...).
# Optionally wrapped in italic underscores or bold stars.
_PLACEHOLDER_RE = re.compile(r"^[\s_*]*[（(][^()）]*[)）][\s_*]*$")


def parse_state_md(text: str) -> list[dict]:
    """Parse STATE.md content into a flat list of card dicts."""
    cards: list[Card] = []
    current_section = ""
    current_status: str | None = None
    current_card: Card | None = None
    next_id = 0

    def new_card(subject: str, description: str = "") -> Card:
        nonlocal next_id
        next_id += 1
        return Card(
            id=str(next_id),
            status="pending" if current_status == "blocked" else (current_status or "pending"),
            subject=subject.strip()[:240],
            description=description.strip(),
            section=current_section,
            blocked=(current_status == "blocked"),
        )

    for raw in text.splitlines():
        line = raw.rstrip()

        # Top-level section
        if line.startswith("## "):
            current_section = line[3:].strip()
            current_status = classify_heading(current_section)
            current_card = None
            continue

        # Sub-section under a recognised top-level section -> own card
        if current_status:
            m_h3 = _H3_RE.match(line)
            if m_h3:
                current_card = new_card(m_h3.group(1))
                cards.append(current_card)
                continue

        # Skip lines outside any kanban section
        if not current_status:
            continue

        # New bullet/numbered item -> new card
        m_item = _BULLET_RE.match(line)
        if m_item:
            content = m_item.group(2).strip()
            if _PLACEHOLDER_RE.match(content):
                current_card = None
                continue
            m_bold = _BOLD_LEAD_RE.match(content)
            if m_bold:
                subject, desc = m_bold.group(1), m_bold.group(2)
            else:
                subject, desc = content, ""
            current_card = new_card(subject, desc)
            cards.append(current_card)
            continue

        # Continuation: append to current card description
        if current_card and line.strip():
            sep = "\n" if current_card.description else ""
            current_card.description = (current_card.description + sep + line).strip()

    return [asdict(c) for c in cards]


def summarize(cards: list[dict]) -> dict:
    s = {"taskCount": len(cards), "completed": 0, "inProgress": 0, "pending": 0, "blocked": 0}
    for c in cards:
        if c["status"] == "completed":
            s["completed"] += 1
        elif c["status"] == "in_progress":
            s["inProgress"] += 1
        else:
            s["pending"] += 1
            if c.get("blocked"):
                s["blocked"] += 1
    return s
