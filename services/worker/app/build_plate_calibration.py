"""Calibrate the skin plate library against the 3D reference bodies (TASK-0120, ADR-0042).

A plate is a photograph of one zone of a reference body. To draw a design on it in millimetres,
the studio must know where the zone's centre is in the picture and how many pixels a millimetre
spans there. This measures both, once per plate, by matching two width profiles along the zone's
up direction:

- on the 3D reference body of the plate's sex (the body the 3D views show, TASK-0110): the width of
  the body part through the zone's centre, seen from the zone's outward direction; on a limb, its
  measured circumference divided by pi;
- on the photograph: the width of the body's silhouette (``mockup.limb.body_mask``) row by row.

A scale and a centre row are searched that make the two agree; the centre column follows the
silhouette there. A plate whose silhouette cannot be read, or whose fit is poor, is recorded as
not calibrated and keeps the framing convention (``SKIN_FRAME_FRACTION``). Every plate is then
reviewed on a contact sheet (``--sheet``) with its zone's reference rectangle drawn on it, and the
reviewed values are committed in ``generation/plates/calibration.json``. Nothing here calls a
model.

Usage::

    python -m app.build_plate_calibration            # measure and write calibration.json
    python -m app.build_plate_calibration --sheet DIR # also draw review sheets into DIR
"""

from __future__ import annotations

import argparse
import json
import math
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw

from generation.plate_library import PLATES
from mockup.anatomy import ZONE_SPAN_MM
from mockup.limb import body_mask
from mockup.placement import SKIN_FRAME_FRACTION

ROOT = Path(__file__).resolve().parents[3]
MODELS = ROOT / "apps" / "web" / "public" / "models"
REFERENCE = ROOT / "contracts" / "reference" / "body-zones.json"
OUTPUT = PLATES / "calibration.json"
#: Zones the limb models carry, and the limb model for each.
LIMB_MODELS = {
    "calf": "lower-leg",
    "shin": "lower-leg",
    "inner_forearm": "forearm",
    "outer_forearm": "forearm",
}
#: A fit worse than this (median |log| width ratio) is not trusted.
MAX_COST = 0.12
#: The fit must use at least this share of the picture's rows.
MIN_ROWS = 0.25
SLICE_MM = 5.0
REACH_MM = 700.0


@dataclass(frozen=True)
class Profile:
    """Width (mm) of the body part through the zone's centre, by height above it (mm)."""

    heights: np.ndarray
    widths: np.ndarray
    #: The zone's centre, measured across from the middle of the part (mm, along `right`).
    offset_mm: float

    def at(self, height: np.ndarray) -> np.ndarray:
        inside = (height >= self.heights[0]) & (height <= self.heights[-1])
        values = np.interp(height, self.heights, self.widths)
        return np.where(inside, values, np.nan)


def read_glb(path: Path) -> tuple[dict[str, Any], dict[str, Any], bytes]:
    data = path.read_bytes()
    length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20 : 20 + length])
    return gltf, gltf["scenes"][0].get("extras", {}), data[20 + length + 8 :]


def accessor(gltf: dict[str, Any], binary: bytes, index: int, size: int) -> np.ndarray:
    item = gltf["accessors"][index]
    view = gltf["bufferViews"][item["bufferView"]]
    offset = view.get("byteOffset", 0) + item.get("byteOffset", 0)
    values = np.frombuffer(binary, dtype=np.float32, count=item["count"] * size, offset=offset)
    return values.reshape(-1, size) if size > 1 else values


