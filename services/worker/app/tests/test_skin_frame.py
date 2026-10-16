"""The mockup and the 3D views place a design by the same millimetres (TASK-0120, ADR-0042)."""

from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from tattoo_contracts.validation import validate

from app.build_plate_calibration import REVIEW
from app.studio import Studio, router
from app.tests.test_studio import ACCOUNT, FakeProvider, an_upload, colour_picture, payload
from generation.plate_library import PLATES, PlateLibrary
from mockup.placement import parent_placement


class Redraws(FakeProvider):
    """A provider that redraws a design when a change is asked."""

    def edit_artwork(
        self,
        brief: dict[str, Any],
        master: bytes,
        references: list[bytes],
        instruction: str,
        *,
        rendered: bool,
        attached: int = 0,
    ) -> bytes:
        return colour_picture("blue")


AS_OWNER = {"Authorization": "Bearer test-only-token", "X-Owner-Id": ACCOUNT}


def back_design(
    studio: Studio, size: tuple[float, float] = (180, 280), side: str = "centre"
) -> str:
    reference = studio.ingest(ACCOUNT, an_upload())
    request = payload()
    request["brief"]["placement"] = {
        "bodyPart": "upper_back",
        "orientation": "vertical",
        "side": side,
        "bodyType": "masculine",
    }
    request["brief"]["size"] = {"widthMm": size[0], "heightMm": size[1]}
    request["referenceIds"] = [reference["assetId"]]
    job = studio.jobs.enqueue(ACCOUNT, request)
    assert studio.jobs.tick()
    status = studio.jobs.get(ACCOUNT, job["jobId"])
    assert status["state"] == "succeeded", status
    return str(job["jobId"])


def visible_mm(studio: Studio, result: dict[str, Any]) -> tuple[float, float]:
    _, _, width, height, _, _ = studio.visible_box(ACCOUNT, result)
    return result["size"]["heightMm"] * width / height, result["size"]["heightMm"]


def test_every_plate_is_calibrated_or_reviewed_onto_the_convention() -> None:
    """AC-001: the committed calibration covers every plate the review did not leave as it was."""
    stored = json.loads((PLATES / "calibration.json").read_text(encoding="utf-8"))["plates"]
    for plate in sorted(PLATES.glob("*.webp")):
        if REVIEW.get(plate.stem, {}).get("convention"):
            assert plate.stem not in stored
            continue
        entry = stored[plate.stem]
        assert 0 < entry["centreX"] < 1 and 0 < entry["centreY"] < 1
        assert 50 < entry["heightMm"] < 2000
        assert entry["method"] in {"silhouette-fit", "silhouette-width", "reviewed-estimate"}
    # The case the owner reported: the back plate spans far more than the old 82 % rule said.
    assert stored["upper_back-masculine"]["heightMm"] > 600


def test_a_left_side_plate_mirrors_its_frame() -> None:
    library = PlateLibrary()
    right = library.frame(
        {"placement": {"bodyPart": "thigh_outer", "side": "right", "bodyType": "masculine"}}
    )
    left = library.frame(
        {"placement": {"bodyPart": "thigh_outer", "side": "left", "bodyType": "masculine"}}
    )
    assert right and left and right["calibrated"]
    assert left["centreX"] == pytest.approx(1 - right["centreX"], abs=1e-4)
    small = library.frame({"placement": {"bodyPart": "hand", "bodyType": "feminine"}})
    assert small == {"calibrated": False, "aspect": pytest.approx(1024 / 1536)}


def test_a_new_design_is_laid_at_its_millimetres_on_the_zone(tmp_path: Path) -> None:
    """AC-002: on a calibrated plate the mockup draws the printed size, on the zone's centre."""
    studio = Studio(tmp_path, b"x" * 32, FakeProvider(), PlateLibrary())
    status = studio.jobs.get(ACCOUNT, back_design(studio))
    assert validate("studio-status", status) == []
    result = status["result"]
    skin = result["skinFrame"]
    assert skin["calibrated"] and skin["heightMm"] > 600
    placed = result["transform"]["placement"]
    width_mm, height_mm = visible_mm(studio, result)
    assert placed["height"] * skin["heightMm"] == pytest.approx(height_mm, rel=0.01)
    assert placed["width"] * skin["widthMm"] == pytest.approx(width_mm, rel=0.01)
    assert (placed["centreX"], placed["centreY"]) == pytest.approx(
        (skin["centreX"], skin["centreY"]), abs=1e-3
    )


