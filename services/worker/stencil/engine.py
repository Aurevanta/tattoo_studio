"""Native line-art centerlines are the authoritative geometry for every delivery."""

from __future__ import annotations

import hashlib
import io
import json
import math
from dataclasses import dataclass
from itertools import pairwise

import numpy as np
from PIL import Image, ImageDraw
from reportlab.pdfgen import canvas
from skimage.feature import canny
from skimage.morphology import skeletonize


@dataclass
class Master:
    paths: list[list[tuple[float, float]]]
    width_mm: float
    height_mm: float
    stroke_mm: float
    source_hash: str | None = None
    #: TASK-0086 (audit ARQ-03): how many coarser passes the trace needed (0 = full detail).
    #: Reported to the client; not part of the design's identity.
    simplification: int = 0

    @property
    def design_hash(self) -> str:
        identity = {k: v for k, v in self.__dict__.items() if k != "simplification"}
        return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()


#: A skeleton with more points than this is not traced: too slow and too dense to transfer.
MAX_TRACE_POINTS = 180_000
TOO_COMPLEX = "Line-art demasiado complejo para un stencil fiable."
#: TASK-0071: a detailed design is traced again at coarser detail before giving up. A realistic
#: colour piece failed a whole paid generation at the first, finest pass.
LINEART_SIZES = (1536, 1152, 864, 640)
COLOUR_PASSES = ((1536, 1.2), (1536, 2.0), (1152, 2.5), (864, 3.0))


class _TooComplexError(ValueError):
    """This pass has too many points; a coarser one may not."""


def trace_native_lineart(
    data: bytes, width_mm: float, height_mm: float, stroke_mm: float = 0.3
) -> Master:
    """Threshold only the dedicated flat native line-art pass, never a shaded render."""
    with Image.open(io.BytesIO(data)) as image:
        gray = image.convert("L")
    for level, size in enumerate(LINEART_SIZES):
        pass_image = gray.copy()
        pass_image.thumbnail((size, size))
        ink = np.asarray(pass_image) < 128
        fraction = float(ink.mean())
        if not 0.001 < fraction < 0.35:
            raise ValueError("El proveedor no produjo line-art limpio. Reintenta con otro diseño.")
        try:
            traced = _trace_mask(ink, width_mm, height_mm, stroke_mm)
        except _TooComplexError:
            continue
        traced.simplification = level
        return traced
    raise ValueError(TOO_COMPLEX)


def trace_colour_artwork(
    data: bytes, width_mm: float, height_mm: float, stroke_mm: float = 0.3
) -> tuple[Master, Image.Image]:
    """Derive review contours from the sole flat artwork, never from skin.

    RGB boundaries retain isoluminant colour transitions. The result is an
    approximation for tattooer review, not guaranteed semantic line selection.
    """
    with Image.open(io.BytesIO(data)) as source:
        original = source.convert("RGB")
    artwork = original.copy()
    artwork.thumbnail((1536, 1536))
    master: Master | None = None
    # TASK-0071: smoother edges, then a smaller image, until the contours can be traced.
    for level, (size, sigma) in enumerate(COLOUR_PASSES):
        pass_image = original.copy()
        pass_image.thumbnail((size, size))
        rgb = np.asarray(pass_image, dtype=np.float64) / 255
        edges = np.zeros(rgb.shape[:2], dtype=bool)
        for channel in range(3):
            edges |= canny(  # type: ignore[no-untyped-call]
                rgb[:, :, channel], sigma=sigma, low_threshold=0.08, high_threshold=0.2
            )
        if not 0.001 < float(edges.mean()) < 0.35:
            raise ValueError("No se pueden extraer contornos suficientes del diseño a color.")
        try:
            master = _trace_mask(edges, width_mm, height_mm, stroke_mm)
            master.simplification = level
            break
        except _TooComplexError:
            continue
    if master is None:
        raise ValueError(TOO_COMPLEX)
    master.source_hash = hashlib.sha256(artwork.tobytes()).hexdigest()
    # Same millimetre fit and one-millimetre margin as the vector paths.
    factor = 150 / 25.4
    preview = Image.new(
        "RGB", (math.ceil(width_mm * factor), math.ceil(height_mm * factor)), "white"
    )
    scale = min((width_mm - 2) / artwork.width, (height_mm - 2) / artwork.height)
    fitted = artwork.resize(
        (
            max(1, round(artwork.width * scale * factor)),
            max(1, round(artwork.height * scale * factor)),
        ),
        Image.Resampling.LANCZOS,
    )
    preview.paste(
        fitted,
        (
            round((width_mm - artwork.width * scale) / 2 * factor),
            round((height_mm - artwork.height * scale) / 2 * factor),
        ),
    )
    return master, preview


