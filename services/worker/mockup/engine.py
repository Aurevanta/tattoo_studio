"""Geometric-only placement; no generative modification of the design."""

from __future__ import annotations

import io
import math
from typing import Any

import numpy as np
from PIL import Image, ImageFilter

from mockup import limb

#: Strength of the fresh-ink ring (TASK-0031). At 1.0 the reddening was measurable but not
#: visible; 2.0 reads as recent without tinting the design. Illustrative, not clinical.
DEFAULT_FRESHNESS = 2.0

#: Strongest ink attenuation the surface term may apply, where 1.0 would erase it entirely.
SURFACE_LIMIT = 1.0

#: Default attenuation. Chosen on a real render: the design stays intact and the ink grades
#: with the body's own light. Above roughly 0.5 it reads as faded rather than curved.
DEFAULT_SURFACE = 0.35


def surface_falloff(patch: np.ndarray, strength: float) -> np.ndarray:
    """How much to attenuate the ink at each pixel, read from the photograph (ADR-0014).

    Where a body turns away from the light it darkens, so the skin's own luminance already
    carries its gross form. Blurring pores and hair away leaves that form; ink on a surface
    angled away reads lighter and lower in contrast, and scaling its opacity says so.

    Deliberately not a displacement. A displacement large enough to read as curvature also
    deforms the subject — measured on a real render, where the animal's muzzle and ears warped
    visibly — and MOCKUP-INV-001 makes the artwork's shape authoritative. This moves nothing.

    It is not recovered depth. It is an illustrative approximation, with the difference from the
    cylinder that it is read from the photograph rather than assumed, so it suits a back or a
    chest as readily as a limb.
    """
    height, width = patch.shape[:2]
    luminance = patch @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    form = np.asarray(
        Image.fromarray(np.clip(luminance, 0, 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(max(4.0, min(width, height) / 12))
        ),
        dtype=np.float32,
    )
    brightest = float(form.max())
    if brightest < 1e-6:
        return np.ones((height, width), dtype=np.float32)
    lit = form / brightest
    falloff: np.ndarray = 1 - min(strength, SURFACE_LIMIT) * np.clip(1 - lit, 0, 1)
    return falloff


#: How much of the skin's surface light passes over ink (TASK-0063): fine sparkle (pores, fine
#: texture) and the broad gloss of the brightest skin. Chosen by eye on library plates.
SPARKLE = 0.45
GLOSS = 0.6


def skin_light(patch: np.ndarray) -> np.ndarray:
    """The light the skin's surface reflects, which sits over the ink rather than under it.

    Ink is under the epidermis: the camera sees the diffuse light the pigment darkens, plus the
    reflection off the skin above it, which the pigment does not touch. Multiplying the whole
    photograph by the ink darkened that reflection too, and the tattoo read as a matte sticker
    (TASK-0063). This estimates the reflection from the photograph in two parts: the fine sparkle
    of pores, brighter than their immediate surroundings, and the broad gloss where the skin is
    among its brightest. It is an illustrative approximation, not a measured reflectance, and like
    the surface term it moves nothing (MOCKUP-INV-001).
    """
    # Rounded once, as the blurs below are: even skin then reflects exactly nothing extra.
    luminance = np.round(patch @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))

    def blur(values: np.ndarray, radius: float) -> np.ndarray:
        image = Image.fromarray(np.clip(values, 0, 255).astype(np.uint8))
        return np.asarray(image.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32)

    height, width = luminance.shape
    sparkle = np.clip(luminance - blur(luminance, 3.0), 0, None)
    smooth = blur(luminance, max(2.0, min(width, height) / 60))
    gloss = np.clip(smooth - float(np.percentile(smooth, 75)), 0, None)
    light: np.ndarray = np.minimum(SPARKLE * sparkle + GLOSS * gloss, 0.6 * luminance)
    return light


