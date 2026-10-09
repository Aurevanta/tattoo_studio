"""TASK-0019 acceptance. Real queue/storage/imaging, no network or paid models."""

from __future__ import annotations

import base64
import io
import json
import re
import time
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast
from xml.etree import ElementTree

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.studio import Studio, router
from generation.studio import ArtworkCheck, StudioProvider
from jobs import client_messages
from jobs.queue import JobQueue, billable_job
from jobs.quota import Limits, QuotaExceededError, TurnLedger
from media.store import EncryptedFileStore, RetentionClass
from mockup.anatomy import ZONE_SPAN_MM
from mockup.engine import composite, visible_size
from mockup.placement import Coverage, coverage_request, fit_coverage
from safety.gate import ModerationOutcome
from stencil.engine import (
    Master,
    export_pdf,
    export_svg,
    rasterize,
    trace_colour_artwork,
    trace_native_lineart,
)
from telemetry import configure
from telemetry.store import EventStore, sqlite_store
from telemetry.usage import Prices, configure_prices


def picture(lines: bool = True) -> bytes:
    image = Image.new("RGB", (200, 300), "white" if lines else "#c29880")
    if lines:
        draw = ImageDraw.Draw(image)
        draw.ellipse((40, 30, 160, 160), outline="black", width=3)
        draw.line((100, 160, 100, 270), fill="black", width=3)
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


class FakeProvider(StudioProvider):
    def __init__(self) -> None:
        self.calls = 0
        self.references: list[bytes] = []

    def moderation(self) -> Any:
        return self

    def classify(self, data: bytes) -> ModerationOutcome:
        return ModerationOutcome(explicit=False, contains_person=False)

    def check_artwork(self, brief: dict[str, Any], artwork: bytes) -> ArtworkCheck | None:
        # TASK-0090: the fakes draw what is asked; tests of the review override this.
        return ArtworkCheck(depicts_body=False, subject_present=True)

    def analyze(self, references: list[bytes], subject: str) -> str:
        self.references = references
        return "Referencia de prueba: contorno circular y línea vertical."

    def lineart(
        self,
        brief: dict[str, Any],
        references: list[bytes],
        analysis: str,
        correction: str = "",
    ) -> bytes:
        self.calls += 1
        assert references == self.references
        return picture()

    def background(self, brief: dict[str, Any]) -> bytes:
        return picture(False)

    def colour_artwork(
        self,
        brief: dict[str, Any],
        references: list[bytes],
        analysis: str,
        correction: str = "",
    ) -> bytes:
        self.calls += 1
        assert references == self.references
        return colour_picture()


def colour_picture(colour: str = "red") -> bytes:
    image = Image.new("RGB", (200, 300), "white")
    ImageDraw.Draw(image).ellipse((40, 30, 160, 260), fill=colour)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def payload() -> dict[str, Any]:
    root = Path(__file__).resolve().parents[4]
    return cast(
        dict[str, Any],
        json.loads((root / "contracts/fixtures/studio-job/valid/minimal.json").read_text()),
    )


def test_native_master_is_shared_and_pdf_has_physical_size() -> None:
    master = trace_native_lineart(picture(), 80, 150)
    assert master.paths
    svg = ElementTree.fromstring(export_svg(master))
    assert svg.attrib["width"] == "80mm" and svg.attrib["height"] == "150mm"
    mirrored = ElementTree.fromstring(export_svg(master, True))
    ns = {"s": "http://www.w3.org/2000/svg"}
    group = mirrored.find("s:g", ns)
    assert group is not None
    assert group.attrib["transform"] == "translate(80 0) scale(-1 1)"
    assert [p.attrib for p in svg.findall(".//s:polyline", ns)] == [
        p.attrib for p in mirrored.findall(".//s:polyline", ns)
    ]
    pdf = export_pdf(master)
    media = re.search(rb"/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)", pdf)
    assert media
    assert float(media[1]) == pytest.approx(100 * 72 / 25.4, abs=0.001)
    assert float(media[2]) == pytest.approx(185 * 72 / 25.4, abs=0.001)
    assert b"Calibration: 50 mm" in pdf
    assert master.design_hash.encode() in pdf


def test_ink_geometry_is_exactly_resized_master_without_generated_redraw() -> None:
    master = Master([[(5, 5), (20, 25)]], 30, 40, 0.3)
    art = rasterize(master)
    rendered, transform = composite(
        art, picture(False), {"widthMm": 30, "heightMm": 40}, {"x": 0.2, "y": 0.1, "width": 0.3}
    )
    output = np.asarray(Image.open(io.BytesIO(rendered)))
    original = np.asarray(Image.open(io.BytesIO(picture(False))))
    x, y, w, h = [transform[k] for k in ("xPx", "yPx", "widthPx", "heightPx")]
    ink = np.asarray(art.resize((w, h), Image.Resampling.LANCZOS), dtype=np.float32) / 255
    expected = (original[y : y + h, x : x + w] * (0.15 + 0.85 * ink)).astype(np.uint8)
    assert np.array_equal(output[y : y + h, x : x + w], expected)
    assert transform["generativePostprocess"] is False
    assert transform["scaleCalibrated"] is False
    with pytest.raises(ValueError, match="fuera"):
        composite(
            art,
            picture(False),
            {"widthMm": 30, "heightMm": 40},
            {"x": 0.95, "y": 0.9, "width": 0.9},
        )


def test_blank_lineart_is_rejected() -> None:
    with pytest.raises(ValueError, match="line-art"):
        trace_native_lineart(picture(False), 80, 150)


def test_fresh_ink_is_deterministic_local_and_keeps_source_unchanged() -> None:
    source = Image.open(io.BytesIO(colour_picture())).convert("RGB")
    before = source.tobytes()
    args = (source, picture(False), {"widthMm": 80.0, "heightMm": 150.0})
    result, transform = composite(*args, fresh=True, curvature=0.5)
    assert result == composite(*args, fresh=True, curvature=0.5)[0]
    assert source.tobytes() == before
    original = np.asarray(Image.open(io.BytesIO(picture(False))))
    image = np.asarray(Image.open(io.BytesIO(result)))
    x, y = transform["xPx"], transform["yPx"]
    assert np.array_equal(image[:y], original[:y])
    assert np.array_equal(image[:, :x], original[:, :x])
    assert transform["method"] == "fresh-ink-composite"
    assert transform["generativePostprocess"] is False
    assert transform["curvature"] == 0.5


def test_owned_media_job_idempotency_lineage_and_deletion(tmp_path: Path) -> None:
    provider = FakeProvider()
    studio = Studio(tmp_path, b"x" * 32, provider)
    owner = "11111111-1111-4111-8111-111111111111"
    ref = studio.ingest(
        owner,
        {
            "data": base64.b64encode(picture()).decode(),
            "kind": "reference",
            "adult": True,
            "consent": True,
        },
    )
    request = payload()
    request["referenceIds"] = [ref["assetId"]]
    a = studio.jobs.enqueue(owner, request)
    b = studio.jobs.enqueue(owner, request)
    assert a["jobId"] == b["jobId"]
    assert studio.jobs.tick()
    result = studio.jobs.get(owner, a["jobId"])
    assert result["state"] == "succeeded", result
    artifact = result["result"]
    assert provider.calls == 1
    assert artifact["stencil"]["designId"] == artifact["mockup"]["designId"] == artifact["designId"]
    assert not studio.jobs.tick()
    with pytest.raises(KeyError):
        studio.owned("another-owner", ref["assetId"])
    with pytest.raises(KeyError):
        studio.jobs.get("another-owner", a["jobId"])
    studio.delete(owner)
    assert studio.media.all_assets() == []
    assert studio.jobs.get(owner, a["jobId"])["result"] is None


def test_a_generic_idea_is_drawn_without_references(tmp_path: Path) -> None:
    """TASK-0058 (ADR-0026): no reference, no analysis call, and the design is its own root."""
    analysed: list[list[bytes]] = []

    class Unreferenced(FakeProvider):
        def analyze(self, references: list[bytes], subject: str) -> str:
            analysed.append(references)
            return ""

    provider = Unreferenced()
    studio = Studio(tmp_path, b"x" * 32, provider)
    owner = "11111111-1111-4111-8111-111111111111"
    request = payload()
    request["referenceIds"] = []
    job = studio.jobs.enqueue(owner, request)
    assert studio.jobs.tick()
    result = studio.jobs.get(owner, job["jobId"])
    assert result["state"] == "succeeded", result
    assert provider.calls == 1
    assert analysed == []
    assert result["result"]["referenceAnalysis"].startswith("Sin referencias")
    master = studio.media.metadata(result["result"]["master"]["assetId"])
    assert master.retention is RetentionClass.DESIGN
    assert master.parent_id is None
    studio.delete(owner)
    assert studio.media.all_assets() == []


def test_a_library_plate_is_used_before_one_is_generated(tmp_path: Path) -> None:
    """TASK-0060: with a reviewed plate for the zone, no plate is generated."""
    from generation.plate_library import PlateLibrary

    class NoPlates(FakeProvider):
        def background(self, brief: dict[str, Any]) -> bytes:
            raise AssertionError("the library had this plate")

    plates = tmp_path / "plates"
    plates.mkdir()
    Image.new("RGB", (400, 600), (205, 160, 130)).save(
        plates / "inner_forearm-masculine.webp", format="WEBP"
    )
    provider = NoPlates()
    studio = Studio(tmp_path / "studio", b"x" * 32, provider, PlateLibrary(plates))
    owner = "11111111-1111-4111-8111-111111111111"
    ref = studio.ingest(
        owner,
        {
            "data": base64.b64encode(picture()).decode(),
            "kind": "reference",
            "adult": True,
            "consent": True,
        },
    )
    request = payload()
    request["referenceIds"] = [ref["assetId"]]
    request["brief"]["placement"]["bodyType"] = "masculine"
    job = studio.jobs.enqueue(owner, request)
    assert studio.jobs.tick()
    result = studio.jobs.get(owner, job["jobId"])
    assert result["state"] == "succeeded", result
    background = studio.media.read(result["result"]["background"]["assetId"])
    with Image.open(io.BytesIO(background)) as image:
        assert image.size == (400, 600)


