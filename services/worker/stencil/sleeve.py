"""A sleeve's stencil: its unrolled skin, and that skin in four panels (TASK-0105, ADR-0035).

A sleeve's design is drawn as a rectangle, its width the limb's widest circumference. On the skin
each row of it goes once round the limb at its own height, so the skin it covers is narrower where
the limb is: above the ankle a leg is about 20 cm round, at the calf 34. `unroll` lays every row at
its real circumference, centred, which is the shape the design takes on the skin, opened flat.

A leg is not a cylinder, and a whole unrolled sleeve laid round it would crease. Four panels, each
a quarter of the way round, follow it closely enough to transfer: each is centred on a side of the
limb (the zone's own side first), overlaps its neighbours by at least `OVERLAP_MM`, and carries
the lines where its neighbours begin, numbered ticks to align them and its name.

The geometry is the vector master's, moved and cut, never redrawn (ADR-0003, PROD-INV-001).
"""

from __future__ import annotations

import io
import math
from collections.abc import Callable
from dataclasses import dataclass
from itertools import pairwise

from reportlab.pdfgen import canvas
from tattoo_contracts.sleeve import WrapRegion

from stencil.engine import Master, _a4_tiles

#: Panels round a sleeve, each a quarter turn.
PANELS = 4
#: Least overlap between neighbouring panels, at the narrowest part of the limb.
OVERLAP_MM = 10.0
#: Longest step along a stroke before it is moved: a long straight stroke must bend with the limb.
STEP_MM = 2.0
#: Alignment ticks on the lines where neighbours begin, this far apart down the band.
TICK_EVERY_MM = 50.0

Path = list[tuple[float, float]]
#: Panel mm to PDF points.
Place = Callable[[float, float], tuple[float, float]]


def _densify(path: Path, step: float = STEP_MM) -> Path:
    if len(path) < 2:
        return list(path)
    out = [path[0]]
    for (x0, y0), (x1, y1) in pairwise(path):
        pieces = max(1, math.ceil(math.hypot(x1 - x0, y1 - y0) / step))
        out.extend(
            (x0 + (x1 - x0) * k / pieces, y0 + (y1 - y0) * k / pieces) for k in range(1, pieces + 1)
        )
    return out


def _depth(region: WrapRegion, master: Master, y: float) -> float:
    """How far below the band's top a row of the design lies, mm."""
    return y * region.length_mm / master.height_mm


def unroll(master: Master, region: WrapRegion) -> Master:
    """The sleeve's skin opened flat: every row at the limb's real circumference, centred."""
    width = master.width_mm

    def place(x: float, y: float) -> tuple[float, float]:
        around = region.circumference_at(_depth(region, master, y))
        return width / 2 + (x / width - 0.5) * around, y

    return Master(
        [[place(x, y) for x, y in _densify(path)] for path in master.paths],
        width,
        master.height_mm,
        master.stroke_mm,
        master.source_hash,
        master.simplification,
    )


@dataclass
class Panel:
    """One quarter of a sleeve, flat, with what the tattooer needs to place it."""

    number: int
    side: str
    master: Master
    #: The lines where the neighbouring panels begin, and the centre line, in panel mm.
    guides: list[Path]
    #: Numbered ticks on the neighbours' lines: (x, y, label).
    ticks: list[tuple[float, float, str]]
    neighbours: tuple[int, int]


def _clip(path: Path, low: float, high: float) -> list[Path]:
    """The pieces of a polyline whose x lies within [low, high], cut exactly at the bounds."""
    pieces: list[Path] = []
    current: Path = []
    for (x0, y0), (x1, y1) in pairwise(path):
        inside0 = low <= x0 <= high
        if inside0 and not current:
            current.append((x0, y0))
        crossings = []
        for bound in (low, high):
            if (x0 - bound) * (x1 - bound) < 0:
                t = (bound - x0) / (x1 - x0)
                crossings.append((t, (bound, y0 + (y1 - y0) * t)))
        for _, point in sorted(crossings):
            if current:
                current.append(point)
                pieces.append(current)
                current = []
            else:
                current = [point]
        if low <= x1 <= high:
            if not current:
                current = [(x1, y1)]
            else:
                current.append((x1, y1))
        elif current:
            pieces.append(current)
            current = []
    if len(current) > 1:
        pieces.append(current)
    return [piece for piece in pieces if len(piece) > 1]