def body_profile(body: str, zone: str) -> Profile | None:
    """The width profile through a zone of the whole reference body, or None without the zone."""
    gltf, extras, binary = read_glb(MODELS / f"body-{body}.glb")
    spec = (extras.get("zones") or {}).get(zone)
    if not spec:
        return None
    attributes = gltf["meshes"][0]["primitives"][0]["attributes"]
    points = accessor(gltf, binary, attributes["POSITION"], 3)
    origin = np.array(spec["surface"], dtype=np.float64)
    up, right = np.array(spec["up"]), np.array(spec["right"])
    relative = points - origin
    along_up, across = relative @ up, relative @ right
    heights, widths, middles = [], [], []
    for height in np.arange(-REACH_MM, REACH_MM + 0.1, SLICE_MM):
        row = np.sort(across[np.abs(along_up - height) < SLICE_MM])
        if len(row) < 6:
            continue
        # The part through the zone: the run of the slice that contains (or is nearest) the
        # zone's own column, split where there is a gap, so a hanging arm is not the torso.
        gaps = np.nonzero(np.diff(row) > 18)[0]
        starts = np.concatenate(([0], gaps + 1))
        ends = np.concatenate((gaps, [len(row) - 1]))
        runs = [(row[s], row[e]) for s, e in zip(starts, ends, strict=True)]
        left, right_edge = min(
            runs, key=lambda r: 0 if r[0] <= 0 <= r[1] else min(abs(r[0]), abs(r[1]))
        )
        heights.append(height)
        widths.append(right_edge - left)
        middles.append((left + right_edge) / 2)
    if len(heights) < 10:
        return None
    centre = int(np.argmin(np.abs(np.array(heights))))
    return Profile(np.array(heights), np.array(widths), -float(middles[centre]))


def limb_profile(body: str, zone: str) -> Profile | None:
    """A limb zone: diameter (circumference over pi) along the band, centred on its middle."""
    reference = json.loads(REFERENCE.read_text(encoding="utf-8"))
    wrap = next(
        (w for w in reference["wraps"].values() if zone in w["zones"]),
        None,
    )
    if wrap is None:
        return None
    profile = (
        (wrap.get("bodies") or {})
        .get(body, {})
        .get("circumferenceProfileMm", wrap["circumferenceProfileMm"])
    )
    step = float(wrap["profileStepMm"])
    depths = np.arange(len(profile)) * step
    middle = float(wrap["lengthMm"]) / 2
    # Depth grows down the limb; height above the band's middle is the opposite.
    heights = middle - depths
    order = np.argsort(heights)
    return Profile(heights[order], np.array(profile)[order] / math.pi, 0.0)


def profile_for(body: str, zone: str) -> Profile | None:
    return limb_profile(body, zone) if zone in LIMB_MODELS else body_profile(body, zone)


def silhouette(photo: Image.Image) -> tuple[np.ndarray, np.ndarray] | None:
    """Width and middle (px) of the body in each row; NaN where cropped by the frame or absent."""
    mask = body_mask(photo)
    if mask is None:
        return None
    widths = np.full(mask.shape[0], np.nan)
    middles = np.full(mask.shape[0], np.nan)
    for y, row in enumerate(mask):
        cols = np.nonzero(row)[0]
        if len(cols) < 4:
            continue
        gaps = np.nonzero(np.diff(cols) > 3)[0]
        starts = np.concatenate(([0], gaps + 1))
        ends = np.concatenate((gaps, [len(cols) - 1]))
        s, e = max(zip(starts, ends, strict=True), key=lambda r: cols[r[1]] - cols[r[0]])
        left, right = cols[s], cols[e]
        if left <= 1 or right >= mask.shape[1] - 2:
            continue  # cropped by the frame: not the body's width
        widths[y], middles[y] = right - left + 1, (left + right) / 2
    return widths, middles


def fit(profile: Profile, widths: np.ndarray, height: int) -> tuple[float, float, float, float]:
    """Pixels per millimetre, centre row, cost and share of rows used, by grid search."""
    rows = np.arange(height, dtype=np.float64)
    valid = ~np.isnan(widths)
    best = (math.inf, 0.0, 0.0, 0.0)
    for scale in np.geomspace(0.3, 12.0, 160):
        for centre in np.linspace(0.1 * height, 0.9 * height, 81):
            model = profile.at((centre - rows) / scale) * scale
            usable = valid & ~np.isnan(model)
            share = usable.sum() / height
            if share < MIN_ROWS:
                continue
            cost = float(np.median(np.abs(np.log(widths[usable] / model[usable]))))
            # The plates were prompted with the zone in the middle of the frame: a mild prior.
            cost += 0.02 * abs(centre / height - 0.5)
            if cost < best[0]:
                best = (cost, float(scale), float(centre), float(share))
    return best[1], best[2], best[0], best[3]