def visible_artwork(master: Image.Image) -> tuple[Image.Image, dict[str, int]]:
    """Remove only exterior white padding for uncalibrated projection; never edit the master."""
    rgb = master.convert("RGB")
    mask = np.asarray(rgb).min(axis=2) < 245
    rows, cols = np.nonzero(mask)
    if not len(rows):
        raise ValueError("El dibujo no contiene tinta visible.")
    margin = max(2, round(min(rgb.size) * 0.01))
    left, top = max(0, int(cols.min()) - margin), max(0, int(rows.min()) - margin)
    right, bottom = (
        min(rgb.width, int(cols.max()) + margin + 1),
        min(rgb.height, int(rows.max()) + margin + 1),
    )
    return rgb.crop((left, top, right, bottom)), {
        "left": left,
        "top": top,
        "width": right - left,
        "height": bottom - top,
    }


def visible_size(master: Image.Image, size: dict[str, float]) -> dict[str, float]:
    art, _ = visible_artwork(master)
    return {"widthMm": size["heightMm"] * art.width / art.height, "heightMm": size["heightMm"]}


#: Share of the design's ink allowed past the silhouette before it is scaled down (TASK-0041). A
#: limb wraps roughly 180 degrees, so the outermost columns of a full-width design continue around
#: its side, out of the camera's sight; a small margin there lets a whole-zone design fill the zone
#: instead of shrinking to fit the visible width. The feathered silhouette clip keeps the edge from
#: reading as a cut, checked on a real render at up to 12 %. 6 % fills well with clean edges.
MAX_SPILL = 0.06
#: A fit never shrinks the design below this share of its requested size.
MIN_FIT_SCALE = 0.6
#: Taper the cylinder may take from the photograph; the same bound `composite` enforces.
MAX_TAPER = 0.35


