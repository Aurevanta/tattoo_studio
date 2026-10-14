"""Reference adult anatomy (ADR-0008). Declared convention, never the user's measurements.

Each entry is the usable ink span of a body zone in millimetres: the area a tattooer would
realistically work within, not the anatomical extent of the limb. Values are deliberately
conservative — a span that is slightly small yields a tattoo that fits, a span that is slightly
large yields one that runs off the zone.

These numbers are illustrative. They are identical for every user regardless of build, which is
wrong in the individual case and honest only because it is labelled as reference anatomy. A
calibrated photograph supersedes them (TASK-0024/REQ-010).
"""

from __future__ import annotations

import json
from importlib import resources

from tattoo_contracts import sleeve

# Contract bounds from tattoo-brief.schema.json `$defs/millimetres`.
MIN_MM = 5.0
MAX_MM = 600.0

# TASK-0027: the table is no longer written here. It is shared contract data, copied
# byte-identically into the contracts package, so the consultation and the worker cannot
# resolve a size from different numbers.
_REFERENCE = json.loads(
    resources.files("tattoo_contracts.reference").joinpath("body-zones.json").read_text("utf-8")
)

#: (widthMm, heightMm) of the usable ink span, keyed by the `bodyPart` enum.
ZONE_SPAN_MM: dict[str, tuple[float, float]] = {
    zone: (float(span["widthMm"]), float(span["heightMm"]))
    for zone, span in _REFERENCE["zones"].items()
}

#: Fraction of a zone a qualitative size claims. "large" fills it, matching a whole-zone request.
SIZE_SCALES: dict[str, float] = {k: float(v) for k, v in _REFERENCE["scales"].items()}


# TASK-0104 (ADR-0034): sleeves are contract data, shared with the consultation.
WRAP_REGIONS = sleeve.WRAP_REGIONS
SLEEVE_SHARE = sleeve.SLEEVE_SHARE
WrapRegion = sleeve.WrapRegion
wrap_region = sleeve.wrap_region
is_sleeve = sleeve.is_sleeve


def zone_size(body_part: str, ink_aspect: float) -> dict[str, float]:
    """Largest size of the given aspect that fits the zone, preserving the artwork's proportions.

    `ink_aspect` is height divided by width of the *visible* artwork, so the returned size
    describes the ink rather than the master's white padding.
    """
    try:
        span_width, span_height = ZONE_SPAN_MM[body_part]
    except KeyError as error:
        raise ValueError(f"No hay anatomía de referencia para «{body_part}».") from error
    if not ink_aspect > 0:
        raise ValueError("La proporción del dibujo debe ser positiva.")
    width = min(span_width, span_height / ink_aspect)
    height = width * ink_aspect
    if width < MIN_MM or height < MIN_MM:
        # Preserving aspect would produce an unprintable dimension; the zone is the wrong shape.
        raise ValueError("El dibujo no cabe en esta zona conservando sus proporciones.")
    return {"widthMm": min(width, MAX_MM), "heightMm": min(height, MAX_MM)}