def test_provider_failure_never_returns_an_artifact(tmp_path: Path) -> None:
    def fail(owner: str, body: dict[str, Any]) -> dict[str, Any]:
        raise ValueError("Proveedor no disponible")

    queue = JobQueue(tmp_path / "jobs.db", fail)
    request = payload()
    job = queue.enqueue("owner", request)
    queue.tick()
    result = queue.get("owner", job["jobId"])
    assert result["state"] == "failed" and result["result"] is None
    # TASK-0072: a technical cause is told to the client plainly.
    assert result["error"] == client_messages.GENERIC


def test_interrupted_job_is_not_automatically_recharged(tmp_path: Path) -> None:
    calls: list[str] = []

    def execute(owner: str, body: dict[str, Any]) -> dict[str, Any]:
        calls.append(owner)
        return {}

    queue = JobQueue(tmp_path / "jobs.db", execute)
    job = queue.enqueue("owner", payload())
    with queue.connect() as db:
        db.execute("UPDATE jobs SET state='running'")
    restarted = JobQueue(tmp_path / "jobs.db", execute)
    assert restarted.get("owner", job["jobId"])["state"] == "failed"
    assert not restarted.tick()
    assert calls == []


@pytest.mark.parametrize("mode", ["colour", "black_and_grey_with_accent", "black_and_grey"])
def test_colour_uses_one_artwork_for_preview_and_contours(tmp_path: Path, mode: str) -> None:
    provider = FakeProvider()
    studio = Studio(tmp_path, b"x" * 32, provider)
    request = payload()
    request["brief"]["colour"] = {"mode": mode}
    if mode == "black_and_grey":
        request["brief"]["style"]["primary"] = "black_and_grey_realism"
    ref = studio.ingest(
        "owner",
        {
            "data": base64.b64encode(picture()).decode(),
            "adult": True,
            "consent": True,
            "kind": "reference",
        },
    )
    request["referenceIds"] = [ref["assetId"]]
    result = studio.generate("owner", request)
    assert provider.calls == 1
    assert request["brief"]["colour"] == {"mode": mode}
    assert "aproxima" in result["notice"]
    for name in ("master", "stencil", "mockup", "pdf"):
        assert result[name]["designId"] == result["designId"]
    pixels = np.asarray(Image.open(io.BytesIO(studio.owned("owner", result["master"]["assetId"]))))
    if mode == "black_and_grey":
        assert np.array_equal(pixels[:, :, 0], pixels[:, :, 1])
        assert np.array_equal(pixels[:, :, 1], pixels[:, :, 2])
        assert np.any((pixels[:, :, 0] > 40) & (pixels[:, :, 0] < 180))
    else:
        assert np.any((pixels[:, :, 0] > 200) & (pixels[:, :, 1] < 30))
    expected, _ = composite(
        Image.fromarray(pixels),
        picture(False),
        request["brief"]["size"],
        fresh=True,
        curvature=1.05,
        taper=0.25 if request["brief"]["placement"]["bodyPart"] == "calf" else 0,
    )
    assert studio.owned("owner", result["mockup"]["assetId"]) == expected


def test_calf_wrap_narrows_lower_design_and_redness_surrounds_ink() -> None:
    art = Image.new("RGB", (200, 300), "white")
    ImageDraw.Draw(art).rectangle((30, 20, 170, 280), fill="black")
    skin = Image.new("RGB", (400, 600), (190, 145, 120))
    buffer = io.BytesIO()
    skin.save(buffer, format="PNG")
    data, transform = composite(
        art,
        buffer.getvalue(),
        {"widthMm": 200.0, "heightMm": 300.0},
        {"x": 0.25, "y": 0.2, "width": 0.5},
        fresh=True,
        curvature=1.05,
        taper=0.25,
    )
    pixels = np.asarray(Image.open(io.BytesIO(data)))
    upper = np.count_nonzero(pixels[180, :, 0] < 50)
    lower = np.count_nonzero(pixels[380, :, 0] < 50)
    assert 0 < lower < upper
    # Pink skin exists outside dark pigment, while remote skin is untouched.
    assert np.any((pixels[:, :, 0] > 190) & (pixels[:, :, 1] < 145))
    assert np.array_equal(pixels[0, 0], [190, 145, 120])
    assert transform["taper"] == 0.25


def test_colour_contours_share_physical_fit_and_identity_includes_colour() -> None:
    master, preview = trace_colour_artwork(colour_picture(), 80, 150)
    blue, _ = trace_colour_artwork(colour_picture("blue"), 80, 150)
    assert master.design_hash != blue.design_hash
    assert master.paths == blue.paths
    assert preview.size == (473, 886)
    points = np.array([point for path in master.paths for point in path])
    # Source ellipse x=40..160, with the same 0.39 mm/px fit and offsets (1,16.5).
    assert points[:, 0].min() == pytest.approx(16.6, abs=0.8)
    assert points[:, 0].max() == pytest.approx(63.4, abs=0.8)
    assert points[:, 1].min() == pytest.approx(28.2, abs=0.8)


def test_expired_uploads_are_removed(tmp_path: Path) -> None:
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    studio.ingest(
        "owner",
        {
            "data": base64.b64encode(picture()).decode(),
            "kind": "reference",
            "adult": True,
            "consent": True,
        },
    )
    for path in (tmp_path / "media" / "meta").glob("*.json"):
        meta = json.loads(path.read_text())
        meta["expiresAt"] = "2000-01-01T00:00:00Z"
        path.write_text(json.dumps(meta))
    studio.purge_expired()
    assert studio.media.all_assets() == []


def test_http_requires_service_auth_and_valid_contract(tmp_path: Path) -> None:
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    app = FastAPI()
    app.include_router(router(studio, "test-only-token"))
    client = TestClient(app)
    assert client.post("/studio/jobs", json={}).status_code == 401
    headers = {
        "Authorization": "Bearer test-only-token",
        "X-Owner-Id": "11111111-1111-4111-8111-111111111111",
    }
    assert client.post("/studio/jobs", json={"brief": {}}, headers=headers).status_code == 422
    assert (
        client.post(
            "/studio/media", json={"kind": "body", "adult": False}, headers=headers
        ).status_code
        == 422
    )


def test_edit_versions_are_owned_idempotent_and_keep_previous(tmp_path: Path) -> None:
    class EditingProvider(FakeProvider):
        edit_input: bytes = b""
        fail = False

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
            self.edit_input = master
            if self.fail:
                raise ValueError("Edición fallida")
            assert instruction == "Añade azul"
            return colour_picture("blue")

    provider = EditingProvider()
    studio = Studio(tmp_path, b"x" * 32, provider)
    owner = "11111111-1111-4111-8111-111111111111"
    ref = studio.ingest(
        owner,
        {
            "data": base64.b64encode(picture()).decode(),
            "adult": True,
            "consent": True,
            "kind": "reference",
        },
    )
    original = payload()
    original["referenceIds"] = [ref["assetId"]]
    parent_id = studio.jobs.enqueue(owner, original)["jobId"]
    assert studio.jobs.tick()
    parent = studio.jobs.get(owner, parent_id)["result"]
    app = FastAPI()
    app.include_router(router(studio, "test-only-token"))
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-only-token", "X-Owner-Id": owner}
    change = {
        "edit": {"parentJobId": parent_id, "instruction": "Añade azul"},
        "idempotencyKey": "22222222-2222-4222-8222-222222222222",
    }
    response = client.post("/studio/jobs", json=change, headers=headers)
    assert response.status_code == 202, response.text
    child_id = response.json()["jobId"]
    assert client.post("/studio/jobs", json=change, headers=headers).json()["jobId"] == child_id
    assert studio.jobs.tick()
    child = studio.jobs.get(owner, child_id)["result"]
    assert child["briefRevision"] == parent["briefRevision"] + 1
    assert provider.edit_input == studio.owned(owner, parent["master"]["assetId"])
    assert child["edit"] == change["edit"]
    assert child["designId"] != parent["designId"]
    assert studio.owned(owner, child["background"]["assetId"]) == studio.owned(
        owner, parent["background"]["assetId"]
    )
    assert (
        child["master"]["designId"] == child["stencil"]["designId"] == child["mockup"]["designId"]
    )
    assert len(client.get("/studio/jobs", headers=headers).json()) == 2
    other = {**headers, "X-Owner-Id": "33333333-3333-4333-8333-333333333333"}
    assert client.post("/studio/jobs", json=change, headers=other).status_code == 422
    assert client.get("/studio/jobs", headers=other).json() == []
    for instruction in ["  ", "a", "x" * 1001, None]:
        invalid = {**change, "edit": {"parentJobId": parent_id, "instruction": instruction}}
        assert client.post("/studio/jobs", json=invalid, headers=headers).status_code == 422
    provider.fail = True
    change["idempotencyKey"] = "44444444-4444-4444-8444-444444444444"
    failed_id = client.post("/studio/jobs", json=change, headers=headers).json()["jobId"]
    assert studio.jobs.tick()
    assert studio.jobs.get(owner, failed_id)["state"] == "failed"
    assert studio.jobs.get(owner, parent_id)["result"] == parent
    assert len(studio.jobs.history(owner)) == 2


