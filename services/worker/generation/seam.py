"""The seam of a sleeve (TASK-0104, ADR-0034).

A sleeve's design is the limb's skin unrolled: its left and right edges meet on the skin. An image
model asked for a design that "continues across the edges" usually gets close but leaves a visible
join. The join is repaired by rolling the design half a turn, so the two edges meet in the middle
of the image, and asking the editor to redraw only a narrow band there. Rolling back puts the
repaired join on the edges again, and the composition the client approved in the middle.

Everything here is pure image arithmetic: it opens no socket. The provider call that redraws the
band lives in `studio.StudioProvider.repair_seam` (ARCH-INV-001).
"""

from __future__ import annotations

import io

import numpy as np
from PIL import Image

#: Share of the width the editor may redraw around the join.
SEAM_BAND = 0.16

#: The edges are a seam when they differ this many times more than the design's larger steps
#: between neighbouring columns (the 90th percentile). Calibrated on synthetic line art and
#: gradients (`tests/test_seam.py`): continuous designs read 0.5 to 1.4, cut ones 2 to 50.
SEAM_LIMIT = 1.8

#: Differences below this (0-255 grey, mean over the column) are bare paper: nothing to compare.
QUIET = 1.0


def _open(png: bytes) -> Image.Image:
    with Image.open(io.BytesIO(png)) as image:
        return image.convert("RGB")


def _png(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def roll_half(png: bytes, back: bool = False) -> bytes:
    """The design turned half way round: its two edges now meet in the middle of the image.

    `back` undoes it exactly, also for an odd width.
    """
    pixels = np.asarray(_open(png))
    shift = pixels.shape[1] // 2
    return _png(Image.fromarray(np.roll(pixels, -shift if back else shift, axis=1)))


def seam_mask(width: int, height: int, band: float = SEAM_BAND) -> bytes:
    """An edit mask: opaque everywhere except a transparent band down the middle, to redraw."""
    alpha = np.full((height, width), 255, dtype=np.uint8)
    half = max(1, round(width * band / 2))
    alpha[:, width // 2 - half : width // 2 + half] = 0
    mask = np.zeros((height, width, 4), dtype=np.uint8)
    mask[..., 3] = alpha
    return _png(Image.fromarray(mask, "RGBA"))


def keep_outside_band(original: bytes, repaired: bytes, band: float = SEAM_BAND) -> bytes:
    """The repaired band laid into the original, so nothing outside the join can change.

    The editor may redraw beyond its mask. Only the band is taken from its answer, with a short
    feathered edge so the two meet without a line.
    """
    base = _open(original)
    patch = _open(repaired).resize(base.size, Image.Resampling.LANCZOS)
    width = base.width
    half = max(1, round(width * band / 2))
    feather = max(1, half // 4)
    weight = np.zeros(width, dtype=np.float32)
    centre = width // 2
    for x in range(width):
        distance = abs(x - centre)
        if distance <= half - feather:
            weight[x] = 1.0
        elif distance < half:
            weight[x] = (half - distance) / feather
    blend = weight[None, :, None]
    merged = (
        np.asarray(base, dtype=np.float32) * (1 - blend)
        + np.asarray(patch, dtype=np.float32) * blend
    )
    return _png(Image.fromarray(np.clip(merged + 0.5, 0, 255).astype(np.uint8)))


def seam_mismatch(png: bytes) -> float:
    """How much the left and right edges disagree, relative to how much neighbouring columns do.

    About 1 for a design that runs on across its edges, and several times that for a cut. A
    design that is bare paper at both edges has nothing to join, and reads 0.
    """
    # Measured half a turn round, where the join sits between two ordinary columns. Unblurred: a
    # blur smears the join into its neighbours and hides it.
    grey = np.asarray(_open(roll_half(png)).convert("L"), np.float32)
    steps = np.abs(np.diff(grey, axis=1)).mean(axis=0)
    middle = grey.shape[1] // 2 - 1  # the step between the old right edge and the old left one
    edge = float(steps[middle])
    # Compared with the larger steps the design takes anyway (its own strokes), so a stroke that
    # happens to lie on the edge is not mistaken for a join.
    typical = float(np.percentile(np.delete(steps, range(middle - 3, middle + 4)), 90))
    if edge < QUIET:
        return 0.0
    return edge / max(typical, QUIET)


def seamless(png: bytes) -> bool:
    return seam_mismatch(png) <= SEAM_LIMIT


def fit_aspect(png: bytes, width_mm: float, height_mm: float) -> bytes:
    """Cut the canvas to the sleeve's proportions, keeping the full width that wraps.

    The width is the circumference and must stay whole, or the edges would no longer meet; any
    excess height is taken evenly from the top and the bottom, which end at the knee and ankle
    (or elbow and wrist) anyway. A canvas too tall for the width is cut the same way; one too wide
    is not cut, only scaled, so nothing of the wrap is lost.
    """
    image = _open(png)
    width, height = image.size
    target = round(width * height_mm / width_mm)
    if target < height:
        top = (height - target) // 2
        image = image.crop((0, top, width, top + target))
    elif target > height:
        image = image.resize((width, target), Image.Resampling.LANCZOS)
    return _png(image)
