"""The whole round trip keeps the design, its place and its millimetres, PDF included (TASK-0124).

Generate, move and resize in the editor, nudge it larger, then close the studio and open it again
on the same data, as a restart or a new session does. What the client and the tattooer reopen —
the version, its placement, its size, the stencil SVG, both PDFs and the tattooer's link — must be
what was saved.
"""

from __future__ import annotations

import io
import math
import re
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from tattoo_contracts.validation import validate

from app.studio import Studio, router
from app.tests.test_skin_frame import AS_OWNER, back_design
from app.tests.test_studio import ACCOUNT, FakeProvider
from generation.plate_library import PlateLibrary
from mockup.placement import parent_placement
from stencil.engine import TILE_AREA_MM, TILE_OVERLAP_MM, tile_grid

KEY = b"x" * 32
PT_PER_MM = 72 / 25.4
SERVICE = {"Authorization": "Bearer test-only-token"}


def client_of(studio: Studio) -> TestClient:
    return TestClient(FastAPI(routes=router(studio, "test-only-token").routes))


def edit(client: TestClient, studio: Studio, change: dict[str, Any], key: str) -> dict[str, Any]:
    answer = client.post(
        "/studio/jobs", json={"edit": change, "idempotencyKey": key}, headers=AS_OWNER
    )
    assert answer.status_code == 202, answer.text
    assert studio.jobs.tick()
    status = client.get(f"/studio/jobs/{answer.json()['jobId']}", headers=AS_OWNER).json()
    assert status["state"] == "succeeded", status
    return dict(status)


def editor_start(studio: Studio, result: dict[str, Any]) -> dict[str, float]:
    """Where the live editor opens a result: the worker's half of `initialPlacement`."""
    skin = studio.owned(ACCOUNT, result["background"]["assetId"], "artifact")
    with Image.open(io.BytesIO(skin)) as image:
        image.thumbnail((2048, 2048))
        frame = image.size
    return parent_placement(
        result["transform"],
        frame,
        studio.visible_box(ACCOUNT, result),
        size=result["size"],
        skin=result.get("skinFrame"),
    )


def pdf_pages(data: bytes) -> list[tuple[float, float]]:
    """Each page's MediaBox in points (reportlab writes them uncompressed)."""
    boxes = re.findall(rb"/MediaBox \[\s*0 0 ([\d.]+) ([\d.]+)\s*\]", data)
    return [(float(w), float(h)) for w, h in boxes]


