"""Sleeves: designs that go all the way round a limb (TASK-0104, ADR-0034).

The Python twin of `wrapSize` and `isSleeve` in the TypeScript contracts, read from the same
reference anatomy (`reference/body-zones.json`, `wraps`), so the consultation and the worker
cannot disagree about what a sleeve is or how large it is.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from importlib import resources
from typing import Any

_WRAPS = json.loads(
    resources.files("tattoo_contracts.reference").joinpath("body-zones.json").read_text("utf-8")
)["wraps"]


@dataclass(frozen=True)
class WrapRegion:
    """Zones a design may wrap round as one sleeve, and its unrolled size in mm."""

    zones: tuple[str, ...]
    circumference_mm: float
    length_mm: float


WRAP_REGIONS: dict[str, WrapRegion] = {
    name: WrapRegion(
        tuple(region["zones"]), float(region["circumferenceMm"]), float(region["lengthMm"])
    )
    for name, region in _WRAPS.items()
}

#: A design this much of the way round the limb or more is a sleeve, not a band.
SLEEVE_SHARE = 0.9


def wrap_region(body_part: str) -> WrapRegion | None:
    """The sleeve region a zone belongs to, or None where a design cannot wrap."""
    return next((r for r in WRAP_REGIONS.values() if body_part in r.zones), None)


def wrap_size(body_part: str) -> dict[str, float] | None:
    """A sleeve's size on this zone, circumference by length, or None where none fits."""
    region = wrap_region(body_part)
    if region is None:
        return None
    return {"widthMm": region.circumference_mm, "heightMm": region.length_mm}


def is_sleeve(brief: dict[str, Any]) -> bool:
    """Whether a brief asks for a sleeve: wrapping, on a zone that wraps, wide enough to go round.

    A band "alrededor del tobillo" wraps too, but narrowly: it is drawn as any other design.
    """
    placement = brief.get("placement") or {}
    region = wrap_region(str(placement.get("bodyPart", "")))
    if region is None or placement.get("orientation") != "wrapping":
        return False
    width = float((brief.get("size") or {}).get("widthMm", 0))
    return width >= SLEEVE_SHARE * region.circumference_mm