def test_a_moved_and_resized_design_keeps_the_view_and_the_print_in_step(tmp_path: Path) -> None:
    """AC-003: a placement chosen in the editor (or in 3D) is the print size in millimetres."""
    studio = Studio(tmp_path, b"x" * 32, Redraws(), PlateLibrary())
    client = TestClient(FastAPI(routes=router(studio, "test-only-token").routes))
    parent_id = back_design(studio)
    parent = studio.jobs.get(ACCOUNT, parent_id)["result"]
    start = parent["transform"]["placement"]
    chosen = {
        **start,
        "centreX": start["centreX"] + 0.12,
        "width": start["width"] * 0.5,
        "height": start["height"] * 0.5,
    }
    answer = client.post(
        "/studio/jobs",
        json={
            "edit": {
                "parentJobId": parent_id,
                "instruction": "Ajuste manual de tamaño, posición y giro sobre la piel",
                "placement": chosen,
            },
            "idempotencyKey": "33333333-3333-4333-8333-333333333333",
        },
        headers=AS_OWNER,
    )
    assert answer.status_code == 202, answer.text
    assert studio.jobs.tick()
    child = studio.jobs.get(ACCOUNT, answer.json()["jobId"])
    assert child["state"] == "succeeded", child
    result = child["result"]
    assert result["size"]["heightMm"] == pytest.approx(140, abs=0.6)
    skin = result["skinFrame"]
    placed = result["transform"]["placement"]
    assert placed["height"] * skin["heightMm"] == pytest.approx(140, rel=0.01)
    # 0.12 of the picture to the right is the same distance on the reference body.
    assert (placed["centreX"] - skin["centreX"]) * skin["widthMm"] == pytest.approx(
        0.12 * skin["widthMm"], rel=0.01
    )

    # A redraw asked from the moved version is drawn where it was, at its millimetres.
    redraw = client.post(
        "/studio/jobs",
        json={
            "edit": {"parentJobId": child["jobId"], "instruction": "Añade azul"},
            "idempotencyKey": "44444444-4444-4444-8444-444444444444",
        },
        headers=AS_OWNER,
    )
    assert redraw.status_code == 202, redraw.text
    assert studio.jobs.tick()
    redrawn = studio.jobs.get(ACCOUNT, redraw.json()["jobId"])
    assert redrawn["state"] == "succeeded", redrawn
    again = redrawn["result"]["transform"]["placement"]
    assert (again["centreX"], again["centreY"]) == pytest.approx(
        (placed["centreX"], placed["centreY"]), abs=2e-3
    )


def test_a_design_made_before_calibration_starts_at_its_printed_size(tmp_path: Path) -> None:
    """AC-004 (respect the stencil): an older result is read in its millimetres, not its pixels."""
    old = Studio(tmp_path, b"x" * 32, FakeProvider())  # composed without a known frame
    parent_id = back_design(old)
    old.jobs.stop.set()
    studio = Studio(tmp_path, b"x" * 32, FakeProvider(), PlateLibrary())
    parent = studio.jobs.get(ACCOUNT, parent_id)["result"]
    assert parent["skinFrame"]["calibrated"]
    assert "placement" not in parent["transform"]
    # Saving the placement it opens at changes nothing printed.
    background = studio.owned(ACCOUNT, parent["background"]["assetId"])
    with Image.open(io.BytesIO(background)) as photo:
        photo.thumbnail((2048, 2048))
        frame = photo.size
    start = parent_placement(
        parent["transform"],
        frame,
        studio.visible_box(ACCOUNT, parent),
        size=parent["size"],
        skin=parent["skinFrame"],
    )
    width_mm, height_mm = visible_mm(studio, parent)
    assert start["height"] * parent["skinFrame"]["heightMm"] == pytest.approx(height_mm, rel=0.01)
    assert start["width"] * parent["skinFrame"]["widthMm"] == pytest.approx(width_mm, rel=0.01)


def test_an_own_photo_and_a_capture_have_no_skin_frame(tmp_path: Path) -> None:
    studio = Studio(tmp_path, b"x" * 32, FakeProvider(), PlateLibrary())
    assert studio.describe({"brief": {}}, {"backgroundKind": "own_photo"}) == {}
    assert (
        studio.describe({"brief": {}}, {"backgroundKind": "generated_anatomy", "capture": {}}) == {}
    )