def _trace_mask(ink: np.ndarray, width_mm: float, height_mm: float, stroke_mm: float) -> Master:
    skel = skeletonize(ink)  # type: ignore[no-untyped-call]
    points = {(int(x), int(y)) for y, x in np.argwhere(skel)}
    if len(points) > MAX_TRACE_POINTS:
        raise _TooComplexError(TOO_COMPLEX)

    def neighbours(p: tuple[int, int]) -> list[tuple[int, int]]:
        x, y = p
        found = []
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            q = x + dx, y + dy
            if q not in points:
                continue
            if dx and dy and ((x + dx, y) in points or (x, y + dy) in points):
                continue
            found.append(q)
        return found

    graph = {p: neighbours(p) for p in sorted(points)}
    visited: set[tuple[tuple[int, int], tuple[int, int]]] = set()
    paths = []
    total_length = kept_length = 0.0
    h, w = ink.shape
    scale = min((width_mm - 2) / w, (height_mm - 2) / h)
    ox, oy = (width_mm - w * scale) / 2, (height_mm - h * scale) / 2
    starts = [p for p in graph if len(graph[p]) != 2] + [p for p in graph if len(graph[p]) == 2]
    for start in starts:
        for neighbour in graph[start]:
            if (start, neighbour) in visited:
                continue
            chain = [start]
            previous, current = start, neighbour
            while True:
                visited.add((previous, current))
                visited.add((current, previous))
                chain.append(current)
                options = [q for q in graph[current] if (current, q) not in visited]
                if len(graph[current]) != 2 or not options:
                    break
                previous, current = current, options[0]
            length = sum(math.dist(a, b) for a, b in pairwise(chain)) * scale
            total_length += length
            # Preserve short edges joining junctions; dropping them disconnects the design.
            if length >= 0.6 or len(graph[chain[0]]) > 2 or len(graph[chain[-1]]) > 2:
                kept_length += length
                paths.append(
                    [(round(x * scale + ox, 4), round(y * scale + oy, 4)) for x, y in chain]
                )
    if not paths:
        raise ValueError("El trazado no contiene líneas utilizables.")
    if total_length and kept_length / total_length < 0.9:
        raise ValueError(
            "El tamaño solicitado elimina demasiados detalles. Aumenta las medidas "
            "o simplifica el diseño antes de volver a generar."
        )
    return Master(paths, width_mm, height_mm, stroke_mm)


def export_svg(master: Master, mirrored: bool = False) -> bytes:
    transform = f"translate({master.width_mm} 0) scale(-1 1)" if mirrored else ""
    paths = "".join(
        '<polyline points="' + " ".join(f"{x},{y}" for x, y in p) + '"/>' for p in master.paths
    )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{master.width_mm}mm" height="{master.height_mm}mm" '
        f'viewBox="0 0 {master.width_mm} {master.height_mm}">'
        f"<title>Stencil {master.design_hash}</title>"
        '<rect width="100%" height="100%" fill="#FFFFFF"/>'
        f'<g transform="{transform}" fill="none" stroke="#000000" '
        f'stroke-width="{master.stroke_mm}" stroke-linecap="round" '
        f'stroke-linejoin="round">{paths}</g></svg>'
    ).encode()


