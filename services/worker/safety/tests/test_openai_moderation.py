"""The OpenAI moderation provider.

Every test here is really the same question asked differently: can anything reach a
*pass* without the model having affirmatively said the image is clean? The provider's
job is to raise on anything it does not fully understand, and the gate turns a raise into
a denial.

All offline, against a scripted transport. That proves the provider handles what OpenAI's
documentation describes; it does not prove OpenAI behaves that way, which needs a real
call.
"""

from __future__ import annotations

import base64
import json
import logging
from dataclasses import dataclass, field
from typing import Any

import pytest

from safety import InputGate, ReasonCode, Verdict
from safety.openai_moderation import (
    CLASSIFY_PROMPT,
    ModerationError,
    OpenAIModerationProvider,
)

SECRET = "sk-proj-must-never-be-logged-8f3c2a"
IMAGE = b"\xff\xd8\xff\xe0pretend-jpeg-bytes"


@dataclass
class FakeResponse:
    status_code: int = 200
    payload: Any = None
    raise_on_json: bool = False

    def json(self) -> Any:
        if self.raise_on_json:
            raise ValueError("not json")
        return self.payload


@dataclass
class ScriptedTransport:
    """Returns a queued response, or raises a queued exception."""

    responses: list[Any] = field(default_factory=list)
    calls: list[dict[str, Any]] = field(default_factory=list)

    def post(self, url: str, *, json: dict[str, Any], headers: dict[str, str]) -> FakeResponse:
        self.calls.append({"url": url, "json": json, "headers": headers})
        if not self.responses:
            raise AssertionError(f"unexpected POST to {url}")
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        assert isinstance(item, FakeResponse)
        return item


def verdict_body(*, person: bool, explicit: bool, wrap: str = "plain") -> FakeResponse:
    """A Responses-API payload carrying the model's JSON verdict."""
    verdict = json.dumps({"contains_person": person, "explicit": explicit})
    if wrap == "fence":
        verdict = f"```json\n{verdict}\n```"
    return FakeResponse(
        payload={
            "output": [{"type": "message", "role": "assistant", "content": [{"text": verdict}]}]
        }
    )


def provider(transport: ScriptedTransport) -> OpenAIModerationProvider:
    return OpenAIModerationProvider(api_key=SECRET, transport=transport)


# ---------------------------------------------------------------------------
# Request construction
# ---------------------------------------------------------------------------


def test_posts_to_the_responses_endpoint_with_bearer_auth() -> None:
    transport = ScriptedTransport([verdict_body(person=False, explicit=False)])

    provider(transport).classify(IMAGE)

    call = transport.calls[0]
    assert call["url"] == "https://api.openai.com/v1/responses"
    assert call["headers"]["Authorization"] == f"Bearer {SECRET}"


def test_image_travels_in_the_body_not_the_url() -> None:
    """Personal data must never go in a URL or query string.

    An uploaded photograph is exactly that, so this is not a style preference.
    """
    transport = ScriptedTransport([verdict_body(person=False, explicit=False)])

    provider(transport).classify(IMAGE)

    call = transport.calls[0]
    encoded = base64.b64encode(IMAGE).decode("ascii")
    assert encoded not in call["url"]
    assert "?" not in call["url"]
    content = call["json"]["input"][0]["content"]
    image_part = next(p for p in content if p["type"] == "input_image")
    assert encoded in image_part["image_url"]


def test_sends_the_classification_prompt() -> None:
    transport = ScriptedTransport([verdict_body(person=False, explicit=False)])

    provider(transport).classify(IMAGE)

    content = transport.calls[0]["json"]["input"][0]["content"]
    text_part = next(p for p in content if p["type"] == "input_text")
    assert text_part["text"] == CLASSIFY_PROMPT


def test_empty_image_is_refused_without_calling_out() -> None:
    transport = ScriptedTransport([])

    with pytest.raises(ModerationError):
        provider(transport).classify(b"")

    assert transport.calls == []


def test_empty_api_key_is_refused() -> None:
    with pytest.raises(ModerationError):
        OpenAIModerationProvider(api_key="", transport=ScriptedTransport([]))


