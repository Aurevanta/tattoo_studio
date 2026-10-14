"""Validation authority for the Python runtime.

The canonical JSON Schema documents are the validator input, exactly as they are in
TypeScript. Nothing here reimplements a rule, and nothing here should: the point of
the contracts module is that one document decides validity in both runtimes
(ARCH-INV-005).

The generated pydantic models in ``tattoo_contracts.generated`` are ergonomics for
FastAPI and editors. They cannot express conditional rules such as the colour
constraints on a brief, so they are never consulted for a verdict.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import cache
from importlib import resources
from typing import Any

from jsonschema import Draft202012Validator

TATTOO_BRIEF = "tattoo-brief"
DESIGN = "design"

SCHEMA_NAMES: tuple[str, ...] = (
    TATTOO_BRIEF,
    DESIGN,
    "studio-job",
    "studio-status",
    "shared-design",
)
"""Every schema the contracts module owns. The corpus iterates this."""


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    """A validation failure, reduced to what a caller can act on."""

    path: str
    """JSON Pointer into the payload, e.g. ``/size/widthMm``. Empty means the root."""

    message: str
    keyword: str


class ContractValidationError(ValueError):
    """Raised by the ``assert_*`` helpers, naming the schema and failing paths."""

    def __init__(self, schema_name: str, issues: list[ValidationIssue]) -> None:
        detail = "; ".join(f"{i.path or '<root>'}: {i.message}" for i in issues)
        super().__init__(f"{schema_name} failed validation: {detail}")
        self.schema_name = schema_name
        self.issues = issues


class TattooBriefValidationError(ContractValidationError):
    """Kept as a distinct type so callers can catch brief failures specifically."""

    def __init__(self, issues: list[ValidationIssue]) -> None:
        super().__init__("TattooBrief", issues)


class DesignValidationError(ContractValidationError):
    def __init__(self, issues: list[ValidationIssue]) -> None:
        super().__init__("Design", issues)


@cache
def schema(name: str) -> dict[str, Any]:
    """Load a packaged schema copy by name.

    Copies are generated from ``contracts/schemas/`` and a test asserts byte identity,
    so these are the same documents the TypeScript runtime compiles.
    """
    if name not in SCHEMA_NAMES:
        raise KeyError(f"unknown schema {name!r}; known: {', '.join(SCHEMA_NAMES)}")
    source = resources.files("tattoo_contracts.schemas").joinpath(f"{name}.schema.json")
    data: dict[str, Any] = json.loads(source.read_text(encoding="utf-8"))
    return data


@cache
def _validator(name: str) -> Draft202012Validator:
    # format is deliberately unused in the schemas, so no format checker is wired up.
    # Patterns carry the assertions instead, which both runtimes enforce identically.
    return Draft202012Validator(schema(name))


def _to_pointer(error_path: Any) -> str:
    return "".join(f"/{part}" for part in error_path)


def validate(name: str, payload: object) -> list[ValidationIssue]:
    """Validate a payload against a named schema, returning every issue found.

    Returns an empty list when valid. Callers at a boundary generally need all
    problems at once rather than the first.
    """
    issues = [
        ValidationIssue(
            path=_to_pointer(error.absolute_path),
            message=error.message,
            keyword=str(error.validator),
        )
        for error in _validator(name).iter_errors(payload)
    ]
    return sorted(issues, key=lambda i: (i.path, i.keyword))


def is_valid(name: str, payload: object) -> bool:
    return not validate(name, payload)


# ---------------------------------------------------------------------------
# Named helpers. Thin wrappers, so call sites read as domain code rather than as
# string lookups, and so a typo in a schema name fails at import rather than at
# validation time.
# ---------------------------------------------------------------------------


def tattoo_brief_schema() -> dict[str, Any]:
    return schema(TATTOO_BRIEF)


def design_schema() -> dict[str, Any]:
    return schema(DESIGN)


def validate_tattoo_brief(payload: object) -> list[ValidationIssue]:
    return validate(TATTOO_BRIEF, payload)


def validate_design(payload: object) -> list[ValidationIssue]:
    return validate(DESIGN, payload)


def is_valid_tattoo_brief(payload: object) -> bool:
    return is_valid(TATTOO_BRIEF, payload)


def is_valid_design(payload: object) -> bool:
    return is_valid(DESIGN, payload)


def assert_tattoo_brief(payload: object) -> dict[str, Any]:
    """Validate, or raise a typed error naming the schema and the failing paths."""
    issues = validate_tattoo_brief(payload)
    if issues:
        raise TattooBriefValidationError(issues)
    assert isinstance(payload, dict)
    return payload


def assert_design(payload: object) -> dict[str, Any]:
    issues = validate_design(payload)
    if issues:
        raise DesignValidationError(issues)
    assert isinstance(payload, dict)
    return payload
