# GENERATED FILE - DO NOT EDIT.
#
# Source: contracts/schemas/
# Regenerate: uv run python scripts/generate.py  (from contracts/python)
#
# Editing this by hand fails the codegen reproducibility check.
# These models are ergonomics only. Validation authority is tattoo_contracts.validation.

from __future__ import annotations

from enum import Enum, StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel


class Refined(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description='The professional description the client accepted, when there is one.',
            max_length=1200,
            min_length=1,
        ),
    ]


class Size(BaseModel):
    """
    The accepted print size. Millimetres are authoritative.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    widthMm: Annotated[float, Field(ge=5.0, le=600.0)]
    heightMm: Annotated[float, Field(ge=5.0, le=600.0)]


class Side(Enum):
    left = 'left'
    right = 'right'
    centre = 'centre'


class Placement(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    bodyPart: Annotated[
        str,
        Field(
            description="A body part of the brief's vocabulary.",
            pattern='^[a-z][a-z_]{1,39}$',
        ),
    ]
    side: Side | None = None


class ColourMode(Enum):
    black_and_grey = 'black_and_grey'
    colour = 'colour'
    black_and_grey_with_accent = 'black_and_grey_with_accent'


class PaletteItem(RootModel[str]):
    root: Annotated[str, Field(max_length=40, min_length=1)]


class StencilMethod(Enum):
    """
    How the stencil was obtained (TASK-0086), so the tattooer knows how far to trust it.
    """

    lineart = 'lineart'
    colour_contours = 'colour_contours'


class Timestamp(RootModel[str]):
    root: Annotated[
        str,
        Field(
            pattern='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
        ),
    ]


class MimeType(StrEnum):
    image_png = 'image/png'
    image_svg_xml = 'image/svg+xml'
    application_pdf = 'application/pdf'


class Asset(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    assetId: Annotated[str, Field(pattern='^[a-f0-9]{32}$')]
    designId: Annotated[str, Field(pattern='^[a-f0-9]{64}$')]
    mimeType: MimeType


class SharedDesign(BaseModel):
    """
    TASK-0097 (ADR-0032): what a client shares with their tattooer through a link. Only the design, its stencils and what the tattooer needs to read them: never a photograph of the client's body, a camera capture, the body type or the account.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    designId: Annotated[str, Field(pattern='^[a-f0-9]{64}$')]
    createdAt: Timestamp
    expiresAt: Timestamp
    idea: Annotated[
        str,
        Field(
            description="The client's own words for the design.",
            max_length=2000,
            min_length=1,
        ),
    ]
    refined: Annotated[
        Refined | None,
        Field(
            description='The professional description the client accepted, when there is one.'
        ),
    ]
    size: Annotated[
        Size,
        Field(description='The accepted print size. Millimetres are authoritative.'),
    ]
    placement: Placement
    style: Annotated[
        str,
        Field(
            description="A style of the brief's vocabulary.",
            pattern='^[a-z][a-z_]{1,39}$',
        ),
    ]
    colourMode: ColourMode
    palette: Annotated[list[PaletteItem] | None, Field(max_length=12)] = None
    master: Asset
    stencil: Asset
    stencilMirror: Asset
    pdf: Asset
    pdfMirror: Asset
    panels: Asset | None = None
    panelsMirror: Asset | None = None
    mockup: Annotated[
        Asset | None,
        Field(
            description="The view on the skin, only when it was composed on a generated skin plate. Null when it was composed on the client's own photograph, which is never shared."
        ),
    ]
    stencilMethod: Annotated[
        StencilMethod | None,
        Field(
            description='How the stencil was obtained (TASK-0086), so the tattooer knows how far to trust it.'
        ),
    ]
    reviewRequired: Annotated[
        Literal[True],
        Field(
            description='Always true: a professional reviews the design and the stencil before tattooing.'
        ),
    ]
