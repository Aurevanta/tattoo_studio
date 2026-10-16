"""The safety input gate.

Screens bytes, before anything is stored and before anything is sent to a provider
(SEC-INV-007). That ordering is what makes this module depend on `contracts` alone and
not on `media` — at the moment the gate runs, there is nothing stored to look at.

**The gate currently denies everything.** TASK-0013 supplies a moderation provider that
can classify an image; until then no input can pass. A gate that cannot pass is useless
but safe. A gate that passes without checking is neither, and would be the most dangerous
shortcut available in this project — so the deny-by-default implementation is the real
one, not a stub with a TODO.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from .clearance import SafetyClearance, mint_clearance

#: TASK-0114 (ADR-0040): version 2 refuses identifiable people, not every visible person.
GATE_VERSION = "input-gate-2"


class Verdict(StrEnum):
    PASS = "pass"
    REJECT = "reject"


class ReasonCode(StrEnum):
    """Stable, actionable codes. Never echo the offending content (SEC-INV-008)."""

    OK = "ok"
    NO_PROVIDER = "no_moderation_provider"
    PROVIDER_FAILED = "moderation_provider_failed"
    #: TASK-0100: the provider refused for lack of credit; retrying in seconds cannot help.
    PROVIDER_EXHAUSTED = "moderation_provider_exhausted"
    CONTAINS_PERSON = "contains_person"
    EXPLICIT = "explicit_content"
    UNSUPPORTED_FORMAT = "unsupported_format"
    TOO_LARGE = "too_large"


class ProviderExhaustedError(Exception):
    """Raised by a provider whose account has no credit left (TASK-0100). Still a denial."""


@dataclass(frozen=True, slots=True)
class GateResult:
    """A verdict and, only on a pass, the clearance that evidences it."""

    verdict: Verdict
    reason: ReasonCode
    clearance: SafetyClearance | None = None

    @property
    def passed(self) -> bool:
        return self.verdict is Verdict.PASS


@dataclass(frozen=True, slots=True)
class ModerationOutcome:
    """What a moderation provider reports about an image."""

    explicit: bool
    #: TASK-0114 (ADR-0040): a real person who could be identified, not a distant passer-by.
    identifiable_person: bool


class ModerationProvider(Protocol):
    """Classifies image bytes. Implemented in TASK-0013.

    The scope agreed with the user is pets and objects, so `identifiable_person` is a
    rejection reason rather than merely advisory: a user can consent to their own
    photograph being processed, but cannot consent on behalf of a third person who
    happens to be in it.
    """

    @property
    def name(self) -> str: ...

    def classify(self, data: bytes) -> ModerationOutcome: ...


class InputGate:
    """Screens uploads. Denies unless a provider affirmatively passes the image."""

    def __init__(self, provider: ModerationProvider | None = None) -> None:
        self._provider = provider

    def screen_upload(self, data: bytes, *, own_body_consented: bool = False) -> GateResult:
        """Screen bytes and, on a pass, mint a clearance bound to them.

        Every failure mode below is a denial. There is no path through this method that
        returns a pass without a provider having said so (SAFETY-INV-007).
        """
        if self._provider is None:
            # Not a placeholder: with no provider there is no basis to pass anything.
            return GateResult(Verdict.REJECT, ReasonCode.NO_PROVIDER)

        try:
            outcome = self._provider.classify(data)
        except ProviderExhaustedError:
            # The same denial, named, so the client is not told to retry in a few seconds.
            return GateResult(Verdict.REJECT, ReasonCode.PROVIDER_EXHAUSTED)
        except Exception:
            # Deliberately broad and deliberately silent about the cause: a provider
            # exception can carry request detail, and any failure here means the same
            # thing operationally, which is that nothing was verified.
            return GateResult(Verdict.REJECT, ReasonCode.PROVIDER_FAILED)

        if outcome.explicit:
            return GateResult(Verdict.REJECT, ReasonCode.EXPLICIT)
        if outcome.identifiable_person and not own_body_consented:
            return GateResult(Verdict.REJECT, ReasonCode.CONTAINS_PERSON)

        return GateResult(
            Verdict.PASS,
            ReasonCode.OK,
            mint_clearance(data, gate_version=GATE_VERSION, reason_code=ReasonCode.OK.value),
        )
