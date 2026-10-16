"""The tattooer acceptance kit builds from the studio's own exporters (TASK-0130).

The kit's human half — printing, transferring, judging — is not testable here. Its software half
is: every sample is the product's export at the stated size, the colour sample says it is
approximate and the line-art ones do not, and the manifest names exactly the files written.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import pytest

from app.build_acceptance_kit import COLOUR_SOURCE, LINEART_SOURCE, build
from stencil.engine import APPROXIMATE_NOTE, tile_grid

PT_PER_MM = 72 / 25.4


def first_page_mm(pdf: bytes) -> tuple[float, float]:
    width, height = re.findall(rb"/MediaBox \[\s*0 0 ([\d.]+) ([\d.]+)\s*\]", pdf)[0]
    return float(width) / PT_PER_MM, float(height) / PT_PER_MM


@pytest.mark.skipif(
    not (LINEART_SOURCE.is_file() and COLOUR_SOURCE.is_file()),
    reason="the kit's real designs live in apps/web/public",
)
def test_the_kit_is_the_products_own_stencils_with_its_protocol_and_form(tmp_path: Path) -> None:
    manifest = build(tmp_path)
    written = sorted(p.name for p in tmp_path.iterdir())
    assert written == sorted([*manifest["files"], "manifiesto.json"])
    for name, digest in manifest["files"].items():
        assert hashlib.sha256((tmp_path / name).read_bytes()).hexdigest() == digest
    assert json.loads((tmp_path / "manifiesto.json").read_text(encoding="utf-8")) == manifest

    note = APPROXIMATE_NOTE[0].encode()
    for sample in manifest["samples"]:
        pdf = (tmp_path / sample["file"]).read_bytes()
        assert pdf.startswith(b"%PDF")
        assert (note in pdf) == (sample["regime"] == "colour_contours"), sample["file"]
        if sample["file"].startswith("06"):
            continue  # a sleeve's panels are pages of their own size
        width, height = sample["size_mm"]
        assert first_page_mm(pdf) == pytest.approx((max(width + 20, 80), height + 35), abs=0.01)
        assert f"{width:g} x {height:g} mm - Print 100%, no fit".encode() in pdf
        columns, rows = tile_grid(width, height)
        assert pdf.count(b"/Type /Page\n") == 1 + columns * rows
    regimes = [s["regime"] for s in manifest["samples"]]
    assert regimes.count("colour_contours") == 1 and regimes.count("lineart") == 5
    strokes = [s["stroke_mm"] for s in manifest["samples"][:3]]
    assert strokes == [0.25, 0.35, 0.6]
    for name in ("00-protocolo.pdf", "07-formulario.pdf"):
        assert (tmp_path / name).read_bytes().startswith(b"%PDF")
    assert b"Criterios de aceptaci" in (tmp_path / "00-protocolo.pdf").read_bytes()