def panels(master: Master, region: WrapRegion, zone: str, side: str = "left") -> list[Panel]:
    """The sleeve in four panels, the first centred on the zone's own side.

    A design column at fraction f of the width lies, on the skin, at `zone_around + (f - 0.5)`
    round the limb (mirrored on the right side, as the 3D view mirrors it), so each panel's name
    is the side of the limb it covers.
    """
    width, height = master.width_mm, master.height_mm
    narrowest = min(region.profile_mm)
    widest = max(region.profile_mm)
    half = 1 / (2 * PANELS)
    overlap = OVERLAP_MM / narrowest
    half_width = (half + overlap) * widest
    sign = 1.0 if side != "right" else -1.0
    zone_around = region.zone_around.get(zone, 0.0)
    dense = [_densify(path) for path in master.paths]
    out: list[Panel] = []
    for k in range(PANELS):
        centre = (0.5 + k / PANELS) % 1.0
        low, high = (centre - half - overlap) * width, (centre + half + overlap) * width
        cut: list[Path] = []
        for shift in (-width, 0.0, width):
            for path in dense:
                cut.extend(_clip([(x + shift, y) for x, y in path], low, high))

        def local(x: float, y: float, centre: float = centre) -> tuple[float, float]:
            around = region.circumference_at(_depth(region, master, y))
            return half_width + (x / width - centre) * around, y

        rows = [height * i / 60 for i in range(61)]
        guides = [[local((centre + edge) * width, y) for y in rows] for edge in (-half, half)] + [
            [(half_width, 0.0), (half_width, height)]
        ]
        previous, following = (k - 1) % PANELS + 1, (k + 1) % PANELS + 1
        ticks: list[tuple[float, float, str]] = []
        for index, y in enumerate(
            y for y in (TICK_EVERY_MM * i for i in range(int(height // TICK_EVERY_MM) + 1))
        ):
            for edge, neighbour in ((-half, previous), (half, following)):
                x, _ = local((centre + edge) * width, y)
                ticks.append((x, y, f"{neighbour}·{index + 1}"))
        label = region.side(zone_around + (centre - 0.5) * sign)
        out.append(
            Panel(
                k + 1,
                label,
                Master(
                    [[local(x, y) for x, y in path] for path in cut],
                    2 * half_width,
                    height,
                    master.stroke_mm,
                    master.source_hash,
                    master.simplification,
                ),
                guides,
                ticks,
                (previous, following),
            )
        )
    return out


def export_panels_pdf(sleeve_panels: list[Panel], mirrored: bool = False) -> bytes:
    """Each panel at 1:1 on its own page, then in A4 pieces (TASK-0088), with its guides."""
    output = io.BytesIO()
    mm = 72 / 25.4
    first = sleeve_panels[0].master
    pdf = canvas.Canvas(
        output, pagesize=(first.width_mm * mm, first.height_mm * mm), pageCompression=0
    )
    pdf.setTitle(f"InkCraft sleeve {first.source_hash or ''}".strip())
    total = len(sleeve_panels)
    for panel in sleeve_panels:
        master = panel.master
        page_w, page_h = max(master.width_mm + 20, 100), master.height_mm + 45

        def at(
            x: float, y: float, master: Master = master, page_h: float = page_h
        ) -> tuple[float, float]:
            return (10 + (master.width_mm - x if mirrored else x)) * mm, (page_h - 20 - y) * mm

        pdf.setPageSize((page_w * mm, page_h * mm))
        pdf.setFont("Helvetica-Bold", 10)
        title = f"Panel {panel.number} of {total}: {panel.side}"
        pdf.drawString(10 * mm, (page_h - 10) * mm, title)
        pdf.setFont("Helvetica", 7)
        pdf.drawString(
            10 * mm,
            (page_h - 15) * mm,
            f"Overlaps panel {panel.neighbours[0]} and panel {panel.neighbours[1]} by at least "
            f"{OVERLAP_MM:g} mm; match the numbered ticks. Top of the page: knee or elbow.",
        )
        _guides(pdf, panel, at, mm)
        pdf.setLineWidth(master.stroke_mm * mm)
        pdf.setDash()
        for points in master.paths:
            path = pdf.beginPath()
            for i, point in enumerate(points):
                (path.moveTo if i == 0 else path.lineTo)(*at(*point))
            pdf.drawPath(path, stroke=1, fill=0)
        pdf.setFont("Helvetica", 8)
        pdf.drawString(
            10 * mm,
            15 * mm,
            f"{master.width_mm:.0f} x {master.height_mm:g} mm - Print 100%, no fit",
        )
        pdf.line(10 * mm, 10 * mm, 60 * mm, 10 * mm)
        pdf.drawString(10 * mm, 5 * mm, "Calibration: 50 mm | Tattooer review required")
        pdf.showPage()
        _a4_tiles(pdf, master, mirrored)
    pdf.save()
    return output.getvalue()


def _guides(pdf: canvas.Canvas, panel: Panel, place: Place, mm: float) -> None:
    """Dashed lines where the neighbours begin, a dotted centre line, and the numbered ticks."""
    pdf.setLineWidth(0.25 * mm)
    for index, guide in enumerate(panel.guides):
        pdf.setDash([1 * mm, 1 * mm] if index == 2 else [3 * mm, 2 * mm])
        path = pdf.beginPath()
        for i, point in enumerate(guide):
            x, y = place(*point)
            (path.moveTo if i == 0 else path.lineTo)(x, y)
        pdf.drawPath(path, stroke=1, fill=0)
    pdf.setDash()
    pdf.setFont("Helvetica", 6)
    for x, y, label in panel.ticks:
        px, py = place(x, y)
        pdf.line(px - 2 * mm, py, px + 2 * mm, py)
        pdf.drawString(px + 2.5 * mm, py - 1 * mm, label)
