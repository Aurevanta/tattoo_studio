"""TASK-0104 (ADR-0034): a sleeve is drawn, its seam redrawn, shown by its visible half, and
counted as two designs."""

from __future__ import annotations

import base64
import io
from pathlib import Path
from typing import Any, cast

import numpy as np
import pytest
from PIL import Image, ImageDraw

from app.studio import SLEEVE_FIXED, Studio, sleeve_notice
from app.tests.test_studio import FakeProvider, payload, picture
from generation.studio import SEAM_REPAIR, SLEEVE_CANVAS, SLEEVE_DESIGN, StudioProvider, canvas
from jobs.queue import design_cost
from jobs.quota import SLEEVE_NEEDS_TWO, Limits, QuotaExceededError

OWNER = "11111111-1111-4111-8111-111111111111"


def sleeve_payload(body_part: str = "calf") -> dict[str, Any]:
    request = payload()
    request["brief"]["placement"] = {"bodyPart": body_part, "orientation": "wrapping"}
    request["brief"]["size"] = (
        {"widthMm": 344, "heightMm": 310}
        if body_part in ("calf", "shin")
        else {"widthMm": 255, "heightMm": 215}
    )
    return request


def wrapping_lines(width: int = 1024, height: int = 1024, seam: bool = False) -> bytes:
    """Line art across the whole width; continuous across its edges unless `seam`."""
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    for k in range(-1, 9):  # a ring every 128 px, so the width is a whole number of repeats
        draw.ellipse((k * 128, 300, k * 128 + 180, 700), outline="black", width=10)
    pixels = np.asarray(image)
    if seam:
        pixels = np.concatenate([pixels[:, :900], np.asarray(image)[:, 500:624]], axis=1)
    out = io.BytesIO()
    Image.fromarray(pixels).save(out, format="PNG")
    return out.getvalue()


class SleeveProvider(FakeProvider):
    """Draws a sleeve with a join; each repair returns the art `repairs` says, in turn."""

    def __init__(self, repairs: list[bytes]) -> None:
        super().__init__()
        self.repairs = list(repairs)
        self.repaired: list[bytes] = []
        self.prompts: list[str] = []

    def lineart(
        self, brief: dict[str, Any], references: list[bytes], analysis: str, correction: str = ""
    ) -> bytes:
        self.calls += 1
        return wrapping_lines(seam=True)

    def repair_seam(self, brief: dict[str, Any], artwork: bytes) -> bytes:
        self.repaired.append(artwork)
        return self.repairs.pop(0)


def run(studio: Studio, request: dict[str, Any]) -> dict[str, Any]:
    ref = studio.ingest(
        OWNER,
        {
            "data": base64.b64encode(picture()).decode(),
            "kind": "reference",
            "adult": True,
            "consent": True,
        },
    )
    request["referenceIds"] = [ref["assetId"]]
    job = studio.jobs.enqueue(OWNER, request)
    assert studio.jobs.tick()
    result = studio.jobs.get(OWNER, job["jobId"])
    assert result["state"] == "succeeded", result
    return cast(dict[str, Any], result["result"])


def test_a_sleeve_has_its_seam_redrawn_once_when_that_closes_it(tmp_path: Path) -> None:
    provider = SleeveProvider([wrapping_lines()])
    artifact = run(Studio(tmp_path, b"x" * 32, provider), sleeve_payload())
    assert len(provider.repaired) == 1
    assert "Manga completa" in artifact["notice"]
    assert "puede notarse" not in artifact["notice"]
    assert artifact["size"] == {"widthMm": 344, "heightMm": 310}


def test_a_join_still_cut_gets_one_more_repair_and_then_is_said(tmp_path: Path) -> None:
    provider = SleeveProvider([wrapping_lines(seam=True), wrapping_lines(seam=True)])
    artifact = run(Studio(tmp_path, b"x" * 32, provider), sleeve_payload())
    assert len(provider.repaired) == 2
    assert "puede notarse" in artifact["notice"]


