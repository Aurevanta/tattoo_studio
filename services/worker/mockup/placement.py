"""Coverage resolution (ADR-0008).

A request naming a whole body zone is a statement about the body, so it is resolved in
millimetres from reference anatomy and the projection follows from those millimetres. The
nudge controls remain visual-only and never touch the brief.
"""

from __future__ import annotations

import difflib
import io
import math
import re
import unicodedata
from dataclasses import dataclass
from typing import Any

from PIL import Image

from mockup.anatomy import ZONE_SPAN_MM

# Generated backgrounds are prompted for skin filling the central ~80% of the frame
# (generation/studio.py). This is that framing, not a measurement of the photograph.
SKIN_FRAME_FRACTION = 0.82
# Hard limit so the design cannot run off the image; unrelated to where the body is.
FRAME_LIMIT = 0.94
# Fallback vertical span for a zone with no reference entry.
DEFAULT_SPAN_MM = 400.0

_VERB = r"(?:ocup\w*|cubr\w*|rellen\w*|abarc\w*|coj\w*|cog\w*|llen\w*|tap\w*|pill\w*|extend\w*)"
_ALL = r"(?:tod[oa]s?|enter[oa]s?|enterit[oa]s?|complet[oa]s?|al completo)"
_SPAN = r"de (?:arriba (?:a )?abajo|abajo (?:a )?arriba)"
_ZONE = (
    r"(?:gemelos?|pantorrillas?|espinillas?|antebrazos?|brazos?|muslos?|piernas?|espaldas?|"
    r"pechos?|costillas?|hombros?|cuellos?|manos?|pies?|pie|tobillos?|munecas?|caderas?|"
    r"barrigas?|estomagos?|tripas?|columnas?|esternones?|esternon|claviculas?|zonas?|"
    r"superficies?|areas?)"
)
_JOINT = r"(?:rodillas?|tobillos?|munecas?|codos?|hombros?|caderas?|ingles?|ingle)"
_JOINT_TO_JOINT = rf"\bde (?:l[ao] )?{_JOINT}\s+(?:a|al|hasta)\s+(?:l[ao] )?{_JOINT}\b"
_NEGATED = r"\bno\s+(?:l[oa] )?(?:quiero|me\s+gusta|hace\s+falta|es\s+necesario|deseo)"
_ARTWORK_CHANGE = (
    r"\b(?:anad\w*|agreg\w*|quit\w*|elimin\w*|sustitu\w*|reemplaz\w*|cambi\w*|"
    r"escudo|virgen|senyera|color\w*|flor\w*|leon|lobo|rosa\w*|calaver\w*)\b"
)
# A figure drawn whole or in part ("de cuerpo entero", "con las piernas") describes the artwork,
# not the client's zone. Its quantifier and limb nouns must not read as a whole-zone request:
# "Son Goku entero, con las piernas" asked for a redraw and was refused as a print-size change.
_LIMB = r"(?:piernas?|pies?|brazos?|manos?)"
_FIGURE = (
    r"\b(?:(?:de )?(?:medio )?cuerpo (?:enter|complet)\w*|medio cuerpo|"
    r"de (?:los )?pies a (?:la )?cabeza|de (?:la )?cabeza a (?:los )?pies|"
    rf"(?:con|sin) (?:l[ao]s |sus )?{_LIMB}(?:,? (?:y|e) (?:l[ao]s |sus )?{_LIMB})*|"
    rf"se (?:le )?vean? (?:l[ao]s |sus )?{_LIMB}|"
    r"(?:salga|aparezca|se vea|este|dibujad[oa]|dibuj[ae]l[oa]|pintad[oa]) enter[oa])\b"
)
_NUDGE = (
    r"(?:haz(?:l[oa])? |(?:l[oa] )?quiero (?:el tatuaje )?)?(?:el tatuaje )?"
    r"(?:un poco |mucho )?mas (grande|pequeno)"
)


@dataclass(frozen=True)
class Coverage:
    """A resolved coverage request. `full` is a zone request and resizes the brief."""

    kind: str  # "full" | "larger" | "smaller" | "manual"
    placement_only: bool

    @property
    def resizes_zone(self) -> bool:
        """Whole-zone requests resolve in millimetres from reference anatomy (ADR-0008)."""
        return self.kind == "full"

    @property
    def nudges(self) -> bool:
        """«Más grande» / «Más pequeño»: a fixed step of the print size (ADR-0043)."""
        return self.kind in NUDGE_STEP