def export_pdf(master: Master, mirrored: bool = False) -> bytes:
    output = io.BytesIO()
    mm = 72 / 25.4
    page_w, page_h = max(master.width_mm + 20, 80), master.height_mm + 35
    pdf = canvas.Canvas(output, pagesize=(page_w * mm, page_h * mm), pageCompression=0)
    pdf.setTitle(f"InkCraft {master.design_hash}")
    pdf.setLineWidth(master.stroke_mm * mm)
    for points in master.paths:
        path = pdf.beginPath()
        for i, (x, y) in enumerate(points):
            px = (10 + (master.width_mm - x if mirrored else x)) * mm
            py = (page_h - 10 - y) * mm
            if i == 0:
                path.moveTo(px, py)
            else:
                path.lineTo(px, py)
        pdf.drawPath(path, stroke=1, fill=0)
    pdf.setFont("Helvetica", 8)
    pdf.drawString(
        10 * mm, 15 * mm, f"{master.width_mm:g} x {master.height_mm:g} mm - Print 100%, no fit"
    )
    pdf.line(10 * mm, 10 * mm, 60 * mm, 10 * mm)
    pdf.drawString(10 * mm, 5 * mm, "Calibration: 50 mm | Tattooer review required")
    pdf.showPage()
    _a4_tiles(pdf, master, mirrored)
    pdf.save()
    return output.getvalue()


#: TASK-0088 (audit, section 5 «Impresión profesional»): A4 portrait, the area printed on each
#: piece, and how much consecutive pieces overlap so they can be aligned and taped.
A4_MM = (210.0, 297.0)
TILE_AREA_MM = (190.0, 257.0)
TILE_OVERLAP_MM = 10.0


def tile_grid(width_mm: float, height_mm: float) -> tuple[int, int]:
    """Columns and rows of A4 pieces for a design; (0, 0) when it fits on one A4 page."""
    if width_mm + 20 <= A4_MM[0] and height_mm + 35 <= A4_MM[1]:
        return 0, 0
    step_w, step_h = TILE_AREA_MM[0] - TILE_OVERLAP_MM, TILE_AREA_MM[1] - TILE_OVERLAP_MM
    columns = max(1, math.ceil((width_mm - TILE_OVERLAP_MM) / step_w))
    rows = max(1, math.ceil((height_mm - TILE_OVERLAP_MM) / step_h))
    return columns, rows


def _a4_tiles(pdf: canvas.Canvas, master: Master, mirrored: bool) -> None:
    """The same design at 1:1 in A4 pieces, after the full-size page (TASK-0088).

    A home printer set to A4 shrinks or crops a page larger than A4. These pages print at 100 % on
    A4: each carries its piece, a 10 mm overlap with the next, corner marks, its position and the
    50 mm calibration bar.
    """
    columns, rows = tile_grid(master.width_mm, master.height_mm)
    if not columns:
        return
    mm = 72 / 25.4
    step_w, step_h = TILE_AREA_MM[0] - TILE_OVERLAP_MM, TILE_AREA_MM[1] - TILE_OVERLAP_MM
    left, bottom = 10.0, 30.0
    total = columns * rows
    for row in range(rows):
        for column in range(columns):
            ox, oy = column * step_w, row * step_h
            pdf.setPageSize((A4_MM[0] * mm, A4_MM[1] * mm))
            pdf.saveState()
            clip = pdf.beginPath()
            clip.rect(left * mm, bottom * mm, TILE_AREA_MM[0] * mm, TILE_AREA_MM[1] * mm)
            pdf.clipPath(clip, stroke=0, fill=0)
            pdf.setLineWidth(master.stroke_mm * mm)
            for points in master.paths:
                path = pdf.beginPath()
                for i, (x, y) in enumerate(points):
                    dx = (master.width_mm - x if mirrored else x) - ox
                    px = (left + dx) * mm
                    py = (bottom + TILE_AREA_MM[1] - (y - oy)) * mm
                    if i == 0:
                        path.moveTo(px, py)
                    else:
                        path.lineTo(px, py)
                pdf.drawPath(path, stroke=1, fill=0)
            pdf.restoreState()
            # Corner marks of the printed area, to align the overlaps.
            pdf.setLineWidth(0.2 * mm)
            for cx in (left, left + TILE_AREA_MM[0]):
                for cy in (bottom, bottom + TILE_AREA_MM[1]):
                    pdf.line((cx - 4) * mm, cy * mm, (cx + 4) * mm, cy * mm)
                    pdf.line(cx * mm, (cy - 4) * mm, cx * mm, (cy + 4) * mm)
            pdf.setFont("Helvetica", 8)
            number = row * columns + column + 1
            pdf.drawString(
                left * mm,
                20 * mm,
                f"A4 piece {number} of {total} (row {row + 1}, column {column + 1}) - "
                f"{TILE_OVERLAP_MM:g} mm overlap - print 100%, no fit",
            )
            pdf.line(left * mm, 10 * mm, (left + 50) * mm, 10 * mm)
            pdf.drawString(left * mm, 5 * mm, "Calibration: 50 mm")
            pdf.showPage()


