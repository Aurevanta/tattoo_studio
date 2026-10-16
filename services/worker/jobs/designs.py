"""A design and its versions, and the name its owner gives it (TASK-0116, ADR-0041).

Every version belongs to one design: the version a fresh consultation produced is the design's
first, and a change, a re-placement, a mockup edit or a kept camera photo asked from a version
joins that version's design. The design is kept as a column (`jobs.family`, the id of its first
version) rather than recomputed from `edit.parentJobId`, because deleting one version would
otherwise cut its children off from their design.

A design's name is the client's own label. Until they set one, it is their idea, shortened.
"""

from __future__ import annotations

import json
import re
from typing import Any

#: The longest name a client may give a design.
MAX_NAME = 60
#: The longest default name, cut from the idea at a word boundary.
DEFAULT_NAME_CHARS = 48
UNTITLED = "Diseño sin título"
_SENTENCE_END = re.compile(r"[.!?;\n]")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def default_name(payload: dict[str, Any]) -> str:
    """The client's idea, shortened: its first sentence, cut at a word within 48 characters."""
    brief = payload.get("brief") or {}
    idea = str((brief.get("subject") or {}).get("description") or "")
    idea = " ".join(_SENTENCE_END.split(idea, maxsplit=1)[0].split())
    if not idea:
        return UNTITLED
    if len(idea) > DEFAULT_NAME_CHARS:
        cut = idea[: DEFAULT_NAME_CHARS + 1].rsplit(" ", 1)[0]
        # A clause ends at a comma: «…a la luna llena», rather than «…a la luna llena, con».
        clause = cut.rsplit(",", 1)[0]
        if len(clause) >= DEFAULT_NAME_CHARS // 2:
            cut = clause
        if len(cut) < DEFAULT_NAME_CHARS // 2:
            cut = idea[:DEFAULT_NAME_CHARS]
        idea = cut.rstrip(" ,:-") + "…"
    return idea[0].upper() + idea[1:]


def clean_name(value: Any) -> str:
    """A name as the client typed it, made safe to store: one line, at most 60 characters.

    An empty name is allowed and means «go back to the default».
    """
    if not isinstance(value, str):
        raise ValueError("El nombre no es válido.")
    name = " ".join(_CONTROL.sub(" ", value).split())
    if len(name) > MAX_NAME:
        raise ValueError(f"El nombre puede tener como máximo {MAX_NAME} caracteres.")
    return name


def parent_of(payload: str | None, result: str | None) -> str | None:
    """The version a version was asked from, if any: a change or a kept camera photo."""
    try:
        edit = (json.loads(payload or "{}") or {}).get("edit") or {}
        capture = (json.loads(result or "{}") or {}).get("capture") or {}
    except (ValueError, AttributeError):
        return None
    parent = edit.get("parentJobId") or capture.get("parentJobId")
    return parent if isinstance(parent, str) else None


def asset_ids(value: Any) -> set[str]:
    """Every stored file a result or a payload points at, wherever it is nested."""
    found: set[str] = set()
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "assetId" and isinstance(item, str):
                found.add(item)
            else:
                found |= asset_ids(item)
    elif isinstance(value, list):
        for item in value:
            found |= asset_ids(item)
    return found


def design_ids(result: dict[str, Any]) -> set[str]:
    """The physical designs (artwork at a size) a result shows, whose vector it may need."""
    ids = {str(result["designId"])} if result.get("designId") else set()
    return ids | {
        str(part["designId"])
        for part in result.values()
        if isinstance(part, dict) and part.get("designId")
    }


def inputs_of(payload: dict[str, Any]) -> set[str]:
    """The uploads a version was made from: its references and the client's own photo."""
    ids = {str(i) for i in payload.get("referenceIds") or []}
    if payload.get("bodyPhotoId"):
        ids.add(str(payload["bodyPhotoId"]))
    edit = payload.get("edit") or {}
    ids |= {str(i) for i in edit.get("referenceIds") or []}
    return ids


__all__ = [
    "MAX_NAME",
    "UNTITLED",
    "asset_ids",
    "clean_name",
    "default_name",
    "design_ids",
    "inputs_of",
    "parent_of",
]