# ---------------------------------------------------------------------------
# Verdicts
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("wrap", ["plain", "fence"], ids=["plain-json", "code-fence"])
def test_reads_a_clean_verdict(wrap: str) -> None:
    transport = ScriptedTransport([verdict_body(person=False, explicit=False, wrap=wrap)])

    outcome = provider(transport).classify(IMAGE)

    assert outcome.contains_person is False
    assert outcome.explicit is False


def test_reads_a_person_verdict() -> None:
    transport = ScriptedTransport([verdict_body(person=True, explicit=False)])

    outcome = provider(transport).classify(IMAGE)

    assert outcome.contains_person is True


def test_reads_an_explicit_verdict() -> None:
    transport = ScriptedTransport([verdict_body(person=False, explicit=True)])

    outcome = provider(transport).classify(IMAGE)

    assert outcome.explicit is True


def test_accepts_the_convenience_output_text_field() -> None:
    """The SDK and the raw API differ; both shapes must work."""
    transport = ScriptedTransport(
        [FakeResponse(payload={"output_text": '{"contains_person": false, "explicit": false}'})]
    )

    outcome = provider(transport).classify(IMAGE)

    assert outcome.contains_person is False


# ---------------------------------------------------------------------------
# Everything ambiguous must raise (SAFETY-INV-007)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("status", [400, 401, 403, 429, 500, 502, 503], ids=str)
def test_http_errors_raise(status: int) -> None:
    transport = ScriptedTransport([FakeResponse(status_code=status)])

    with pytest.raises(ModerationError):
        provider(transport).classify(IMAGE)


def test_transport_failure_raises() -> None:
    transport = ScriptedTransport(
        [TimeoutError("timed out talking to https://api.openai.com?k=leak")]
    )

    with pytest.raises(ModerationError) as raised:
        provider(transport).classify(IMAGE)

    assert "leak" not in str(raised.value)


def test_non_json_body_raises() -> None:
    transport = ScriptedTransport([FakeResponse(raise_on_json=True)])

    with pytest.raises(ModerationError):
        provider(transport).classify(IMAGE)


@pytest.mark.parametrize(
    "payload",
    [
        {"output": []},
        {"output": "not-a-list"},
        {"output": [{"type": "message", "content": []}]},
        {"nothing": "useful"},
        [],
        "a string",
    ],
    ids=["empty", "wrong-type", "no-text", "missing-key", "list", "string"],
)
def test_responses_without_usable_text_raise(payload: Any) -> None:
    transport = ScriptedTransport([FakeResponse(payload=payload)])

    with pytest.raises(ModerationError):
        provider(transport).classify(IMAGE)


@pytest.mark.parametrize(
    "verdict",
    [
        "not json at all",
        "[]",
        '"a string"',
        '{"contains_person": true}',
        '{"explicit": false}',
        '{"contains_person": "true", "explicit": "false"}',
        '{"contains_person": 1, "explicit": 0}',
        '{"contains_person": null, "explicit": null}',
        "{}",
    ],
    ids=[
        "prose",
        "array",
        "string",
        "missing-explicit",
        "missing-person",
        "string-booleans",
        "numeric-booleans",
        "nulls",
        "empty-object",
    ],
)
def test_malformed_verdicts_raise_rather_than_defaulting(verdict: str) -> None:
    """Coercing a string or a number would mean inventing a judgement nobody gave."""
    transport = ScriptedTransport(
        [FakeResponse(payload={"output": [{"type": "message", "content": [{"text": verdict}]}]})]
    )

    with pytest.raises(ModerationError):
        provider(transport).classify(IMAGE)


# ---------------------------------------------------------------------------
# The gate converts every one of those into a denial
# ---------------------------------------------------------------------------


def test_gate_passes_a_clean_image() -> None:
    transport = ScriptedTransport([verdict_body(person=False, explicit=False)])

    result = InputGate(provider(transport)).screen_upload(IMAGE)

    assert result.verdict is Verdict.PASS
    assert result.clearance is not None
    assert result.clearance.covers(IMAGE)