def rasterize(master: Master, dpi: int = 150) -> Image.Image:
    factor = dpi / 25.4
    image = Image.new(
        "RGB", (math.ceil(master.width_mm * factor), math.ceil(master.height_mm * factor)), "white"
    )
    draw = ImageDraw.Draw(image)
    for points in master.paths:
        draw.line(
            [(x * factor, y * factor) for x, y in points],
            fill="black",
            width=max(1, round(master.stroke_mm * factor)),
            joint="curve",
        )
    return image


def serialize_master(master: Master) -> bytes:
    """Persist the authoritative vector geometry (ADR-0007), not only a raster of it."""
    return json.dumps(
        {
            "version": 1,
            "paths": master.paths,
            "widthMm": master.width_mm,
            "heightMm": master.height_mm,
            "strokeMm": master.stroke_mm,
            "sourceHash": master.source_hash,
        },
        separators=(",", ":"),
    ).encode()


def deserialize_master(data: bytes) -> Master:
    document = json.loads(data.decode())
    if document.get("version") != 1:
        raise ValueError("Formato de master vectorial no reconocido.")
    return Master(
        [[(float(x), float(y)) for x, y in path] for path in document["paths"]],
        float(document["widthMm"]),
        float(document["heightMm"]),
        float(document["strokeMm"]),
        document.get("sourceHash"),
    )


def rescale(master: Master, width_mm: float, height_mm: float) -> Master:
    """Exact uniform vector scale. Never re-traces already-traced output (ADR-0003)."""
    if width_mm <= 0 or height_mm <= 0:
        raise ValueError("Las medidas deben ser positivas.")
    factor = min(width_mm / master.width_mm, height_mm / master.height_mm)
    offset_x = (width_mm - master.width_mm * factor) / 2
    offset_y = (height_mm - master.height_mm * factor) / 2
    return Master(
        [
            [(x * factor + offset_x, y * factor + offset_y) for x, y in path]
            for path in master.paths
        ],
        width_mm,
        height_mm,
        master.stroke_mm * factor,
        master.source_hash,
    )


def rescale_axes(master: Master, width_mm: float, height_mm: float) -> Master:
    """Exact per-axis vector scale (TASK-0107, ADR-0036). Never re-traces (ADR-0003).

    The live editor may widen or lengthen a design, so the stencil follows the mockup on each
    axis. A stroke has one width, so it scales by the geometric mean of the two factors.
    """
    if width_mm <= 0 or height_mm <= 0:
        raise ValueError("Las medidas deben ser positivas.")
    sx, sy = width_mm / master.width_mm, height_mm / master.height_mm
    return Master(
        [[(x * sx, y * sy) for x, y in path] for path in master.paths],
        width_mm,
        height_mm,
        master.stroke_mm * (sx * sy) ** 0.5,
        master.source_hash,
    )
