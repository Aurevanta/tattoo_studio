"""Sleeves: designs that go all the way round a limb (TASK-0104, ADR-0034).

The Python twin of `wrapSize` and `isSleeve` in the TypeScript contracts, read from the same
reference anatomy (`reference/body-zones.json`, `wraps`), so the consultation and the worker
cannot disagree about what a sleeve is or how large it is.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from importlib import resources
from typing import Any

_WRAPS = json.loads(
    resources.files("tattoo_contracts.reference").joinpath("body-zones.json").read_text("utf-8")
)["wraps"]


@dataclass(frozen=True)
class WrapRegion:
    """Zones a design may wrap round as one sleeve, and its unrolled size in mm.

    TASK-0105: `profile_mm` is the limb's circumference every `step_mm` down the band, from its
    top; `views` name the limb's sides as fractions round it; `zone_around` is each zone's side.
    """

    zones: tuple[str, ...]
    circumference_mm: float
    length_mm: float
    step_mm: float
    profile_mm: tuple[float, ...]
    views: tuple[tuple[float, str], ...]
    zone_around: dict[str, float]
    #: TASK-0110 (ADR-0038): the profile on the masculine and the feminine reference limbs.
    body_profiles: dict[str, tuple[float, ...]] = field(default_factory=dict)

    def circumference_at(self, depth_mm: float, body_type: str | None = None) -> float:
        """The limb's circumference `depth_mm` below the band's top, interpolated.

        On the named body's own profile; the neutral one when none is named (TASK-0110).
        """
        profile = self.body_profiles.get(body_type or "", self.profile_mm)
        position = min(max(depth_mm, 0.0), self.step_mm * (len(profile) - 1)) / self.step_mm
        index = min(int(position), len(profile) - 2)
        weight = position - index
        return profile[index] * (1 - weight) + profile[index + 1] * weight

    def for_body(self, body_type: str | None) -> WrapRegion:
        """The region on the named body: its own profile, the neutral one when none is named.

        TASK-0110 (ADR-0038). The band's length and the size a sleeve is asked at do not change.
        """
        profile = self.body_profiles.get(body_type or "")
        return replace(self, profile_mm=profile) if profile else self

    def side(self, around: float) -> str:
        """The name of the side nearest a fraction round the limb."""

        def distance(view: tuple[float, str]) -> float:
            return abs(((around - view[0] + 0.5) % 1.0) - 0.5)

        return min(self.views, key=distance)[1]


WRAP_REGIONS: dict[str, WrapRegion] = {
    name: WrapRegion(
        tuple(region["zones"]),
        float(region["circumferenceMm"]),
        float(region["lengthMm"]),
        float(region["profileStepMm"]),
        tuple(float(value) for value in region["circumferenceProfileMm"]),
        tuple((float(view["around"]), str(view["label"])) for view in region["views"]),
        {zone: float(value) for zone, value in region["zoneAround"].items()},
        {
            body: tuple(float(value) for value in profile["circumferenceProfileMm"])
            for body, profile in region.get("bodies", {}).items()
        },
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
