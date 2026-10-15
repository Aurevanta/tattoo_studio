"""TASK-0107 (ADR-0036): a placement the client chose in the live editor is rendered as chosen."""

from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image, ImageDraw

from mockup.engine import composite


def skin(width: int = 400, height: int = 300) -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (width, height), (200, 160, 130)).save(output, format="PNG")
    return output.getvalue()


def bar() -> Image.Image:
    """A tall black bar on white: 20 wide, 100 high."""
    image = Image.new("RGB", (40, 120), "white")
    ImageDraw.Draw(image).rectangle((10, 10, 29, 109), fill="black")
    return image


def ink(png: bytes) -> np.ndarray:
    with Image.open(io.BytesIO(png)) as image:
        pixels = np.asarray(image.convert("RGB"), dtype=np.float32)
    mask: np.ndarray = pixels.mean(axis=2) < 100
    return mask


def bounds(mask: np.ndarray) -> tuple[int, int, int, int]:
    rows, cols = np.nonzero(mask)
    return int(cols.min()), int(rows.min()), int(cols.max()), int(rows.max())


def place(**placement: float) -> tuple[bytes, dict[str, object]]:
    p = {"centreX": 0.5, "centreY": 0.5, "width": 0.1, "height": 0.4, "angle": 0.0} | placement
    return composite(bar(), skin(), {"widthMm": 20, "heightMm": 60}, p, manual=True)


def test_the_design_is_centred_where_the_client_put_it() -> None:
    png, transform = place(centreX=0.25, centreY=0.4)
    left, top, right, bottom = bounds(ink(png))
    assert (left + right) / 2 == pytest.approx(100, abs=3)
    assert (top + bottom) / 2 == pytest.approx(120, abs=3)
    assert transform["placement"] == {
        "centreX": 0.25,
        "centreY": 0.4,
        "width": 0.1,
        "height": 0.4,
        "angle": 0.0,
    }


def test_a_quarter_turn_lays_a_tall_bar_flat() -> None:
    upright = bounds(ink(place()[0]))
    turned = bounds(ink(place(angle=90)[0]))
    assert upright[3] - upright[1] > 2 * (upright[2] - upright[0])
    assert turned[2] - turned[0] > 2 * (turned[3] - turned[1])


def test_a_stretched_placement_takes_the_asked_proportions() -> None:
    narrow = bounds(ink(place(width=0.1)[0]))
    wide = bounds(ink(place(width=0.125)[0]))
    assert (wide[2] - wide[0]) / (narrow[2] - narrow[0]) == pytest.approx(1.25, abs=0.12)
    assert wide[3] - wide[1] == pytest.approx(narrow[3] - narrow[1], abs=2)


def test_a_design_half_off_the_frame_is_clipped_not_refused() -> None:
    png, transform = place(centreX=0.0)
    left, _, right, _ = bounds(ink(png))
    assert left == 0 and right < 25
    assert transform["xPx"] == 0


def test_a_design_too_small_to_place_is_refused() -> None:
    # The contract keeps the centre on the frame, so at least half the design stays on it.
    with pytest.raises(ValueError, match="pequeño"):
        place(width=0.001)


def test_the_angle_is_bounded() -> None:
    with pytest.raises(ValueError, match="Giro"):
        place(angle=181)
