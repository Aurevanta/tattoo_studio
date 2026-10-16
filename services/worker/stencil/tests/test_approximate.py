"""A stencil traced from colour artwork says so on the sheet itself (TASK-0129, ADR-0044)."""

from __future__ import annotations

from tattoo_contracts.sleeve import WRAP_REGIONS

from stencil.engine import (
    APPROXIMATE_NOTE,
    Master,
    export_pdf,
    export_svg,
    rescale,
    rescale_axes,
    tile_grid,
)
from stencil.sleeve import export_panels_pdf, panels, unroll

LEG = WRAP_REGIONS["lower_leg"]
FIRST = APPROXIMATE_NOTE[0].encode()


def master(source: str | None, width: float = 80, height: float = 120) -> Master:
    return Master([[(1.0, 1.0), (width - 1, height - 1)]], width, height, 0.35, source)


def test_a_line_art_stencil_carries_no_note() -> None:
    plain = master(None)
    assert not plain.approximate
    assert FIRST not in export_pdf(plain)
    assert APPROXIMATE_NOTE[0].encode() not in export_svg(plain)


def test_a_colour_stencil_says_it_is_approximate_on_every_printed_page() -> None:
    colour = master("digest-of-the-colour-artwork", 250, 380)
    assert colour.approximate
    pdf = export_pdf(colour)
    columns, rows = tile_grid(250, 380)
    assert pdf.count(FIRST) == 1 + columns * rows
    assert pdf.count(APPROXIMATE_NOTE[1].encode()) == 1 + columns * rows
    assert FIRST in export_pdf(colour, mirrored=True)
    assert FIRST in export_svg(colour)


def test_the_note_survives_every_resize_and_a_sleeve_unrolled_in_panels() -> None:
    colour = master("digest")
    assert rescale(colour, 100, 150).approximate
    assert rescale_axes(colour, 100, 130).approximate
    sleeve = Master(
        [[(0.0, 50.0), (LEG.circumference_mm, 50.0)]],
        LEG.circumference_mm,
        LEG.length_mm,
        0.4,
        "digest",
    )
    quarters = panels(unroll(sleeve, LEG), LEG, "calf")
    assert export_panels_pdf(quarters).count(FIRST) >= len(quarters)