def test_a_change_can_attach_reference_photos(tmp_path: Path) -> None:
    """TASK-0036: photos sent with a change lead the edit and stay with the design."""

    class AttachingProvider(FakeProvider):
        def __init__(self) -> None:
            super().__init__()
            self.seen: tuple[list[bytes], int] = ([], 0)
            self.analysed: list[str] = []

        def analyze(self, references: list[bytes], subject: str) -> str:
            self.analysed.append(subject)
            return super().analyze(references, subject)

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
            self.seen = (references, attached)
            return colour_picture("blue")

    provider = AttachingProvider()
    studio = Studio(tmp_path, b"x" * 32, provider)
    owner = "11111111-1111-4111-8111-111111111111"

    def upload(image: bytes) -> str:
        return studio.ingest(
            owner,
            {"data": base64.b64encode(image).decode(), "adult": True, "consent": True},
        )["assetId"]

    original = payload()
    original["referenceIds"] = [upload(picture())]
    parent_id = studio.jobs.enqueue(owner, original)["jobId"]
    assert studio.jobs.tick()
    virgin = upload(colour_picture("gold"))
    app = FastAPI()
    app.include_router(router(studio, "test-only-token"))
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-only-token", "X-Owner-Id": owner}
    # "todo el gemelo" alone would only reposition; an attached photo means a redraw.
    edit = {
        "parentJobId": parent_id,
        "instruction": "Quiero una virgen como en la foto, que ocupe todo el gemelo",
        "referenceIds": [virgin],
    }
    response = client.post(
        "/studio/jobs",
        json={"edit": edit, "idempotencyKey": "22222222-2222-4222-8222-222222222222"},
        headers=headers,
    )
    assert response.status_code == 202, response.text
    assert studio.jobs.tick()
    status = studio.jobs.get(owner, response.json()["jobId"])
    assert status["state"] == "succeeded", status
    references, attached = provider.seen
    assert attached == 1
    assert references[0] == studio.owned(owner, virgin)
    assert references[1] == studio.owned(owner, original["referenceIds"][0])
    assert provider.analysed[-1] == edit["instruction"]
    assert "Fotos añadidas con el cambio" in status["result"]["referenceAnalysis"]
    assert status["result"]["edit"] == edit
    # A photo the session does not own is refused before anything runs.
    foreign = Studio(tmp_path / "other", b"x" * 32, FakeProvider()).ingest(
        owner, {"data": base64.b64encode(picture()).decode(), "adult": True, "consent": True}
    )["assetId"]
    refused = client.post(
        "/studio/jobs",
        json={
            "edit": {**edit, "referenceIds": [foreign]},
            "idempotencyKey": "33333333-3333-4333-8333-333333333333",
        },
        headers=headers,
    )
    assert refused.status_code == 422


def test_an_edit_of_a_resized_version_keeps_its_size(tmp_path: Path) -> None:
    """TASK-0036: live, a zone resize to 140 x 380 mm reverted to 140 x 260 on the next edit."""

    class EditingProvider(FakeProvider):
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

    studio = Studio(tmp_path, b"x" * 32, EditingProvider())
    owner = "11111111-1111-4111-8111-111111111111"
    ref = studio.ingest(
        owner, {"data": base64.b64encode(picture()).decode(), "adult": True, "consent": True}
    )
    original = payload()
    original["referenceIds"] = [ref["assetId"]]
    first = studio.jobs.enqueue(owner, original)["jobId"]
    assert studio.jobs.tick()
    app = FastAPI()
    app.include_router(router(studio, "test-only-token"))
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-only-token", "X-Owner-Id": owner}

    def edit(parent: str, instruction: str, key: str, **control: str) -> dict[str, Any]:
        response = client.post(
            "/studio/jobs",
            json={
                "edit": {"parentJobId": parent, "instruction": instruction, **control},
                "idempotencyKey": key,
            },
            headers=headers,
        )
        assert response.status_code == 202, response.text
        assert studio.jobs.tick()
        status = studio.jobs.get(owner, response.json()["jobId"])
        assert status["state"] == "succeeded", status
        return {"id": response.json()["jobId"], **status["result"]}

    # TASK-0073: the print size changes through the explicit control only.
    resized = edit(
        first,
        "Que ocupe toda la zona",
        "22222222-2222-4222-8222-222222222222",
        coverage="full",
        mode="placement",
    )
    assert resized["size"] != studio.jobs.get(owner, first)["result"]["size"]
    redrawn = edit(resized["id"], "Añade azul", "33333333-3333-4333-8333-333333333333")
    assert redrawn["size"] == resized["size"]


def test_edit_prompt_points_at_the_attached_photos() -> None:
    plain = StudioProvider.edit_prompt("Añade azul", rendered=True)
    assert "image 2" not in plain and "identity references" in plain
    one = StudioProvider.edit_prompt("Una virgen como en la foto", rendered=True, attached=1)
    assert "attached image 2 " in one
    two = StudioProvider.edit_prompt("Una virgen como en la foto", rendered=True, attached=2)
    assert "images 2 to 3" in two


def _zone_edit(
    tmp_path: Path, edit: dict[str, Any], provider: Any = None
) -> tuple[Any, dict[str, Any], dict[str, Any]]:
    """A design, then the given change request on it; returns the provider, parent and result."""
    provider = provider or FakeProvider()
    studio = Studio(tmp_path, b"x" * 32, provider)
    owner = "11111111-1111-4111-8111-111111111111"
    ref = studio.ingest(
        owner, {"data": base64.b64encode(picture()).decode(), "adult": True, "consent": True}
    )
    original = payload()
    original["referenceIds"] = [ref["assetId"]]
    original["placement"] = {"x": 0.32, "y": 0.22, "width": 0.36}
    parent_id = studio.jobs.enqueue(owner, original)["jobId"]
    assert studio.jobs.tick()
    parent = studio.jobs.get(owner, parent_id)["result"]
    app = FastAPI()
    app.include_router(router(studio, "test-only-token"))
    response = TestClient(app).post(
        "/studio/jobs",
        json={
            "edit": {"parentJobId": parent_id, **edit},
            "idempotencyKey": "22222222-2222-4222-8222-222222222222",
        },
        headers={"Authorization": "Bearer test-only-token", "X-Owner-Id": owner},
    )
    assert response.status_code == 202
    assert studio.jobs.tick()
    status = studio.jobs.get(owner, response.json()["jobId"])
    assert status["state"] == "succeeded", status
    return provider, parent, status["result"]


@pytest.mark.parametrize(
    "instruction",
    [
        "quiero que ocupe casi todo el gemelo",
        "es muy pequeño, quiero que me ocupe casi todo el gemelo y abarque hacia los lados, "
        "casi envolviendo el gemelo",
    ],
)
def test_a_whole_zone_phrase_asks_for_the_control_instead_of_resizing(
    tmp_path: Path, instruction: str
) -> None:
    """TASK-0073 (audit UX-01): a sentence cannot confirm a new print size; nothing is queued."""
    provider = FakeProvider()
    studio = Studio(tmp_path, b"x" * 32, provider)
    owner = "11111111-1111-4111-8111-111111111111"
    parent_id = a_design_for(studio, owner)
    app = FastAPI()
    app.include_router(router(studio, "test-only-token"))
    response = TestClient(app).post(
        "/studio/jobs",
        json={
            "edit": {"parentJobId": parent_id, "instruction": instruction},
            "idempotencyKey": "22222222-2222-4222-8222-222222222222",
        },
        headers={"Authorization": "Bearer test-only-token", "X-Owner-Id": owner},
    )
    assert response.status_code == 422
    assert "Ocupar toda la zona" in response.json()["detail"]
    assert provider.calls == 1


def test_a_mixed_whole_zone_request_redraws_at_the_accepted_size(tmp_path: Path) -> None:
    """TASK-0073: «que ocupe todo el gemelo y añade flores» redraws; the print size stays."""
    _, parent, result = _zone_edit(
        tmp_path,
        {"instruction": "Que ocupe casi todo el gemelo y añade flores"},
        RecordingProvider(),
    )
    assert result["size"] == parent["size"]


def a_design_for(studio: Studio, owner: str) -> str:
    ref = studio.ingest(
        owner, {"data": base64.b64encode(picture()).decode(), "adult": True, "consent": True}
    )
    original = payload()
    original["referenceIds"] = [ref["assetId"]]
    job_id = str(studio.jobs.enqueue(owner, original)["jobId"])
    assert studio.jobs.tick()
    return job_id


def test_whole_zone_control_resizes_to_reference_anatomy_without_generation(
    tmp_path: Path,
) -> None:
    """ADR-0008: the confirmed whole-zone control settles millimetres, so the print changes too.

    The instructions say «gemelo» while the brief declares `inner_forearm`. The brief wins:
    the Spanish noun is never mapped onto the enum (TASK-0024/REQ-003).
    """
    provider, parent, result = _zone_edit(
        tmp_path, {"instruction": "Que ocupe toda la zona", "coverage": "full", "mode": "placement"}
    )
    original = payload()
    assert result["transform"]["widthPx"] > parent["transform"]["widthPx"]
    assert result["transform"]["heightPx"] > parent["transform"]["heightPx"]
    # TASK-0024/AC-004: the size fills the reference span on its binding dimension.
    span_width, span_height = ZONE_SPAN_MM[original["brief"]["placement"]["bodyPart"]]
    size = result["size"]
    assert size != parent["size"]
    assert size["widthMm"] <= span_width + 0.01
    assert size["heightMm"] <= span_height + 0.01
    assert max(size["widthMm"] / span_width, size["heightMm"] / span_height) == pytest.approx(1.0)
    # TASK-0024/AC-005: the stencil follows the new millimetres; the artwork itself does not move.
    for name in ("stencil", "stencilMirror", "pdf", "pdfMirror"):
        assert result[name]["assetId"] != parent[name]["assetId"]
    assert result["master"]["assetId"] == parent["master"]["assetId"]
    assert result["background"] == parent["background"]
    assert result["mockup"]["assetId"] != parent["mockup"]["assetId"]
    for name in ("master", "stencil", "pdf", "mockup"):
        assert result[name]["designId"] == result["designId"]
    assert f"{size['widthMm']:.0f} x {size['heightMm']:.0f} mm" in result["notice"]
    # TASK-0024/AC-006: resizing never costs a generation call.
    assert provider.calls == 1


def test_visual_coverage_bounds_calibration_and_mixed_requests() -> None:
    small = fit_coverage(picture(False), {"widthMm": 80.0, "heightMm": 120.0}, "auto")
    large = fit_coverage(picture(False), {"widthMm": 200.0, "heightMm": 300.0}, "auto")
    assert large["width"] > small["width"]
    assert large["x"] + large["width"] <= 1
    with pytest.raises(ValueError, match="calibrada"):
        fit_coverage(
            picture(False), {"widthMm": 200.0, "heightMm": 300.0}, "full", {"photoWidthMm": 400.0}
        )
    assert coverage_request({"instruction": "Haz el escudo más pequeño"}) is None
    assert coverage_request(
        {"instruction": "Que ocupe casi todo el gemelo y añade flores"}
    ) == Coverage("full", False)
    assert coverage_request(
        {"instruction": "Ampliar", "coverage": "larger", "mode": "placement"}
    ) == Coverage("larger", True)


