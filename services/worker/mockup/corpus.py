"""A synthetic validation corpus for the AI-finish geometry check (TASK-0087, audit ARQ-02).

The tolerance of ADR-0018 was calibrated on one live design. The audit asked for a corpus across
style, colour, text, symbol and skin tone, with local metrics as well as global ones, reporting
false accepts and false rejects. Real model outputs cost money and change between runs, so this
corpus is synthetic and deterministic: each design is drawn on three skin tones, then changed the
ways a faithful finish may change it (relight, retone, soften, retexture) and the ways an unfaithful
one does (redraw a small emblem, change a letter, drop a small element, shift the design).

It measures the method, not a provider. Real finishes must still be sampled from production and
added here when they disagree with it.

    python -m mockup.corpus        # prints the confusion table for the decided tolerance
"""

from __future__ import annotations

import io
from collections.abc import Callable, Iterator
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from mockup.geometry import (
    BLEND_TOLERANCE,
    GeometryTolerance,
    geometry_report,
    within_tolerance,
)

SIZE = (900, 700)
BOUNDS = {"xPx": 250, "yPx": 150, "widthPx": 400, "heightPx": 400}
SKINS = {
    "light": ((228, 190, 168), (190, 146, 122)),
    "medium": ((196, 150, 118), (150, 108, 82)),
    "dark": ((118, 82, 62), (84, 58, 44)),
}
INK = (34, 30, 30)


