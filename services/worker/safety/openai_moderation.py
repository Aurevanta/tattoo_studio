"""Image moderation via an OpenAI vision model.

Written against OpenAI's documented Responses API, confirmed 2026-09-19:

  POST https://api.openai.com/v1/responses
  Authorization: Bearer <OPENAI_API_KEY>
  {"model": "...", "input": [{"role": "user", "content": [
      {"type": "input_text",  "text": "..."},
      {"type": "input_image", "image_url": "data:image/jpeg;base64,..."}]}]}

**Everything ambiguous raises**, and :class:`~safety.gate.InputGate` converts a raise into
a denial. A parse failure, a missing field, a non-boolean value, an HTTP error and a
timeout all mean the same thing operationally: nothing was verified. A moderation provider
that guesses is worse than one that fails, because the failure is visible.

This module performs an outbound call from `safety`, which ARCH-INV-001 permits since
TASK-0013. Routing it through `generation` was rejected: it would make the gate's
integrity depend on the module the gate exists to constrain.
"""

from __future__ import annotations

import base64
import json
from typing import Any, Protocol

from .gate import ModerationOutcome, ProviderExhaustedError

OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"

#: Cheap enough to run on every upload. Moderation is per-upload cost, not per-design.
DEFAULT_MODEL = "gpt-5.6-luna"

#: Asks for the two judgements the gate needs, as strict JSON and nothing else.
#: Phrased around what is *visible* rather than what the image is "about", because the
#: question is whether a person appears at all, not whether they are the subject.
CLASSIFY_PROMPT = """You are a content gate for a tattoo design service.

Answer ONLY with a JSON object, no prose and no code fence, in exactly this form:
{"contains_person": <true|false>, "explicit": <true|false>}

contains_person: true if any real human being is visible anywhere in the image, including
partially, in the background, as a reflection, or as any recognisable body part such as a
hand, arm or face. Drawings, statues and cartoon figures are NOT real people, so they are
false. When genuinely unsure, answer true.

explicit: true if the image contains nudity, sexual content, graphic violence or gore.
When genuinely unsure, answer true."""


class ModerationError(RuntimeError):
    """The image could not be classified. Always results in a denial.

    Never carries the provider's message: an HTTP error can quote the request, which
    embeds the image, and a client error can embed the credential (SEC-INV-008).
    """


class ModerationExhaustedError(ModerationError, ProviderExhaustedError):
    """The provider's account has no credit left (TASK-0100). A denial like any other."""


#: OpenAI's error type and codes for an account without credit, seen live on 2026-10-13 as
#: 429 `insufficient_quota` / `credit_balance_exhausted`.
OUT_OF_CREDIT = frozenset(
    {"insufficient_quota", "credit_balance_exhausted", "billing_hard_limit_reached"}
)


def out_of_credit(response: Any) -> bool:
    """Whether an error response says the account has no credit.

    Reads only the short `error.type` and `error.code` fields, never the message, which can
    quote the request (SEC-INV-008).
    """
    if getattr(response, "status_code", 0) not in (402, 429):
        return False
    try:
        error = response.json().get("error")
    except Exception:
        return False
    if not isinstance(error, dict):
        return False
    return bool({error.get("type"), error.get("code")} & OUT_OF_CREDIT)


class HttpResponse(Protocol):
    @property
    def status_code(self) -> int: ...

    def json(self) -> Any: ...


class HttpTransport(Protocol):
    def post(self, url: str, *, json: dict[str, Any], headers: dict[str, str]) -> HttpResponse: ...


def _data_url(data: bytes, media_type: str) -> str:
    """Inline the image in the request body.

    Deliberately a body field rather than a URL: SEC-INV-008 and the privacy rules forbid
    putting personal data in a URL or query string, and an uploaded photograph is exactly
    that.
    """
    return f"data:{media_type};base64,{base64.b64encode(data).decode('ascii')}"


class OpenAIModerationProvider:
    """Classifies an image with a vision model."""

    def __init__(
        self,
        *,
        api_key: str,
        transport: HttpTransport,
        model: str = DEFAULT_MODEL,
        url: str = OPENAI_RESPONSES_URL,
        media_type: str = "image/jpeg",
    ) -> None:
        if not api_key:
            raise ModerationError("moderation api key is empty")
        self._api_key = api_key
        self._http = transport
        self._model = model
        self._url = url
        self._media_type = media_type

    @property
    def name(self) -> str:
        return f"openai:{self._model}"

    def classify(self, data: bytes) -> ModerationOutcome:
        """Return the model's judgement, or raise.

        Raises:
            ModerationError: on any failure, ambiguity or unexpected shape.
        """
        if not data:
            raise ModerationError("nothing to classify")

        payload: dict[str, Any] = {
            "model": self._model,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": CLASSIFY_PROMPT},
                        {
                            "type": "input_image",
                            "image_url": _data_url(data, self._media_type),
                        },
                    ],
                }
            ],
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        try:
            response = self._http.post(self._url, json=payload, headers=headers)
        except Exception as error:
            raise ModerationError("moderation transport failure") from error

        if out_of_credit(response):
            raise ModerationExhaustedError(
                f"moderation provider out of credit ({response.status_code})"
            )
        if response.status_code >= 400:
            # Status only. The body can repeat the submitted payload, which is the image.
            raise ModerationError(f"moderation provider returned {response.status_code}")

        try:
            body = response.json()
        except Exception as error:
            raise ModerationError("moderation response was not JSON") from error

        return self._parse(self._extract_text(body))

    # ------------------------------------------------------------------

    def _extract_text(self, body: Any) -> str:
        """Pull the assistant's text out of a Responses payload.

        Handles the convenience field and the structured output array, since the raw API
        and the SDK differ. Anything else raises rather than being guessed at.
        """
        if not isinstance(body, dict):
            raise ModerationError("moderation response was not an object")

        convenience = body.get("output_text")
        if isinstance(convenience, str) and convenience.strip():
            return convenience

        output = body.get("output")
        if isinstance(output, list):
            for item in output:
                if not isinstance(item, dict) or item.get("type") != "message":
                    continue
                for part in item.get("content") or []:
                    if isinstance(part, dict):
                        text = part.get("text")
                        if isinstance(text, str):
                            return text

        raise ModerationError("moderation response contained no text")

    def _parse(self, text: str) -> ModerationOutcome:
        """Read the strict JSON the prompt asked for.

        Tolerates a surrounding code fence because models add them, but tolerates nothing
        about the values themselves: a missing field or a non-boolean is a failure, not a
        default.
        """
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("```")[1] if "```" in cleaned[3:] else cleaned[3:]
            if cleaned.lstrip().startswith("json"):
                cleaned = cleaned.lstrip()[4:]
        cleaned = cleaned.strip()

        try:
            parsed = json.loads(cleaned)
        except (ValueError, TypeError) as error:
            raise ModerationError("moderation verdict was not parseable JSON") from error

        if not isinstance(parsed, dict):
            raise ModerationError("moderation verdict was not an object")

        person = parsed.get("contains_person")
        explicit = parsed.get("explicit")
        if not isinstance(person, bool) or not isinstance(explicit, bool):
            # A string "true", a number, or a missing key all land here. Coercing them
            # would mean inventing a verdict nobody gave.
            raise ModerationError("moderation verdict fields were missing or not boolean")

        return ModerationOutcome(explicit=explicit, contains_person=person)