def test_gate_refuses_an_image_containing_a_person() -> None:
    transport = ScriptedTransport([verdict_body(person=True, explicit=False)])

    result = InputGate(provider(transport)).screen_upload(IMAGE)

    assert result.reason is ReasonCode.CONTAINS_PERSON
    assert result.clearance is None


def test_gate_refuses_explicit_content() -> None:
    transport = ScriptedTransport([verdict_body(person=False, explicit=True)])

    result = InputGate(provider(transport)).screen_upload(IMAGE)

    assert result.reason is ReasonCode.EXPLICIT
    assert result.clearance is None


@pytest.mark.parametrize(
    "response",
    [
        FakeResponse(status_code=500),
        FakeResponse(raise_on_json=True),
        FakeResponse(payload={"output": []}),
        TimeoutError("boom"),
    ],
    ids=["http-500", "non-json", "no-text", "timeout"],
)
def test_every_provider_failure_becomes_a_denial(response: Any) -> None:
    """The provider raises; the gate must never let that become a pass."""
    result = InputGate(provider(ScriptedTransport([response]))).screen_upload(IMAGE)

    assert result.verdict is Verdict.REJECT
    assert result.reason is ReasonCode.PROVIDER_FAILED
    assert result.clearance is None


# ---------------------------------------------------------------------------
# SEC-INV-008: the credential must not leak
# ---------------------------------------------------------------------------


def test_api_key_never_appears_in_logs(caplog: pytest.LogCaptureFixture) -> None:
    transport = ScriptedTransport([verdict_body(person=False, explicit=False)])

    with caplog.at_level(logging.DEBUG):
        provider(transport).classify(IMAGE)

    assert SECRET not in caplog.text


@pytest.mark.parametrize(
    "response",
    [FakeResponse(status_code=401), FakeResponse(raise_on_json=True), TimeoutError("x")],
    ids=["unauthorised", "non-json", "timeout"],
)
def test_api_key_never_appears_in_an_exception(response: Any) -> None:
    transport = ScriptedTransport([response])

    with pytest.raises(ModerationError) as raised:
        provider(transport).classify(IMAGE)

    assert SECRET not in str(raised.value)
    assert SECRET not in repr(raised.value)


def test_provider_name_identifies_the_model_not_the_key() -> None:
    assert SECRET not in provider(ScriptedTransport([])).name
    assert "openai" in provider(ScriptedTransport([])).name


# ---------------------------------------------------------------------------
# TASK-0100: an account without credit is named, and still denied
# ---------------------------------------------------------------------------

NO_CREDIT = {
    "error": {
        "type": "insufficient_quota",
        "code": "credit_balance_exhausted",
        "message": "You have no credits remaining.",
    }
}


def test_an_account_without_credit_is_named_and_denied() -> None:
    """The live answer of 2026-10-13: 429, `insufficient_quota` / `credit_balance_exhausted`."""
    from safety.openai_moderation import ModerationExhaustedError

    transport = ScriptedTransport([FakeResponse(status_code=429, payload=NO_CREDIT)])
    with pytest.raises(ModerationExhaustedError) as raised:
        provider(transport).classify(IMAGE)
    assert "credits remaining" not in str(raised.value)

    gate = InputGate(
        provider(ScriptedTransport([FakeResponse(status_code=429, payload=NO_CREDIT)]))
    )
    result = gate.screen_upload(IMAGE)
    assert result.verdict is Verdict.REJECT
    assert result.reason is ReasonCode.PROVIDER_EXHAUSTED
    assert result.clearance is None


def test_a_rate_limit_is_not_mistaken_for_no_credit() -> None:
    from safety.openai_moderation import ModerationExhaustedError

    limited = {"error": {"type": "requests", "code": "rate_limit_exceeded"}}
    transport = ScriptedTransport([FakeResponse(status_code=429, payload=limited)])
    with pytest.raises(ModerationError) as raised:
        provider(transport).classify(IMAGE)
    assert not isinstance(raised.value, ModerationExhaustedError)
    gate = InputGate(provider(ScriptedTransport([FakeResponse(status_code=429, payload=limited)])))
    assert gate.screen_upload(IMAGE).reason is ReasonCode.PROVIDER_FAILED
