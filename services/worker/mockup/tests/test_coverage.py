"""Coverage resolution against ADR-0008 and the reference anatomy table."""

from __future__ import annotations

import io

import pytest
from PIL import Image
from tattoo_contracts.validation import schema

from mockup.anatomy import MAX_MM, MIN_MM, ZONE_SPAN_MM, zone_size
from mockup.placement import SKIN_FRAME_FRACTION, Coverage, coverage_request, fit_coverage

# The geometry the system actually asks its provider for (generation/studio.py).
BACKGROUND = (1024, 1536)


def background(size: tuple[int, int] = BACKGROUND) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, "white").save(buffer, format="PNG")
    return buffer.getvalue()


def test_every_body_part_has_a_reference_span_within_contract_bounds() -> None:
    """TASK-0024/AC-001. The enum is read from the contract, never restated here."""
    declared = set(schema("tattoo-brief")["$defs"]["bodyPart"]["enum"])
    assert declared == set(ZONE_SPAN_MM), declared.symmetric_difference(ZONE_SPAN_MM)
    for body_part, (width, height) in ZONE_SPAN_MM.items():
        assert MIN_MM <= width <= MAX_MM, body_part
        assert MIN_MM <= height <= MAX_MM, body_part


@pytest.mark.parametrize("ink_aspect", [3.0, 1.0, 1 / 3])
def test_zone_size_preserves_aspect_and_touches_a_bound(ink_aspect: float) -> None:
    """TASK-0024/AC-002."""
    span_width, span_height = ZONE_SPAN_MM["calf"]
    size = zone_size("calf", ink_aspect)
    assert size["heightMm"] / size["widthMm"] == pytest.approx(ink_aspect, rel=1e-3)
    assert size["widthMm"] <= span_width + 1e-9
    assert size["heightMm"] <= span_height + 1e-9
    touching = max(size["widthMm"] / span_width, size["heightMm"] / span_height)
    assert touching == pytest.approx(1.0)


def test_zone_size_rejects_an_unknown_zone() -> None:
    with pytest.raises(ValueError, match="anatomía de referencia"):
        zone_size("left_eyebrow", 1.0)


@pytest.mark.parametrize(
    "phrase",
    [
        "quiero que el tatuaje ocupe todo el gemelo de arriba a abajo",
        "que cubra el gemelo entero",
        "que me coja todo el gemelo",
        "de la rodilla al tobillo",
        "que ocupe toda la pierna de arriba a abajo",
        "que ocupe todo el brazo",
        "Que me llene la espalda completa",
        "rellenar el antebrazo enterito",
        # TASK-0035: the live request that was misread, a misspelt zone, and no zone noun at all.
        "que ocupe todo el gemlo",
        "que ocupe todo el atebrazo",
        "quiero que el tatuaje ocupe todo el modelo",
    ],
)
def test_whole_zone_phrases_resolve(phrase: str) -> None:
    """TASK-0024/AC-003. Five of these returned nothing before ADR-0008."""
    assert coverage_request({"instruction": phrase}) == Coverage("full", True)


@pytest.mark.parametrize(
    ("phrase", "expected"),
    [
        ("lo quiero mas grande", Coverage("larger", True)),
        ("hazlo un poco más pequeño", Coverage("smaller", True)),
        ("Haz el escudo más pequeño", None),
        ("añade una flor", None),
        ("no quiero que ocupe todo el gemelo", None),
        ("que ocupe todo el gemelo y añade un león", Coverage("full", False)),
        # TASK-0035: the looser forms must not swallow artwork edits.
        ("rellena todo de color", None),
        ("que el escudo cubra todo el lobo", None),
        ("pon todo el texto en negro", None),
        # A figure drawn whole is an artwork change, not a zone (the Son Goku request).
        ("Son Goku entero, con las piernas", None),
        ("hazlo de cuerpo entero, que se vean las piernas", None),
        ("que salga entero, con piernas y pies", None),
        ("dibujalo de pies a cabeza", None),
        ("de cuerpo completo en vez de medio cuerpo", None),
        ("que ocupe todo el gemelo y que Goku salga entero", Coverage("full", False)),
    ],
)
def test_other_instructions_keep_their_meaning(phrase: str, expected: Coverage | None) -> None:
    """TASK-0024/AC-003: a nudge stays a nudge, a negation acts on nothing."""
    assert coverage_request({"instruction": phrase}) == expected