def test_a_band_is_not_a_sleeve_and_has_no_repair(tmp_path: Path) -> None:
    provider = SleeveProvider([])
    request = sleeve_payload()
    request["brief"]["size"] = {"widthMm": 120, "heightMm": 60}
    artifact = run(Studio(tmp_path, b"x" * 32, provider), request)
    assert provider.repaired == []
    assert "Manga" not in artifact["notice"]


def test_the_mockup_shows_the_half_facing_the_camera(tmp_path: Path) -> None:
    """The visible half is half the circumference wide; the master stays the whole sleeve."""
    provider = SleeveProvider([wrapping_lines()])
    studio = Studio(tmp_path, b"x" * 32, provider)
    artifact = run(studio, sleeve_payload())
    with Image.open(io.BytesIO(studio.owned(OWNER, artifact["master"]["assetId"]))) as master:
        assert master.width / master.height == pytest.approx(344 / 310, rel=0.02)
    assert artifact["transform"]["widthPx"] > 0


def test_a_sleeve_counts_as_two_designs(tmp_path: Path) -> None:
    assert design_cost(sleeve_payload()) == 2
    assert design_cost(payload()) == 1
    placement = payload()
    placement["edit"] = {
        "parentJobId": "a" * 32,
        "instruction": "más grande",
        "coverage": "larger",
        "mode": "placement",
    }
    assert design_cost(placement) == 0
    studio = Studio(tmp_path, b"x" * 32, SleeveProvider([wrapping_lines()]))
    studio.jobs.limits = Limits(designs_per_account=3)
    run(studio, sleeve_payload())
    assert studio.jobs.designs_today(OWNER)[0] == 2
    second = sleeve_payload()
    second["idempotencyKey"] = "22222222-2222-4222-8222-222222222222"
    with pytest.raises(QuotaExceededError) as refused:
        studio.jobs.enqueue(OWNER, second)
    assert str(refused.value) == SLEEVE_NEEDS_TWO


def test_the_prompt_and_canvas_ask_for_a_continuous_unrolled_design() -> None:
    brief = sleeve_payload()["brief"]
    prompt = StudioProvider.artwork_prompt(brief, "", colour=False)
    assert SLEEVE_DESIGN in prompt
    assert canvas(brief) == SLEEVE_CANVAS
    assert canvas(payload()["brief"]) == "1536x1024"
    assert SLEEVE_DESIGN not in StudioProvider.artwork_prompt(payload()["brief"], "", colour=False)
    assert "pure white" in SEAM_REPAIR


def test_the_seam_repair_sends_the_rolled_design_and_its_mask() -> None:
    """One edit call: the design turned half way, a mask open down the middle, nothing else."""
    sent: dict[str, Any] = {}

    class Response:
        status_code = 200

        def json(self) -> dict[str, Any]:
            out = io.BytesIO()
            Image.new("RGB", (1024, 1024), "white").save(out, format="PNG")
            return {"data": [{"b64_json": base64.b64encode(out.getvalue()).decode()}]}

    class Client:
        def post(self, url: str, **kwargs: Any) -> Response:
            sent["url"] = url
            sent.update(kwargs)
            return Response()

    provider = StudioProvider("key")
    provider.client = Client()  # type: ignore[assignment]
    provider.accept_output = lambda data: data  # type: ignore[method-assign]
    original = wrapping_lines()
    repaired = provider.repair_seam(sleeve_payload()["brief"], original)
    assert sent["url"].endswith("/images/edits")
    assert sent["data"]["prompt"] == SEAM_REPAIR and sent["data"]["size"] == SLEEVE_CANVAS
    names = [name for name, _ in sent["files"]]
    assert names == ["image[]", "mask"]
    with Image.open(io.BytesIO(repaired)) as image:
        result = np.asarray(image.convert("RGB"))
    with Image.open(io.BytesIO(original)) as image:
        before = np.asarray(image.convert("RGB"))
    # The editor answered blank paper; only the join's band, on the edges, may have taken it.
    assert (result[:, 200:824] == before[:, 200:824]).all()