#: ADR-0043: a nudge resizes the print by this step, keeping the proportions. The two are inverse,
#: so one undoes the other up to rounding. The browser uses the same values (`lib/size-step.ts`).
NUDGE_STEP = {"larger": 1.25, "smaller": 0.8}
CALIBRATED_NUDGE = "La foto está calibrada: cambia las medidas físicas para ampliar el tatuaje."
MIN_MM, MAX_MM = 5, 600


def nudged_size(size: dict[str, float], kind: str) -> dict[str, float]:
    """The print size after a nudge, in whole millimetres, rounding half up as the browser does."""
    step = NUDGE_STEP[kind]
    width = math.floor(size["widthMm"] * step + 0.5)
    height = math.floor(size["heightMm"] * step + 0.5)
    if min(width, height) < MIN_MM or max(width, height) > MAX_MM:
        raise ValueError(SIZE_LIMIT)
    return {"widthMm": width, "heightMm": height}


def _fold(text: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", text.lower()) if unicodedata.category(c) != "Mn"
    ).strip(" .!¡?¿")


_ZONE_WORDS = tuple(
    form
    for alternative in _ZONE[3:-1].split("|")
    for form in (
        (alternative[:-2], alternative[:-2] + "s") if alternative.endswith("s?") else (alternative,)
    )
)
# "que ocupe todo el <cualquier cosa>": the verb and the quantifier already carry the intent,
# whatever noun (or misspelling of one) follows. TASK-0035: "que ocupe todo el gemlo" was read
# as an artwork edit and the tattoo stayed the same size.
_VERB_ALL_NOUN = rf"\b{_VERB}\b.*\b{_ALL}\s+(?:el|la|los|las|mi|mis|su|sus)\s+(\w+)"


def _zone_word(folded: str) -> bool:
    """A body-zone noun, tolerating a one-letter slip ("gemlo", "atebrazo")."""
    if re.search(rf"\b{_ZONE}\b", folded):
        return True
    words = re.findall(r"[a-z]{5,}", folded)
    return any(difflib.get_close_matches(w, _ZONE_WORDS, n=1, cutoff=0.8) for w in words)


def whole_zone_intent(text: str) -> bool:
    """True when the sentence asks for a body zone to be covered end to end.

    The Spanish noun is deliberately not mapped onto the `bodyPart` enum: the brief already
    declares the body part, and guessing whether "pierna" means calf or thigh would invent an
    answer the brief holds (ADR-0008).
    """
    folded = _fold(text)
    if re.search(_NEGATED, folded):
        return False
    quantified = re.search(rf"\b{_ALL}\b", folded) or re.search(_SPAN, folded)
    if quantified and _zone_word(folded):
        return True
    if re.search(rf"\b{_VERB}\b", folded) and re.search(_SPAN, folded):
        return True
    target = re.search(_VERB_ALL_NOUN, folded)
    if target and not re.search(_ARTWORK_CHANGE, target[1]):
        return True
    return bool(re.search(_JOINT_TO_JOINT, folded))


def coverage_request(edit: dict[str, Any]) -> Coverage | None:
    if edit.get("placement"):
        # TASK-0107: a placement chosen in the live editor; it moves the design, never redraws it.
        return Coverage("manual", True)
    explicit = edit.get("coverage")
    if explicit:
        # The fill-zone control is an explicit whole-zone request, like the phrase.
        return Coverage(str(explicit), edit.get("mode") == "placement")
    folded = _fold(edit["instruction"])
    # The figure's own body is judged apart: what remains decides whether a zone is asked for.
    figure = re.search(_FIGURE, folded)
    if whole_zone_intent(re.sub(_FIGURE, " ", folded)):
        # A mixed request keeps the artwork edit but still applies whole-zone coverage.
        return Coverage("full", not (figure or re.search(_ARTWORK_CHANGE, folded)))
    nudge = re.fullmatch(_NUDGE, folded)
    if nudge:
        return Coverage("larger" if nudge[1] == "grande" else "smaller", True)
    return None