def test_the_fill_zone_control_is_a_zone_request() -> None:
    request = coverage_request({"instruction": "Ampliar", "coverage": "full", "mode": "placement"})
    assert request is not None and request.resizes_zone
    nudge = coverage_request({"instruction": "Ampliar", "coverage": "larger", "mode": "placement"})
    assert nudge is not None and not nudge.resizes_zone


@pytest.mark.parametrize("ink_aspect", [1.0, 1.5, 2.0, 2.5, 3.0])
@pytest.mark.parametrize("height_mm", [200.0, 300.0, 360.0])
def test_a_zone_request_never_collapses_onto_auto(ink_aspect: float, height_mm: float) -> None:
    """TASK-0024/AC-010.

    Regression for the defect this task exists to fix. Before ADR-0008, `full` and `auto` shared a
    frame-fraction ceiling, so at a realistic calf size they returned an identical width and the
    request did nothing at all. The projection now follows the millimetres, and a zone request
    changes the millimetres.
    """
    photo = background()
    requested = {"widthMm": height_mm / ink_aspect, "heightMm": height_mm}
    automatic = fit_coverage(photo, requested, "auto", body_part="calf")
    whole_zone = fit_coverage(photo, zone_size("calf", ink_aspect), "full", body_part="calf")
    assert whole_zone["width"] != pytest.approx(automatic["width"])


@pytest.mark.parametrize("height_mm", [120.0, 200.0, 300.0, 360.0])
def test_a_zone_request_enlarges_a_design_the_zone_can_hold(height_mm: float) -> None:
    """A design in the zone's own proportions grows to fill it, whatever was asked for."""
    photo = background()
    span_width, span_height = ZONE_SPAN_MM["calf"]
    ink_aspect = span_height / span_width
    requested = {"widthMm": height_mm / ink_aspect, "heightMm": height_mm}
    automatic = fit_coverage(photo, requested, "auto", body_part="calf")
    whole_zone = fit_coverage(photo, zone_size("calf", ink_aspect), "full", body_part="calf")
    assert whole_zone["width"] > automatic["width"]


def test_a_zone_shrinks_a_design_it_cannot_hold() -> None:
    """A square design cannot cover a calf top to bottom; fitting it is a reduction, not a bug.

    The alternative would be distorting the artwork, which MOCKUP-INV-001 forbids.
    """
    span_width, span_height = ZONE_SPAN_MM["calf"]
    fitted = zone_size("calf", 1.0)
    assert fitted == {"widthMm": span_width, "heightMm": span_width}
    assert fitted["heightMm"] < span_height


def test_a_calibrated_photograph_refuses_visual_resizing() -> None:
    """TASK-0024/AC-009: real millimetres supersede the reference table."""
    with pytest.raises(ValueError, match="calibrada"):
        fit_coverage(
            background(),
            {"widthMm": 140.0, "heightMm": 380.0},
            "full",
            {"photoWidthMm": 400.0},
            body_part="calf",
        )


def test_coverage_never_leaves_the_frame() -> None:
    photo = background()
    for ink_aspect in (0.25, 1.0, 4.0):
        size = zone_size("calf", ink_aspect)
        placed = fit_coverage(photo, size, "full", body_part="calf")
        height = placed["width"] * (size["heightMm"] / size["widthMm"]) * 1024 / 1536
        assert placed["x"] >= 0 and placed["x"] + placed["width"] <= 1
        assert placed["y"] >= 0 and placed["y"] + height <= 1 + 1e-9


def test_a_design_claiming_half_the_zone_is_projected_at_half_the_occupancy() -> None:
    """The projection is a function of millimetres, not of which branch was taken."""
    photo = background()
    span_height = ZONE_SPAN_MM["calf"][1]
    half = {"widthMm": 70.0, "heightMm": span_height / 2}
    placed = fit_coverage(photo, half, "full", body_part="calf")
    height_fraction = placed["width"] * (half["heightMm"] / half["widthMm"]) * 1024 / 1536
    assert height_fraction == pytest.approx(SKIN_FRAME_FRACTION * 0.5, rel=1e-6)
