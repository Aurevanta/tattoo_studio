"""The client names designs, deletes them and starts one from another (TASK-0116)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from tattoo_contracts.validation import validate

from app.studio import Studio, router
from app.tests.test_studio import ACCOUNT, FakeProvider, a_capture, a_design, an_upload, payload

SERVICE = {"Authorization": "Bearer test-only-token"}
AS_OWNER = {**SERVICE, "X-Owner-Id": ACCOUNT}
OTHER = {**SERVICE, "X-Owner-Id": "22222222-2222-4222-8222-222222222222"}
COPY_KEY = "77777777-7777-4777-8777-777777777777"


def a_client(studio: Studio) -> TestClient:
    app = FastAPI()
    app.include_router(router(studio, "test-only-token"))
    return TestClient(app)


def a_placement(studio: Studio, parent: str, key: str) -> str:
    """A re-placement of `parent`: it keeps the parent's artwork and stencils."""
    response = a_client(studio).post(
        "/studio/jobs",
        json={
            "edit": {
                "parentJobId": parent,
                "instruction": "Ampliar la cobertura",
                "coverage": "larger",
                "mode": "placement",
            },
            "idempotencyKey": key,
        },
        headers=AS_OWNER,
    )
    assert response.status_code == 202, response.text
    assert studio.jobs.tick()
    status = studio.jobs.get(ACCOUNT, response.json()["jobId"])
    assert status["state"] == "succeeded", status
    return str(status["jobId"])


def another_design(studio: Studio) -> str:
    """A second design of the account, from a request of its own."""
    reference = studio.ingest(ACCOUNT, an_upload())
    request = {
        **payload(),
        "referenceIds": [reference["assetId"]],
        "idempotencyKey": "88888888-8888-4888-8888-888888888888",
    }
    job = studio.jobs.enqueue(ACCOUNT, request)
    assert studio.jobs.tick()
    return str(job["jobId"])


def files_of(result: dict[str, Any]) -> set[str]:
    return {
        part["assetId"] for part in result.values() if isinstance(part, dict) and "assetId" in part
    }


def stored(studio: Studio) -> set[str]:
    return {asset.asset_id for asset in studio.media.all_assets()}


def test_versions_of_one_design_share_it_and_its_name(tmp_path: Path) -> None:
    """AC-001, AC-002: a change joins its design; the default name is the idea, shortened."""
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    first = a_design(studio)
    child = a_placement(studio, first, "33333333-3333-4333-8333-333333333333")
    kept = studio.capture(ACCOUNT, a_capture(child))["jobId"]
    other = another_design(studio)

    history = studio.jobs.history(ACCOUNT)
    assert all(validate("studio-status", status) == [] for status in history)
    designs = {status["jobId"]: status["design"] for status in history}
    assert designs[first]["id"] == designs[child]["id"] == designs[kept]["id"] == first
    assert designs[other]["id"] == other
    idea = payload()["brief"]["subject"]["description"]
    assert designs[first]["name"].lower().startswith(idea.split()[0].lower())
    assert len(designs[first]["name"]) <= 60


def test_a_design_is_renamed_and_its_name_can_be_reset(tmp_path: Path) -> None:
    """AC-003."""
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    client = a_client(studio)
    first = a_design(studio)
    default = studio.jobs.get(ACCOUNT, first)["design"]["name"]

    answer = client.patch(
        f"/studio/designs/{first}", json={"name": "  Lobo\n de  Ana "}, headers=AS_OWNER
    )
    assert answer.status_code == 200, answer.text
    assert answer.json() == {"name": "Lobo de Ana"}
    assert studio.jobs.history(ACCOUNT)[0]["design"]["name"] == "Lobo de Ana"

    assert (
        client.patch(
            f"/studio/designs/{first}", json={"name": "x" * 61}, headers=AS_OWNER
        ).status_code
        == 422
    )
    assert (
        client.patch(f"/studio/designs/{first}", json={"name": 3}, headers=AS_OWNER).status_code
        == 422
    )
    # Another account cannot name it, nor learn it exists.
    assert (
        client.patch(f"/studio/designs/{first}", json={"name": "Mío"}, headers=OTHER).status_code
        == 404
    )
    assert studio.jobs.get(ACCOUNT, first)["design"]["name"] == "Lobo de Ana"

    assert client.patch(f"/studio/designs/{first}", json={"name": ""}, headers=AS_OWNER).json() == {
        "name": default
    }