def _span_height_mm(body_part: str | None) -> float:
    if body_part in ZONE_SPAN_MM:
        return ZONE_SPAN_MM[body_part][1]
    return DEFAULT_SPAN_MM


def fit_coverage(
    background: bytes,
    size: dict[str, float],
    coverage: str,
    previous: dict[str, Any] | None = None,
    *,
    body_part: str | None = None,
) -> dict[str, float]:
    """Project a physical size onto the frame.

    For `auto` and `full` the projection is a function of the millimetres alone: a zone request
    differs from `auto` because the caller has already resized the brief, not because a ceiling
    was raised. Nudges scale the previous projection by the step their millimetres were scaled by
    (ADR-0043), so the picture and the print change together.
    """
    if previous and previous.get("photoWidthMm"):
        raise ValueError(CALIBRATED_NUDGE)
    with Image.open(io.BytesIO(background)) as photo:
        aspect = photo.height / photo.width
    ratio = size["heightMm"] / size["widthMm"]
    maximum = min(FRAME_LIMIT, FRAME_LIMIT * aspect / ratio)
    if coverage in ("auto", "full"):
        # Illustrative: the fraction of the frame the zone is assumed to occupy, scaled by how
        # much of that zone the design actually claims. Not measured body segmentation.
        occupancy = min(1.0, size["heightMm"] / _span_height_mm(body_part))
        width = min(maximum, max(0.12, SKIN_FRAME_FRACTION * occupancy * aspect / ratio))
    else:
        old = (previous or {}).get("width", 0.36)
        width = min(maximum, old * NUDGE_STEP[coverage])
    height = width * ratio / aspect
    return {"x": (1 - width) / 2, "y": (1 - height) / 2, "width": width}


#: TASK-0107 (ADR-0036): how far a design's width-to-height ratio may move from the drawing.
MIN_STRETCH, MAX_STRETCH = 0.75, 1.25
#: Below this relative change a size or a ratio counts as unchanged (rounding in the browser).
UNCHANGED = 0.005
STRETCH_LIMIT = "Ensanchar o alargar puede cambiar las proporciones del dibujo un 25 % como máximo."
CALIBRATED_SIZE = (
    "La foto está calibrada: el tamaño es tu medida. Aquí solo puedes mover y girar el diseño."
)
SIZE_LIMIT = "El tamaño queda fuera de lo que se puede tatuar (de 5 a 600 mm)."


@dataclass(frozen=True)
class ManualLayout:
    """What a placement chosen in the live editor means in millimetres (TASK-0107)."""

    placement: dict[str, float]
    #: Factors on each axis against the parent's projection.
    sx: float
    sy: float
    #: Accumulated against the drawing as generated; 1 is undeformed.
    stretch: float

    @property
    def resizes(self) -> bool:
        return abs(self.sx - 1) > UNCHANGED or abs(self.sy - 1) > UNCHANGED

    @property
    def stretches(self) -> bool:
        return abs(self.sx / self.sy - 1) > UNCHANGED

    def size(self, width_mm: float, height_mm: float) -> dict[str, float]:
        size = {"widthMm": round(width_mm * self.sx, 1), "heightMm": round(height_mm * self.sy, 1)}
        if not all(5 <= value <= 600 for value in size.values()):
            raise ValueError(SIZE_LIMIT)
        return size


def convention_frame(body_part: str | None, aspect: float) -> dict[str, Any]:
    """The framing a plate without a calibration is assumed to have (TASK-0120, ADR-0042).

    The zone's reference height is `SKIN_FRAME_FRACTION` of the picture, centred: what every plate
    was assumed to show before plates were calibrated, and still right for a plate framed tightly
    on a small zone. ``aspect`` is the picture's width over its height.
    """
    height_mm = _span_height_mm(body_part) / SKIN_FRAME_FRACTION
    return {
        "widthMm": round(height_mm * aspect, 1),
        "heightMm": round(height_mm, 1),
        "centreX": 0.5,
        "centreY": 0.5,
        "calibrated": False,
    }


