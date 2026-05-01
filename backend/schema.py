"""Pydantic models for `.claude-progress/state.json`.

Schema v2 (current):
    Card = a requirement-level item containing:
      - subtasks[]    fine-grained checkable steps (with body + within-card deps)
      - references[]  reading material / links / docs needed to complete the card
      - findings[]    accumulating research notes ("read X doc → conclusion Y",
                      "explored code → discovered Z") — separate from `body`
                      which describes the requirement itself
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


Status = Literal["pending", "in_progress", "completed"]
SCHEMA_VERSION = 2


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def gen_card_id() -> str:
    return f"c_{uuid4().hex[:10]}"


def gen_subtask_id() -> str:
    return f"s_{uuid4().hex[:10]}"


def gen_reference_id() -> str:
    return f"r_{uuid4().hex[:10]}"


def gen_finding_id() -> str:
    return f"f_{uuid4().hex[:10]}"


# Backwards-compatible alias
gen_id = gen_card_id


class Reference(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=gen_reference_id)
    title: str
    url: str = ""
    note: str = ""


class Finding(BaseModel):
    """Accumulating research/exploration note attached to a card."""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=gen_finding_id)
    title: str = ""           # optional one-line summary
    body: str                 # markdown content (the actual finding)
    createdAt: datetime = Field(default_factory=utcnow)
    updatedAt: datetime = Field(default_factory=utcnow)


class Subtask(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=gen_subtask_id)
    title: str
    done: bool = False
    body: str = ""
    # Subtask-level dependencies. blockedBy holds sibling subtask ids; `blocks`
    # is derived (computed on read) so we don't store it.
    blockedBy: list[str] = Field(default_factory=list)
    createdAt: datetime = Field(default_factory=utcnow)
    updatedAt: datetime = Field(default_factory=utcnow)


class Card(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=gen_card_id)
    status: Status = "pending"
    blocked: bool = False
    title: str
    body: str = ""
    section: str = ""
    tags: list[str] = Field(default_factory=list)
    priority: int | None = None
    subtasks: list[Subtask] = Field(default_factory=list)
    references: list[Reference] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)
    createdAt: datetime = Field(default_factory=utcnow)
    updatedAt: datetime = Field(default_factory=utcnow)

    def find_subtask(self, sub_id: str) -> Subtask | None:
        for s in self.subtasks:
            if s.id == sub_id:
                return s
        return None

    def find_reference(self, ref_id: str) -> Reference | None:
        for r in self.references:
            if r.id == ref_id:
                return r
        return None

    def find_finding(self, fid: str) -> Finding | None:
        for f in self.findings:
            if f.id == fid:
                return f
        return None


class ProgressState(BaseModel):
    model_config = ConfigDict(extra="ignore")

    schemaVersion: int = SCHEMA_VERSION
    project: str = ""
    updatedAt: datetime = Field(default_factory=utcnow)
    cards: list[Card] = Field(default_factory=list)

    def find(self, card_id: str) -> Card | None:
        for c in self.cards:
            if c.id == card_id:
                return c
        return None
