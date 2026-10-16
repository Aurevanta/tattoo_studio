"""A design's default name and the name a client gives it (TASK-0116)."""

from __future__ import annotations

import pytest

from jobs.designs import UNTITLED, asset_ids, clean_name, default_name, parent_of


def brief(idea: str) -> dict[str, object]:
    return {"brief": {"subject": {"description": idea}}}


def test_the_default_name_is_the_idea_shortened() -> None:
    assert default_name(brief("un lobo geométrico")) == "Un lobo geométrico"
    assert default_name(brief("Una rosa. Con espinas finas y una gota")) == "Una rosa"
    long = default_name(
        brief("Un dragón japonés enroscado alrededor de una katana con flores de cerezo y olas")
    )
    assert long.endswith("…") and len(long) <= 49
    assert " " not in long[-2:]
    assert (
        default_name(brief("Un lobo geométrico aullando a la luna llena, con líneas finas"))
        == "Un lobo geométrico aullando a la luna llena…"
    )
    assert default_name(brief("   ")) == UNTITLED
    assert default_name({}) == UNTITLED


def test_a_name_is_one_line_of_at_most_sixty_characters() -> None:
    assert clean_name("  Lobo\n\tde   Ana ") == "Lobo de Ana"
    assert clean_name("") == ""
    assert clean_name("x" * 60) == "x" * 60
    with pytest.raises(ValueError):
        clean_name("x" * 61)
    with pytest.raises(ValueError):
        clean_name(None)


def test_a_version_knows_what_it_was_asked_from() -> None:
    assert parent_of('{"edit": {"parentJobId": "a"}}', None) == "a"
    assert parent_of("{}", '{"capture": {"parentJobId": "b"}}') == "b"
    assert parent_of("{}", None) is None
    assert parent_of("not json", None) is None


def test_every_nested_file_is_found() -> None:
    result = {
        "master": {"assetId": "m"},
        "panels": [{"assetId": "p1"}, {"assetId": "p2"}],
        "capture": {"photo": {"assetId": "c"}},
        "notice": "assetId",
    }
    assert asset_ids(result) == {"m", "p1", "p2", "c"}