#: The review of every plate on the contact sheet (TASK-0120). A plate not listed keeps the
#: measured fit, centred on the silhouette at the fitted row. Otherwise:
#: - ``convention``: the plate is framed tightly on its zone (a hand, a wrist, an ankle), which is
#:   what the framing convention assumes, so it stays;
#: - ``row`` and ``refMm``: the silhouette's width at that row is the body's reference width there
#:   (adult averages), where the profile fit was wrong (a hanging arm joined the torso);
#: - ``heightMm``: an estimate from a reviewed sibling plate, where neither could be read;
#: - ``centre``: where the zone's centre is, set by eye, as fractions of the picture.
REVIEW: dict[str, dict[str, Any]] = {
    "ankle-feminine": {"convention": True},
    "ankle-masculine": {"convention": True},
    "behind_ear-feminine": {"convention": True},
    "behind_ear-masculine": {"convention": True},
    "collarbone-feminine": {"convention": True},
    "collarbone-masculine": {"convention": True},
    "finger-feminine": {"convention": True},
    "finger-masculine": {"convention": True},
    "foot-feminine": {"convention": True},
    "foot-masculine": {"convention": True},
    "hand-feminine": {"convention": True},
    "hand-masculine": {"convention": True},
    "neck-feminine": {"convention": True},
    "neck-masculine": {"convention": True},
    "wrist_inner-feminine": {"convention": True},
    "wrist_inner-masculine": {"convention": True},
    "wrist_outer-feminine": {"convention": True},
    "wrist_outer-masculine": {"convention": True},
    "sternum-feminine": {"convention": True},
    # A pectoral, as the 3D chest zone is: the right one, on the picture's left.
    "chest-feminine": {"centre": (0.30, 0.58)},
    "chest-masculine": {"centre": (0.18, 0.49)},
    "ribs-feminine": {"centre": (None, 0.55)},
    "inner_forearm-feminine": {"centre": (None, 0.5)},
    "inner_forearm-masculine": {"centre": (None, 0.5)},
    "outer_forearm-feminine": {"centre": (None, 0.5)},
    "outer_forearm-masculine": {"centre": (None, 0.5)},
    # Seen from the side: the deltoid's depth, and the upper arm's width, at mid-frame.
    "shoulder-feminine": {"row": 0.55, "refMm": 110, "centre": (None, 0.4)},
    "shoulder-masculine": {"row": 0.55, "refMm": 125, "centre": (None, 0.4)},
    "upper_arm_inner-feminine": {"row": 0.5, "refMm": 90},
    "upper_arm_inner-masculine": {"row": 0.5, "refMm": 105},
    "upper_arm_outer-feminine": {"row": 0.5, "refMm": 90},
    "upper_arm_outer-masculine": {"row": 0.5, "refMm": 105},
    # The dress hides the sides of the back: the masculine plate's framing (649 mm, measured),
    # scaled by the reference bodies' heights (1.62 m against 1.73 m).
    "upper_back-feminine": {"heightMm": 608.0, "centre": (0.5, 0.43)},
}


def _middle(middles: np.ndarray, row: int, fallback: float) -> float:
    near = middles[max(0, row - 15) : row + 16]
    return float(np.nanmedian(near)) if np.isfinite(near).any() else fallback


def calibrate(path: Path) -> dict[str, Any]:
    zone, body = path.stem.rsplit("-", 1)
    review = REVIEW.get(path.stem, {})
    with Image.open(path) as source:
        photo = source.convert("RGB")
    entry: dict[str, Any] = {"zone": zone, "body": body, "calibrated": False}
    if review.get("convention"):
        entry["method"] = "convention"
        return entry
    measured = silhouette(photo)
    centre_x, centre_y = review.get("centre", (None, None))
    if "heightMm" in review:
        scale, row = photo.height / review["heightMm"], centre_y * photo.height
        entry["method"] = "reviewed-estimate"
    elif "refMm" in review:
        if measured is None:
            entry["reason"] = "no silhouette"
            return entry
        row = review["row"] * photo.height
        band = measured[0][int(row) - 10 : int(row) + 11]
        if not np.isfinite(band).any():
            entry["reason"] = "no silhouette at the reviewed row"
            return entry
        scale = float(np.nanmedian(band)) / review["refMm"]
        entry["method"] = "silhouette-width"
    else:
        profile = profile_for(body, zone)
        if profile is None or measured is None:
            entry["reason"] = "no profile" if profile is None else "no silhouette"
            return entry
        scale, row, cost, share = fit(profile, measured[0], photo.height)
        entry.update(cost=round(cost, 4), rowsUsed=round(share, 3), method="silhouette-fit")
        if not math.isfinite(cost) or cost > MAX_COST:
            entry["reason"] = "poor fit"
            return entry
    if centre_y is not None:
        row = centre_y * photo.height
    if centre_x is None:
        middles = measured[1] if measured is not None else np.full(photo.height, np.nan)
        centre_x = _middle(middles, round(row), photo.width / 2) / photo.width
    entry.update(
        calibrated=True,
        centreX=round(float(centre_x), 4),
        centreY=round(float(row) / photo.height, 4),
        widthMm=round(photo.width / scale, 1),
        heightMm=round(photo.height / scale, 1),
    )
    return entry


