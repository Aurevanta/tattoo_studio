"""TASK-0105 (ADR-0035): a sleeve's stencil is its skin unrolled, and that skin in four panels."""

from __future__ import annotations

import re

import pytest
from tattoo_contracts.sleeve import WRAP_REGIONS

from stencil.engine import Master, tile_grid
from stencil.sleeve import OVERLAP_MM, PANELS, export_panels_pdf, panels, unroll

LEG = WRAP_REGIONS["lower_leg"]
ARM = WRAP_REGIONS["forearm"]


def sleeve(paths: list[list[tuple[float, float]]], region=LEG) -> Master:  # type: ignore[no-untyped-def]
    return Master(paths, region.circumference_mm, region.length_mm, 0.4)


def row(y: float, region=LEG) -> list[tuple[float, float]]:  # type: ignore[no-untyped-def]
    """A stroke right across the design at depth y: once round the limb on the skin."""
    return [(0.0, y), (region.circumference_mm, y)]


@pytest.mark.parametrize("region", [LEG, ARM])
def test_each_row_unrolls_to_the_limbs_circumference_at_its_height(region) -> None:  # type: ignore[no-untyped-def]
    for y in (0.0, region.length_mm / 2, region.length_mm):
        flat = unroll(sleeve([row(y, region)], region), region)
        xs = [x for x, _ in flat.paths[0]]
        assert max(xs) - min(xs) == pytest.approx(region.circumference_at(y), abs=0.01)
        assert (max(xs) + min(xs)) / 2 == pytest.approx(region.circumference_mm / 2, abs=0.01)


def test_a_long_vertical_stroke_bends_with_the_limb() -> None:
    """A stroke a quarter turn from the centre keeps that quarter turn at every height."""
    flat = unroll(
        sleeve([[(0.75 * LEG.circumference_mm, 0.0), (0.75 * LEG.circumference_mm, 310.0)]]), LEG
    )
    for x, y in flat.paths[0]:
        assert x - LEG.circumference_mm / 2 == pytest.approx(
            0.25 * LEG.circumference_at(y), abs=0.01
        )
    assert len(flat.paths[0]) > 100  # densified, so it follows the profile


def test_four_panels_are_named_from_the_zones_own_side() -> None:
    master = sleeve([row(150.0)])
    assert [p.side for p in panels(master, LEG, "calf")] == [
        "Detrás",
        "Interior",
        "Delante",
        "Exterior",
    ]
    assert [p.side for p in panels(master, LEG, "calf", "right")] == [
        "Detrás",
        "Exterior",
        "Delante",
        "Interior",
    ]
    assert panels(master, LEG, "shin")[0].side == "Delante"
    assert panels(sleeve([row(100.0, ARM)], ARM), ARM, "outer_forearm")[0].side == "Exterior"
    assert [p.neighbours for p in panels(master, LEG, "calf")] == [(4, 2), (1, 3), (2, 4), (3, 1)]


@pytest.mark.parametrize("depth", [0.0, 80.0, 200.0, 310.0])
def test_the_panels_cover_the_whole_turn_with_overlap(depth: float) -> None:
    """Across a row, each panel takes a quarter of the circumference plus its two overlaps."""
    around = LEG.circumference_at(depth)
    quarters = panels(sleeve([row(depth)]), LEG, "calf")
    assert len(quarters) == PANELS
    for panel in quarters:
        xs = [x for path in panel.master.paths for x, _ in path]
        covered = max(xs) - min(xs)
        overlap = (covered - around / PANELS) / 2
        assert overlap >= OVERLAP_MM - 0.01
        # Centred on the panel's own centre line.
        assert (max(xs) + min(xs)) / 2 == pytest.approx(panel.master.width_mm / 2, abs=0.01)


def test_a_motif_on_a_panel_edge_appears_in_both_panels() -> None:
    edge = 0.625 * LEG.circumference_mm  # between the back (0.5) and the next panel (0.75)
    quarters = panels(sleeve([[(edge - 2, 100.0), (edge + 2, 100.0)]]), LEG, "calf")
    holding = [p.number for p in quarters if p.master.paths]
    assert holding == [1, 2]


def test_a_motif_across_the_designs_edges_reaches_the_panel_opposite_the_zone() -> None:
    """The design's left and right edges meet on the skin; panel 3 holds both of their sides."""
    width = LEG.circumference_mm
    quarters = panels(
        sleeve([[(1.0, 100.0), (5.0, 100.0)], [(width - 5, 100.0), (width - 1, 100.0)]]),
        LEG,
        "calf",
    )
    assert len(quarters[2].master.paths) == 2
    assert not quarters[0].master.paths


def test_the_guides_mark_where_the_neighbours_begin() -> None:
    panel = panels(sleeve([row(150.0)]), LEG, "calf")[0]
    left, right, centre = panel.guides
    for (xl, y), (xr, _) in zip(left, right, strict=True):
        assert xr - xl == pytest.approx(LEG.circumference_at(y) / PANELS, abs=0.01)
    assert {x for x, _ in centre} == {panel.master.width_mm / 2}
    labels = {label for _, _, label in panel.ticks}
    assert {"4·1", "2·1", "4·7", "2·7"} <= labels


def test_the_pdf_has_each_panel_at_full_size_then_in_a4_pieces() -> None:
    quarters = panels(sleeve([row(150.0), [(10.0, 10.0), (60.0, 300.0)]]), LEG, "calf")
    pdf = export_panels_pdf(quarters)
    columns, rows = tile_grid(quarters[0].master.width_mm, quarters[0].master.height_mm)
    count = re.search(rb"/Count (\d+)", pdf)
    assert count and int(count[1]) == PANELS * (1 + columns * rows)
    assert b"Panel 1 of 4: Detr" in pdf and b"Panel 4 of 4: Exterior" in pdf
    assert b"Overlaps panel 4 and panel 2" in pdf
    mirrored = export_panels_pdf(quarters, mirrored=True)
    assert mirrored != pdf


@pytest.mark.parametrize("body", ["masculine", "feminine"])
def test_a_sleeve_unrolls_to_the_named_bodys_limb(body: str) -> None:
    """TASK-0110 (ADR-0038): the stencil follows the limb the 3D view and the plate show."""
    region = LEG.for_body(body)
    y = LEG.length_mm / 3  # the calf
    flat = unroll(sleeve([row(y)]), region)
    xs = [x for x, _ in flat.paths[0]]
    assert max(xs) - min(xs) == pytest.approx(LEG.circumference_at(y, body), abs=0.01)
    assert LEG.circumference_at(y, body) != pytest.approx(LEG.circumference_at(y), abs=1)
