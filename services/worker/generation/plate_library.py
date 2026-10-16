"""The skin plate library (TASK-0060, ADR-0027).

A generated plate is a blank, clothed photograph of one zone of a man's or a woman's body. It used
to be generated for every design: a paid call, a wait, and a refusal from the image provider's
safety system now and then (TASK-0059). The same 26 zones and two bodies recur, so each plate is
generated once, reviewed by a person, and committed here, like the style catalogue (ADR-0012).

Plates show the right side. A left-side design gets the same photograph mirrored. A brief that
names no body gets one of the two, chosen from its id, so every version of a design sits on the
same body.

This lives in ``generation`` because building the library makes outbound model calls (ARCH-INV-001).
Reading it makes none. ``app.build_plate_library`` is the runner.
"""

from __future__ import annotations

import hashlib
import io
import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

from generation.studio import ZONE_VIEWS

#: Where the reviewed plates are committed.
PLATES = Path(__file__).resolve().parent / "plates"
BODIES = ("masculine", "feminine")
#: Zones photographed from the front or back along the body's centre line: no side to name.
CENTRED = {"chest", "sternum", "stomach", "upper_back", "lower_back", "spine"}
WEBP_QUALITY = 88


def plate_body(brief: dict[str, Any]) -> str:
    """The body a generated plate shows: the brief's, or one of the two when it names none.

    The same for every version of a design. TASK-0110: the 3D views and a sleeve's stencil use
    the same body, so the skin, the limb and the stencil agree.
    """
    body = (brief.get("placement") or {}).get("bodyType")
    if body in BODIES:
        return str(body)
    # No body named: one of the two, the same for every version of this design.
    digest = hashlib.sha256(str(brief.get("briefId", "")).encode()).digest()
    return BODIES[digest[0] % 2]


@dataclass(frozen=True)
class Plate:
    zone: str
    body: str

    @property
    def filename(self) -> str:
        return f"{self.zone}-{self.body}.webp"

    def brief(self) -> dict[str, Any]:
        """The brief the plate is generated for: the right side, or the centre line."""
        side = "centre" if self.zone in CENTRED else "right"
        return {"placement": {"bodyPart": self.zone, "side": side, "bodyType": self.body}}


def planned(zones: list[str] | None = None, bodies: list[str] | None = None) -> list[Plate]:
    chosen = zones or list(ZONE_VIEWS)
    unknown = sorted(set(chosen) - set(ZONE_VIEWS))
    if unknown:
        raise SystemExit(f"unknown zone(s) {', '.join(unknown)}; known: {', '.join(ZONE_VIEWS)}")
    return [Plate(zone, body) for zone in chosen for body in BODIES if not bodies or body in bodies]


class PlateLibrary:
    """Reads committed plates. Makes no call and never raises for a missing one."""

    def __init__(self, directory: Path = PLATES) -> None:
        self.directory = directory
        self._calibration: dict[str, dict[str, Any]] | None = None

    def plate(self, brief: dict[str, Any]) -> bytes | None:
        placement = brief.get("placement") or {}
        zone = placement.get("bodyPart")
        if zone not in ZONE_VIEWS:
            return None
        body = plate_body(brief)
        path = self.directory / Plate(zone, body).filename
        if not path.is_file():
            return None
        with Image.open(path) as source:
            image = source.convert("RGB")
        if placement.get("side") == "left" and zone not in CENTRED:
            image = ImageOps.mirror(image)
        output = io.BytesIO()
        image.save(output, format="PNG")
        return output.getvalue()

    def frame(self, brief: dict[str, Any]) -> dict[str, Any] | None:
        """Where the zone is on the plate this brief gets, in millimetres (TASK-0120, ADR-0042).

        The picture's size in millimetres and the zone's centre as fractions of it, as
        ``calibration.json`` records them for a reviewed plate, mirrored with the plate for a
        left-side design. ``{"calibrated": False, "aspect": ...}`` for a plate the review left on
        the framing convention (the caller applies `mockup.placement.convention_frame`); None when
        the library has no plate for the brief.
        """
        placement = brief.get("placement") or {}
        zone = placement.get("bodyPart")
        if zone not in ZONE_VIEWS:
            return None
        path = self.directory / Plate(zone, plate_body(brief)).filename
        if not path.is_file():
            return None
        measured = self.calibration().get(path.stem)
        if not measured:
            with Image.open(path) as source:
                return {"calibrated": False, "aspect": source.width / source.height}
        frame: dict[str, Any] = {
            k: float(measured[k]) for k in ("widthMm", "heightMm", "centreX", "centreY")
        }
        frame["calibrated"] = True
        if placement.get("side") == "left" and zone not in CENTRED:
            frame["centreX"] = round(1 - frame["centreX"], 4)
        return frame

    def calibration(self) -> dict[str, dict[str, Any]]:
        """The reviewed calibration of the plates, read once (`app.build_plate_calibration`)."""
        if self._calibration is None:
            path = self.directory / "calibration.json"
            self._calibration = (
                json.loads(path.read_text(encoding="utf-8")).get("plates", {})
                if path.is_file()
                else {}
            )
        return self._calibration


def encode(data: bytes) -> bytes:
    with Image.open(io.BytesIO(data)) as source:
        output = io.BytesIO()
        source.convert("RGB").save(output, format="WEBP", quality=WEBP_QUALITY, method=6)
        return output.getvalue()


def build(
    background: Callable[[dict[str, Any]], bytes],
    out: Path,
    plates: list[Plate],
    *,
    force: bool = False,
    attempts: int = 4,
    pause: Callable[[float], None] = time.sleep,
    report: Callable[[str], None] = print,
) -> list[tuple[Plate, str]]:
    """Generate each plate not yet on disk; return the failures rather than stop at the first.

    `background` is the provider's own plate call, which already asks again when the safety system
    refuses (TASK-0059). A rate limit is waited out here; paid work already written is never redone.
    """
    out.mkdir(parents=True, exist_ok=True)
    todo = [plate for plate in plates if force or not (out / plate.filename).exists()]
    failures: list[tuple[Plate, str]] = []
    for index, plate in enumerate(todo, start=1):
        report(f"[{index}/{len(todo)}] {plate.zone} {plate.body} ...")
        for attempt in range(1, attempts + 1):
            try:
                data = encode(background(plate.brief()))
            except ValueError as error:
                if attempt == attempts:
                    failures.append((plate, str(error)))
                    report(f"    FAILED {plate.filename}: {error}")
                else:
                    pause(30.0)
                continue
            (out / plate.filename).write_bytes(data)
            report(f"    wrote {plate.filename}, {len(data) // 1024} KiB")
            break
    return failures
