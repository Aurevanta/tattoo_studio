"""The vector master is the authoritative geometry (ADR-0007) and must resize exactly."""

from __future__ import annotations

import pytest

from stencil.engine import (
    Master,
    deserialize_master,
    export_svg,
    rescale,
    rescale_axes,
    serialize_master,
)


def sample() -> Master:
    return Master([[(0.0, 0.0), (10.0, 20.0)], [(5.0, 5.0), (8.0, 18.0)]], 20.0, 40.0, 0.3, "a")


def test_serialisation_round_trip_preserves_the_geometry() -> None:
    """TASK-0024/AC-005: persisting a raster alone left no exact path back to the vector."""
    restored = deserialize_master(serialize_master(sample()))
    assert restored.paths == sample().paths
    assert (restored.width_mm, restored.height_mm) == (20.0, 40.0)
    assert restored.stroke_mm == 0.3
    assert restored.source_hash == "a"


def test_rescale_is_an_exact_similarity() -> None:
    """TASK-0024/AC-005: a resize scales the vector; it never re-traces (ADR-0003)."""
    master = sample()
    scaled = rescale(master, 40.0, 80.0)
    assert scaled.stroke_mm == pytest.approx(master.stroke_mm * 2)
    for original, result in zip(master.paths, scaled.paths, strict=True):
        for (x, y), (sx, sy) in zip(original, result, strict=True):
            assert sx == pytest.approx(x * 2, abs=1e-9)
            assert sy == pytest.approx(y * 2, abs=1e-9)
    assert b'width="40.0mm"' in export_svg(scaled)
    assert scaled.design_hash != master.design_hash


def test_rescale_centres_when_the_target_aspect_differs() -> None:
    scaled = rescale(sample(), 40.0, 100.0)
    assert scaled.width_mm == 40.0 and scaled.height_mm == 100.0
    ys = [y for path in scaled.paths for _, y in path]
    assert min(ys) == pytest.approx(10.0)


def test_an_unknown_vector_document_is_refused() -> None:
    with pytest.raises(ValueError, match="no reconocido"):
        deserialize_master(b'{"version": 2, "paths": []}')


def test_rescale_rejects_a_non_positive_size() -> None:
    with pytest.raises(ValueError, match="positivas"):
        rescale(sample(), 0.0, 10.0)


def test_rescale_axes_widens_without_changing_the_height() -> None:
    """TASK-0107/AC-003: the stencil follows a widened mockup, exactly and per axis."""
    master = sample()
    wide = rescale_axes(master, 40.0, 40.0)
    for original, result in zip(master.paths, wide.paths, strict=True):
        for (x, y), (sx, sy) in zip(original, result, strict=True):
            assert sx == pytest.approx(x * 2, abs=1e-9)
            assert sy == pytest.approx(y, abs=1e-9)
    assert wide.stroke_mm == pytest.approx(0.3 * 2**0.5)
    assert b'width="40.0mm"' in export_svg(wide)


def test_rescale_axes_at_equal_factors_is_the_uniform_rescale() -> None:
    uniform, axes = rescale(sample(), 30.0, 60.0), rescale_axes(sample(), 30.0, 60.0)
    for path, expected in zip(axes.paths, uniform.paths, strict=True):
        for point, target in zip(path, expected, strict=True):
            assert point == pytest.approx(target)
    assert axes.stroke_mm == pytest.approx(uniform.stroke_mm)
    with pytest.raises(ValueError, match="positivas"):
        rescale_axes(sample(), 10.0, -1.0)


def _large_drawing(colour: bool) -> bytes:
    import io

    from PIL import Image, ImageDraw

    image = Image.new("RGB", (2000, 3000), "white")
    draw = ImageDraw.Draw(image)
    if colour:
        draw.ellipse((300, 300, 1700, 2700), fill="red")
    else:
        draw.ellipse((300, 300, 1700, 2700), outline="black", width=12)
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


@pytest.mark.parametrize("colour", [False, True])
def test_a_dense_design_is_traced_at_coarser_detail(
    monkeypatch: pytest.MonkeyPatch, colour: bool
) -> None:
    """TASK-0071: a detailed design used to fail the whole generation at the first, finest pass."""
    from stencil import engine

    shapes: list[tuple[int, ...]] = []
    real = engine._trace_mask

    def dense_twice(ink, *args):  # type: ignore[no-untyped-def]
        shapes.append(ink.shape)
        if len(shapes) <= 2:
            raise engine._TooComplexError(engine.TOO_COMPLEX)
        return real(ink, *args)

    monkeypatch.setattr(engine, "_trace_mask", dense_twice)
    if colour:
        master, _ = engine.trace_colour_artwork(_large_drawing(True), 80, 120)
    else:
        master = engine.trace_native_lineart(_large_drawing(False), 80, 120)
    assert master.paths and len(shapes) == 3
    # Line-art gets smaller each pass; colour first smooths its edges at the same size.
    expected = (
        [(1536, 1024), (1536, 1024), (1152, 768)]
        if colour
        else [
            (1536, 1024),
            (1152, 768),
            (864, 576),
        ]
    )
    assert shapes == expected
    # TASK-0086 (audit ARQ-03): the client is told how many coarser passes it took.
    assert master.simplification == 2