def test_the_notice_names_the_limb_and_the_unrolled_size() -> None:
    forearm = sleeve_payload("outer_forearm")["brief"]
    assert "la piel de un antebrazo" in sleeve_notice(forearm, False)
    assert "de 25,5 por 21,5 cm" in sleeve_notice(forearm, False)
    assert "la piel de una pierna" in sleeve_notice(sleeve_payload()["brief"], True)


def test_a_sleeve_is_not_resized_by_the_coverage_controls(tmp_path: Path) -> None:
    studio = Studio(tmp_path, b"x" * 32, SleeveProvider([wrapping_lines()]))
    first = run(studio, sleeve_payload())
    job = studio.jobs.history(OWNER)[0]["jobId"]
    request = sleeve_payload()
    request["referenceIds"] = []
    request["idempotencyKey"] = "33333333-3333-4333-8333-333333333333"
    request["edit"] = {
        "parentJobId": job,
        "instruction": "más grande",
        "coverage": "larger",
        "mode": "placement",
    }
    queued = studio.jobs.enqueue(OWNER, request)
    assert studio.jobs.tick()
    failed = studio.jobs.get(OWNER, queued["jobId"])
    assert failed["state"] == "failed" and failed["error"] == SLEEVE_FIXED
    assert first["size"] == {"widthMm": 344, "heightMm": 310}


def test_a_sleeve_brings_its_stencil_unrolled_and_in_four_panels(tmp_path: Path) -> None:
    """TASK-0105: the SVG is the skin at each height's circumference; the panels are a PDF."""
    import re

    from tattoo_contracts.sleeve import WRAP_REGIONS
    from tattoo_contracts.validation import validate

    from app.shares import shared_design, shared_files

    provider = SleeveProvider([wrapping_lines()])
    studio = Studio(tmp_path, b"x" * 32, provider)
    request = sleeve_payload()
    artifact = run(studio, request)
    assert (
        artifact["panels"]["mimeType"] == artifact["panelsMirror"]["mimeType"] == "application/pdf"
    )
    pdf = studio.owned(OWNER, artifact["panels"]["assetId"])
    assert b"Panel 1 of 4: Detr" in pdf and b"Panel 3 of 4: Delante" in pdf
    svg = studio.owned(OWNER, artifact["stencil"]["assetId"]).decode()
    xs = [float(x) for x in re.findall(r"(-?\d+(?:\.\d+)?),-?\d+(?:\.\d+)?", svg)]
    region = WRAP_REGIONS["lower_leg"]
    # Unrolled: nothing lies outside the widest circumference, and the ink narrows with the limb.
    assert min(xs) >= -0.5 and max(xs) <= region.circumference_mm + 0.5
    # The tattooer's link shares the panels as well.
    shared = shared_design(artifact, request, 0.0, 86400.0)
    assert not validate("shared-design", shared)
    assert artifact["panels"]["assetId"] in shared_files(shared)


def test_an_ordinary_design_has_no_panels(tmp_path: Path) -> None:
    provider = SleeveProvider([])
    request = sleeve_payload()
    request["brief"]["size"] = {"widthMm": 120, "heightMm": 60}
    artifact = run(Studio(tmp_path, b"x" * 32, provider), request)
    assert "panels" not in artifact and "panelsMirror" not in artifact


def test_a_sleeves_stencil_is_drawn_for_the_body_its_plate_shows() -> None:
    """TASK-0110: a generated plate's body names the profile; an own photo keeps the neutral one."""
    from app.studio import design_body, design_zone

    placement = {"bodyPart": "calf", "orientation": "wrapping"}
    brief: dict[str, object] = {"briefId": "b", "placement": placement}
    named: dict[str, object] = {"briefId": "b", "placement": {**placement, "bodyType": "feminine"}}
    assert design_body(named, {}) == "feminine"
    assert design_body(brief, {}) in ("masculine", "feminine")
    assert design_body(named, {"bodyPhotoId": "x"}) is None
    assert design_zone(named, {})["bodyType"] == "feminine"
    assert "bodyType" not in design_zone(named, {"bodyPhotoId": "x"})