def test_tall_print_canvas_fills_visible_ink_not_white_padding() -> None:
    master = Image.new("RGB", (900, 3000), "white")
    ImageDraw.Draw(master).rectangle((100, 1000, 800, 2000), fill="black")
    original = master.tobytes()
    size = {"widthMm": 150.0, "heightMm": 500.0}
    background = picture(False)
    old, _ = composite(master, background, size, fit_coverage(background, size, "full"))
    placement = fit_coverage(background, visible_size(master, size), "full")
    new, transform = composite(master, background, size, placement, fit_visible=True)

    def ink_height(data: bytes) -> int:
        pixels = np.asarray(Image.open(io.BytesIO(data)))
        rows = np.where((pixels.min(axis=2) < 50).any(axis=1))[0]
        return int(rows[-1] - rows[0] + 1)

    assert ink_height(new) > 2 * ink_height(old)
    assert ink_height(new) > 200  # Background is 300 px high; visible ink must fill it.
    assert transform["sourceCropPx"]["height"] < 1100
    assert master.tobytes() == original
    calibrated = {"x": 0.3, "y": 0.1, "width": 0.2, "photoWidthMm": 600.0}
    a, metadata = composite(master, background, size, calibrated, fit_visible=True)
    assert a == composite(master, background, size, calibrated)[0]
    assert "sourceCropPx" not in metadata


def test_initial_full_calf_prompt_uses_visible_bounds(tmp_path: Path) -> None:
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    ref = studio.ingest(
        "owner", {"data": base64.b64encode(picture()).decode(), "adult": True, "consent": True}
    )
    request = payload()
    request["referenceIds"] = [ref["assetId"]]
    request.pop("placement", None)
    request["brief"]["placement"]["bodyPart"] = "calf"
    request["brief"]["subject"]["description"] = (
        "Un diseño que ocupe todo el gemelo de arriba a abajo"
    )
    request["brief"]["size"] = {"widthMm": 150, "heightMm": 500}
    request["brief"]["style"]["primary"] = "black_and_grey_realism"
    result = studio.generate("owner", request)
    assert result["transform"]["sourceCropPx"]["height"] > 0
    assert result["transform"]["heightPx"] >= 240
    # TASK-0073 (audit UX-01): the accepted millimetres reach the result and the print unchanged.
    assert result["size"] == {"widthMm": 150, "heightMm": 500}
    stencil = studio.owned("owner", result["stencil"]["assetId"]).decode()
    assert 'width="150mm"' in stencil and 'height="500mm"' in stencil


def test_a_nudge_changes_the_view_and_nothing_that_gets_printed(tmp_path: Path) -> None:
    """TASK-0024/AC-007 and AC-006: nudges stay visual, and neither path calls the provider."""
    provider = FakeProvider()
    studio = Studio(tmp_path, b"x" * 32, provider)
    owner = "11111111-1111-4111-8111-111111111111"
    ref = studio.ingest(
        owner, {"data": base64.b64encode(picture()).decode(), "adult": True, "consent": True}
    )
    original = payload()
    original["referenceIds"] = [ref["assetId"]]
    original["placement"] = {"x": 0.32, "y": 0.22, "width": 0.36}
    parent_id = studio.jobs.enqueue(owner, original)["jobId"]
    assert studio.jobs.tick()
    parent = studio.jobs.get(owner, parent_id)["result"]

    app = FastAPI()
    app.include_router(router(studio, "test-only-token"))
    client = TestClient(app)
    response = client.post(
        "/studio/jobs",
        json={
            "edit": {
                "parentJobId": parent_id,
                "instruction": "Ampliar la cobertura",
                "coverage": "larger",
                "mode": "placement",
            },
            "idempotencyKey": "33333333-3333-4333-8333-333333333333",
        },
        headers={"Authorization": "Bearer test-only-token", "X-Owner-Id": owner},
    )
    assert response.status_code == 202
    assert studio.jobs.tick()
    status = studio.jobs.get(owner, response.json()["jobId"])
    assert status["state"] == "succeeded", status
    result = status["result"]
    assert result["size"] == parent["size"]
    for name in ("master", "stencil", "stencilMirror", "pdf", "pdfMirror", "background"):
        assert result[name] == parent[name]
    assert result["mockup"]["assetId"] != parent["mockup"]["assetId"]
    assert result["transform"]["widthPx"] > parent["transform"]["widthPx"]
    assert "las medidas del PDF siguen siendo las originales" in result["notice"]
    assert provider.calls == 1


def leg_plate() -> bytes:
    """A generated-anatomy stand-in with a body the silhouette reader can find (TASK-0039)."""
    image = Image.new("RGB", (400, 600), (128, 126, 124))
    ImageDraw.Draw(image).polygon(
        [(110, 0), (300, 0), (260, 600), (150, 600)], fill=(205, 150, 115)
    )
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


class LegProvider(FakeProvider):
    """Paints a leg as the background and finishes the mockup with `finish`."""

    def __init__(self, finish: str = "same") -> None:
        super().__init__()
        self.finish = finish
        self.blends = 0

    def background(self, brief: dict[str, Any]) -> bytes:
        return leg_plate()

    def blend_mockup(self, mockup: bytes, finish: str) -> bytes:
        self.blends += 1
        if self.finish == "fail":
            raise ValueError("provider down")
        if self.finish == "redraw":
            return leg_plate()  # the design is gone: a redraw the check must refuse
        return mockup


def _leg_job(tmp_path: Path, provider: FakeProvider) -> tuple[Studio, dict[str, Any]]:
    studio = Studio(tmp_path, b"x" * 32, provider)
    owner = "11111111-1111-4111-8111-111111111111"
    ref = studio.ingest(
        owner, {"data": base64.b64encode(picture()).decode(), "adult": True, "consent": True}
    )
    request = payload()
    request["referenceIds"] = [ref["assetId"]]
    request.pop("placement", None)
    request["brief"]["placement"]["bodyPart"] = "calf"
    job = studio.jobs.enqueue(owner, request)
    assert studio.jobs.tick()
    return studio, studio.jobs.get(owner, job["jobId"])


def test_a_body_fitted_mockup_is_a_valid_status(tmp_path: Path) -> None:
    """TASK-0039 shipped `bodyFit` outside the studio-status contract, so every job whose
    background had a readable body would have been refused as an invalid status."""
    _, job = _leg_job(tmp_path, LegProvider("fail"))
    assert job["state"] == "succeeded", job
    transform = job["result"]["transform"]
    assert transform["bodyFit"]["spill"] <= 0.02
    assert transform["generativePostprocess"] is False
    assert transform["finish"] == "unavailable"


def test_the_ai_finish_is_delivered_when_the_design_did_not_move(tmp_path: Path) -> None:
    provider = LegProvider("same")
    _, job = _leg_job(tmp_path, provider)
    assert job["state"] == "succeeded", job
    result = job["result"]
    assert provider.blends == 1
    assert result["transform"]["generativePostprocess"] is True
    assert result["transform"]["finish"] == "accepted"
    assert "Acabado de piel con IA" in result["notice"]


def test_a_finish_that_redraws_is_refused_and_the_composite_ships(tmp_path: Path) -> None:
    provider = LegProvider("redraw")
    studio, job = _leg_job(tmp_path, provider)
    assert job["state"] == "succeeded", job
    result = job["result"]
    assert provider.blends == 1
    assert result["transform"]["generativePostprocess"] is False
    assert result["transform"]["finish"] == "rejected_geometry"
    shipped = studio.media.read(result["mockup"]["assetId"])
    assert shipped != leg_plate()


def test_an_own_photo_is_never_sent_for_the_finish() -> None:
    from app.studio import _StudioBlend

    provider = LegProvider("same")
    assert _StudioBlend(provider).blend(b"warp", b"PHOTO", object(), "finish") is None
    assert provider.blends == 0


ACCOUNT = "11111111-1111-4111-8111-111111111111"


def an_upload() -> dict[str, Any]:
    return {
        "data": base64.b64encode(picture()).decode(),
        "kind": "reference",
        "adult": True,
        "consent": True,
    }


def test_erasing_your_work_is_not_a_lockout(tmp_path: Path) -> None:
    """
    TASK-0046/AC-004.

    The owner used to be a throwaway session id, so blocklisting it on deletion cost nothing: the
    browser simply started a new session. It is an account id now, and the same blocklist would
    lock the account out of the studio permanently.
    """
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    first = studio.ingest(ACCOUNT, an_upload())
    request = payload()
    request["referenceIds"] = [first["assetId"]]
    job = studio.jobs.enqueue(ACCOUNT, request)
    assert studio.jobs.tick()
    assert studio.jobs.get(ACCOUNT, job["jobId"])["state"] == "succeeded"

    studio.delete(ACCOUNT)

    # Nothing from before the deletion survives it.
    assert studio.jobs.history(ACCOUNT) == []
    assert studio.media.all_assets() == []
    with pytest.raises(KeyError):
        studio.owned(ACCOUNT, first["assetId"])

    # And the account can still work.
    second = studio.ingest(ACCOUNT, an_upload())
    again = payload()
    again["referenceIds"] = [second["assetId"]]
    again["idempotencyKey"] = "55555555-5555-4555-8555-555555555555"
    later = studio.jobs.enqueue(ACCOUNT, again)
    assert studio.jobs.tick()
    assert studio.jobs.get(ACCOUNT, later["jobId"])["state"] == "succeeded"
    assert len(studio.jobs.history(ACCOUNT)) == 1


def test_a_deletion_during_a_generation_leaves_nothing_behind(tmp_path: Path) -> None:
    """
    TASK-0046/AC-005.

    A generation runs for minutes, so an erasure can land inside one. The artwork is already drawn
    by then; what must not happen is it being written for an owner who just erased everything.
    """

    class ErasesMidway(FakeProvider):
        def lineart(
            self,
            brief: dict[str, Any],
            references: list[bytes],
            analysis: str,
            correction: str = "",
        ) -> bytes:
            studio.delete(ACCOUNT)
            return super().lineart(brief, references, analysis)

    studio = Studio(tmp_path, b"x" * 32, ErasesMidway())
    reference = studio.ingest(ACCOUNT, an_upload())
    request = payload()
    request["referenceIds"] = [reference["assetId"]]
    job = studio.jobs.enqueue(ACCOUNT, request)

    assert studio.jobs.tick()
    finished = studio.jobs.get(ACCOUNT, job["jobId"])
    assert finished["state"] != "succeeded"
    assert finished["result"] is None
    assert studio.media.all_assets() == []
    with studio.db() as db:
        assert (
            db.execute("SELECT count(*) FROM assets WHERE owner=?", (ACCOUNT,)).fetchone()[0] == 0
        )
        assert (
            db.execute("SELECT count(*) FROM design_vector WHERE owner=?", (ACCOUNT,)).fetchone()[0]
            == 0
        )