def _skin(tone: str, seed: int) -> Image.Image:
    top, bottom = (np.array(c, dtype=np.float32) for c in SKINS[tone])
    ys = np.linspace(0, 1, SIZE[1])[:, None, None]
    base = np.broadcast_to(top + (bottom - top) * ys, (SIZE[1], SIZE[0], 3)).copy()
    base += np.random.default_rng(seed).normal(0, 4, base.shape)
    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Pillow's bundled font (Aileron Regular), the same on every machine (TASK-0132).

    The corpus once preferred DejaVu Sans Bold when the system had it. The tolerance was calibrated
    where it did not (Pillow's font), and CI's Linux has it, so the same test measured a different
    letter there and failed. A bold DejaVu letter change is a known miss: FINDING-0006.
    """
    return ImageFont.load_default(size=size)


@dataclass(frozen=True)
class Variant:
    """What is drawn; the unfaithful cases flip one of these."""

    emblem: str = "star"  # the small symbol in the corner: "star" | "circle" | "none"
    text: str = "AMOR"
    shift: tuple[int, int] = (0, 0)


def _draw(design: str, tone: str, variant: Variant) -> Image.Image:
    image = _skin(tone, seed=7)
    draw = ImageDraw.Draw(image)
    x0, y0 = BOUNDS["xPx"] + variant.shift[0], BOUNDS["yPx"] + variant.shift[1]
    if design == "emblem":
        # A large ring with a small crest in one corner: the case a global measure can miss.
        draw.ellipse((x0 + 40, y0 + 40, x0 + 360, y0 + 360), outline=INK, width=8)
        draw.line((x0 + 200, y0 + 40, x0 + 200, y0 + 360), fill=INK, width=6)
    elif design == "lettering":
        draw.rectangle((x0 + 20, y0 + 300, x0 + 380, y0 + 312), fill=INK)
        draw.text((x0 + 40, y0 + 150), variant.text, fill=INK, font=_font(92))
    elif design == "fine_line":
        for i in range(9):
            draw.line((x0 + 40 + i * 38, y0 + 40, x0 + 20 + i * 40, y0 + 360), fill=INK, width=3)
    elif design == "colour":
        draw.ellipse(
            (x0 + 60, y0 + 60, x0 + 340, y0 + 340), fill=(178, 34, 40), outline=INK, width=7
        )
        draw.polygon(
            [(x0 + 120, y0 + 330), (x0 + 200, y0 + 380), (x0 + 280, y0 + 330)],
            fill=(40, 120, 60),
            outline=INK,
        )
    # The small emblem, top-right: about a twentieth of the design's area.
    ex, ey = x0 + 300, y0 + 20
    if variant.emblem == "star":
        draw.polygon(
            [
                (ex + 40, ey),
                (ex + 50, ey + 30),
                (ex + 80, ey + 30),
                (ex + 55, ey + 48),
                (ex + 65, ey + 80),
                (ex + 40, ey + 60),
                (ex + 15, ey + 80),
                (ex + 25, ey + 48),
                (ex, ey + 30),
                (ex + 30, ey + 30),
            ],
            fill=INK,
        )
    elif variant.emblem == "circle":
        draw.ellipse((ex + 10, ey + 10, ex + 70, ey + 70), outline=INK, width=6)
    return image


def _png(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def _finish(image: Image.Image, strength: float) -> Image.Image:
    """What a faithful finish may do: relight, retone, retexture and soften."""
    arr = np.asarray(image, dtype=np.float32) / 255
    relit = (arr ** (1 + 0.15 * strength)) * (1 - 0.12 * strength) + 0.05 * strength
    ys = np.linspace(1 - 0.08 * strength, 1 + 0.05 * strength, SIZE[1])[:, None, None]
    noise = np.random.default_rng(11).normal(0, 4 + 3 * strength, relit.shape)
    textured = relit * ys * 255 + noise
    out = Image.fromarray(np.clip(textured, 0, 255).astype(np.uint8))
    return out.filter(ImageFilter.GaussianBlur(0.6 + 0.6 * strength))


@dataclass(frozen=True)
class Case:
    design: str
    tone: str
    change: str
    faithful: bool
    before: bytes
    after: bytes


DESIGNS = ("emblem", "lettering", "fine_line", "colour")

#: Unfaithful changes: what a redraw does to the same design.
UNFAITHFUL: dict[str, Callable[[str], Variant]] = {
    "emblem_redrawn": lambda design: Variant(emblem="circle"),
    "emblem_dropped": lambda design: Variant(emblem="none"),
    "letter_changed": lambda design: Variant(text="AMAR"),
    "shifted": lambda design: Variant(shift=(16, 10)),
}


def cases(tones: tuple[str, ...] = tuple(SKINS)) -> Iterator[Case]:
    for design in DESIGNS:
        for tone in tones:
            reference = _draw(design, tone, Variant())
            before = _png(reference)
            for strength in (0.5, 1.0, 1.5):
                yield Case(
                    design,
                    tone,
                    f"finish_{strength}",
                    True,
                    before,
                    _png(_finish(reference, strength)),
                )
            for name, change in UNFAITHFUL.items():
                if name == "letter_changed" and design != "lettering":
                    continue
                changed = _draw(design, tone, change(design))
                yield Case(design, tone, name, False, before, _png(_finish(changed, 1.0)))


@dataclass(frozen=True)
class Confusion:
    false_accepts: list[str]
    false_rejects: list[str]
    faithful: int
    unfaithful: int


def evaluate(tolerance: GeometryTolerance, tones: tuple[str, ...] = tuple(SKINS)) -> Confusion:
    accepts: list[str] = []
    rejects: list[str] = []
    faithful = unfaithful = 0
    for case in cases(tones):
        passed = within_tolerance(geometry_report(case.before, case.after, BOUNDS), tolerance)
        name = f"{case.design}/{case.tone}/{case.change}"
        if case.faithful:
            faithful += 1
            if not passed:
                rejects.append(name)
        else:
            unfaithful += 1
            if passed:
                accepts.append(name)
    return Confusion(accepts, rejects, faithful, unfaithful)


def main() -> None:
    global_only = GeometryTolerance(
        max_p95_relative=BLEND_TOLERANCE.max_p95_relative,
        min_ink_iou=BLEND_TOLERANCE.min_ink_iou,
        min_tile_iou=0.0,
    )
    for name, tolerance in (("global only", global_only), ("global + local", BLEND_TOLERANCE)):
        result = evaluate(tolerance)
        print(
            f"{name}: false accepts {len(result.false_accepts)}/{result.unfaithful}, "
            f"false rejects {len(result.false_rejects)}/{result.faithful}"
        )
        for case in result.false_accepts:
            print("  accepted:", case)
        for case in result.false_rejects:
            print("  rejected:", case)


if __name__ == "__main__":
    main()
