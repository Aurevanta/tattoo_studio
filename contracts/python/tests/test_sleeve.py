"""TASK-0104: the Python sleeve rule matches the TypeScript one (`corpus.test.ts`, «sleeves»)."""

from __future__ import annotations

from tattoo_contracts.sleeve import WRAP_REGIONS, is_sleeve, wrap_region, wrap_size


def brief(body_part: str, orientation: str, width: float) -> dict[str, object]:
    return {
        "placement": {"bodyPart": body_part, "orientation": orientation},
        "size": {"widthMm": width, "heightMm": 300.0},
    }


def test_sleeve_sizes_for_the_lower_leg_and_the_forearm() -> None:
    assert wrap_size("calf") == {"widthMm": 344.0, "heightMm": 310.0}
    assert wrap_size("shin") == wrap_size("calf")
    assert wrap_size("inner_forearm") == {"widthMm": 255.0, "heightMm": 215.0}
    assert wrap_size("chest") is None
    assert wrap_region("ankle") is None
    assert sorted(WRAP_REGIONS) == ["forearm", "lower_leg"]


def test_a_sleeve_is_told_from_a_band() -> None:
    assert is_sleeve(brief("calf", "wrapping", 344))
    assert is_sleeve(brief("calf", "wrapping", 310))
    assert not is_sleeve(brief("calf", "wrapping", 120))
    assert not is_sleeve(brief("calf", "vertical", 344))
    assert not is_sleeve(brief("ankle", "wrapping", 344))
    assert not is_sleeve({})