def test_deleting_a_version_keeps_what_the_others_use(tmp_path: Path) -> None:
    """AC-004: the parent goes; its child keeps the artwork and stencils it shares with it."""
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    client = a_client(studio)
    first = a_design(studio)
    parent = studio.jobs.get(ACCOUNT, first)["result"]
    child = a_placement(studio, first, "33333333-3333-4333-8333-333333333333")
    kept = studio.jobs.get(ACCOUNT, child)["result"]
    assert kept["stencil"] == parent["stencil"]

    answer = client.delete(f"/studio/jobs/{first}", headers=AS_OWNER)
    assert answer.status_code == 200, answer.text
    assert answer.json() == {"deleted": 1}

    assert [status["jobId"] for status in studio.jobs.history(ACCOUNT)] == [child]
    # Every file the child shows still opens; the parent's own skin view does not.
    for asset_id in files_of(kept):
        assert studio.owned(ACCOUNT, asset_id)
    assert parent["mockup"]["assetId"] not in stored(studio)
    # The child is still its design, under the same name, and can be changed further.
    assert studio.jobs.get(ACCOUNT, child)["design"]["id"] == first
    a_placement(studio, child, "44444444-4444-4444-8444-444444444444")
    # It counted as a design today, and still does.
    assert studio.jobs.designs_today(ACCOUNT)[0] == 1
    assert client.delete(f"/studio/jobs/{first}", headers=AS_OWNER).status_code == 404


def test_deleting_a_design_erases_every_version_file_and_link(tmp_path: Path) -> None:
    """AC-005, AC-006: its versions, its files, its references, its vector and its links."""
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    client = a_client(studio)
    first = a_design(studio)
    child = a_placement(studio, first, "33333333-3333-4333-8333-333333333333")
    studio.capture(ACCOUNT, a_capture(child))
    other = another_design(studio)
    other_files = files_of(studio.jobs.get(ACCOUNT, other)["result"])
    before = stored(studio)
    token = client.post("/studio/shares", json={"jobId": child}, headers=AS_OWNER).json()["token"]
    survivor = client.post("/studio/shares", json={"jobId": other}, headers=AS_OWNER).json()[
        "token"
    ]

    assert client.delete(f"/studio/designs/{first}", headers=OTHER).status_code == 404
    answer = client.delete(f"/studio/designs/{first}", headers=AS_OWNER)
    assert answer.status_code == 200, answer.text
    assert answer.json() == {"deleted": 3}

    assert [status["jobId"] for status in studio.jobs.history(ACCOUNT)] == [other]
    left = stored(studio)
    assert other_files <= left
    assert len(left) < len(before)
    # What is left is exactly the other design: its files, its reference and its vector.
    with studio.db() as db:
        owned = {row[0] for row in db.execute("SELECT id FROM assets WHERE owner=?", (ACCOUNT,))}
        vectors = db.execute(
            "SELECT count(*) FROM design_vector WHERE owner=?", (ACCOUNT,)
        ).fetchone()[0]
    assert owned == left
    assert vectors == 1
    reference = studio.jobs.source_payload(ACCOUNT, other)["referenceIds"][0]
    extra = left - other_files
    assert reference in extra and len(extra) == 2  # its reference and its vector
    # The link to the erased design closes; the other one still opens.
    shown = {**SERVICE, "X-Share-Token": token}
    assert client.get("/studio/shares", headers=shown).status_code == 404
    assert (
        client.get("/studio/shares", headers={**SERVICE, "X-Share-Token": survivor}).status_code
        == 200
    )
    assert client.delete(f"/studio/designs/{first}", headers=AS_OWNER).status_code == 404


