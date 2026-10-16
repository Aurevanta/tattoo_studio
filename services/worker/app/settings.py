"""Typed worker settings.

PLAT-INV-005: settings are validated at process start. A missing or malformed required
setting fails startup loudly rather than defaulting.

SEC-INV-008 / PLAT-INV-003: a validation failure names the offending key and never prints
its value. Settings carry credentials, so the error path is as security-relevant as the
values themselves.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field, SecretStr, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict

LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]


class SettingsError(RuntimeError):
    """Raised when configuration is missing or malformed.

    The message names offending keys only. It never includes their values.
    """


class Settings(BaseSettings):
    """Worker configuration, read from the environment.

    Only settings the shell genuinely needs are declared here. Engine-specific
    configuration is added by the task that introduces the engine, so that an
    unset key always means something is actually missing.
    """

    model_config = SettingsConfigDict(
        env_prefix="TATTOO_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: str
    """Deployment environment name, for example 'local' or 'production'."""

    log_level: LogLevel = "INFO"
    """Constrained so that a malformed value is a validation failure, which is what
    makes the redaction path in ``_redacted_key_report`` testable."""

    generation_provider: str = "fixture"
    """Which generation adapter to use. Deliberately defaults to the offline fixture
    provider: a misconfigured deployment should produce obviously fake artwork rather
    than silently spend money against a real API."""

    fal_key: SecretStr | None = Field(default=None, validation_alias="FAL_KEY")
    """fal.ai credential.

    Read from the plain ``FAL_KEY`` variable rather than the ``TATTOO_`` prefix, because
    that is the name fal's own tooling uses and duplicating it would invite the two
    copies to diverge.

    Typed as ``SecretStr`` so it does not appear in logs, tracebacks or ``repr``
    output (SEC-INV-008). Reading the value requires an explicit
    ``.get_secret_value()``, which makes every such read visible in review.
    """

    openai_api_key: SecretStr | None = Field(default=None, validation_alias="OPENAI_API_KEY")
    worker_token: SecretStr | None = None
    media_key: SecretStr | None = None
    data_dir: str = ".artifacts/studio"
    image_model: str = "gpt-image-2"
    vision_model: str = "gpt-4.1-mini"

    image_backend: Literal["openai", "bfl"] = "openai"
    """TASK-0025: which vendor renders studio artwork (TATTOO_IMAGE_BACKEND). Vision
    analysis and output moderation stay on OpenAI in both cases."""

    bfl_api_key: SecretStr | None = Field(default=None, validation_alias="BFL_API_KEY")
    """Black Forest Labs credential, read from the plain ``BFL_API_KEY`` variable."""

    bfl_base_url: str = "https://api.eu.bfl.ai"
    """EU cluster by default: requests and results stay in the EU region."""

    telemetry_dsn: SecretStr | None = None
    """TASK-0054: Postgres connection string for events (TATTOO_TELEMETRY_DSN), for a role that
    may only insert into, read, anonymise and prune ``inkcraft.events``. Unset: events are kept in
    SQLite beside the studio data, which is what development and the tests use."""

    prices: str | None = None
    """TASK-0054: USD per model as JSON (TATTOO_PRICES), for cost estimates. Unset: tokens are
    recorded and cost is left empty, never guessed."""

    telemetry_retention_days: int = Field(default=365, ge=1)
    """Events older than this are deleted (TATTOO_TELEMETRY_RETENTION_DAYS)."""

    daily_designs: int = Field(default=20, ge=1)
    """TASK-0078 (audit SEG-02): designs and redraws per account per UTC day
    (TATTOO_DAILY_DESIGNS). Re-placements and kept camera photos are not counted."""

    daily_designs_total: int = Field(default=300, ge=1)
    """Designs for the whole studio per UTC day (TATTOO_DAILY_DESIGNS_TOTAL)."""

    daily_turns: int = Field(default=100, ge=1)
    """Paid consultation turns (messages, reference searches) per account per UTC day
    (TATTOO_DAILY_TURNS)."""

    daily_uploads: int = Field(default=30, ge=1)
    """TASK-0115: images uploaded per account per UTC day: references, own-body photos and kept
    camera photos (TATTOO_DAILY_UPLOADS)."""

    bfl_background_model: str = "flux-2-pro"
    """TASK-0025: FLUX.2 renders the blank skin plate only. Artwork and edits stay on
    OpenAI, which is the vendor that will actually return flat art on white (ADR-0009)."""

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


def _redacted_key_report(error: ValidationError) -> str:
    """Summarise a validation failure by key, discarding every value.

    pydantic's default rendering includes the offending input, which for settings
    can be a credential. This rebuilds the message from locations and error types
    only.
    """
    problems: list[str] = []
    for item in error.errors():
        location = ".".join(str(part) for part in item["loc"]) or "<root>"
        problems.append(f"{location} ({item['type']})")
    return ", ".join(problems)


def load_settings() -> Settings:
    """Load and validate settings, or raise ``SettingsError``.

    Raises:
        SettingsError: with the offending keys named and all values redacted.
    """
    try:
        return Settings()  # type: ignore[call-arg]
    except ValidationError as error:
        raise SettingsError(
            f"Invalid worker configuration. Check these settings: {_redacted_key_report(error)}. "
            "Values are redacted from this message."
        ) from error