def convention(zone: str, size: tuple[int, int]) -> dict[str, float]:
    """The framing every plate was assumed to have before calibration."""
    span = ZONE_SPAN_MM.get(zone, (0.0, 400.0))[1]
    height_mm = span / SKIN_FRAME_FRACTION
    return {
        "centreX": 0.5,
        "centreY": 0.5,
        "heightMm": height_mm,
        "widthMm": height_mm * size[0] / size[1],
    }


def draw_sheet(entries: list[dict[str, Any]], directory: Path) -> None:
    """Contact sheets: each plate with its zone's reference rectangle at the calibrated scale."""
    directory.mkdir(parents=True, exist_ok=True)
    tiles = []
    for entry in entries:
        path = PLATES / f"{entry['zone']}-{entry['body']}.webp"
        with Image.open(path) as source:
            tile = source.convert("RGB")
            tile.thumbnail((256, 384))
        frame = entry if entry["calibrated"] else convention(entry["zone"], tile.size)
        span_w, span_h = ZONE_SPAN_MM.get(entry["zone"], (100.0, 100.0))
        sx, sy = tile.width / frame["widthMm"], tile.height / frame["heightMm"]
        cx, cy = frame["centreX"] * tile.width, frame["centreY"] * tile.height
        draw = ImageDraw.Draw(tile)
        colour = (0, 220, 0) if entry["calibrated"] else (230, 40, 40)
        draw.rectangle(
            (
                cx - span_w * sx / 2,
                cy - span_h * sy / 2,
                cx + span_w * sx / 2,
                cy + span_h * sy / 2,
            ),
            outline=colour,
            width=2,
        )
        draw.line((cx - 6, cy, cx + 6, cy), fill=colour, width=2)
        draw.line((cx, cy - 6, cx, cy + 6), fill=colour, width=2)
        label = f"{entry['zone']} {entry['body'][0]} {entry.get('cost', '-')}"
        draw.rectangle((0, 0, tile.width, 14), fill=(0, 0, 0))
        draw.text((3, 1), label, fill=colour)
        tiles.append(tile)
    per_sheet = 8
    for index in range(0, len(tiles), per_sheet):
        group = tiles[index : index + per_sheet]
        sheet = Image.new("RGB", (256 * 4, 384 * 2), (20, 20, 20))
        for n, tile in enumerate(group):
            sheet.paste(tile, ((n % 4) * 256, (n // 4) * 384))
        sheet.save(directory / f"sheet-{index // per_sheet + 1:02d}.png")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sheet", type=Path, help="draw review sheets into this directory")
    parser.add_argument("--only", nargs="*", help="plate stems to measure (default: all)")
    parser.add_argument("--dry-run", action="store_true", help="print, do not write")
    args = parser.parse_args()
    paths = sorted(PLATES.glob("*.webp"))
    if args.only:
        paths = [p for p in paths if p.stem in args.only]
    entries = [calibrate(path) for path in paths]
    for entry in entries:
        print(json.dumps(entry, ensure_ascii=False))
    if args.sheet:
        draw_sheet(entries, args.sheet)
    if not args.dry_run and not args.only:
        plates = {
            f"{e['zone']}-{e['body']}": {
                k: e[k] for k in ("centreX", "centreY", "widthMm", "heightMm", "method")
            }
            for e in entries
            if e["calibrated"]
        }
        OUTPUT.write_text(
            json.dumps({"version": 1, "plates": plates}, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
            newline="\n",
        )


if __name__ == "__main__":
    main()