def test_the_worker_only_accepts_an_account_as_the_owner(tmp_path: Path) -> None:
    """TASK-0046/AC-006. The header carries an account id and is named for it."""
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    app = FastAPI()
    app.include_router(router(studio, "test-only-token"))
    client = TestClient(app)
    auth = {"Authorization": "Bearer test-only-token"}

    assert client.get("/studio/jobs", headers=auth).status_code == 401
    # Uppercase is refused too: Supabase issues lowercase, and accepting both would let one
    # account own two separate piles of work.
    for rejected in ["", "not-a-uuid", "1" * 32, "-" * 36, "AAAAAAAA-1111-4111-8111-111111111111"]:
        assert (
            client.get("/studio/jobs", headers={**auth, "X-Owner-Id": rejected}).status_code == 401
        ), rejected
    # The old name identifies nobody, so a stale caller fails closed rather than sharing an owner.
    assert client.get("/studio/jobs", headers={**auth, "X-Session-Id": ACCOUNT}).status_code == 401
    assert client.get("/studio/jobs", headers={**auth, "X-Owner-Id": ACCOUNT}).status_code == 200


# --- ADR-0022: a camera try-on photograph kept as a version -----------------------------------


class RecordingProvider(FakeProvider):
    """Remembers every image an image model was handed, to prove what never reaches one."""

    def __init__(self) -> None:
        super().__init__()
        self.model_inputs: list[bytes] = []
        self.screened = 0
        self.explicit = False

    def classify(self, data: bytes) -> ModerationOutcome:
        self.screened += 1
        # The skin-toned test photo shows a person; the line-art reference does not. The gate
        # accepts a person only in an own-body photo with consent, which is what a capture is.
        with Image.open(io.BytesIO(data)) as image:
            person = image.convert("RGB").getpixel((0, 0)) == (194, 152, 128)
        return ModerationOutcome(explicit=self.explicit, contains_person=person)

    def analyze(self, references: list[bytes], subject: str) -> str:
        self.model_inputs.extend(references)
        return super().analyze(references, subject)

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
        self.model_inputs.extend([master, *references])
        return colour_picture("blue")


def a_design(studio: Studio) -> str:
    reference = studio.ingest(ACCOUNT, an_upload())
    request = payload()
    request["referenceIds"] = [reference["assetId"]]
    job = studio.jobs.enqueue(ACCOUNT, request)
    assert studio.jobs.tick()
    assert studio.jobs.get(ACCOUNT, job["jobId"])["state"] == "succeeded"
    return str(job["jobId"])


def a_capture(parent: str, key: str = "66666666-6666-4666-8666-666666666666") -> dict[str, Any]:
    return {
        "parentJobId": parent,
        "idempotencyKey": key,
        "data": base64.b64encode(picture(lines=False)).decode(),
        "adult": True,
        "consent": True,
    }


def test_a_kept_photo_is_a_version_of_the_same_design(tmp_path: Path) -> None:
    provider = RecordingProvider()
    studio = Studio(tmp_path, b"x" * 32, provider)
    parent_id = a_design(studio)
    parent = studio.jobs.get(ACCOUNT, parent_id)["result"]

    kept = studio.capture(ACCOUNT, a_capture(parent_id))

    assert kept["state"] == "succeeded"
    version = kept["result"]
    # The design is untouched: same master, same stencil, same size.
    for field in ("designId", "master", "stencil", "pdf", "size", "mockup"):
        assert version[field] == parent[field], field
    # The only new things are the photograph and what the notice says about it.
    photo = version["capture"]["photo"]
    assert version["capture"]["parentJobId"] == parent_id
    assert studio.owned(ACCOUNT, photo["assetId"], "body")
    assert "superpuesto" in version["notice"] and "ilustrativa" in version["notice"]
    # It is listed with the account's other versions, newest first.
    assert studio.jobs.history(ACCOUNT)[0]["jobId"] == kept["jobId"]
    # And the parent version is exactly what it was.
    assert studio.jobs.get(ACCOUNT, parent_id)["result"] == parent


def test_a_kept_photo_needs_consent_and_passes_the_safety_gate(tmp_path: Path) -> None:
    provider = RecordingProvider()
    studio = Studio(tmp_path, b"x" * 32, provider)
    parent_id = a_design(studio)
    before = len(studio.jobs.history(ACCOUNT))

    for missing in ("adult", "consent"):
        with pytest.raises(ValueError):
            studio.capture(ACCOUNT, {**a_capture(parent_id), missing: False})

    provider.explicit = True
    with pytest.raises(ValueError):
        studio.capture(ACCOUNT, a_capture(parent_id))

    # Nothing was stored for any of them: no version and no photograph.
    assert len(studio.jobs.history(ACCOUNT)) == before
    with studio.db() as db:
        assert (
            db.execute(
                "SELECT count(*) FROM assets WHERE owner=? AND kind='body'", (ACCOUNT,)
            ).fetchone()[0]
            == 0
        )


def test_a_retried_save_keeps_one_photo(tmp_path: Path) -> None:
    provider = RecordingProvider()
    studio = Studio(tmp_path, b"x" * 32, provider)
    parent_id = a_design(studio)
    screened = provider.screened

    first = studio.capture(ACCOUNT, a_capture(parent_id))
    again = studio.capture(ACCOUNT, a_capture(parent_id))

    assert first["jobId"] == again["jobId"]
    # Screened and stored once, not once per attempt.
    assert provider.screened == screened + 1
    with studio.db() as db:
        assert (
            db.execute(
                "SELECT count(*) FROM assets WHERE owner=? AND kind='body'", (ACCOUNT,)
            ).fetchone()[0]
            == 1
        )


def test_only_your_own_design_can_be_photographed(tmp_path: Path) -> None:
    studio = Studio(tmp_path, b"x" * 32, RecordingProvider())
    parent_id = a_design(studio)
    stranger = "22222222-2222-4222-8222-222222222222"
    with pytest.raises(KeyError):
        studio.capture(stranger, a_capture(parent_id))


def test_erasing_your_work_takes_the_photos_with_it(tmp_path: Path) -> None:
    studio = Studio(tmp_path, b"x" * 32, RecordingProvider())
    kept = studio.capture(ACCOUNT, a_capture(a_design(studio)))
    photo_id = kept["result"]["capture"]["photo"]["assetId"]

    studio.delete(ACCOUNT)

    assert studio.jobs.history(ACCOUNT) == []
    assert studio.media.all_assets() == []
    with pytest.raises(KeyError):
        studio.owned(ACCOUNT, photo_id)


def test_the_photo_never_reaches_an_image_model(tmp_path: Path) -> None:
    """
    ADR-0022 and ADR-0007: a picture of the client's body is shown back to them, and nothing else.
    A change asked from the photo's version edits the design, whose inputs are the master artwork
    and the references, never the photograph.
    """
    provider = RecordingProvider()
    studio = Studio(tmp_path, b"x" * 32, provider)
    kept = studio.capture(ACCOUNT, a_capture(a_design(studio)))
    photo = studio.owned(ACCOUNT, kept["result"]["capture"]["photo"]["assetId"])

    app = FastAPI()
    app.include_router(router(studio, "test-only-token"))
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-only-token", "X-Owner-Id": ACCOUNT}
    change = {
        "edit": {"parentJobId": kept["jobId"], "instruction": "Añade azul"},
        "idempotencyKey": "77777777-7777-4777-8777-777777777777",
    }
    response = client.post("/studio/jobs", json=change, headers=headers)
    assert response.status_code == 202, response.text
    assert studio.jobs.tick()
    edited = studio.jobs.get(ACCOUNT, response.json()["jobId"])
    assert edited["state"] == "succeeded", edited

    assert provider.model_inputs, "the edit did reach the model"
    assert photo not in provider.model_inputs


def test_the_capture_route(tmp_path: Path) -> None:
    studio = Studio(tmp_path, b"x" * 32, RecordingProvider())
    parent_id = a_design(studio)
    app = FastAPI()
    app.include_router(router(studio, "test-only-token"))
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-only-token", "X-Owner-Id": ACCOUNT}

    kept = client.post("/studio/captures", json=a_capture(parent_id), headers=headers)
    assert kept.status_code == 201, kept.text
    assert kept.json()["result"]["capture"]["parentJobId"] == parent_id

    other = {**headers, "X-Owner-Id": "22222222-2222-4222-8222-222222222222"}
    assert (
        client.post("/studio/captures", json=a_capture(parent_id), headers=other).status_code == 404
    )
    refused = {**a_capture(parent_id, "88888888-8888-4888-8888-888888888888"), "consent": False}
    assert client.post("/studio/captures", json=refused, headers=headers).status_code == 422


def test_a_plate_that_fails_costs_no_artwork(tmp_path: Path) -> None:
    """
    TASK-0052. On 2026-09-29 BFL's EU cluster timed out the skin plate after OpenAI had already
    drawn the artwork, which was paid for and thrown away. The plate now comes first.
    """

    class NoPlate(FakeProvider):
        def background(self, brief: dict[str, Any]) -> bytes:
            raise ValueError("FLUX ha superado el tiempo máximo de espera.")

    provider = NoPlate()
    studio = Studio(tmp_path, b"x" * 32, provider)
    reference = studio.ingest(ACCOUNT, an_upload())
    request = payload()
    request["referenceIds"] = [reference["assetId"]]
    job = studio.jobs.enqueue(ACCOUNT, request)

    assert studio.jobs.tick()
    failed = studio.jobs.get(ACCOUNT, job["jobId"])
    assert failed["state"] == "failed"
    # The client is told what happened, in plain words (TASK-0072).
    assert failed["error"] == client_messages.BUSY
    # And no drawing was paid for.
    assert provider.calls == 0


# --- TASK-0047: designs last; photographs of a body do not -------------------------------------

LATER = datetime.now(UTC) + timedelta(hours=25)


def a_body_photo(studio: Studio) -> str:
    uploaded = studio.ingest(
        ACCOUNT,
        {
            "data": base64.b64encode(picture(lines=False)).decode(),
            "kind": "body",
            "adult": True,
            "consent": True,
        },
    )
    return str(uploaded["assetId"])


