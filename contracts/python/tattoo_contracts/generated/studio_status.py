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


class State(StrEnum):
    queued = 'queued'
    running = 'running'
    succeeded = 'succeeded'
    failed = 'failed'
    cancelled = 'cancelled'


class Stage(StrEnum):
    """
    TASK-0076 (audit UX-03): the pipeline step a running job is in, as the worker reports it. Absent when unknown. `seam` (TASK-0104) is a sleeve's join being redrawn.
    """

    references = 'references'
    skin = 'skin'
    drawing = 'drawing'
    seam = 'seam'
    stencil = 'stencil'
    placing = 'placing'
    finishing = 'finishing'


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


class Size(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    widthMm: Annotated[float, Field(ge=5.0, le=600.0)]
    heightMm: Annotated[float, Field(ge=5.0, le=600.0)]


class BackgroundKind(StrEnum):
    own_photo = 'own_photo'
    generated_anatomy = 'generated_anatomy'


class Method(Enum):
    geometric_multiply = 'geometric-multiply'
    fresh_ink_composite = 'fresh-ink-composite'


class Finish(Enum):
    """
    What happened to the AI finish when one was attempted (ADR-0018). Anything but accepted means the geometric composite was delivered.
    """

    accepted = 'accepted'
    declined = 'declined'
    unavailable = 'unavailable'
    rejected_geometry = 'rejected_geometry'
    rejected_output = 'rejected_output'


class BodyFit(BaseModel):
    """
    How the design was fitted to the body silhouette read from the photograph (TASK-0039). A silhouette, not depth.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    scale: Annotated[float, Field(gt=0.0, le=1.0)]
    spill: Annotated[float, Field(ge=0.0, le=1.0)]
    taper: Annotated[float, Field(ge=0.0, le=0.35)]


class SourceCropPx(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    left: Annotated[int, Field(ge=0)]
    top: Annotated[int, Field(ge=0)]
    width: Annotated[int, Field(ge=1)]
    height: Annotated[int, Field(ge=1)]


class Transform(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    xPx: Annotated[int, Field(ge=0)]
    yPx: Annotated[int, Field(ge=0)]
    widthPx: Annotated[int, Field(ge=0)]
    heightPx: Annotated[int, Field(ge=0)]
    method: Method
    curvature: Annotated[
        float | None,
        Field(
            description='Approximate cylindrical warp in radians, not inferred anatomy.',
            ge=0.0,
            le=1.2,
        ),
    ] = None
    taper: Annotated[
        float | None,
        Field(
            description='Illustrative narrowing towards the lower calf, not measured anatomy.',
            ge=0.0,
            le=0.35,
        ),
    ] = None
    scaleCalibrated: bool
    generativePostprocess: Annotated[
        bool,
        Field(
            description='True only when a constrained AI finish replaced the geometric composite after passing the geometry check against it (ADR-0016, ADR-0018). The stencil never derives from it.'
        ),
    ]
    finish: Annotated[
        Finish | None,
        Field(
            description='What happened to the AI finish when one was attempted (ADR-0018). Anything but accepted means the geometric composite was delivered.'
        ),
    ] = None
    bodyFit: Annotated[
        BodyFit | None,
        Field(
            description='How the design was fitted to the body silhouette read from the photograph (TASK-0039). A silhouette, not depth.'
        ),
    ] = None
    sourceCropPx: SourceCropPx | None = None
    surface: Annotated[
        float | None,
        Field(
            description="How strongly the ink is attenuated where the photograph's own shading says the body turns away. An illustrative approximation of surface form, not recovered depth, and never a displacement: the artwork's geometry is authoritative (ADR-0014, MOCKUP-INV-001).",
            ge=0.0,
            le=1.0,
        ),
    ] = None
    freshness: Annotated[
        float | None,
        Field(
            description='Strength of the fresh-ink reddening around the strokes. 0 when the render is a plain multiply. Illustrative, never a clinical prediction of healing (PROD-INV-003).',
            ge=0.0,
            le=4.0,
        ),
    ] = None


class Method1(StrEnum):
    lineart = 'lineart'
    colour_contours = 'colour_contours'


class StencilReview(BaseModel):
    """
    TASK-0086 (audit ARQ-03): how the stencil was obtained, so the client and the tattooer know how far to trust it. `lineart`: traced from a dedicated line-art pass; `colour_contours`: approximate contours of a colour or shaded design. `simplification`: 0 when traced at full detail, 1 to 3 for each coarser pass needed.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    method: Method1
    simplification: Annotated[int, Field(ge=0, le=3)]


class MimeType1(StrEnum):
    image_jpeg = 'image/jpeg'
    image_png = 'image/png'


class Photo(BaseModel):
    """
    Stored as the media store keeps every own-body photograph: JPEG, EXIF stripped, encrypted at rest.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    assetId: Annotated[str, Field(pattern='^[a-f0-9]{32}$')]
    designId: Annotated[str, Field(pattern='^[a-f0-9]{64}$')]
    mimeType: MimeType1


class Capture(BaseModel):
    """
    A photograph the client took with the camera try-on and chose to keep, saved as a version of the design it shows (ADR-0022). Every other field is the parent's: the design is unchanged. The photograph passed the own-photo gate and is never sent to an image model.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    parentJobId: Annotated[str, Field(pattern='^[a-f0-9]{32}$')]
    photo: Annotated[
        Photo,
        Field(
            description='Stored as the media store keeps every own-body photograph: JPEG, EXIF stripped, encrypted at rest.'
        ),
    ]


class ReferenceId(RootModel[str]):
    root: Annotated[str, Field(pattern='^[a-f0-9]{32}$')]


class Coverage(Enum):
    larger = 'larger'
    smaller = 'smaller'
    full = 'full'


class Mode(Enum):
    artwork = 'artwork'
    placement = 'placement'


class Edit(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    parentJobId: Annotated[str, Field(pattern='^[a-f0-9]{32}$')]
    instruction: Annotated[str, Field(max_length=1000, min_length=3)]
    referenceIds: Annotated[
        list[ReferenceId] | None, Field(max_length=3, min_length=1)
    ] = None
    coverage: Coverage | None = None
    mode: Mode | None = None


class Artifact(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    designId: Annotated[str, Field(pattern='^[a-f0-9]{64}$')]
    briefId: Annotated[str, Field(pattern='^[a-f0-9-]{36}$')]
    briefRevision: Annotated[int, Field(ge=1)]
    size: Size
    master: Asset
    stencil: Asset
    stencilMirror: Asset
    pdf: Asset
    pdfMirror: Asset
    mockup: Asset
    referenceAnalysis: Annotated[str, Field(max_length=3000, min_length=1)]
    reviewRequired: Literal[True]
    backgroundKind: BackgroundKind
    transform: Transform
    notice: Annotated[str, Field(min_length=1)]
    stencilReview: Annotated[
        StencilReview | None,
        Field(
            description='TASK-0086 (audit ARQ-03): how the stencil was obtained, so the client and the tattooer know how far to trust it. `lineart`: traced from a dedicated line-art pass; `colour_contours`: approximate contours of a colour or shaded design. `simplification`: 0 when traced at full detail, 1 to 3 for each coarser pass needed.'
        ),
    ] = None
    background: Asset | None = None
    capture: Annotated[
        Capture | None,
        Field(
            description="A photograph the client took with the camera try-on and chose to keep, saved as a version of the design it shows (ADR-0022). Every other field is the parent's: the design is unchanged. The photograph passed the own-photo gate and is never sent to an image model."
        ),
    ] = None
    edit: Edit | None = None


class StudioJobStatus(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    jobId: Annotated[str, Field(pattern='^[a-f0-9]{32}$')]
    state: State
    result: Artifact | None
    error: str | None
    stage: Annotated[
        Stage | None,
        Field(
            description="TASK-0076 (audit UX-03): the pipeline step a running job is in, as the worker reports it. Absent when unknown. `seam` (TASK-0104) is a sleeve's join being redrawn."
        ),
    ] = None
    queuePosition: Annotated[
        int | None,
        Field(
            description="TASK-0076: for a queued job, how many jobs (including it) are ahead in the studio's queue.",
            ge=1,
        ),
    ] = None