def frame_placement(
    skin: dict[str, Any],
    visible_mm: dict[str, float],
    centre: tuple[float, float] | None = None,
    angle: float = 0.0,
) -> dict[str, float]:
    """A design's visible artwork at its millimetres on a plate, as a live-editor placement.

    ``skin`` is the plate's frame in millimetres (`PlateLibrary.frame` or `convention_frame`).
    Centred on the zone unless ``centre`` (fractions of the picture) is given. The 3D views read
    the same millimetres on the reference body, so the two agree by construction (ADR-0042).
    """
    x, y = centre if centre is not None else (skin["centreX"], skin["centreY"])
    return {
        "centreX": round(float(x), 4),
        "centreY": round(float(y), 4),
        "width": round(visible_mm["widthMm"] / skin["widthMm"], 4),
        "height": round(visible_mm["heightMm"] / skin["heightMm"], 4),
        "angle": round(float(angle), 4),
    }


def parent_placement(
    transform: dict[str, Any],
    frame: tuple[int, int],
    visible: tuple[int, int, int, int, int, int] | None = None,
    *,
    size: dict[str, float] | None = None,
    skin: dict[str, Any] | None = None,
) -> dict[str, float]:
    """The placement of a result's visible artwork, as the live editor starts from it.

    TASK-0120 (ADR-0042): on a plate with a known frame (``skin``) the size comes from the
    result's millimetres, not from its pixel box, so a design composed before plates were
    calibrated starts at its printed size, where the 3D view shows it; its centre and turn are
    read from the result as before. The browser starts from the same (`lib/mockup-editor.ts`).
    """
    start = _pixel_placement(transform, frame, visible)
    if skin is None or size is None or visible is None or transform.get("scaleCalibrated"):
        return start
    _, _, width, height, _, _ = visible
    visible_mm = {"widthMm": size["heightMm"] * width / height, "heightMm": size["heightMm"]}
    return frame_placement(skin, visible_mm, (start["centreX"], start["centreY"]), start["angle"])


def _pixel_placement(
    transform: dict[str, Any],
    frame: tuple[int, int],
    visible: tuple[int, int, int, int, int, int] | None = None,
) -> dict[str, float]:
    """The placement of the visible artwork in a result, as the live editor starts from it.

    A result saved from the editor records it. Any other is read from its pixel box, which is
    unrotated and unclipped for those (`lib/mockup-editor.ts` reads it the same way). A box drawn
    from the whole canvas, white margins included, is narrowed to the visible artwork, which is
    what a manual placement draws: ``visible`` is (left, top, width, height) of the artwork inside
    a canvas of (width, height), as `visible_artwork` finds it.
    """
    if transform.get("placement"):
        return dict(transform["placement"])
    width, height = frame
    x, y, w, h = (transform[k] for k in ("xPx", "yPx", "widthPx", "heightPx"))
    if visible is not None and not transform.get("sourceCropPx"):
        left, top, cw, ch, canvas_w, canvas_h = visible
        x, y = x + w * left / canvas_w, y + h * top / canvas_h
        w, h = w * cw / canvas_w, h * ch / canvas_h
    return {
        "centreX": (x + w / 2) / width,
        "centreY": (y + h / 2) / height,
        "width": w / width,
        "height": h / height,
        "angle": 0.0,
    }


def manual_layout(
    transform: dict[str, Any],
    frame: tuple[int, int],
    chosen: dict[str, float],
    visible: tuple[int, int, int, int, int, int] | None = None,
    *,
    size: dict[str, float] | None = None,
    skin: dict[str, Any] | None = None,
) -> ManualLayout:
    """Scale factors and the accumulated stretch of a chosen placement (ADR-0036).

    The millimetres follow the view proportionally on each axis, derived here and never taken
    from the client. A calibrated photo keeps its scale: only position and angle may change.
    On a plate with a known frame the start is the printed size (TASK-0120).
    """
    before = parent_placement(transform, frame, visible, size=size, skin=skin)
    sx, sy = chosen["width"] / before["width"], chosen["height"] / before["height"]
    if transform.get("scaleCalibrated") and max(abs(sx - 1), abs(sy - 1)) > UNCHANGED:
        raise ValueError(CALIBRATED_SIZE)
    stretch = float(transform.get("stretch", 1.0)) * sx / sy
    if not MIN_STRETCH - 1e-3 <= stretch <= MAX_STRETCH + 1e-3:
        raise ValueError(STRETCH_LIMIT)
    return ManualLayout(dict(chosen), sx, sy, round(min(MAX_STRETCH, max(MIN_STRETCH, stretch)), 4))