def design_files(result: dict[str, Any]) -> list[str]:
    return [result[name]["assetId"] for name in ("master", "stencil", "stencilMirror", "pdf")]


def test_a_design_outlives_the_photo_window(tmp_path: Path) -> None:
    """MEDIA-INV-006: a design shows nobody, so it follows the design lifecycle, not the photo's."""
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    job_id = a_design(studio)
    result = studio.jobs.get(ACCOUNT, job_id)["result"]
    reference = studio.jobs.source_payload(ACCOUNT, job_id)["referenceIds"][0]

    studio.purge_expired(now=LATER)

    # The version is still listed, and every file it shows still opens.
    assert [item["jobId"] for item in studio.jobs.history(ACCOUNT)] == [job_id]
    for asset_id in [*design_files(result), result["mockup"]["assetId"], reference]:
        assert studio.owned(ACCOUNT, asset_id)
    assert studio.media.metadata(result["master"]["assetId"]).expires_at is None


def test_a_body_photo_and_what_shows_it_expire_but_the_design_stays(tmp_path: Path) -> None:
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    reference = studio.ingest(ACCOUNT, an_upload())
    photo = a_body_photo(studio)
    request = payload()
    request["referenceIds"] = [reference["assetId"]]
    request["bodyPhotoId"] = photo
    job = studio.jobs.enqueue(ACCOUNT, request)
    assert studio.jobs.tick()
    result = studio.jobs.get(ACCOUNT, job["jobId"])["result"]
    assert result["backgroundKind"] == "own_photo"

    studio.purge_expired(now=LATER)

    # The photograph, and the composite and background that show the body, are gone...
    for asset_id in (photo, result["mockup"]["assetId"], result["background"]["assetId"]):
        with pytest.raises(KeyError):
            studio.owned(ACCOUNT, asset_id)
    # ...while the design, which never contained the photo (ADR-0007), is intact and listed.
    for asset_id in design_files(result):
        assert studio.owned(ACCOUNT, asset_id)
    assert [item["jobId"] for item in studio.jobs.history(ACCOUNT)] == [job["jobId"]]


def test_a_change_to_a_design_whose_photo_expired_says_why(tmp_path: Path) -> None:
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    reference = studio.ingest(ACCOUNT, an_upload())
    request = payload()
    request["referenceIds"] = [reference["assetId"]]
    request["bodyPhotoId"] = a_body_photo(studio)
    job = studio.jobs.enqueue(ACCOUNT, request)
    assert studio.jobs.tick()
    studio.purge_expired(now=LATER)

    app = FastAPI()
    app.include_router(router(studio, "test-only-token"))
    response = TestClient(app).post(
        "/studio/jobs",
        json={
            "edit": {"parentJobId": job["jobId"], "instruction": "Añade azul"},
            "idempotencyKey": "99999999-9999-4999-8999-999999999999",
        },
        headers={"Authorization": "Bearer test-only-token", "X-Owner-Id": ACCOUNT},
    )
    assert response.status_code == 422
    assert "se borra a las 24 horas" in response.json()["detail"]


def test_a_kept_camera_photo_goes_with_its_photo(tmp_path: Path) -> None:
    studio = Studio(tmp_path, b"x" * 32, RecordingProvider())
    parent_id = a_design(studio)
    kept = studio.capture(ACCOUNT, a_capture(parent_id))

    studio.purge_expired(now=LATER)

    # Without its photo the version would show nothing; the design it belonged to remains.
    listed = [item["jobId"] for item in studio.jobs.history(ACCOUNT)]
    assert kept["jobId"] not in listed
    assert listed == [parent_id]


def test_only_runs_that_produced_nothing_are_swept(tmp_path: Path) -> None:
    class Failing(FakeProvider):
        def lineart(
            self,
            brief: dict[str, Any],
            references: list[bytes],
            analysis: str,
            correction: str = "",
        ) -> bytes:
            raise ValueError("Proveedor no disponible")

    studio = Studio(tmp_path, b"x" * 32, Failing())
    reference = studio.ingest(ACCOUNT, an_upload())
    request = payload()
    request["referenceIds"] = [reference["assetId"]]
    failed = studio.jobs.enqueue(ACCOUNT, request)
    assert studio.jobs.tick()

    studio.purge_expired(now=LATER)

    with pytest.raises(KeyError):
        studio.jobs.get(ACCOUNT, failed["jobId"])


def test_an_upload_is_a_photograph_or_design_material() -> None:
    from media.store import RetentionClass

    store = EncryptedFileStore(
        Path("unused-never-written"), b"x" * 32, retention=timedelta(hours=1)
    )
    with pytest.raises(ValueError):
        store.ingest_photo(b"", object(), retention=RetentionClass.PHOTO_DERIVED)  # type: ignore[arg-type]


# --- TASK-0054: what the studio records ---------------------------------------------------------


@pytest.fixture
def recorded(tmp_path: Path) -> Iterator[EventStore]:
    store = sqlite_store(tmp_path / "telemetry.sqlite", start=False)
    configure(store)
    yield store
    configure(EventStore(lambda: None, style="sqlite", start=False))
    configure_prices(Prices())


def kinds(store: EventStore) -> list[tuple[str, str, str]]:
    return [
        (e["kind"], e["operation"], e["outcome"])
        for e in reversed(store.events(datetime.now(UTC) - timedelta(hours=1)))
    ]


def test_a_generation_is_recorded_for_its_owner(tmp_path: Path, recorded: EventStore) -> None:
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    job_id = a_design(studio)

    events = recorded.events(datetime.now(UTC) - timedelta(hours=1))
    job = next(e for e in events if e["kind"] == "job")
    assert (job["account"], job["job"], job["outcome"]) == (ACCOUNT, job_id, "ok")
    assert job["detail"]["zone"] and job["duration_ms"] is not None
    assert ("upload", "reference", "ok") in kinds(recorded)


def test_a_refused_upload_is_recorded_without_the_image(
    tmp_path: Path, recorded: EventStore
) -> None:
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    with pytest.raises(ValueError):
        studio.ingest(ACCOUNT, {**an_upload(), "consent": False})
    (event,) = recorded.events(datetime.now(UTC) - timedelta(hours=1))
    assert (event["kind"], event["outcome"]) == ("upload", "refused")
    # Nothing that could be the picture: no text, and a detail of a reason only.
    assert event["text"] is None and set(event["detail"]) == {"reason"}


def test_erasing_the_account_leaves_numbers_without_a_name(
    tmp_path: Path, recorded: EventStore
) -> None:
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    a_design(studio)
    studio.delete(ACCOUNT)
    events = recorded.events(datetime.now(UTC) - timedelta(hours=1))
    assert events and all(e["account"] is None for e in events)
    assert ("deletion", "erase_all", "ok") in kinds(recorded)


def test_the_web_reports_events_as_the_account_it_names(
    tmp_path: Path, recorded: EventStore
) -> None:
    configure_prices(
        Prices.parse('{"claude-x": {"input_per_million": 3, "output_per_million": 15}}')
    )
    app = FastAPI()
    app.include_router(router(Studio(tmp_path, b"x" * 32, FakeProvider()), "test-only-token"))
    client = TestClient(app)
    auth = {"Authorization": "Bearer test-only-token"}
    batch = {
        "events": [
            {
                "kind": "provider_call",
                "operation": "consultation",
                "provider": "anthropic",
                "model": "claude-x",
                "input_tokens": 1000,
                "output_tokens": 200,
                "cost_usd": 999,  # ignored: the worker prices it
                "account": "someone-else",  # ignored: the header names the account
            },
            {"kind": "consultation_turn", "operation": "message", "text": "Un lobo"},
            {"kind": "made_up", "operation": "x"},
            {"kind": "sign_in", "operation": "NOT VALID"},
        ]
    }

    assert client.post("/studio/events", json=batch).status_code == 401
    answer = client.post("/studio/events", json=batch, headers={**auth, "X-Owner-Id": ACCOUNT})
    assert answer.json() == {"accepted": 2}

    call, turn = reversed(recorded.events(datetime.now(UTC) - timedelta(hours=1)))
    assert call["account"] == turn["account"] == ACCOUNT
    assert call["cost_usd"] == pytest.approx(0.006)
    assert turn["text"] == "Un lobo"
    # A failed sign-in has no account yet: the header may be absent, never malformed.
    anonymous = {"events": [{"kind": "sign_in", "operation": "password", "outcome": "refused"}]}
    assert client.post("/studio/events", json=anonymous, headers=auth).json() == {"accepted": 1}
    bad = {**auth, "X-Owner-Id": "not-an-account"}
    assert client.post("/studio/events", json=anonymous, headers=bad).status_code == 401


def test_a_screen_that_failed_in_the_browser_reaches_recent_errors(
    tmp_path: Path, recorded: EventStore
) -> None:
    """TASK-0094: the web reports a client's rendering failure; the Panel lists it."""
    from telemetry.report import overview

    app = FastAPI()
    app.include_router(router(Studio(tmp_path, b"x" * 32, FakeProvider()), "test-only-token"))
    client = TestClient(app)
    auth = {"Authorization": "Bearer test-only-token", "X-Owner-Id": ACCOUNT}
    failure = {
        "kind": "client_error",
        "operation": "render",
        "outcome": "error",
        "detail": {"error": "Cannot read properties of undefined", "path": "/", "digest": None},
    }
    assert client.post("/studio/events", json={"events": [failure]}, headers=auth).json() == {
        "accepted": 1
    }
    rows = recorded.events(datetime.now(UTC) - timedelta(hours=1))
    errors = overview(rows)["errors"]
    assert [(e["kind"], e["operation"], e["account"]) for e in errors] == [
        ("client_error", "render", ACCOUNT)
    ]
    assert errors[0]["reason"] == "Cannot read properties of undefined"


# --- TASK-0055: the administrator ------------------------------------------------------------

ADMIN = "33333333-3333-4333-8333-333333333333"


def admin_client(studio: Studio, store: EventStore | None) -> tuple[TestClient, dict[str, str]]:
    app = FastAPI()
    app.include_router(router(studio, "test-only-token", store))
    return TestClient(app), {"Authorization": "Bearer test-only-token", "X-Admin-Id": ADMIN}