def test_the_simplification_level_is_not_part_of_the_design_identity() -> None:
    a = sample()
    b = sample()
    b.simplification = 3
    assert a.design_hash == b.design_hash


def test_a_design_too_dense_at_every_pass_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    from stencil import engine

    def always(ink, *args):  # type: ignore[no-untyped-def]
        raise engine._TooComplexError(engine.TOO_COMPLEX)

    monkeypatch.setattr(engine, "_trace_mask", always)
    with pytest.raises(ValueError, match="demasiado complejo") as refused:
        engine.trace_native_lineart(_large_drawing(False), 80, 120)
    assert type(refused.value) is ValueError


def test_a_design_larger_than_a4_also_prints_in_a4_pieces() -> None:
    """TASK-0088: a 150 x 300 mm calf design does not fit an A4 page at 100 %."""
    import re

    from stencil.engine import A4_MM, export_pdf, tile_grid

    assert tile_grid(80, 150) == (0, 0)
    assert tile_grid(150, 300) == (1, 2)
    assert tile_grid(300, 500) == (2, 2)  # 2 x 247 mm steps, the last piece 257 mm tall
    big = Master([[(0.0, 0.0), (150.0, 300.0)]], 150.0, 300.0, 0.3)
    pdf = export_pdf(big)
    boxes = re.findall(rb"/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)", pdf)
    # The full-size page, then two A4 pieces.
    assert len(boxes) == 3
    for width, height in boxes[1:]:
        assert float(width) == pytest.approx(A4_MM[0] * 72 / 25.4, abs=0.01)
        assert float(height) == pytest.approx(A4_MM[1] * 72 / 25.4, abs=0.01)
    assert b"A4 piece 2 of 2" in pdf
    small = export_pdf(Master([[(0.0, 0.0), (80.0, 150.0)]], 80.0, 150.0, 0.3))
    assert len(re.findall(rb"/MediaBox", small)) == 1


def _card(backdrop: tuple[int, int, int] | None) -> bytes:
    import io

    import numpy as np
    from PIL import Image, ImageDraw

    if backdrop is None:
        image = Image.new("RGB", (600, 900), "white")
    else:
        # A gradient card, as the model painted behind a biomechanical piece.
        ys = np.linspace(0, 1, 900)[:, None, None]
        base = np.array(backdrop, dtype=np.float32) + 50 * ys
        image = Image.fromarray(
            np.clip(np.broadcast_to(base, (900, 600, 3)), 0, 255).astype(np.uint8)
        )
    draw = ImageDraw.Draw(image)
    draw.ellipse((180, 250, 420, 650), fill=(35, 35, 38))
    for r in range(40):
        draw.ellipse((200 + r, 270 + r, 400 - r, 630 - r), outline=(75 + r, 75 + r, 78 + r))
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def test_a_painted_backdrop_is_cleared_and_the_design_kept() -> None:
    """TASK-0089: a grey card behind the design was tattooed onto the skin as a panel."""
    import io

    import numpy as np
    from PIL import Image

    from stencil.backdrop import clear_backdrop

    cleared = np.asarray(
        Image.open(io.BytesIO(clear_backdrop(_card((115, 115, 118))))).convert("L")
    )
    assert cleared[3, 3] == 255 and cleared[-3, -3] == 255 and cleared[450, 20] == 255
    assert cleared[450, 300] < 60  # the motif's dark core
    assert 70 <= cleared[450, 215] <= 140  # its soft shading


def test_white_and_dark_grounds_are_left_alone() -> None:
    """A white ground is already right; a dark field is a blackwork design, not a backdrop."""
    import io

    from PIL import Image, ImageDraw

    from stencil.backdrop import clear_backdrop

    white = _card(None)
    assert clear_backdrop(white) == white
    field = Image.new("RGB", (400, 400), (14, 14, 14))
    ImageDraw.Draw(field).ellipse((100, 100, 300, 300), fill="white")
    out = io.BytesIO()
    field.save(out, format="PNG")
    assert clear_backdrop(out.getvalue()) == out.getvalue()