def _shape(
    master: Image.Image, width: int, height: int, curvature: float, taper: float
) -> Image.Image:
    """The artwork at its projected size, wrapped on a tapered cylinder when curved.

    Geometric only; the source artwork remains untouched (MOCKUP-INV-001).
    """
    ink_image = master.resize((width, height), Image.Resampling.LANCZOS).convert("RGB")
    if not curvature:
        return ink_image
    mesh = []

    def source_point(px: int, py: int) -> tuple[float, float]:
        t = py / height
        radius = 1 - taper * t * t
        u = (2 * px / width - 1) / radius
        # Continue beyond the image edge so PIL fills exposed margins white.
        sx = math.asin(max(-1, min(1, u)) * math.sin(curvature)) / curvature
        sx += max(0, abs(u) - 1) * (1 if u > 0 else -1)
        bow = 0.035 * height * math.sin(curvature) * (1 - min(1, u * u))
        sy = py - bow * math.sin(math.pi * t)
        return (sx + 1) * width / 2, sy

    for top in range(0, height, max(1, height // 48)):
        bottom = min(height, top + max(1, height // 48))
        for left in range(0, width, max(1, width // 48)):
            right = min(width, left + max(1, width // 48))
            quad = (
                *source_point(left, top),
                *source_point(left, bottom),
                *source_point(right, bottom),
                *source_point(right, top),
            )
            mesh.append(((left, top, right, bottom), quad))
    return ink_image.transform(
        (width, height), Image.Transform.MESH, mesh, Image.Resampling.BICUBIC, fillcolor="white"
    )


def _fit_to_body(
    master: Image.Image,
    body: np.ndarray,
    x: int,
    y: int,
    width: int,
    height: int,
    curvature: float,
    taper: float,
    calibrated: bool,
) -> tuple[int, int, int, int, float, dict[str, Any]]:
    """Centre the design on the body, taper it with the limb and shrink it until it stays on.

    The vertical centre is kept. A calibrated photo keeps its physical scale: only the centring
    and the clip apply, since shrinking it would contradict the millimetres the client measured.
    """
    rows, cols = body.shape
    centre_y = y + height / 2
    if curvature:
        measured = limb.taper(body, y, y + height, MAX_TAPER)
        if measured is not None:
            taper = measured
    scale, spill = 1.0, 0.0
    while True:
        w, h = max(2, round(width * scale)), max(2, round(height * scale))
        top = min(max(0, round(centre_y - h / 2)), rows - h)
        centre_x = limb.centre_line(body, top, top + h)
        left = x if centre_x is None else round(centre_x - w / 2)
        left = min(max(0, left), cols - w)
        ink = np.asarray(_shape(master, w, h, curvature, taper), dtype=np.float32)
        inked = ink.min(axis=2) < 230
        total = int(inked.sum())
        spill = (
            float((inked & ~body[top : top + h, left : left + w]).sum()) / total if total else 0.0
        )
        if calibrated or spill <= MAX_SPILL or scale * 0.95 < MIN_FIT_SCALE:
            break
        scale *= 0.95
    return (
        left,
        top,
        w,
        h,
        taper,
        {"scale": round(scale, 3), "spill": round(spill, 4), "taper": round(taper, 3)},
    )


#: The fields of a placement chosen in the live editor (TASK-0107), as `edit.placement` has them.
MANUAL_KEYS = ("centreX", "centreY", "width", "height", "angle")


def _manual(
    master: Image.Image,
    photo: Image.Image,
    p: dict[str, float],
    curvature: float,
    taper: float,
) -> tuple[int, int, int, int, Image.Image]:
    """The ink box of a placement chosen in the live editor, clipped to the frame (TASK-0107).

    Resize to the chosen width and height (a stretch the platform has bounded), turn clockwise by
    the angle, then wrap on the cylinder, in the order `lib/mockup-editor.ts` uses. Geometric
    only: the artwork is resampled, never redrawn (MOCKUP-INV-001).
    """
    if not -180 <= p["angle"] <= 180:
        raise ValueError("Giro fuera del rango admitido.")
    width, height = round(photo.width * p["width"]), round(photo.height * p["height"])
    if width < 2 or height < 2:
        raise ValueError("El diseño es demasiado pequeño para colocarlo.")
    art = master.resize((width, height), Image.Resampling.LANCZOS).convert("RGB")
    if p["angle"]:
        art = art.rotate(
            -p["angle"], resample=Image.Resampling.BICUBIC, expand=True, fillcolor="white"
        )
    ink = _shape(art, art.width, art.height, curvature, taper)
    left = round(photo.width * p["centreX"] - ink.width / 2)
    top = round(photo.height * p["centreY"] - ink.height / 2)
    x, y = max(0, left), max(0, top)
    right, bottom = min(photo.width, left + ink.width), min(photo.height, top + ink.height)
    if right - x < 2 or bottom - y < 2:
        raise ValueError("El diseño queda fuera de la fotografía. Muévelo hacia la piel.")
    ink = ink.crop((x - left, y - top, right - left, bottom - top))
    return x, y, right - x, bottom - y, ink


def composite(
    master: Image.Image,
    background: bytes,
    size: dict[str, float],
    placement: dict[str, float] | None = None,
    *,
    fresh: bool = False,
    curvature: float = 0.0,
    taper: float = 0.0,
    fit_visible: bool = False,
    freshness: float = DEFAULT_FRESHNESS,
    surface: float = 0.0,
    fit_body: bool = False,
    manual: bool = False,
) -> tuple[bytes, dict[str, Any]]:
    """Lay the master into the photograph by multiply, never redrawing it (MOCKUP-INV-001).

    ``manual`` (TASK-0107, ADR-0036) takes a placement the client chose in the live editor:
    ``centreX``/``centreY`` and the design's ``width``/``height`` before rotation, as fractions of
    the frame, and ``angle`` in degrees clockwise. The design is turned before the cylinder warp,
    as the browser does, and clipped to the frame and the silhouette; it is never re-centred or
    shrunk, since that would undo the client's choice.
    """
    with Image.open(io.BytesIO(background)) as source:
        photo = source.convert("RGB")
        photo.thumbnail((2048, 2048))
    p = placement or {"x": 0.32, "y": 0.22, "width": 0.36}
    crop = None
    if fit_visible and not p.get("photoWidthMm"):
        master, crop = visible_artwork(master)
        size = {
            "widthMm": size["heightMm"] * master.width / master.height,
            "heightMm": size["heightMm"],
        }
    if not 0 <= curvature <= 1.2 or not 0 <= taper <= 0.35:
        raise ValueError("Curvatura fuera del rango admitido.")
    if not 0 <= surface <= SURFACE_LIMIT:
        raise ValueError("Ajuste de superficie fuera del rango admitido.")
    fitted: dict[str, Any] | None = None
    if manual:
        x, y, width, height, ink_image = _manual(master, photo, p, curvature, taper)
        body = limb.body_mask(photo) if fit_body else None
    else:
        width = (
            round(photo.width * size["widthMm"] / p["photoWidthMm"])
            if p.get("photoWidthMm")
            else round(photo.width * p["width"])
        )
        height = round(width * size["heightMm"] / size["widthMm"])
        x, y = round(photo.width * p["x"]), round(photo.height * p["y"])
        if width < 2 or height < 2 or x + width > photo.width or y + height > photo.height:
            raise ValueError(
                "El diseño queda fuera de la fotografía. Ajusta posición, anchura o calibración."
            )
        body = limb.body_mask(photo) if fit_body else None
        if body is not None:
            # TASK-0039: fit to the body actually in the photograph, not to an assumed framing.
            x, y, width, height, taper, fitted = _fit_to_body(
                master, body, x, y, width, height, curvature, taper, bool(p.get("photoWidthMm"))
            )
        ink_image = _shape(master, width, height, curvature, taper)
    if fresh:
        ink_image = ink_image.filter(ImageFilter.GaussianBlur(0.3))
    ink = np.asarray(ink_image, dtype=np.float32) / 255
    if body is not None:
        # Ink past the silhouette wraps round the limb, out of the camera's sight; it is not
        # printed on the backdrop. A narrow feather, inside the silhouette only, keeps the edge
        # from reading as a cut.
        region = body[y : y + height, x : x + width]
        skin = (
            np.asarray(
                Image.fromarray(region.astype(np.uint8) * 255).filter(
                    ImageFilter.GaussianBlur(max(1.0, width * 0.004))
                ),
                dtype=np.float32,
            )
            / 255
        ) * region
        ink = 1 - (1 - ink) * skin[:, :, None]
    pixels = np.asarray(photo, dtype=np.float32).copy()
    patch = pixels[y : y + height, x : x + width]
    if surface:
        # Attenuate, never displace: the artwork's geometry is authoritative (MOCKUP-INV-001).
        ink = 1 - (1 - ink) * surface_falloff(patch, surface)[:, :, None]
    if fresh:
        coverage = 1 - ink.min(axis=2)
        # Dilate before blurring: redness must surround ink, not disappear beneath it.
        halo_radius = max(1, min(9, round(width * 0.009)))
        halo = (
            np.asarray(
                Image.fromarray((coverage * 255).astype(np.uint8))
                .filter(ImageFilter.MaxFilter(halo_radius * 2 + 1))
                .filter(ImageFilter.GaussianBlur(max(1.2, width * 0.008))),
                dtype=np.float32,
            )
            / 255
        )
        # Then subtract the ink itself, leaving a ring. Fresh ink irritates the skin *around*
        # the strokes; a solid black stroke hides the tint anyway, but mid-grey shading lets it
        # through, and without this the whole design goes warm instead of its border.
        halo = np.clip(halo - coverage, 0, 1) * freshness
        if body is not None:
            halo *= skin  # irritated skin, never a reddened backdrop
        warm = patch.copy()
        warm[:, :, 0] += (255 - warm[:, :, 0]) * halo * 0.14
        warm[:, :, 1] *= 1 - halo * 0.095
        warm[:, :, 2] *= 1 - halo * 0.065
        # TASK-0063: the pigment darkens the diffuse light only; the surface's own reflection
        # passes over it, so the skin's pores and gloss continue across the tattoo.
        light = skin_light(patch)[:, :, None]
        pixels[y : y + height, x : x + width] = (warm - light) * (0.07 + 0.93 * ink) + light
    else:
        # The bare geometric reference stays a plain multiply: it is what proves no redraw.
        patch *= 0.15 + 0.85 * ink
    result = Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8))
    output = io.BytesIO()
    result.save(output, format="PNG")
    return output.getvalue(), {
        "xPx": x,
        "yPx": y,
        "widthPx": width,
        "heightPx": height,
        "method": "fresh-ink-composite" if fresh else "geometric-multiply",
        **({"curvature": curvature} if curvature else {}),
        **({"taper": taper} if taper else {}),
        **({"surface": surface} if surface else {}),
        "freshness": freshness if fresh else 0.0,
        **({"sourceCropPx": crop} if crop else {}),
        **({"bodyFit": fitted} if fitted else {}),
        **({"placement": {k: round(float(p[k]), 4) for k in MANUAL_KEYS}} if manual else {}),
        "scaleCalibrated": bool(p.get("photoWidthMm")),
        "generativePostprocess": False,
    }