def test_the_administrator_sees_metrics_and_is_recorded_seeing_them(
    tmp_path: Path, recorded: EventStore
) -> None:
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    a_design(studio)
    client, headers = admin_client(studio, recorded)

    assert client.get("/studio/admin/overview").status_code == 401
    no_admin = {"Authorization": "Bearer test-only-token"}
    assert client.get("/studio/admin/overview", headers=no_admin).status_code == 401

    report = client.get("/studio/admin/overview?days=7", headers=headers).json()
    assert report["days"] == 7
    assert report["totals"]["generations"] == 1
    assert [person["account"] for person in report["byAccount"]] == [ACCOUNT]

    audit = [
        e for e in recorded.events(datetime.now(UTC) - timedelta(hours=1)) if e["kind"] == "admin"
    ]
    assert [(e["operation"], e["account"]) for e in audit] == [("overview", ADMIN)]


def test_without_monitoring_the_panel_says_so(tmp_path: Path) -> None:
    client, headers = admin_client(Studio(tmp_path, b"x" * 32, FakeProvider()), None)
    assert client.get("/studio/admin/overview", headers=headers).status_code == 503


def test_the_administrator_sees_a_design_and_never_a_body(
    tmp_path: Path, recorded: EventStore
) -> None:
    studio = Studio(tmp_path, b"x" * 32, RecordingProvider())
    # One design on a generated plate, one on the client's own photo, and a kept camera photo.
    plate_job = a_design(studio)
    reference = studio.ingest(ACCOUNT, an_upload())
    photo = a_body_photo(studio)
    request = payload()
    request["referenceIds"] = [reference["assetId"]]
    request["bodyPhotoId"] = photo
    request["idempotencyKey"] = "12121212-1212-4121-8121-121212121212"
    own = studio.jobs.enqueue(ACCOUNT, request)
    assert studio.jobs.tick()
    kept = studio.capture(ACCOUNT, a_capture(plate_job))
    client, headers = admin_client(studio, recorded)

    detail = client.get(f"/studio/admin/accounts/{ACCOUNT}", headers=headers).json()
    hidden = {v["jobId"]: v["adminHidden"] for v in detail["versions"]}
    assert hidden[plate_job] == []
    assert hidden[own["jobId"]] == ["mockup", "background"]
    assert hidden[kept["jobId"]] == ["capture"]

    def fetch(asset_id: str) -> int:
        return client.get(f"/studio/admin/media/{asset_id}", headers=headers).status_code

    plate = studio.jobs.get(ACCOUNT, plate_job)["result"]
    on_photo = studio.jobs.get(ACCOUNT, own["jobId"])["result"]
    # The design, its stencil and a composite on a generated plate: shown.
    for asset_id in (
        plate["master"]["assetId"],
        plate["stencil"]["assetId"],
        plate["mockup"]["assetId"],
    ):
        assert fetch(asset_id) == 200
    # The same design's master on an own-photo version: shown, it never contained the photo.
    assert fetch(on_photo["master"]["assetId"]) == 200
    # The photograph, what was composed on it, and a kept camera photo: refused.
    for asset_id in (
        photo,
        on_photo["mockup"]["assetId"],
        on_photo["background"]["assetId"],
        kept["result"]["capture"]["photo"]["assetId"],
    ):
        assert fetch(asset_id) == 403
    assert fetch("f" * 32) == 404

    # Each look is recorded, with whose activity or which file.
    audit = [
        e for e in recorded.events(datetime.now(UTC) - timedelta(hours=1)) if e["kind"] == "admin"
    ]
    assert {e["operation"] for e in audit} == {"view_account", "view_asset"}
    assert all(e["account"] == ADMIN for e in audit)


class _FailingModeration(FakeProvider):
    def classify(self, data: bytes) -> ModerationOutcome:
        raise RuntimeError("timeout")


def test_each_upload_refusal_says_its_own_reason(tmp_path: Path) -> None:
    """TASK-0071: one message for every reason hid why a cartoon reference was refused."""
    skin = {**an_upload(), "data": base64.b64encode(picture(lines=False)).decode()}
    person = RecordingProvider()
    with pytest.raises(ValueError, match="persona real"):
        Studio(tmp_path / "a", b"x" * 32, person).ingest(ACCOUNT, skin)
    explicit = RecordingProvider()
    explicit.explicit = True
    with pytest.raises(ValueError, match="contenido explícito"):
        Studio(tmp_path / "b", b"x" * 32, explicit).ingest(ACCOUNT, an_upload())
    with pytest.raises(ValueError, match="No hemos podido revisar"):
        Studio(tmp_path / "c", b"x" * 32, _FailingModeration()).ingest(ACCOUNT, an_upload())


def test_a_failed_job_tells_the_client_plainly_and_the_panel_the_cause(
    tmp_path: Path, recorded: EventStore
) -> None:
    """TASK-0072: «El proveedor no ha completado la solicitud (400)» reached the client."""

    def fail(owner: str, body: dict[str, Any]) -> dict[str, Any]:
        raise ValueError("El proveedor no ha completado la solicitud (400). No hay resultado.")

    queue = JobQueue(tmp_path / "jobs.db", fail)
    job = queue.enqueue("owner", payload())
    queue.tick()
    assert queue.get("owner", job["jobId"])["error"] == client_messages.GENERIC
    (event,) = [
        e for e in recorded.events(datetime.now(UTC) - timedelta(hours=1)) if e["kind"] == "job"
    ]
    assert "(400)" in event["detail"]["error"]


def test_an_interrupted_job_is_explained_plainly(tmp_path: Path) -> None:
    queue = JobQueue(tmp_path / "jobs.db", lambda owner, body: {})
    job = queue.enqueue("owner", payload())
    with queue.connect() as db:
        db.execute("UPDATE jobs SET state='running'")
    error = JobQueue(tmp_path / "jobs.db", lambda owner, body: {}).get("owner", job["jobId"])[
        "error"
    ]
    assert client_messages.for_client(error) == error and "worker" not in error


def test_the_generation_refusals_reach_the_client_unchanged() -> None:
    """TASK-0072: they are written for the client, so the plain-words rule leaves them alone."""
    from generation.studio import CONTENT_REFUSED, PLATE_REFUSED

    for plain in (CONTENT_REFUSED, PLATE_REFUSED):
        assert client_messages.for_client(plain) == plain


def test_a_running_job_reports_its_real_step(tmp_path: Path) -> None:
    """TASK-0076 (audit UX-03): the step shown comes from the pipeline, not from a clock."""
    seen: list[dict[str, Any]] = []
    queue: JobQueue

    def execute(owner: str, body: dict[str, Any]) -> dict[str, Any]:
        job = seen[0]["jobId"]
        queue.stage("drawing")
        seen.append(queue.get(owner, job))
        raise ValueError("stop here")

    queue = JobQueue(tmp_path / "jobs.db", execute)
    seen.append(queue.enqueue("owner", payload()))
    queue.tick()
    assert seen[1]["state"] == "running" and seen[1]["stage"] == "drawing"
    # Once it ends the step is forgotten.
    assert "stage" not in queue.get("owner", seen[0]["jobId"])


def test_a_queued_job_knows_its_place(tmp_path: Path) -> None:
    queue = JobQueue(tmp_path / "jobs.db", lambda owner, body: {})
    first = queue.enqueue("a", payload())
    second = queue.enqueue("b", payload())
    assert queue.get("a", first["jobId"])["queuePosition"] == 1
    assert queue.get("b", second["jobId"])["queuePosition"] == 2


def test_a_generation_reports_each_step_in_order(tmp_path: Path) -> None:
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    steps: list[str] = []
    studio.jobs.stage = steps.append  # type: ignore[method-assign,assignment]
    a_design_for(studio, "11111111-1111-4111-8111-111111111111")
    order = [step for i, step in enumerate(steps) if i == 0 or steps[i - 1] != step]
    assert order == ["references", "skin", "drawing", "stencil", "placing", "finishing"]


def test_an_account_has_a_daily_design_limit(tmp_path: Path) -> None:
    """TASK-0078 (audit SEG-02): checked before anything is paid for; a retry counts once."""
    queue = JobQueue(
        tmp_path / "jobs.db",
        lambda owner, body: {},
        limits=Limits(designs_per_account=2, designs_total=10, turns_per_account=5),
    )
    request = payload()
    for key in ("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"):
        queue.enqueue("owner", {**request, "idempotencyKey": key})
        with queue.connect() as db:
            db.execute("UPDATE jobs SET state='failed', error='x'")
    # The same key again is the same job, not a third design.
    again = queue.enqueue(
        "owner", {**request, "idempotencyKey": "22222222-2222-4222-8222-222222222222"}
    )
    assert again["state"] == "failed"
    with pytest.raises(QuotaExceededError, match="límite de 2 diseños"):
        queue.enqueue(
            "owner", {**request, "idempotencyKey": "33333333-3333-4333-8333-333333333333"}
        )
    # Another account is not affected.
    queue.enqueue("other", {**request, "idempotencyKey": "44444444-4444-4444-8444-444444444444"})


def test_the_studio_has_a_daily_limit_for_everyone(tmp_path: Path) -> None:
    queue = JobQueue(
        tmp_path / "jobs.db",
        lambda owner, body: {},
        limits=Limits(designs_per_account=5, designs_total=1, turns_per_account=5),
    )
    queue.enqueue("a", payload())
    with queue.connect() as db:
        db.execute("UPDATE jobs SET state='failed', error='x'")
    with pytest.raises(QuotaExceededError, match="límite de diseños de hoy"):
        queue.enqueue("b", payload())


def test_a_replacement_is_not_counted_as_a_design() -> None:
    assert billable_job(payload())
    placement = {"edit": {"coverage": "larger", "mode": "placement"}}
    assert not billable_job(placement)
    assert billable_job({"edit": {**placement["edit"], "referenceIds": ["a" * 32]}})


def test_consultation_turns_have_a_daily_limit_and_count_once(tmp_path: Path) -> None:
    ledger = TurnLedger(tmp_path / "jobs.db", Limits(turns_per_account=2))
    ledger.reserve("owner", "t1", "message")
    ledger.reserve("owner", "t1", "message")  # a retry of the same turn
    ledger.reserve("owner", "t2", "search")
    with pytest.raises(QuotaExceededError, match="límite de 2 mensajes"):
        ledger.reserve("owner", "t3", "message")
    # A new UTC day starts again.
    ledger.reserve("owner", "t4", "message", now=time.time() + 86400)


