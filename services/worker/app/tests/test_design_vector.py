"""One vector per account and design (TASK-0126, FINDING-0005)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.studio import Studio, router
from app.tests.test_studio import FakeProvider, a_design_for, an_upload, payload

ANA = "11111111-1111-4111-8111-111111111111"
BEA = "22222222-2222-4222-8222-222222222222"
KEY = b"x" * 32


def another_design(studio: Studio, owner: str, key: str) -> str:
    """A second request of the same account, which the test provider draws identically."""
    reference = studio.ingest(owner, an_upload())
    request = {**payload(), "referenceIds": [reference["assetId"]], "idempotencyKey": key}
    job_id = str(studio.jobs.enqueue(owner, request)["jobId"])
    assert studio.jobs.tick()
    return job_id


def vectors(studio: Studio, owner: str) -> list[str]:
    """The vector files the account owns, by their media type."""
    with studio.db() as db:
        ids = [row[0] for row in db.execute("SELECT id FROM assets WHERE owner=?", (owner,))]
    return [i for i in ids if studio.media.metadata(i).media_type == "application/json"]


def test_two_accounts_with_the_same_design_keep_a_vector_each(tmp_path: Path) -> None:
    """The test provider draws the same picture for every idea, so both designs hash alike."""
    studio = Studio(tmp_path, KEY, FakeProvider())
    ana = studio.jobs.get(ANA, a_design_for(studio, ANA))["result"]
    bea_job = a_design_for(studio, BEA)
    bea = studio.jobs.get(BEA, bea_job)["result"]
    assert ana["designId"] == bea["designId"]
    with studio.db() as db:
        rows = db.execute(
            "SELECT owner, asset_id FROM design_vector WHERE design_id=? ORDER BY owner",
            (ana["designId"],),
        ).fetchall()
    assert [owner for owner, _ in rows] == [ANA, BEA]
    assert rows[0][1] != rows[1][1]
    assert studio.load_vector(ANA, ana["designId"]) is not None
    assert studio.load_vector(BEA, bea["designId"]) is not None

    # Erasing one account's design leaves the other's vector where it was.
    client = TestClient(FastAPI(routes=router(studio, "test-only-token").routes))
    erased = client.delete(
        f"/studio/designs/{bea_job}",
        headers={"Authorization": "Bearer test-only-token", "X-Owner-Id": BEA},
    )
    assert erased.status_code == 200, erased.text
    assert studio.load_vector(ANA, ana["designId"]) is not None
    assert studio.load_vector(BEA, bea["designId"]) is None
    assert vectors(studio, BEA) == []


def test_the_same_design_stored_again_leaves_no_vector_behind(tmp_path: Path) -> None:
    studio = Studio(tmp_path, KEY, FakeProvider())
    first = studio.jobs.get(ANA, a_design_for(studio, ANA))["result"]
    kept = vectors(studio, ANA)
    assert len(kept) == 1
    second_job = another_design(studio, ANA, "88888888-8888-4888-8888-888888888888")
    second = studio.jobs.get(ANA, second_job)["result"]
    assert second["designId"] == first["designId"]
    # Reused, not replaced: no file is left that nothing points at.
    assert vectors(studio, ANA) == kept
    with studio.db() as db:
        assert db.execute(
            "SELECT asset_id FROM design_vector WHERE owner=?", (ANA,)
        ).fetchall() == [(kept[0],)]


def test_a_vector_whose_file_is_gone_is_stored_again(tmp_path: Path) -> None:
    studio = Studio(tmp_path, KEY, FakeProvider())
    design = studio.jobs.get(ANA, a_design_for(studio, ANA))["result"]
    (lost,) = vectors(studio, ANA)
    studio.media.delete_cascade(lost)
    assert studio.load_vector(ANA, design["designId"]) is None
    another_design(studio, ANA, "88888888-8888-4888-8888-888888888888")
    assert studio.load_vector(ANA, design["designId"]) is not None
    with studio.db() as db:
        assert db.execute("SELECT 1 FROM assets WHERE id=?", (lost,)).fetchone() is None


def test_a_table_keyed_by_the_design_alone_is_migrated(tmp_path: Path) -> None:
    """An existing studio keeps its vectors when the key changes."""
    tmp_path.mkdir(exist_ok=True)
    with sqlite3.connect(tmp_path / "ownership.sqlite") as db:
        db.execute(
            "CREATE TABLE design_vector (design_id TEXT PRIMARY KEY, owner TEXT, asset_id TEXT)"
        )
        db.execute("INSERT INTO design_vector VALUES ('d1', ?, 'a1')", (ANA,))
        db.execute("INSERT INTO design_vector VALUES ('d2', ?, 'a2')", (BEA,))
    studio = Studio(tmp_path, KEY, FakeProvider())
    with studio.db() as db:
        key = [row[1] for row in db.execute("PRAGMA table_info(design_vector)") if row[5]]
        rows = db.execute(
            "SELECT design_id, owner, asset_id FROM design_vector ORDER BY design_id"
        ).fetchall()
    assert sorted(key) == ["design_id", "owner"]
    assert rows == [("d1", ANA, "a1"), ("d2", BEA, "a2")]
    # The same design id may now be kept by another account.
    with studio.db() as db:
        db.execute("INSERT INTO design_vector VALUES ('d1', ?, 'a3')", (BEA,))
    # Opening it again changes nothing.
    Studio(tmp_path, KEY, FakeProvider())
    with studio.db() as db:
        assert db.execute("SELECT count(*) FROM design_vector").fetchone()[0] == 3


def test_erasing_the_version_that_stored_a_shared_vector_keeps_it_for_the_rest(
    tmp_path: Path,
) -> None:
    """Two designs of one account that hash alike share a vector, stored under the first one's
    reference. Erasing the first, with its reference, must not take the second's vector."""
    studio = Studio(tmp_path, KEY, FakeProvider())
    first = a_design_for(studio, ANA)
    second = another_design(studio, ANA, "88888888-8888-4888-8888-888888888888")
    design_id = studio.jobs.get(ANA, second)["result"]["designId"]
    client = TestClient(FastAPI(routes=router(studio, "test-only-token").routes))
    erased = client.delete(
        f"/studio/designs/{first}",
        headers={"Authorization": "Bearer test-only-token", "X-Owner-Id": ANA},
    )
    assert erased.status_code == 200, erased.text
    assert studio.load_vector(ANA, design_id) is not None
    (kept,) = vectors(studio, ANA)
    reference = studio.jobs.source_payload(ANA, second)["referenceIds"][0]
    assert studio.media.metadata(kept).parent_id == reference
