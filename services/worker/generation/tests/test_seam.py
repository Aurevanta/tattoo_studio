"""TASK-0104/AC-003: the seam of a sleeve is found, masked and repaired only where it is."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageDraw

from generation.seam import (
    SEAM_BAND,
    fit_aspect,
    keep_outside_band,
    roll_half,
    seam_mask,
    seam_mismatch,
    seamless,
)


def png(pixels: np.ndarray) -> bytes:
    out = io.BytesIO()
    Image.fromarray(pixels.astype(np.uint8)).save(out, format="PNG")
    return out.getvalue()


def pixels(data: bytes) -> np.ndarray:
    with Image.open(io.BytesIO(data)) as image:
        return np.asarray(image.convert("RGB"))


def periodic(width: int = 300, height: int = 200, turns: float = 3) -> np.ndarray:
    """Waves that repeat exactly across the width, as a sleeve should, for a whole `turns`."""
    x = np.arange(width)[None, :]
    y = np.arange(height)[:, None]
    wave = 127 + 100 * np.sin(2 * np.pi * (turns * x / width + y / 60))
    return np.repeat(wave[..., None], 3, axis=2)


def test_a_design_that_runs_on_across_its_edges_is_seamless() -> None:
    assert seam_mismatch(png(periodic())) < 1.2
    assert seamless(png(periodic()))


def test_a_cut_across_the_edges_is_a_seam() -> None:
    # Three and a half waves: the right edge ends half a wave away from where the left begins.
    assert seam_mismatch(png(periodic(turns=3.5))) > 10
    assert not seamless(png(periodic(turns=3.5)))


def test_strokes_cut_by_the_edge_are_a_seam() -> None:
    rng = np.random.default_rng(1)
    width, height = 600, 400
    canvas = Image.new("RGB", (width * 3, height), "white")
    draw = ImageDraw.Draw(canvas)
    for _ in range(120):  # every stroke drawn three times, a width apart: the middle repeats
        x, y = int(rng.integers(0, width)), int(rng.integers(0, height))
        dx, dy = (int(v) for v in rng.integers(-120, 120, 2))
        for offset in (0, width, 2 * width):
            draw.line((x + offset, y, x + offset + dx, y + dy), fill="black", width=6)
    strokes = np.asarray(canvas)
    continued = strokes[:, width : 2 * width]
    cut = np.concatenate(
        [strokes[:, width : width + 400], strokes[:, width + 250 : width + 450]], 1
    )
    assert seamless(png(continued))
    assert not seamless(png(cut))


def test_bare_paper_at_both_edges_has_nothing_to_join() -> None:
    page = np.full((200, 300, 3), 255)
    page[60:140, 120:180] = 0
    assert seam_mismatch(png(page)) == 0.0


def test_rolling_half_way_brings_the_edges_to_the_middle() -> None:
    marked = np.full((10, 100, 3), 255)
    marked[:, 0] = 0
    rolled = pixels(roll_half(png(marked)))
    assert (rolled[:, 50] == 0).all()
    assert (pixels(roll_half(roll_half(png(marked)), back=True)) == marked).all()
    odd = np.arange(3 * 7 * 3).reshape(3, 7, 3)
    assert (pixels(roll_half(roll_half(png(odd)), back=True)) == odd).all()


def test_the_mask_opens_only_the_middle_band() -> None:
    with Image.open(io.BytesIO(seam_mask(400, 100))) as mask:
        alpha = np.asarray(mask)[..., 3]
    open_columns = np.flatnonzero(alpha[0] == 0)
    assert open_columns.min() > 0 and open_columns.max() < 399
    assert abs(len(open_columns) - 400 * SEAM_BAND) <= 2
    assert abs(open_columns.mean() - 200) <= 1


def test_only_the_band_is_taken_from_the_editor() -> None:
    original = np.full((50, 400, 3), 40)
    repaired = np.full((50, 400, 3), 220)  # the editor repainted everything
    merged = pixels(keep_outside_band(png(original), png(repaired)))
    assert (merged[:, :100] == 40).all() and (merged[:, -100:] == 40).all()
    assert (merged[:, 195:205] == 220).all()


def test_the_sleeve_keeps_its_whole_width() -> None:
    square = png(np.zeros((1024, 1024, 3)))
    with Image.open(io.BytesIO(fit_aspect(square, 344, 310))) as fitted:
        assert fitted.width == 1024
        assert abs(fitted.width / fitted.height - 344 / 310) < 0.01
    with Image.open(io.BytesIO(fit_aspect(square, 200, 300))) as tall:
        assert tall.width == 1024 and tall.height == 1536


def test_line_art_continued_across_its_edges_reads_apart_from_one_cut() -> None:
    """Line art, mostly paper: a motif that repeats with the width is seamless, a cut is not."""
    width, height = 600, 400
    strip = Image.new("RGB", (width * 2, height), "white")
    draw = ImageDraw.Draw(strip)
    for k in range(-1, 13):  # rings every 100 px whose heights repeat every 300 px
        top = 80 + 40 * (k % 3)
        draw.ellipse((k * 100, top, k * 100 + 140, top + 160), outline="black", width=9)
    pixels_ = np.asarray(strip)
    continued = pixels_[:, :width]  # 600 px is a whole number of repeats
    cut = np.concatenate([pixels_[:, :450], pixels_[:, 1040:1190]], axis=1)
    assert seamless(png(continued))
    assert not seamless(png(cut))