def pdf_stroke_extent(data: bytes) -> tuple[float, float, float, float]:
    """The bounding box of the first page's design strokes, in points.

    The design's paths come first in the page's stream; the label (set in 8 pt) and the 50 mm
    calibration bar after it are left out.
    """
    stream = data.split(b"endstream")[0].split(b"stream", 1)[1]
    first = stream.split(b"BT /F1 8 Tf")[0]
    points = [(float(x), float(y)) for x, y in re.findall(rb"([\d.]+) ([\d.]+) [ml]\b", first)]
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def test_a_design_survives_editing_saving_closing_and_reopening(tmp_path: Path) -> None:
    # 1. Generate.
    studio = Studio(tmp_path, KEY, FakeProvider(), PlateLibrary())
    client = client_of(studio)
    first_id = back_design(studio, side="right")
    first = client.get(f"/studio/jobs/{first_id}", headers=AS_OWNER).json()["result"]

    # 2. Modify in the editor: move it and make it 80 % as large, then save (confirmed).
    start = editor_start(studio, first)
    chosen = {
        **start,
        "centreX": start["centreX"] - 0.05,
        "centreY": start["centreY"] + 0.04,
        "width": start["width"] * 0.8,
        "height": start["height"] * 0.8,
        "angle": 12.0,
    }
    moved = edit(
        client,
        studio,
        {
            "parentJobId": first_id,
            "instruction": "Ajuste manual de tamaño, posición y giro sobre la piel",
            "placement": chosen,
        },
        "33333333-3333-4333-8333-333333333333",
    )
    after_editor = moved["result"]
    assert after_editor["size"]["widthMm"] == pytest.approx(first["size"]["widthMm"] * 0.8, abs=1)
    assert after_editor["size"]["heightMm"] == pytest.approx(first["size"]["heightMm"] * 0.8, abs=1)

    # 3. «Más grande», confirmed (ADR-0043).
    nudged = edit(
        client,
        studio,
        {
            "parentJobId": moved["jobId"],
            "instruction": "más grande",
            "coverage": "larger",
            "mode": "placement",
        },
        "44444444-4444-4444-8444-444444444444",
    )
    saved = nudged["result"]
    assert saved["size"] == {
        "widthMm": math.floor(after_editor["size"]["widthMm"] * 1.25 + 0.5),
        "heightMm": math.floor(after_editor["size"]["heightMm"] * 1.25 + 0.5),
    }
    share = client.post("/studio/shares", json={"jobId": nudged["jobId"]}, headers=AS_OWNER)
    assert share.status_code == 201, share.text
    token = share.json()["token"]

    # 4. Close the studio and open it again on the same data.
    studio.jobs.stop.set()
    reopened = Studio(tmp_path, KEY, FakeProvider(), PlateLibrary())
    client = client_of(reopened)

    history = client.get("/studio/jobs", headers=AS_OWNER).json()
    assert [status["jobId"] for status in history][:3] == [
        nudged["jobId"],
        moved["jobId"],
        first_id,
    ]
    status = client.get(f"/studio/jobs/{nudged['jobId']}", headers=AS_OWNER).json()
    assert validate("studio-status", status) == []
    result = status["result"]

    # The design: the same version, drawing and vector identity.
    for name in ("designId", "size", "master", "stencil", "stencilMirror", "pdf", "pdfMirror"):
        assert result[name] == saved[name], name
    # Its place and turn, as saved, and the editor reopens there at the printed size.
    assert result["transform"]["placement"] == saved["transform"]["placement"]
    placed = result["transform"]["placement"]
    assert placed["angle"] == pytest.approx(12.0, abs=0.01)
    assert (placed["centreX"], placed["centreY"]) == pytest.approx(
        (chosen["centreX"], chosen["centreY"]), abs=2e-3
    )
    again = editor_start(reopened, result)
    assert again == pytest.approx(placed, abs=2e-3)
    skin = result["skinFrame"]
    _, _, box_w, box_h, _, _ = reopened.visible_box(ACCOUNT, result)
    assert again["height"] * skin["heightMm"] == pytest.approx(result["size"]["heightMm"], rel=0.01)
    assert again["width"] * skin["widthMm"] == pytest.approx(
        result["size"]["heightMm"] * box_w / box_h, rel=0.01
    )

    # The stencil SVG carries the millimetres.
    width, height = result["size"]["widthMm"], result["size"]["heightMm"]
    svg = client.get(f"/studio/media/{result['stencil']['assetId']}", headers=AS_OWNER).text
    assert f'width="{width:g}mm"' in svg and f'height="{height:g}mm"' in svg

    # Both PDFs: the full-size page, its label, ink inside the design, and the A4 pieces.
    for name in ("pdf", "pdfMirror"):
        pdf = client.get(f"/studio/media/{result[name]['assetId']}", headers=AS_OWNER).content
        pages = pdf_pages(pdf)
        assert pages[0] == pytest.approx(
            (max(width + 20, 80) * PT_PER_MM, (height + 35) * PT_PER_MM), abs=0.01
        )
        assert f"{width:g} x {height:g} mm - Print 100%, no fit".encode() in pdf
        x0, y0, x1, y1 = pdf_stroke_extent(pdf)
        assert x0 >= 10 * PT_PER_MM - 0.5 and x1 <= (10 + width) * PT_PER_MM + 0.5
        assert y1 <= pages[0][1] - 10 * PT_PER_MM + 0.5
        assert y0 >= pages[0][1] - (10 + height) * PT_PER_MM - 0.5
        columns, rows = tile_grid(width, height)
        assert len(pages) == 1 + columns * rows
        assert all(page == pytest.approx((210 * PT_PER_MM, 297 * PT_PER_MM)) for page in pages[1:])
        assert TILE_AREA_MM[1] - TILE_OVERLAP_MM < height  # this design needs pieces

    # The tattooer's link shows the same size and the same files after the restart.
    shared = client.get("/studio/shares", headers={**SERVICE, "X-Share-Token": token}).json()
    assert shared["size"] == result["size"]
    assert shared["pdf"] == result["pdf"]
    printed = client.get(
        f"/studio/shares/media/{result['pdf']['assetId']}",
        headers={**SERVICE, "X-Share-Token": token},
    )
    assert printed.status_code == 200 and printed.content.startswith(b"%PDF")
