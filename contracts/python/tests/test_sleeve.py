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


def test_the_circumference_follows_the_limb_down_the_band() -> None:
    """TASK-0105: widest at the calf, narrowest above the ankle; interpolated between samples."""
    leg = WRAP_REGIONS["lower_leg"]
    assert abs(max(leg.profile_mm) - leg.circumference_mm) < 1.0
    assert len(leg.profile_mm) == int(leg.length_mm / leg.step_mm) + 1
    assert leg.circumference_at(0) == leg.profile_mm[0]
    assert leg.circumference_at(5) == (leg.profile_mm[0] + leg.profile_mm[1]) / 2
    assert leg.circumference_at(-10) == leg.profile_mm[0]
    assert leg.circumference_at(1e6) == leg.profile_mm[-1]
    assert leg.circumference_at(leg.length_mm) < 0.65 * leg.circumference_mm  # the ankle


def test_the_sides_are_named_round_each_limb() -> None:
    leg, arm = WRAP_REGIONS["lower_leg"], WRAP_REGIONS["forearm"]
    assert (
        leg.side(0.5) == "Detrás" and leg.side(0.27) == "Exterior" and leg.side(0.97) == "Delante"
    )
    assert arm.side(0.0) == "Interior" and arm.side(0.5) == "Exterior"
    assert leg.zone_around == {"calf": 0.5, "shin": 0.0}
