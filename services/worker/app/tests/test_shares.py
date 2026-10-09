"""Links a client gives their tattooer (TASK-0097, ADR-0032)."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from tattoo_contracts.validation import validate

from app.shares import MAX_ACTIVE, SHARE_DAYS, ShareLedger
from app.studio import Studio, router
from app.tests.test_studio import (
    ACCOUNT,
    FakeProvider,
    a_body_photo,
    a_design_for,
    an_upload,
    payload,
)

SERVICE = {"Authorization": "Bearer test-only-token"}
AS_OWNER = {**SERVICE, "X-Owner-Id": ACCOUNT}
OTHER = "22222222-2222-4222-8222-222222222222"


def a_client(studio: Studio) -> TestClient:
    app = FastAPI()
    app.include_router(router(studio, "test-only-token"))
    return TestClient(app)


def opened(client: TestClient, token: str) -> dict[str, Any]:
    answer = client.get("/studio/shares", headers={**SERVICE, "X-Share-Token": token})
    assert answer.status_code == 200, answer.text
    return cast(dict[str, Any], answer.json())


def test_a_link_shows_the_design_and_what_the_tattooer_needs(tmp_path: Path) -> None:
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    client = a_client(studio)
    job = a_design_for(studio, ACCOUNT)

    made = client.post("/studio/shares", json={"jobId": job}, headers=AS_OWNER)
    assert made.status_code == 201
    token = made.json()["token"]
    assert len(token) == 32

    shared = opened(client, token)
    assert validate("shared-design", shared) == []
    result = studio.jobs.get(ACCOUNT, job)["result"]
    brief = payload()["brief"]
    assert shared["designId"] == result["designId"]
    assert shared["size"] == result["size"]
    assert shared["placement"]["bodyPart"] == brief["placement"]["bodyPart"]
    assert shared["idea"] == brief["subject"]["description"]
    assert shared["mockup"] == result["mockup"]  # generated skin may be shown
    # Nothing that identifies the client or shows their body.
    for private in ("account", "owner", "bodyType", "capture", "background", "jobId"):
        assert private not in str(shared.keys()) and private not in shared["placement"]

    # Each file the link shows opens; anything else of the account does not.
    for name in ("master", "stencil", "stencilMirror", "pdf", "pdfMirror", "mockup"):
        asset = shared[name]["assetId"]
        answer = client.get(
            f"/studio/shares/media/{asset}", headers={**SERVICE, "X-Share-Token": token}
        )
        assert answer.status_code == 200, name
    # Another file of the same account, such as a reference, is not part of the link.
    other_asset = studio.ingest(ACCOUNT, an_upload())["assetId"]
    refused = client.get(
        f"/studio/shares/media/{other_asset}", headers={**SERVICE, "X-Share-Token": token}
    )
    assert refused.status_code == 404


def test_a_design_on_the_clients_own_photo_shares_no_view_of_the_body(tmp_path: Path) -> None:
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    client = a_client(studio)
    reference = studio.ingest(ACCOUNT, an_upload())
    request = payload()
    request["referenceIds"] = [reference["assetId"]]
    request["bodyPhotoId"] = a_body_photo(studio)
    job = studio.jobs.enqueue(ACCOUNT, request)["jobId"]
    assert studio.jobs.tick()
    result = studio.jobs.get(ACCOUNT, job)["result"]
    assert result["backgroundKind"] == "own_photo"

    token = client.post("/studio/shares", json={"jobId": job}, headers=AS_OWNER).json()["token"]
    shared = opened(client, token)
    assert shared["mockup"] is None
    for asset in (result["mockup"]["assetId"], result["background"]["assetId"]):
        answer = client.get(
            f"/studio/shares/media/{asset}", headers={**SERVICE, "X-Share-Token": token}
        )
        assert answer.status_code == 404


def test_only_the_owner_shares_and_only_the_service_opens(tmp_path: Path) -> None:
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    client = a_client(studio)
    job = a_design_for(studio, ACCOUNT)
    stranger = {**SERVICE, "X-Owner-Id": OTHER}
    assert client.post("/studio/shares", json={"jobId": job}, headers=stranger).status_code == 404
    assert client.post("/studio/shares", json={"jobId": "x"}, headers=AS_OWNER).status_code == 422
    token = client.post("/studio/shares", json={"jobId": job}, headers=AS_OWNER).json()["token"]
    # Without the service token a link opens nothing, even with the right token.
    assert client.get("/studio/shares", headers={"X-Share-Token": token}).status_code == 401
    for wrong in ("", "x" * 32, token[:-1] + ("A" if token[-1] != "A" else "B")):
        answer = client.get("/studio/shares", headers={**SERVICE, "X-Share-Token": wrong})
        assert answer.status_code == 404


def test_a_link_ends_when_withdrawn_or_when_the_account_is_erased(tmp_path: Path) -> None:
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    client = a_client(studio)
    job = a_design_for(studio, ACCOUNT)
    first = client.post("/studio/shares", json={"jobId": job}, headers=AS_OWNER).json()["token"]
    second = client.post("/studio/shares", json={"jobId": job}, headers=AS_OWNER).json()["token"]
    status = client.get(f"/studio/shares/open/{job}", headers=AS_OWNER).json()
    assert status["open"] == 2 and status["expiresAt"]
    other = {**SERVICE, "X-Owner-Id": OTHER}
    assert client.get(f"/studio/shares/open/{job}", headers=other).json() == {
        "open": 0,
        "expiresAt": None,
    }
    assert client.delete(f"/studio/shares/{job}", headers=AS_OWNER).status_code == 204
    assert client.get(f"/studio/shares/open/{job}", headers=AS_OWNER).json()["open"] == 0
    for token in (first, second):
        answer = client.get("/studio/shares", headers={**SERVICE, "X-Share-Token": token})
        assert answer.status_code == 404

    again = client.post("/studio/shares", json={"jobId": job}, headers=AS_OWNER).json()["token"]
    assert opened(client, again)
    studio.delete(ACCOUNT)
    answer = client.get("/studio/shares", headers={**SERVICE, "X-Share-Token": again})
    assert answer.status_code == 404


def test_the_ledger_keeps_a_digest_expires_and_limits_open_links(tmp_path: Path) -> None:
    ledger = ShareLedger(tmp_path / "jobs.sqlite")
    now = time.time()
    token, created, expires = ledger.create(ACCOUNT, "a" * 32, now=now)
    assert expires - created == SHARE_DAYS * 86400
    with ledger.connect() as db:
        stored = [row[0] for row in db.execute("SELECT digest FROM shares")]
    assert stored == [ledger.digest(token)] and token not in stored
    assert ledger.resolve(token, now=now + 60) is not None
    assert ledger.resolve(token, now=expires + 1) is None

    for _ in range(MAX_ACTIVE - 1):
        ledger.create(ACCOUNT, "a" * 32, now=now)
    with pytest.raises(ValueError, match="demasiados enlaces"):
        ledger.create(ACCOUNT, "a" * 32, now=now)
    # Expired links do not count against the limit.
    assert ledger.create(ACCOUNT, "a" * 32, now=expires + 1)[0]