def test_the_counter_says_what_is_left_by_the_rule_the_limit_applies(tmp_path: Path) -> None:
    """TASK-0095 (audit 2026-10-08 UX-04): the client sees what is left before being refused."""
    studio = Studio(
        tmp_path,
        b"x" * 32,
        FakeProvider(),
        limits=Limits(designs_per_account=2, designs_total=3, turns_per_account=4),
    )
    app = FastAPI()
    app.include_router(router(studio, "test-only-token"))
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-only-token", "X-Owner-Id": ACCOUNT}

    fresh = client.get("/studio/quota", headers=headers).json()
    assert fresh["designs"] == {"used": 0, "limit": 2, "remaining": 2}
    assert fresh["turns"] == {"used": 0, "limit": 4, "remaining": 4}
    assert fresh["resetsAt"].endswith("T00:00:00+00:00")

    turn = {"id": "55555555-5555-4555-8555-555555555555", "kind": "message"}
    client.post("/studio/quota/turns", json=turn, headers=headers)
    studio.jobs.enqueue(ACCOUNT, payload())
    with studio.jobs.connect() as db:
        db.execute("UPDATE jobs SET state='failed', error='x'")
    # A re-placement draws nothing, so it is not counted (TASK-0078).
    placement = {**payload(), "idempotencyKey": "88888888-8888-4888-8888-888888888888"}
    placement["edit"] = {"coverage": "larger", "mode": "placement"}
    studio.jobs.enqueue(ACCOUNT, placement)
    with studio.jobs.connect() as db:
        db.execute("UPDATE jobs SET state='failed', error='x'")
    used = client.get("/studio/quota", headers=headers).json()
    assert used["designs"] == {"used": 1, "limit": 2, "remaining": 1}
    assert used["turns"]["remaining"] == 3

    # The studio's own limit can leave an account with nothing even under its own.
    for other in ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"):
        studio.jobs.enqueue(other, payload())
        with studio.jobs.connect() as db:
            db.execute("UPDATE jobs SET state='failed', error='x'")
    full = client.get("/studio/quota", headers=headers).json()
    assert full["designs"] == {"used": 1, "limit": 2, "remaining": 0}
    with pytest.raises(QuotaExceededError):
        studio.jobs.enqueue(
            ACCOUNT, {**payload(), "idempotencyKey": "99999999-9999-4999-8999-999999999999"}
        )
    assert client.get("/studio/quota").status_code == 401


def test_the_limits_answer_429_with_a_plain_message(tmp_path: Path) -> None:
    studio = Studio(
        tmp_path,
        b"x" * 32,
        FakeProvider(),
        limits=Limits(designs_per_account=1, turns_per_account=1),
    )
    app = FastAPI()
    app.include_router(router(studio, "test-only-token"))
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-only-token", "X-Owner-Id": ACCOUNT}
    turn = {"id": "55555555-5555-4555-8555-555555555555", "kind": "message"}
    assert client.post("/studio/quota/turns", json=turn, headers=headers).status_code == 204
    refused = client.post(
        "/studio/quota/turns",
        json={**turn, "id": "66666666-6666-4666-8666-666666666666"},
        headers=headers,
    )
    assert refused.status_code == 429 and "mensajes por día" in refused.json()["detail"]
    reference = studio.ingest(ACCOUNT, an_upload())
    request = payload()
    request["referenceIds"] = [reference["assetId"]]
    assert client.post("/studio/jobs", json=request, headers=headers).status_code == 202
    assert studio.jobs.tick()
    second = client.post(
        "/studio/jobs",
        json={**request, "idempotencyKey": "77777777-7777-4777-8777-777777777777"},
        headers=headers,
    )
    assert second.status_code == 429 and "diseños por día" in second.json()["detail"]


def test_a_consultation_survives_a_web_restart(tmp_path: Path) -> None:
    """TASK-0079 (audit ARQ-01): kept by the worker, per owner, for a day after its last change."""
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    app = FastAPI()
    app.include_router(router(studio, "test-only-token"))
    client = TestClient(app)
    mine = {"Authorization": "Bearer test-only-token", "X-Owner-Id": ACCOUNT}
    other = {**mine, "X-Owner-Id": "22222222-2222-4222-8222-222222222222"}
    cid = "33333333-3333-4333-8333-333333333333"
    data = {"state": {"sessionId": cid, "messages": []}, "jobId": "a" * 32}
    url = f"/studio/consultations/{cid}"
    assert client.put(url, json={"data": data}, headers=mine).status_code == 204
    assert client.get(url, headers=mine).json() == {"data": data}
    # Another account neither reads nor overwrites it.
    assert client.get(url, headers=other).status_code == 404
    assert client.put(url, json={"data": data}, headers=other).status_code == 403
    # A day without changes ends it, and erasing the account removes it.
    studio.purge_expired(datetime.now(UTC) + timedelta(days=2))
    assert client.get(url, headers=mine).status_code == 404
    client.put(url, json={"data": data}, headers=mine)
    studio.delete(ACCOUNT)
    assert client.get(url, headers=mine).status_code == 404


def test_a_consultation_is_dropped_on_request(tmp_path: Path) -> None:
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    cid = "33333333-3333-4333-8333-333333333333"
    studio.save_consultation(ACCOUNT, cid, "{}")
    studio.drop_consultation(ACCOUNT, cid)
    assert studio.load_consultation(ACCOUNT, cid) is None


def test_a_job_records_how_long_it_waited(tmp_path: Path, recorded: EventStore) -> None:
    """TASK-0085 (audit REN-01)."""
    queue = JobQueue(tmp_path / "jobs.db", lambda owner, body: {})
    queue.enqueue("owner", payload())
    with queue.connect() as db:
        db.execute("UPDATE jobs SET created = created - 3")
    queue.tick()
    (event,) = [
        e for e in recorded.events(datetime.now(UTC) - timedelta(hours=1)) if e["kind"] == "job"
    ]
    assert event["detail"]["waitMs"] >= 3_000


def test_a_result_says_how_its_stencil_was_obtained(tmp_path: Path) -> None:
    """TASK-0086 (audit ARQ-03)."""
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    job = a_design_for(studio, ACCOUNT)
    review = studio.jobs.get(ACCOUNT, job)["result"]["stencilReview"]
    assert review["method"] in ("lineart", "colour_contours")
    assert review["simplification"] == 0


class _PaintedBackdrop(FakeProvider):
    """The model drew a shaded design inside a grey card (TASK-0089)."""

    def colour_artwork(
        self,
        brief: dict[str, Any],
        references: list[bytes],
        analysis: str,
        correction: str = "",
    ) -> bytes:
        self.calls += 1
        image = Image.new("RGB", (200, 300), (128, 128, 130))
        ImageDraw.Draw(image).ellipse((40, 30, 160, 260), fill=(30, 30, 32))
        out = io.BytesIO()
        image.save(out, format="PNG")
        return out.getvalue()


def test_a_backdrop_painted_by_the_model_never_reaches_the_design(tmp_path: Path) -> None:
    """TASK-0089: the grey card became a grey panel tattooed on the thigh."""
    studio = Studio(tmp_path, b"x" * 32, _PaintedBackdrop())
    reference = studio.ingest(ACCOUNT, an_upload())
    request = payload()
    request["referenceIds"] = [reference["assetId"]]
    request["brief"]["shading"]["technique"] = "smooth_blend"  # the shaded, colour path
    job = studio.jobs.enqueue(ACCOUNT, request)
    assert studio.jobs.tick()
    result = studio.jobs.get(ACCOUNT, job["jobId"])["result"]
    with Image.open(io.BytesIO(studio.owned(ACCOUNT, result["master"]["assetId"]))) as master:
        grey = master.convert("L")
        # The design's own frame: corners inside the 1 mm margin are what was the card.
        assert grey.getpixel((grey.width // 2, 8)) == 255
        centre = grey.getpixel((grey.width // 2, grey.height // 2))
        assert isinstance(centre, (int, float)) and centre < 80


class _DrawsALegFirst(FakeProvider):
    """TASK-0090: the first artwork is a leg with a tattoo on it; the corrected one is not."""

    def __init__(self, misread_every_time: bool = False) -> None:
        super().__init__()
        self.corrections: list[str] = []
        self.misread_every_time = misread_every_time

    def lineart(
        self, brief: dict[str, Any], references: list[bytes], analysis: str, correction: str = ""
    ) -> bytes:
        self.corrections.append(correction)
        return super().lineart(brief, references, analysis)

    def check_artwork(self, brief: dict[str, Any], artwork: bytes) -> ArtworkCheck | None:
        first = len(self.corrections) <= 1
        bad = self.misread_every_time or first
        return ArtworkCheck(depicts_body=bad, subject_present=True)


def test_a_misread_artwork_is_drawn_again_with_a_correction(tmp_path: Path) -> None:
    provider = _DrawsALegFirst()
    studio = Studio(tmp_path, b"x" * 32, provider)
    job = a_design_for(studio, ACCOUNT)
    assert studio.jobs.get(ACCOUNT, job)["state"] == "succeeded"
    assert provider.corrections[0] == ""
    assert "body or skin" in provider.corrections[1]


def test_a_design_misread_twice_is_refused_plainly(tmp_path: Path) -> None:
    from app.studio import ARTWORK_MISREAD

    provider = _DrawsALegFirst(misread_every_time=True)
    studio = Studio(tmp_path, b"x" * 32, provider)
    reference = studio.ingest(ACCOUNT, an_upload())
    request = payload()
    request["referenceIds"] = [reference["assetId"]]
    job = studio.jobs.enqueue(ACCOUNT, request)
    assert studio.jobs.tick()
    failed = studio.jobs.get(ACCOUNT, job["jobId"])
    assert failed["state"] == "failed" and failed["error"] == ARTWORK_MISREAD
    assert len(provider.corrections) == 2


def test_an_unavailable_review_lets_the_artwork_through(tmp_path: Path) -> None:
    class Unreviewed(FakeProvider):
        def check_artwork(self, brief: dict[str, Any], artwork: bytes) -> ArtworkCheck | None:
            return None

    studio = Studio(tmp_path, b"x" * 32, Unreviewed())
    job = a_design_for(studio, ACCOUNT)
    assert studio.jobs.get(ACCOUNT, job)["state"] == "succeeded"