def test_a_design_being_changed_is_not_deleted(tmp_path: Path) -> None:
    """AC-007: a generation in progress would otherwise read files deleted under it."""
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    client = a_client(studio)
    first = a_design(studio)
    queued = client.post(
        "/studio/jobs",
        json={
            "edit": {
                "parentJobId": first,
                "instruction": "Ampliar",
                "coverage": "larger",
                "mode": "placement",
            },
            "idempotencyKey": "33333333-3333-4333-8333-333333333333",
        },
        headers=AS_OWNER,
    )
    assert queued.status_code == 202
    for path in (f"/studio/designs/{first}", f"/studio/jobs/{first}"):
        refused = client.delete(path, headers=AS_OWNER)
        assert refused.status_code == 409
        assert "Espera" in refused.json()["detail"]
    assert studio.jobs.tick()
    assert client.delete(f"/studio/designs/{first}", headers=AS_OWNER).json() == {"deleted": 2}


def test_a_new_design_from_a_version_is_its_own_design(tmp_path: Path) -> None:
    """AC-008: copied as it is, under its own name, free, and independent of the original."""
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    client = a_client(studio)
    first = a_design(studio)
    source = studio.jobs.get(ACCOUNT, first)
    studio.jobs.rename(ACCOUNT, first, "Lobo")
    body = {"fromJobId": first, "idempotencyKey": COPY_KEY}

    made = client.post("/studio/designs", json=body, headers=AS_OWNER)
    assert made.status_code == 201, made.text
    copy = made.json()
    assert validate("studio-status", copy) == []
    assert copy["design"] == {"id": copy["jobId"], "name": "Lobo (copia)"}
    assert copy["result"]["stencil"] == source["result"]["stencil"]
    assert "edit" not in copy["result"]
    # A retry makes no second copy; it costs no design from the day's limit.
    assert (
        client.post("/studio/designs", json=body, headers=AS_OWNER).json()["jobId"] == copy["jobId"]
    )
    assert studio.jobs.designs_today(ACCOUNT)[0] == 1
    assert client.post("/studio/designs", json=body, headers=OTHER).status_code == 404

    # Changes asked from the copy are versions of the copy.
    child = a_placement(studio, copy["jobId"], "33333333-3333-4333-8333-333333333333")
    assert studio.jobs.get(ACCOUNT, child)["design"]["id"] == copy["jobId"]
    # Deleting the original leaves the copy whole.
    assert client.delete(f"/studio/designs/{first}", headers=AS_OWNER).json() == {"deleted": 1}
    for asset_id in files_of(studio.jobs.get(ACCOUNT, copy["jobId"])["result"]):
        assert studio.owned(ACCOUNT, asset_id)
    assert {status["design"]["id"] for status in studio.jobs.history(ACCOUNT)} == {copy["jobId"]}


def test_a_copy_of_a_kept_photo_leaves_the_photo_behind(tmp_path: Path) -> None:
    """AC-008: a camera photo is of the client's body and stays with the design it was taken for."""
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    first = a_design(studio)
    kept = studio.capture(ACCOUNT, a_capture(first))
    copy = studio.copy_design(ACCOUNT, {"fromJobId": kept["jobId"], "idempotencyKey": COPY_KEY})
    assert "capture" not in copy["result"]
    assert "superpuesto" not in copy["result"]["notice"]
    assert copy["design"]["id"] == copy["jobId"] != first


def test_versions_stored_before_designs_existed_find_their_design(tmp_path: Path) -> None:
    """AC-009: a database from before TASK-0116 is given its designs when the studio starts."""
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    first = a_design(studio)
    child = a_placement(studio, first, "33333333-3333-4333-8333-333333333333")
    with studio.jobs.connect() as db:
        db.execute("UPDATE jobs SET family=NULL")

    again = Studio(tmp_path, b"x" * 32, FakeProvider())
    assert again.jobs.get(ACCOUNT, child)["design"]["id"] == first


def test_erasing_everything_forgets_the_names(tmp_path: Path) -> None:
    studio = Studio(tmp_path, b"x" * 32, FakeProvider())
    first = a_design(studio)
    studio.jobs.rename(ACCOUNT, first, "Lobo")
    studio.delete(ACCOUNT)
    with studio.jobs.connect() as db:
        assert db.execute("SELECT count(*) FROM design_names").fetchone()[0] == 0
    with pytest.raises(KeyError):
        studio.jobs.name(ACCOUNT, first)
