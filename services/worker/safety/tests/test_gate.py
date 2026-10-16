"""The input gate: denies unless a provider affirmatively passes.

The central property here is that there is no route to a pass except through a provider
saying so. Every test below is really one question asked differently: can anything get
through without being checked?
"""

from __future__ import annotations

import pytest

from safety import (
    GateResult,
    InputGate,
    ModerationOutcome,
    ReasonCode,
    SafetyClearance,
    Verdict,
    content_digest,
    mint_clearance,
)

IMAGE = b"pretend-these-are-image-bytes"


def test_own_body_exception_requires_consent_and_still_rejects_explicit() -> None:
    assert not InputGate(HasPerson()).screen_upload(IMAGE).passed
    assert InputGate(HasPerson()).screen_upload(IMAGE, own_body_consented=True).passed
    assert not InputGate(Explicit()).screen_upload(IMAGE, own_body_consented=True).passed


class Passing:
    name = "test-passing"

    def classify(self, data: bytes) -> ModerationOutcome:
        return ModerationOutcome(explicit=False, identifiable_person=False)


class Explicit:
    name = "test-explicit"

    def classify(self, data: bytes) -> ModerationOutcome:
        return ModerationOutcome(explicit=True, identifiable_person=False)


class HasPerson:
    name = "test-person"

    def classify(self, data: bytes) -> ModerationOutcome:
        return ModerationOutcome(explicit=False, identifiable_person=True)


class Exploding:
    name = "test-broken"

    def classify(self, data: bytes) -> ModerationOutcome:
        raise RuntimeError("provider is down, and this message mentions secret-token-xyz")


# ---------------------------------------------------------------------------
# SAFETY-INV-001 / SAFETY-INV-007: deny by default, never fall open
# ---------------------------------------------------------------------------


def test_gate_with_no_provider_denies() -> None:
    """The shipped configuration today. Useless but safe, which is the right order."""
    result = InputGate().screen_upload(IMAGE)

    assert result.verdict is Verdict.REJECT
    assert result.reason is ReasonCode.NO_PROVIDER
    assert result.clearance is None


def test_gate_with_no_provider_denies_even_a_perfectly_fine_image() -> None:
    """Absence of a gate denies; it does not wave things through."""
    result = InputGate().screen_upload(b"\x89PNG\r\n\x1a\n" + b"\x00" * 128)

    assert not result.passed


def test_provider_failure_denies() -> None:
    result = InputGate(Exploding()).screen_upload(IMAGE)

    assert result.verdict is Verdict.REJECT
    assert result.reason is ReasonCode.PROVIDER_FAILED
    assert result.clearance is None


def test_provider_failure_message_is_not_echoed() -> None:
    """A provider exception can carry request detail or a token (SEC-INV-008)."""
    result = InputGate(Exploding()).screen_upload(IMAGE)

    assert "secret-token-xyz" not in result.reason.value
    assert "secret-token-xyz" not in str(result)


def test_explicit_content_is_rejected() -> None:
    result = InputGate(Explicit()).screen_upload(IMAGE)

    assert result.reason is ReasonCode.EXPLICIT
    assert result.clearance is None


def test_an_image_containing_a_person_is_rejected() -> None:
    """Scope is pets and objects.

    A user can consent to their own photograph being processed but cannot consent on
    behalf of a third person who happens to be in it, so people are refused outright
    rather than screened for appropriateness.
    """
    result = InputGate(HasPerson()).screen_upload(IMAGE)

    assert result.reason is ReasonCode.CONTAINS_PERSON
    assert result.clearance is None


@pytest.mark.parametrize(
    "provider", [Explicit(), HasPerson(), Exploding()], ids=["explicit", "person", "broken"]
)
def test_no_rejection_ever_carries_a_clearance(provider: object) -> None:
    result = InputGate(provider).screen_upload(IMAGE)  # type: ignore[arg-type]

    assert result.clearance is None


# ---------------------------------------------------------------------------
# Passing, and what a pass is worth
# ---------------------------------------------------------------------------


def test_a_pass_yields_a_clearance_bound_to_the_bytes() -> None:
    result = InputGate(Passing()).screen_upload(IMAGE)

    assert result.passed
    assert result.clearance is not None
    assert result.clearance.covers(IMAGE)
    assert result.clearance.content_sha256 == content_digest(IMAGE)


def test_a_clearance_does_not_cover_other_bytes() -> None:
    result = InputGate(Passing()).screen_upload(IMAGE)

    assert result.clearance is not None
    assert not result.clearance.covers(IMAGE + b"tampered")


def test_clearance_records_the_gate_version() -> None:
    """So a clearance minted by an older policy is identifiable later."""
    result = InputGate(Passing()).screen_upload(IMAGE)

    assert result.clearance is not None
    assert result.clearance.gate_version


# ---------------------------------------------------------------------------
# Forgery
# ---------------------------------------------------------------------------


def test_clearance_cannot_be_constructed_directly() -> None:
    with pytest.raises(PermissionError):
        SafetyClearance(content_sha256=content_digest(IMAGE), gate_version="v", reason_code="ok")


def test_clearance_cannot_be_copied_with_dataclasses_replace() -> None:
    """`replace` re-runs __post_init__, so a clearance cannot be retargeted."""
    import dataclasses

    original = mint_clearance(IMAGE, gate_version="v", reason_code="ok")

    with pytest.raises(PermissionError):
        dataclasses.replace(original, content_sha256=content_digest(b"other"))


def test_mint_produces_a_usable_clearance() -> None:
    clearance = mint_clearance(IMAGE, gate_version="v", reason_code="ok")

    assert clearance.covers(IMAGE)


def test_gate_result_passed_property_matches_verdict() -> None:
    assert GateResult(Verdict.PASS, ReasonCode.OK).passed
    assert not GateResult(Verdict.REJECT, ReasonCode.EXPLICIT).passed
