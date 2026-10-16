"""Composition root for the local studio: media, jobs, imaging and HTTP boundary."""

from __future__ import annotations

import base64
import hmac
import io
import json
import re
import sqlite3
import threading
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from PIL import Image
from tattoo_contracts.validation import validate

from app.settings import Settings, SettingsError
from app.shares import ShareLedger, shared_design, shared_files
from generation.bfl_studio import BflStudioProvider
from generation.plate_library import PlateLibrary, plate_body
from generation.seam import fit_aspect, seamless
from generation.studio import StudioProvider
from jobs.client_messages import for_client
from jobs.designs import MAX_NAME, asset_ids, clean_name, design_ids, inputs_of
from jobs.queue import JobQueue, designs_left
from jobs.quota import Limits, QuotaExceededError, TurnLedger, UploadLedger, day_start
from media.sanitize import sanitize
from media.store import AssetNotFoundError, EncryptedFileStore, RetentionClass
from mockup.anatomy import ZONE_SPAN_MM, is_sleeve, wrap_region, zone_size
from mockup.engine import DEFAULT_SURFACE, composite, visible_artwork, visible_size
from mockup.geometry import BLEND_TOLERANCE, GeometryCheck
from mockup.placement import (
    Coverage,
    ManualLayout,
    coverage_request,
    fit_coverage,
    manual_layout,
)
from orchestration import PipelineState, build_finish_graph, build_generation_graph
from safety.gate import InputGate, ReasonCode
from stencil.backdrop import clear_backdrop
from stencil.engine import (
    Master,
    deserialize_master,
    export_pdf,
    export_svg,
    rasterize,
    rescale,
    rescale_axes,
    serialize_master,
    trace_colour_artwork,
    trace_native_lineart,
)
from stencil.sleeve import export_panels_pdf, panels, unroll
from telemetry import activity, forget, record, usage
from telemetry.report import activity as account_activity
from telemetry.report import overview, window
from telemetry.store import EventStore

# TASK-0071: why an upload was refused. They used to share one message, so a reference refused
# because the check could not run read as if it showed a person, and nobody could tell which.
REFUSED_UPLOAD = {
    ReasonCode.CONTAINS_PERSON: (
        "La revisión ha visto una persona que se puede reconocer. Recorta la foto para quitarla "
        "(las personas pequeñas y lejanas no importan) o usa otra imagen; para ver el tatuaje "
        "sobre ti, sube tu foto como foto de tu piel."
    ),
    ReasonCode.EXPLICIT: (
        "La imagen tiene contenido explícito (desnudos, sexo o violencia gráfica) y no se puede "
        "usar."
    ),
    ReasonCode.PROVIDER_FAILED: (
        "No hemos podido revisar la imagen en este momento. Inténtalo de nuevo en unos segundos."
    ),
    ReasonCode.NO_PROVIDER: (
        "La revisión de imágenes no está disponible ahora mismo. Inténtalo más tarde."
    ),
    # TASK-0100: the provider has no credit; «en unos segundos» would never come true. The panel
    # shows the cause as an alert.
    ReasonCode.PROVIDER_EXHAUSTED: (
        "El estudio no puede revisar imágenes ahora mismo. Inténtalo más tarde; no hace falta "
        "que cambies nada."
    ),
}


#: TASK-0076 (audit UX-03): the step the client is shown for each pipeline node.
NODE_STAGES = {
    "skin_plate": "skin",
    "master_artwork": "drawing",
    "stencil_trace": "stencil",
    "surface_warp": "placing",
}

#: TASK-0104: the coverage controls do not apply to a sleeve.
SLEEVE_FIXED = (
    "Una manga ya rodea toda la zona: su tamaño es el de la pierna o el antebrazo. Para cambiarla, "
    "pide un cambio en el dibujo."
)
# TASK-0107: a design stored before TASK-0024 has no vector, so its stencil cannot follow a stretch.
NO_VECTOR_STRETCH = (
    "Este diseño es anterior a las plantillas escalables: puedes moverlo, girarlo o cambiar su "
    "tamaño en la vista, pero no ensancharlo ni alargarlo."
)

#: TASK-0090: said when the model drew something else twice, instead of delivering it.
ARTWORK_MISREAD = (
    "El generador no ha dibujado el diseño como se pidió (dibujó un cuerpo o le faltaba el "
    "motivo principal). Vuelve a generarlo; si se repite, describe el motivo con más claridad."
)

#: TASK-0113 (ADR-0039): the longest side of a reference shown to the prompt architect. Larger
#: images are downscaled by the API anyway and cost more tokens for nothing.
PREVIEW_EDGE_PX = 1568

#: TASK-0079: a consultation in progress lives a day after its last change, as the web cookie does.
CONSULTATION_TTL_S = 86400
CONSULTATION_ID = "[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}"
#: The largest consultation kept: messages are capped at 30 and references at five URLs.
MAX_CONSULTATION_BYTES = 400_000

ZONE_NEEDS_CONTROL = (
    "Para que ocupe toda la zona hay que cambiar las medidas de impresión. Usa el botón «Ocupar "
    "toda la zona»: te dirá las medidas nuevas antes de aplicarlas."
)


def sleeve_notice(brief: dict[str, Any], seam_visible: bool) -> str:
    """TASK-0104 (ADR-0034): what a sleeve's result is, in the client's words."""
    limb = "un antebrazo" if "forearm" in brief["placement"]["bodyPart"] else "una pierna"
    width, height = (
        f"{brief['size'][axis] / 10:g}".replace(".", ",") for axis in ("widthMm", "heightMm")
    )
    return (
        f"Manga completa: el diseño es la piel de {limb} de referencia desenrollada, "
        f"de {width} por {height} cm; el mockup muestra la mitad que se ve de frente y la vista "
        "3D, la vuelta entera. La plantilla es esa misma piel desenrollada a tamaño real. "
        + (
            "La junta donde se unen los dos bordes aún puede notarse: tu tatuador la cierra a "
            "mano. "
            if seam_visible
            else ""
        )
    )


def resizes_print(edit: dict[str, Any] | None) -> bool:
    """Whether a request may change the print millimetres (TASK-0073, audit UX-01).

    Only the explicit, confirmed «Ocupar toda la zona» control does: an edit carrying
    `coverage: "full"`. A whole-zone phrase in the idea or a change request covers the zone on the
    skin and keeps the accepted size.
    """
    return bool(edit) and (edit or {}).get("coverage") == "full"


class _StudioBlend:
    """The mockup finish over the configured provider (TASK-0040, ADR-0018).

    Declines an own photograph: ADR-0016 requires a provider whose no-training and no-retention
    terms are verified (GEN-INV-002), and none is yet. A generated plate is no one's photograph.
    Every provider output is moderated before it returns (`accept_output`, SEC-INV-006).
    """

    def __init__(self, provider: StudioProvider) -> None:
        self.provider = provider

    def blend(
        self, warped_mockup: bytes, photo: bytes | None, clearance: Any, finish: str
    ) -> bytes | None:
        if photo is not None:
            return None
        return self.provider.blend_mockup(warped_mockup, finish)


def design_body(brief: dict[str, Any], payload: dict[str, Any]) -> str | None:
    """The reference body a design is shown on (TASK-0110, ADR-0038).

    On a generated plate, the plate's own body; on the client's photograph, none: their body is
    not a reference one, and a sleeve's stencil then keeps the neutral profile.
    """
    return None if payload.get("bodyPhotoId") else plate_body(brief)


def design_zone(brief: dict[str, Any], payload: dict[str, Any]) -> dict[str, str]:
    """Where a design goes and on which body, as the result carries it (TASK-0108, TASK-0110)."""
    placement = brief["placement"]
    zone = {k: placement[k] for k in ("bodyPart", "orientation", "side") if k in placement}
    body = design_body(brief, payload)
    return {**zone, "bodyType": body} if body else zone


def manual_notice(layout: ManualLayout, size: dict[str, float], resized: bool) -> str:
    """What a placement saved from the live editor changed (TASK-0107, ADR-0036)."""
    measure = f"{size['widthMm']:.0f} x {size['heightMm']:.0f} mm"
    notice = (
        f"Colocación ajustada por ti. Plantilla y PDF reexportados a {measure}; "
        if resized
        else f"Colocación ajustada por ti. Las medidas del PDF siguen siendo {measure}; "
    )
    change = round((layout.stretch - 1) * 100)
    if change:
        notice += (
            f"proporciones {'ensanchadas' if change > 0 else 'alargadas'} un {abs(change)} % "
            "respecto al dibujo original: revisa círculos, letras y caras. "
        )
    angle = round(layout.placement["angle"])
    if angle:
        side = "a la derecha" if angle > 0 else "a la izquierda"
        notice += (
            f"Girado {abs(angle)} grados {side} sobre la piel: la plantilla se imprime recta, "
            "colócala con ese giro. "
        )
    return notice + "El tamaño sobre la piel es orientativo. "


def finished_transform(state: PipelineState) -> dict[str, Any]:
    """The composite's transform, saying whether an AI finish replaced it and why not if not."""
    assert state.transform is not None
    return {
        **state.transform,
        "generativePostprocess": state.blended,
        **({"finish": state.blend_outcome} if state.blend_outcome else {}),
    }


FINISH_NOTICE = (
    "Acabado de piel con IA sobre la composición; el diseño se ha comparado con la plantilla "
    "antes de mostrarlo. "
)

# TASK-0047: what a client sees when a version's own-body photo has expired.
PHOTO_GONE = (
    "La foto de tu cuerpo ya no está: se borra a las 24 horas. Súbela de nuevo para volver a "
    "ver el diseño sobre ella."
)

#: The files that show the client's body when the background is their own photo.
LIKENESS_FILES = frozenset({"mockup", "background"})


def lifecycle(name: str, payload: dict[str, Any]) -> tuple[RetentionClass, str | None]:
    """
    Which lifecycle a stored file follows, and what it descends from (TASK-0047, MEDIA-INV-006).

    On the client's own photo, the composite and its background show their body: they follow the
    photograph, expire with it and are erased with it. Everything else is the design - master,
    stencils, PDFs, the vector, a generated plate and a mockup on it - which shows nobody and stays
    until its owner deletes it. It descends from the first reference, itself design material, so
    no photograph's expiry can cascade into it.
    """
    photo = payload.get("bodyPhotoId")
    if photo and name in LIKENESS_FILES:
        return RetentionClass.PHOTO_DERIVED, str(photo)
    return RetentionClass.DESIGN, design_parent(payload)


NO_REFERENCES = "Sin referencias: el diseño parte solo de la descripción del cliente."


def design_parent(payload: dict[str, Any]) -> str | None:
    """The first reference, or none: a design drawn from the brief alone is its own root
    (TASK-0058, ADR-0026). Erasing the account still removes it (MEDIA-INV-006)."""
    references = payload.get("referenceIds") or []
    return str(references[0]) if references else None


# ADR-0022: the version a kept camera photograph becomes. The ink is superimposed on the device, so
# the notice says what the picture is and what it is not.
CAPTURE_NOTICE = (
    "Foto hecha con la cámara en tu dispositivo: el tatuaje está superpuesto, no hecho. "
    "El diseño y la plantilla son los de la propuesta original. "
    "Visualización ilustrativa. Revisa los símbolos y el trazo con tu tatuador."
)


# TASK-0116: a design copied from a kept camera photo's version takes the version it was taken of,
# without the photo, so its notice cannot say it is a photograph.
COPIED_CAPTURE_NOTICE = (
    "Diseño nuevo hecho a partir de otra propuesta: el dibujo, la plantilla y la vista en piel son "
    "los de esa propuesta; la foto con la cámara se queda en el diseño original. "
    "Visualización ilustrativa. Revisa los símbolos y el trazo con tu tatuador. "
    "Imprime el PDF al 100 %, sin ajustar a página."
)


class _StudioGenerationDeps:
    """Per-call `GenerationDeps` for the `orchestration` graph (TASK-0032).

    Each method runs exactly what `Studio.generate` used to run inline; the graph only fixes the
    order. It closes over the request context (edit/parent, coverage, zone, payload) so placement
    and artwork decisions stay identical, which is what makes this delegation behaviour-preserving.
    Image-model calls still go through the injected provider (ARCH-INV-001); this adapter opens no
    socket of its own.
    """

    def __init__(
        self,
        studio: Studio,
        owner: str,
        edit: dict[str, Any] | None,
        parent: dict[str, Any] | None,
        coverage: Coverage | None,
        zone: bool,
        payload: dict[str, Any],
    ) -> None:
        self.studio = studio
        self.owner = owner
        self.edit = edit
        self.parent = parent
        self.coverage = coverage
        self.zone = zone
        self.payload = payload
        #: TASK-0104: whether a sleeve's join still read as a cut after its repairs.
        self.seam_visible = False

    def make_artwork(self, state: PipelineState) -> bytes:
        brief = state.brief
        edited_native = (
            self.studio.provider.edit_artwork(
                brief,
                self.studio.owned(self.owner, self.parent["master"]["assetId"], "artifact"),
                state.references,
                self.edit["instruction"],
                rendered=state.rendered,
                attached=len(self.edit.get("referenceIds") or []),
            )
            if self.parent and self.edit
            else None
        )
        if state.rendered:
            native = edited_native or self.studio.provider.colour_artwork(
                brief, state.references, state.analysis
            )
            native = self.reviewed(state, native, edited_native is not None)
            if not state.colour and not self.edit:
                with Image.open(io.BytesIO(native)) as source:
                    monochrome = io.BytesIO()
                    source.convert("L").convert("RGB").save(monochrome, format="PNG")
                    native = monochrome.getvalue()
        else:
            native = edited_native or self.studio.provider.lineart(
                brief, state.references, state.analysis
            )
            native = self.reviewed(state, native, edited_native is not None)
        # TASK-0089: a backdrop the model painted behind the design would be tattooed as a panel
        # and traced into the stencil. It is turned to white before anything is built on it.
        native = clear_backdrop(native)
        if is_sleeve(brief):
            native = self.sleeve(brief, native)
        return native

    def sleeve(self, brief: dict[str, Any], native: bytes) -> bytes:
        """TASK-0104 (ADR-0034): a sleeve's edges meet on the skin, so its seam is redrawn.

        One repair always; a second only when the join still reads as a cut. A join that still
        shows after that ships, and the result says so: the tattooer closes it by hand.
        """
        self.studio.jobs.stage("seam")
        repaired = self.studio.provider.repair_seam(brief, native)
        if not seamless(repaired):
            repaired = self.studio.provider.repair_seam(brief, repaired)
        self.seam_visible = not seamless(repaired)
        return fit_aspect(repaired, brief["size"]["widthMm"], brief["size"]["heightMm"])

    def reviewed(self, state: PipelineState, native: bytes, edited: bool) -> bytes:
        """TASK-0090: the artwork is what was asked, or it is drawn once more with a correction.

        A design for a thigh came back as a thigh with the tattoo on it. A failed check redraws
        once, telling the model what went wrong; a second failure is said plainly rather than
        delivered. An edit is redrawn with the same request, which cannot take a correction.
        """
        provider = self.studio.provider
        verdict = provider.check_artwork(state.brief, native)
        if verdict is None or not verdict.misread:
            return native
        self.studio.jobs.stage("drawing")
        if edited:
            assert self.parent and self.edit
            again = provider.edit_artwork(
                state.brief,
                self.studio.owned(self.owner, self.parent["master"]["assetId"], "artifact"),
                state.references,
                self.edit["instruction"],
                rendered=state.rendered,
                attached=len(self.edit.get("referenceIds") or []),
            )
        elif state.rendered:
            again = provider.colour_artwork(
                state.brief, state.references, state.analysis, correction=verdict.correction()
            )
        else:
            again = provider.lineart(
                state.brief, state.references, state.analysis, correction=verdict.correction()
            )
        second = provider.check_artwork(state.brief, again)
        if second is not None and second.misread:
            raise ValueError(ARTWORK_MISREAD)
        return again

    def trace(self, state: PipelineState, native: bytes) -> tuple[Any, Any]:
        brief = state.brief
        width, height = brief["size"]["widthMm"], brief["size"]["heightMm"]
        if state.rendered:
            return trace_colour_artwork(native, width, height, state.weight)
        master = trace_native_lineart(native, width, height, state.weight)
        return master, rasterize(master)

    def master_preview(self, raster: Any) -> bytes:
        preview = io.BytesIO()
        raster.save(preview, format="PNG")
        return preview.getvalue()

    def stencil_files(self, master: Any) -> dict[str, tuple[bytes, str]]:
        brief = self.payload["brief"]
        region = wrap_region(brief["placement"]["bodyPart"]) if is_sleeve(brief) else None
        if region is not None:
            # TASK-0110 (ADR-0038): on the body the plate and the 3D view show.
            region = region.for_body(design_body(brief, self.payload))
        if region is None:
            return {
                "stencil": (export_svg(master), "image/svg+xml"),
                "stencilMirror": (export_svg(master, True), "image/svg+xml"),
                "pdf": (export_pdf(master), "application/pdf"),
                "pdfMirror": (export_pdf(master, True), "application/pdf"),
            }
        # TASK-0105 (ADR-0035): a sleeve's stencil is its skin unrolled, every row at the limb's
        # circumference there, and the same skin in four panels to transfer round the limb.
        flat = unroll(master, region)
        quarters = panels(
            master, region, brief["placement"]["bodyPart"], brief["placement"].get("side", "left")
        )
        return {
            "stencil": (export_svg(flat), "image/svg+xml"),
            "stencilMirror": (export_svg(flat, True), "image/svg+xml"),
            "pdf": (export_pdf(flat), "application/pdf"),
            "pdfMirror": (export_pdf(flat, True), "application/pdf"),
            "panels": (export_panels_pdf(quarters), "application/pdf"),
            "panelsMirror": (export_panels_pdf(quarters, True), "application/pdf"),
        }

    def ensure_background(self, state: PipelineState) -> bytes:
        if state.background is not None:
            return state.background
        return self.studio.plate(state.brief)

    def compose(
        self, state: PipelineState, raster: Any, background: bytes
    ) -> tuple[bytes, dict[str, Any]]:
        payload, brief = self.payload, state.brief
        body_part = brief["placement"]["bodyPart"]
        if is_sleeve(brief):
            return self.compose_sleeve(raster, background, brief)
        auto_placed = (
            not payload.get("placement")
            and not payload.get("bodyPhotoId")
            and (body_part == "calf" or (self.zone and body_part in ZONE_SPAN_MM))
        )
        fit_visible = bool(self.coverage) or auto_placed
        projection_size = visible_size(raster, brief["size"]) if fit_visible else brief["size"]
        if self.coverage:
            previous = dict(payload.get("placement") or {})
            if self.parent:
                with Image.open(io.BytesIO(background)) as photo:
                    photo.thumbnail((2048, 2048))
                    previous["width"] = self.parent["transform"]["widthPx"] / photo.width
            payload["placement"] = fit_coverage(
                background, projection_size, self.coverage.kind, previous, body_part=body_part
            )
        elif auto_placed:
            payload["placement"] = fit_coverage(
                background,
                projection_size,
                "full" if self.zone else "auto",
                body_part=body_part,
            )
        curved = body_part in {
            "calf",
            "shin",
            "inner_forearm",
            "outer_forearm",
            "upper_arm_inner",
            "upper_arm_outer",
            "thigh_front",
            "thigh_outer",
        }
        return composite(
            raster,
            background,
            brief["size"],
            payload.get("placement"),
            fresh=True,
            fit_visible=fit_visible,
            curvature=1.05 if curved else 0,
            taper=0.25 if body_part == "calf" else 0,
            # Read from the photograph, so it suits a back or a chest as readily as a limb.
            surface=DEFAULT_SURFACE,
            # TASK-0039: centred on, tapered with and kept on the body actually photographed.
            fit_body=True,
        )

    def compose_sleeve(
        self, raster: Any, background: bytes, brief: dict[str, Any]
    ) -> tuple[bytes, dict[str, Any]]:
        """TASK-0104: on a photograph only the half of a sleeve facing the camera shows.

        The sleeve's design is centred on the zone's own side (the back of the calf, the front of
        the shin, the palm side or the back of the forearm), which is the side the plate is seen
        from. Its middle half, half the circumference wide, is laid over the zone; the 3D view
        shows the whole turn. Nothing of the artwork is redrawn (MOCKUP-INV-001).

        TASK-0105: each row of a sleeve goes once round the limb at its own height. On the plate
        that is already so: `fit_body` measures how the limb narrows in the photograph and tapers
        the half with it, so every row covers the visible half of the limb there.
        """
        width, height = raster.size
        visible = raster.crop((width // 4, 0, width - width // 4, height))
        size = {"widthMm": brief["size"]["widthMm"] / 2, "heightMm": brief["size"]["heightMm"]}
        body_part = brief["placement"]["bodyPart"]
        self.payload["placement"] = fit_coverage(background, size, "full", body_part=body_part)
        return composite(
            visible,
            background,
            size,
            self.payload["placement"],
            fresh=True,
            curvature=1.05,
            taper=0.25 if body_part == "calf" else 0,
            surface=DEFAULT_SURFACE,
            fit_body=True,
        )


class Studio:
    def __init__(
        self,
        root: Path,
        key: bytes,
        provider: StudioProvider,
        plates: PlateLibrary | None = None,
        limits: Limits | None = None,
    ) -> None:
        root.mkdir(parents=True, exist_ok=True)
        self.provider = provider
        self.plates = plates
        self.media = EncryptedFileStore(root / "media", key, retention=timedelta(hours=24))
        self.db_path = root / "ownership.sqlite"
        self.lock = threading.RLock()
        with self.db() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, owner TEXT, kind TEXT)"
            )
            # When an owner last erased everything (TASK-0046). Not a blocklist: see `still_mine`.
            db.execute("CREATE TABLE IF NOT EXISTS deleted (owner TEXT PRIMARY KEY, at REAL)")
            # The authoritative vector geometry (ADR-0007). Internal: it is not a client
            # artifact, so it stays out of the studio-status contract.
            db.execute(
                "CREATE TABLE IF NOT EXISTS design_vector "
                "(design_id TEXT PRIMARY KEY, owner TEXT, asset_id TEXT)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS consent (owner TEXT, version TEXT, created TEXT "
                "DEFAULT CURRENT_TIMESTAMP)"
            )
            # TASK-0079 (audit ARQ-01): the consultation in progress, kept here so a restart or a
            # second web replica does not lose it. Its own 24-hour life, apart from designs.
            db.execute(
                "CREATE TABLE IF NOT EXISTS consultations "
                "(id TEXT PRIMARY KEY, owner TEXT, data TEXT, updated REAL)"
            )
        self.limits = limits or Limits()
        self.jobs = JobQueue(
            root / "jobs.sqlite", self.generate, self.purge_expired, limits=self.limits
        )
        # TASK-0078 (audit SEG-02): paid consultation turns, reserved by the web before it spends.
        self.turns = TurnLedger(root / "jobs.sqlite", self.limits)
        # TASK-0115: uploaded images per day, in place of ten per account for life.
        self.uploads = UploadLedger(root / "jobs.sqlite", self.limits)
        # TASK-0097 (ADR-0032): links a client gives their tattooer.
        self.shares = ShareLedger(root / "jobs.sqlite")

    def plate(self, brief: dict[str, Any]) -> bytes:
        """A skin plate from the reviewed library, or generated when it has none (TASK-0060)."""
        stored = self.plates.plate(brief) if self.plates else None
        return stored if stored is not None else self.provider.background(brief)

    def purge_expired(self, now: datetime | None = None) -> None:
        """
        Erase what has outlived its lifecycle (TASK-0047).

        Photographs of a body and everything composed on them expire; designs do not. Versions
        are kept, so a design made weeks ago still opens, with a notice where its photo was. Only
        runs that produced nothing - failed or cancelled - are swept, and a kept camera photo's
        version goes with its photo, because without it there is nothing left to show.
        """
        moment = now or datetime.now(UTC)
        with self.lock:
            for asset in self.media.expired(moment):
                try:
                    receipt = self.media.delete_cascade(asset.asset_id)
                except AssetNotFoundError:
                    continue
                with self.db() as db:
                    db.executemany("DELETE FROM assets WHERE id=?", [(a,) for a in receipt.removed])
            with self.jobs.connect() as db:
                db.execute(
                    "DELETE FROM jobs WHERE created < ? AND state IN ('failed','cancelled')",
                    (moment.timestamp() - 86400,),
                )
            self.drop_orphaned_captures()
            with self.db() as db:
                db.execute("DELETE FROM consent WHERE created < datetime('now','-1 day')")
                db.execute(
                    "DELETE FROM consultations WHERE updated < ?",
                    (moment.timestamp() - CONSULTATION_TTL_S,),
                )

    def save_consultation(self, owner: str, consultation_id: str, data: str) -> None:
        """Keep the consultation in progress (TASK-0079). One owner per id, never handed over."""
        with self.db() as db:
            row = db.execute(
                "SELECT owner FROM consultations WHERE id=?", (consultation_id,)
            ).fetchone()
            if row and row[0] != owner:
                raise PermissionError("Consulta de otra cuenta.")
            db.execute(
                "INSERT OR REPLACE INTO consultations VALUES (?,?,?,?)",
                (consultation_id, owner, data, time.time()),
            )

    def load_consultation(self, owner: str, consultation_id: str) -> str | None:
        with self.db() as db:
            row = db.execute(
                "SELECT data FROM consultations WHERE id=? AND owner=? AND updated >= ?",
                (consultation_id, owner, time.time() - CONSULTATION_TTL_S),
            ).fetchone()
        return str(row[0]) if row else None

    def drop_consultation(self, owner: str, consultation_id: str) -> None:
        with self.db() as db:
            db.execute("DELETE FROM consultations WHERE id=? AND owner=?", (consultation_id, owner))

    def drop_orphaned_captures(self) -> None:
        """A kept camera photo's version whose photo has expired shows nothing: remove it."""
        with self.jobs.connect() as db:
            rows = db.execute(
                "SELECT id, result FROM jobs WHERE state='succeeded' AND result LIKE ?",
                ('%"capture"%',),
            ).fetchall()
        gone: list[str] = []
        with self.db() as db:
            for row in rows:
                photo = (json.loads(row["result"]).get("capture") or {}).get("photo") or {}
                held = db.execute("SELECT 1 FROM assets WHERE id=?", (photo.get("assetId"),))
                if not held.fetchone():
                    gone.append(row["id"])
        if gone:
            with self.jobs.connect() as db:
                db.executemany("DELETE FROM jobs WHERE id=?", [(job,) for job in gone])

    def admin_asset(self, asset_id: str) -> tuple[bytes, str]:
        """
        A file of any account, for the administrator (TASK-0055) - never one that shows a body.

        A body photograph, a kept camera photo and anything composed on them are refused whoever
        owns them: the owner decided the administrator does not see those. So is anything stored
        before TASK-0047, when every file was written as a photograph and nothing distinguishes a
        design from a body.
        """
        if not re.fullmatch("[a-f0-9]{32}", asset_id):
            raise KeyError("Archivo no encontrado")
        with self.db() as db:
            row = db.execute("SELECT kind FROM assets WHERE id=?", (asset_id,)).fetchone()
        if not row:
            raise KeyError("Archivo no encontrado")
        try:
            stored = self.media.metadata(asset_id)
        except AssetNotFoundError as error:
            raise KeyError("Archivo no disponible") from error
        if row[0] == "body" or stored.retention in (
            RetentionClass.PHOTO,
            RetentionClass.PHOTO_DERIVED,
        ):
            raise PermissionError("Las fotos del cuerpo no se muestran al administrador.")
        return self.media.read(asset_id), stored.media_type

    def own_photo(self, owner: str, asset_id: str) -> bytes:
        """The client's own body photo, or a clear refusal once it has expired (TASK-0047)."""
        try:
            return self.owned(owner, asset_id, "body")
        except (KeyError, ValueError) as error:
            raise ValueError(PHOTO_GONE) from error

    def db(self) -> sqlite3.Connection:
        return sqlite3.connect(self.db_path, timeout=10)

    def deletion_mark(self, owner: str) -> float:
        """When this owner last erased everything, or 0 if they never have (TASK-0046)."""
        with self.db() as db:
            row = db.execute("SELECT at FROM deleted WHERE owner=?", (owner,)).fetchone()
        return float(row[0]) if row else 0.0

    def still_mine(self, owner: str, mark: float) -> None:
        """
        Refuse to store work for an owner who erased everything while it was being made.

        A generation runs for minutes, so a deletion can land in the middle of one and the work
        would otherwise be registered after it, outliving the erasure. The guard this replaces
        refused a deleted owner forever: correct for a throwaway session id, a permanent lockout
        for an account id (TASK-0046/DEC-002). Comparing against the mark taken when the work
        started refuses the straddling case and nothing else, so deleting is not a lockout.
        """
        if self.deletion_mark(owner) != mark:
            raise ValueError("Se eliminaron tus datos durante esta operación. Vuelve a empezar.")

    def owned(self, owner: str, asset_id: str, kind: str | None = None) -> bytes:
        if not re.fullmatch("[a-f0-9]{32}", asset_id):
            raise KeyError("Archivo no encontrado")
        with self.db() as db:
            row = db.execute(
                "SELECT kind FROM assets WHERE id=? AND owner=?", (asset_id, owner)
            ).fetchone()
        if not row or (kind and row[0] != kind):
            raise KeyError("Archivo no encontrado")
        try:
            asset = self.media.metadata(asset_id)
        except AssetNotFoundError as error:
            raise KeyError("Archivo no disponible") from error
        if asset in self.media.expired():
            raise ValueError("El archivo ha caducado. Adjunta la imagen de nuevo.")
        return self.media.read(asset_id)

    def preview(self, owner: str, asset_id: str) -> bytes:
        """An owned reference as a bounded JPEG, for the prompt architect (TASK-0113, ADR-0039).

        The stored PNG passed the input gate; this only shrinks it to what the language model's
        image input can take, so the architect never receives a full-size upload.
        """
        data = self.owned(owner, asset_id, "reference")
        with Image.open(io.BytesIO(data)) as stored:
            image = stored.convert("RGB")
        image.thumbnail((PREVIEW_EDGE_PX, PREVIEW_EDGE_PX))
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=85)
        return output.getvalue()

    def discard(self, owner: str, asset_id: str) -> None:
        """Delete a reference the client removed before it was used (TASK-0113, ADR-0039).

        One a job already used belongs to that design and goes with the account's data, so it is
        refused here rather than leaving a design without its references.
        """
        self.owned(owner, asset_id, "reference")
        with self.lock:
            with self.jobs.connect() as db:
                used = db.execute(
                    "SELECT 1 FROM jobs WHERE owner=? AND payload LIKE ?",
                    (owner, f"%{asset_id}%"),
                ).fetchone()
            if used:
                raise ValueError("Esa imagen ya forma parte de un diseño.")
            self.media.delete_cascade(asset_id)
            with self.db() as db:
                db.execute("DELETE FROM assets WHERE id=? AND owner=?", (asset_id, owner))
        record("deletion", "reference", account=owner)

    def register(self, owner: str, asset_id: str, kind: str) -> str:
        with self.db() as db:
            db.execute("INSERT INTO assets VALUES (?,?,?)", (asset_id, owner, kind))
        return asset_id

    def ingest(self, owner: str, body: dict[str, Any]) -> dict[str, str]:
        """Screen and store an upload, recording it (TASK-0054). The event holds no image."""
        kind = str(body.get("kind", "reference"))
        with activity(owner):
            try:
                stored = self._ingest(owner, body)
            except ValueError as refusal:
                record("upload", kind, outcome="refused", detail={"reason": str(refusal)[:300]})
                raise
            record("upload", kind, detail={"mimeType": stored["mimeType"]})
            return stored

    def _ingest(self, owner: str, body: dict[str, Any]) -> dict[str, str]:
        mark = self.deletion_mark(owner)
        kind = body.get("kind", "reference")
        if (
            kind not in ("reference", "body")
            or body.get("consent") is not True
            or body.get("adult") is not True
        ):
            raise ValueError("Confirma mayoría de edad y permiso para procesar la imagen.")
        if body.get("sourceUrl"):
            data = self.provider.download_reference(body["sourceUrl"])
        else:
            try:
                data = base64.b64decode(body.get("data", ""), validate=True)
            except (ValueError, TypeError) as error:
                raise ValueError("Imagen inválida") from error
        if not data or len(data) > 8_000_000:
            raise ValueError("La imagen debe ocupar entre 1 byte y 8 MB.")
        # TASK-0115: counted before the moderation call it would spend.
        self.uploads.reserve(owner)
        clean = sanitize(data)
        # Moderate sanitized PNG; no EXIF or unapproved bytes reach durable storage.
        with Image.open(io.BytesIO(clean.data)) as image:
            output = io.BytesIO()
            image.convert("RGB").save(output, format="PNG")
        normalized = output.getvalue()
        gate = InputGate(self.provider.moderation()).screen_upload(
            normalized, own_body_consented=kind == "body"
        )
        if not gate.passed or gate.clearance is None:
            # TASK-0071: one message per reason, so the client and the panel know which it was.
            raise ValueError(
                REFUSED_UPLOAD.get(gate.reason, REFUSED_UPLOAD[ReasonCode.PROVIDER_FAILED])
            )
        with self.lock:
            self.still_mine(owner, mark)
            with self.db() as db:
                db.execute(
                    "INSERT INTO consent(owner,version) VALUES (?,?)",
                    (owner, "studio-own-photo-v1" if kind == "body" else "studio-reference-v1"),
                )
            # A reference passed a gate that refuses any person, so it shows nobody and follows
            # the design lifecycle; a body photo is a photograph and expires (TASK-0047).
            asset = self.media.ingest_photo(
                normalized,
                gate.clearance,
                retention=RetentionClass.PHOTO if kind == "body" else RetentionClass.DESIGN,
            )
            self.register(owner, asset.asset_id, kind)
        return {"assetId": asset.asset_id, "mimeType": asset.media_type}

    def generate(self, owner: str, payload: dict[str, Any]) -> dict[str, Any]:
        # Taken before any work starts, so a deletion arriving mid-generation is detected at the
        # storage step rather than silently outlived by it (TASK-0046/REQ-005).
        mark = self.deletion_mark(owner)
        brief = payload["brief"]
        colour = brief["colour"]["mode"] != "black_and_grey"
        rendered = (
            bool(payload.get("edit"))
            or colour
            or brief["style"]["primary"] == "black_and_grey_realism"
            or brief["shading"]["technique"] != "none"
        )
        references = [
            self.owned(owner, asset_id, "reference") for asset_id in payload["referenceIds"]
        ]
        background = (
            self.own_photo(owner, payload["bodyPhotoId"]) if payload.get("bodyPhotoId") else None
        )
        edit = payload.get("edit")
        parent = self.jobs.get(owner, edit["parentJobId"])["result"] if edit else None
        if edit and parent is None:
            raise ValueError("La propuesta original no está disponible.")
        if parent and parent.get("background") and background is None:
            background = self.owned(owner, parent["background"]["assetId"], "artifact")
        coverage = coverage_request(edit) if edit else None
        attached = len(edit.get("referenceIds") or []) if edit else 0
        # Attached photos always mean the drawing changes, whatever else the sentence says.
        if coverage and parent and coverage.placement_only and not attached:
            if background is None:
                background = self.plate(brief)
            return self.reposition(owner, payload, parent, background, coverage, mark)
        # A whole-zone request fills the zone on the skin (ADR-0008). TASK-0073 (audit UX-01): the
        # millimetres the client accepted stay authoritative. Only the explicit «Ocupar toda la
        # zona» control, which says it changes the print size and is confirmed, resolves them from
        # the zone; a sentence in the idea or in a change request moves the projection only.
        zone = self.zone_intent(brief, payload, coverage, bool(edit))
        if zone and resizes_print(edit):
            brief["size"] = self.zone_millimetres(brief)
        if references and not parent:
            self.jobs.stage("references")
        analysis = (
            parent["referenceAnalysis"]
            if parent
            else self.provider.analyze(references, brief["subject"]["description"])
            if references
            else NO_REFERENCES
        )
        if edit and attached:
            # The new photos lead the reference list; record what they show for traceability.
            added = self.provider.analyze(references[:attached], edit["instruction"])
            analysis = f"{analysis}\n\nFotos añadidas con el cambio: {added}"[:3000]
        # The creation sequence (artwork -> stencil -> compose) runs through the orchestration
        # graph (TASK-0032, ADR-0015). The adapter reproduces the previous inline behaviour; the
        # graph fixes the order and hosts the future AI-blend / output-gate nodes.
        deps = _StudioGenerationDeps(self, owner, edit, parent, coverage, zone, payload)
        state = build_generation_graph(
            deps, blend=_StudioBlend(self.provider), geometry=GeometryCheck(BLEND_TOLERANCE)
        ).invoke(
            on_node=lambda node: self.jobs.stage(NODE_STAGES.get(node, "finishing")),
            state=PipelineState(
                brief=brief,
                references=references,
                analysis=analysis,
                rendered=rendered,
                colour=colour,
                weight={"fine": 0.25, "medium": 0.35, "bold": 0.6}.get(
                    brief["linework"]["weight"], 0.35
                ),
                background=background,
                # An own photo is marked as such so the finish declines it (ADR-0018).
                body_photo=background if payload.get("bodyPhotoId") else None,
            ),
        )
        # The graph always fills these on the success path; assert to narrow the optional state
        # fields and to fail loudly rather than storing a half-built result.
        assert state.mockup is not None and state.background is not None
        assert state.transform is not None
        master, raster, mockup = state.master, state.raster, state.mockup
        transform, background, files = finished_transform(state), state.background, state.files
        result: dict[str, Any] = {
            "designId": master.design_hash,
            "briefId": brief["briefId"],
            "briefRevision": brief["revision"],
            "size": brief["size"],
            "referenceAnalysis": analysis,
            "transform": transform,
            "reviewRequired": True,
            # TASK-0086 (audit ARQ-03): how far to trust the stencil.
            "stencilReview": {
                "method": "colour_contours" if rendered else "lineart",
                "simplification": master.simplification,
            },
            "backgroundKind": "own_photo" if payload.get("bodyPhotoId") else "generated_anatomy",
            "placement": design_zone(brief, payload),
            "notice": (
                "Propuesta con acabado y sombreado. El stencil aproxima los contornos "
                "del mismo dibujo; "
                "el tatuador debe revisar y corregir los detalles antes de transferirlo. "
                if rendered
                else "Propuesta de contornos negros. "
            )
            + (FINISH_NOTICE if state.blended else "")
            + (sleeve_notice(brief, deps.seam_visible) if is_sleeve(brief) else "")
            + "Simulación de tinta reciente; curvatura aproximada en extremidades, "
            "no reconstrucción anatómica. "
            "Visualización ilustrativa. Revisa los símbolos y el trazo con "
            "tu tatuador. Imprime el PDF al 100 %, sin ajustar a página.",
        }
        with self.lock:
            self.still_mine(owner, mark)
            self.store_vector(owner, master, payload)
            if edit:
                result["edit"] = edit
            for asset_id in payload["referenceIds"]:
                self.owned(owner, asset_id, "reference")
            if payload.get("bodyPhotoId"):
                self.own_photo(owner, payload["bodyPhotoId"])
            for name, (data, mime) in files.items():
                with Image.open(io.BytesIO(mockup)) as rendered:
                    dimensions = rendered.size if name in ("mockup", "background") else raster.size
                asset = self.media.store_artifact(
                    data,
                    media_type=mime,
                    width_px=dimensions[0],
                    height_px=dimensions[1],
                    retention=lifecycle(name, payload)[0],
                    parent_id=lifecycle(name, payload)[1],
                )
                result[name] = {
                    "assetId": self.register(owner, asset.asset_id, "artifact"),
                    "designId": master.design_hash,
                    "mimeType": mime,
                }
        return result

    def store_vector(self, owner: str, master: Master, payload: dict[str, Any]) -> None:
        """Keep the authoritative geometry so a later resize is an exact scale, not a retrace."""
        asset = self.media.store_artifact(
            serialize_master(master),
            media_type="application/json",
            width_px=0,
            height_px=0,
            # The geometry shows nobody: it is the design itself (TASK-0047).
            retention=RetentionClass.DESIGN,
            parent_id=design_parent(payload),
        )
        with self.db() as db:
            db.execute(
                "INSERT OR REPLACE INTO design_vector VALUES (?, ?, ?)",
                (master.design_hash, owner, self.register(owner, asset.asset_id, "artifact")),
            )

    def visible_box(
        self, owner: str, parent: dict[str, Any]
    ) -> tuple[int, int, int, int, int, int]:
        """Where the artwork sits in its master's canvas, white margins aside (TASK-0107)."""
        with Image.open(
            io.BytesIO(self.owned(owner, parent["master"]["assetId"], "artifact"))
        ) as source:
            _, crop = visible_artwork(source)
            return (
                crop["left"],
                crop["top"],
                crop["width"],
                crop["height"],
                source.width,
                source.height,
            )

    def load_vector(self, owner: str, design_id: str) -> bytes | None:
        """A design created before TASK-0024 has no stored vector; the caller must cope."""
        with self.db() as db:
            row = db.execute(
                "SELECT asset_id FROM design_vector WHERE design_id = ? AND owner = ?",
                (design_id, owner),
            ).fetchone()
        if row is None:
            return None
        try:
            return self.owned(owner, row[0], "artifact")
        except (AssetNotFoundError, HTTPException, KeyError):
            # The row can outlive its asset (expiry, deletion). A missing vector is a case the
            # caller already handles; it is not an error.
            return None

    def zone_intent(
        self,
        brief: dict[str, Any],
        payload: dict[str, Any],
        coverage: Coverage | None,
        is_edit: bool,
    ) -> bool:
        """Whether this request asks for a whole body zone to be covered (ADR-0008)."""
        if (payload.get("placement") or {}).get("photoWidthMm"):
            # A calibrated photograph carries real millimetres; it supersedes the table.
            return False
        if brief["placement"]["bodyPart"] not in ZONE_SPAN_MM:
            return False
        if coverage:
            return coverage.resizes_zone
        if is_edit:
            return False
        initial = coverage_request({"instruction": brief["subject"]["description"]})
        return bool(initial and initial.resizes_zone)

    def zone_millimetres(self, brief: dict[str, Any]) -> dict[str, float]:
        """The zone's own span, which is what the artwork is then composed to fill."""
        body_part = brief["placement"]["bodyPart"]
        span_width, span_height = ZONE_SPAN_MM[body_part]
        return zone_size(body_part, span_height / span_width)

    def reposition(
        self,
        owner: str,
        payload: dict[str, Any],
        parent: dict[str, Any],
        background: bytes,
        coverage: Coverage,
        mark: float,
    ) -> dict[str, Any]:
        """Reuse the accepted artwork, with no retracing, no AI editing and no provider call.

        A nudge changes the projection alone. A whole-zone request also resolves the millimetres
        from reference anatomy and re-exports the print assets by exact vector scale (ADR-0008).
        A parent stored before TASK-0024 has no vector master, so it keeps its millimetres rather
        than letting the brief and the stencil disagree.
        """
        brief = payload["brief"]
        if is_sleeve(brief):
            # TASK-0104: a sleeve already goes all the way round; there is nothing to enlarge,
            # shrink or fill, and its 2D view is always its visible half.
            raise ValueError(SLEEVE_FIXED)
        self.jobs.stage("placing")
        body_part = brief["placement"]["bodyPart"]
        previous = dict(payload.get("placement") or {})
        with Image.open(io.BytesIO(background)) as image:
            image.thumbnail((2048, 2048))
            frame = image.size
            previous["width"] = parent["transform"]["widthPx"] / image.width
        # TASK-0107 (ADR-0036): a placement chosen in the live editor. Its millimetres follow the
        # view on each axis, derived here from the parent's placement, never from the client.
        layout = (
            manual_layout(
                parent["transform"],
                frame,
                payload["edit"]["placement"],
                None if previous.get("photoWidthMm") else self.visible_box(owner, parent),
            )
            if coverage.kind == "manual"
            else None
        )
        stored_vector = (
            self.load_vector(owner, parent["designId"])
            if (
                coverage.resizes_zone
                and resizes_print(payload.get("edit"))
                and not previous.get("photoWidthMm")
            )
            or (layout is not None and layout.resizes)
            else None
        )
        if layout is not None and layout.stretches and stored_vector is None:
            raise ValueError(NO_VECTOR_STRETCH)
        resize = stored_vector is not None and (layout is not None or body_part in ZONE_SPAN_MM)
        stretched: bytes | None = None
        files: dict[str, tuple[bytes, str]] = {}
        design_id = parent["designId"]
        result_master = parent["master"]
        with Image.open(
            io.BytesIO(self.owned(owner, parent["master"]["assetId"], "artifact"))
        ) as source:
            artwork_size = source.size
            if layout is not None:
                if resize:
                    brief["size"] = layout.size(brief["size"]["widthMm"], brief["size"]["heightMm"])
                placement = {**previous, **layout.placement}
                if layout.stretches:
                    # The raster master takes the same proportions, so the 3D view, the overlay
                    # and the tattooer's link agree with the stencil. Resampled, never redrawn.
                    resampled = io.BytesIO()
                    source.resize(
                        (max(1, round(source.width * layout.sx / layout.sy)), source.height),
                        Image.Resampling.LANCZOS,
                    ).save(resampled, format="PNG")
                    stretched = resampled.getvalue()
            else:
                if resize:
                    _, bounds = visible_artwork(source)
                    brief["size"] = zone_size(body_part, bounds["height"] / bounds["width"])
                placement = fit_coverage(
                    background,
                    visible_size(source, brief["size"]),
                    coverage.kind,
                    previous,
                    body_part=body_part,
                )
            mockup, transform = composite(
                source.convert("RGB"),
                background,
                brief["size"],
                placement,
                fresh=True,
                fit_visible=True,
                curvature=parent["transform"].get("curvature", 1.05 if body_part == "calf" else 0),
                taper=parent["transform"].get("taper", 0.25 if body_part == "calf" else 0),
                surface=parent["transform"].get("surface", DEFAULT_SURFACE),
                fit_body=True,
                manual=layout is not None,
            )
        stretch = layout.stretch if layout is not None else parent["transform"].get("stretch")
        if stretch is not None and abs(stretch - 1) > 1e-4:
            transform["stretch"] = stretch
        # TASK-0040: a re-placed design gets the same finish, through the same nodes, as a new one.
        own_photo = bool(payload.get("bodyPhotoId")) or parent.get("backgroundKind") == "own_photo"
        finished = build_finish_graph(
            blend=_StudioBlend(self.provider), geometry=GeometryCheck(BLEND_TOLERANCE)
        ).invoke(
            PipelineState(
                brief=brief,
                mockup=mockup,
                transform=transform,
                body_photo=background if own_photo else None,
            )
        )
        assert finished.mockup is not None
        mockup, transform = finished.mockup, finished_transform(finished)
        if resize:
            assert stored_vector is not None
            master = (rescale_axes if layout is not None else rescale)(
                deserialize_master(stored_vector),
                brief["size"]["widthMm"],
                brief["size"]["heightMm"],
            )
            design_id = master.design_hash
            self.store_vector(owner, master, payload)
            # The artwork bytes are reused, but their physical identity changed with the size.
            result_master = {**parent["master"], "designId": design_id}
            files = {
                "stencil": (export_svg(master), "image/svg+xml"),
                "stencilMirror": (export_svg(master, True), "image/svg+xml"),
                "pdf": (export_pdf(master), "application/pdf"),
                "pdfMirror": (export_pdf(master, True), "application/pdf"),
            }
            if stretched is not None:
                files["master"] = (stretched, "image/png")
        if layout is not None:
            notice = manual_notice(layout, brief["size"], resize)
        elif resize:
            notice = (
                f"Tamaño ajustado a la zona: {brief['size']['widthMm']:.0f} x "
                f"{brief['size']['heightMm']:.0f} mm. Plantilla y PDF reexportados a esa medida; "
                "el dibujo no se ha modificado. La medida procede de anatomía de referencia "
                "adulta, no de tu cuerpo: confírmala con tu tatuador. "
            )
        elif coverage.resizes_zone and not resizes_print(payload.get("edit")):
            # TASK-0073: a phrase is not the confirmed control; the accepted size stays.
            notice = (
                "Cobertura visual ampliada a la zona. Las medidas de impresión siguen siendo las "
                f"que aceptaste ({brief['size']['widthMm']:.0f} x {brief['size']['heightMm']:.0f} "
                "mm); para cambiarlas usa «Ocupar toda la zona». "
            )
        elif coverage.resizes_zone:
            notice = (
                "Cobertura visual ampliada. No he podido cambiar las medidas de impresión de "
                "esta propuesta, así que el PDF conserva las originales. "
            )
        else:
            notice = (
                "Tamaño sobre piel actualizado. Dibujo y plantilla conservados sin cambios. "
                "Cobertura visual orientativa; las medidas del PDF siguen siendo las originales. "
            )
        result = {
            **parent,
            **({"master": result_master} if resize else {}),
            "designId": design_id,
            "size": brief["size"],
            "briefRevision": brief["revision"],
            "transform": transform,
            "edit": payload["edit"],
            "notice": notice
            + (FINISH_NOTICE if finished.blended else "")
            + "La curvatura no es una reconstrucción anatómica.",
        }
        with self.lock:
            self.still_mine(owner, mark)
            reused = [("mockup", mockup, "image/png")]
            if not parent.get("background"):
                reused.append(("background", background, "image/png"))
            for name, data, mime in reused:
                files[name] = (data, mime)
            for name, (data, mime) in files.items():
                if mime == "image/png":
                    with Image.open(io.BytesIO(data)) as image:
                        dimensions = image.size
                else:
                    dimensions = artwork_size
                asset = self.media.store_artifact(
                    data,
                    media_type=mime,
                    width_px=dimensions[0],
                    height_px=dimensions[1],
                    retention=lifecycle(name, payload)[0],
                    parent_id=lifecycle(name, payload)[1],
                )
                result[name] = {
                    "assetId": self.register(owner, asset.asset_id, "artifact"),
                    "designId": design_id,
                    "mimeType": mime,
                }
        return result

    def capture(self, owner: str, body: dict[str, Any]) -> dict[str, Any]:
        """
        Keep a photograph taken with the camera try-on as a version of its design (ADR-0022).

        The photograph is a picture of the client's body, so it takes exactly the own-photo path:
        adult consent, the safety gate with own-body consent, EXIF stripped, encrypted at rest,
        counted against the account's images and erased with everything else. It is stored, shown
        back to its owner and nothing more: no image model ever receives it.

        The design does not change. Every field of the version is the parent's except the
        photograph and the notice, so an edit started from it edits the same design.
        """
        with activity(owner):
            try:
                kept = self._capture(owner, body)
            except (KeyError, ValueError) as refusal:
                record("capture", "keep", outcome="refused", detail={"reason": str(refusal)[:300]})
                raise
            record("capture", "keep", job=kept["jobId"])
            return kept

    def _capture(self, owner: str, body: dict[str, Any]) -> dict[str, Any]:
        key = body.get("idempotencyKey")
        parent_id = body.get("parentJobId")
        if not isinstance(key, str) or not re.fullmatch("[a-f0-9-]{36}", key):
            raise ValueError("Identificador de solicitud inválido.")
        if not isinstance(parent_id, str) or not re.fullmatch("[a-f0-9]{32}", parent_id):
            raise ValueError("Propuesta original inválida.")
        # A retry of a request that already succeeded does not screen or store the photo twice.
        existing = self.jobs.find(owner, key)
        if existing:
            return existing
        parent = self.jobs.get(owner, parent_id)
        if parent["state"] != "succeeded" or not parent["result"]:
            raise ValueError("La propuesta original no está disponible.")
        # The parent's stored request, so a change asked from this version finds its brief.
        source = self.jobs.source_payload(owner, parent_id)
        photo = self.ingest(
            owner,
            {
                "data": body.get("data", ""),
                "kind": "body",
                "adult": body.get("adult"),
                "consent": body.get("consent"),
            },
        )
        result = {k: v for k, v in parent["result"].items() if k not in ("capture", "edit")}
        result["capture"] = {
            "parentJobId": parent_id,
            "photo": {
                "assetId": photo["assetId"],
                "designId": result["designId"],
                "mimeType": photo["mimeType"],
            },
        }
        result["notice"] = CAPTURE_NOTICE
        payload = {k: v for k, v in source.items() if k != "edit"}
        return self.jobs.record(owner, {**payload, "idempotencyKey": key}, result, parent=parent_id)

    def shared(self, token: str) -> tuple[str, dict[str, Any]]:
        """The owner and what an open link shows (TASK-0097), or KeyError.

        Built from the stored job each time, so a version that is gone, or whose files are gone,
        closes its links with it.
        """
        found = self.shares.resolve(token)
        if found is None:
            raise KeyError("Enlace no disponible")
        owner, job_id, created, expires = found
        status = self.jobs.get(owner, job_id)
        if status["state"] != "succeeded" or not status.get("result"):
            raise KeyError("Enlace no disponible")
        try:
            payload = self.jobs.source_payload(owner, job_id)
        except ValueError as error:
            raise KeyError("Enlace no disponible") from error
        shared = shared_design(status["result"], payload, created, expires)
        issues = validate("shared-design", shared)
        if issues:
            raise KeyError(f"Enlace no disponible: {issues[0].path} {issues[0].message}")
        return owner, shared

    def copy_design(self, owner: str, body: dict[str, Any]) -> dict[str, Any]:
        """
        A new design made from one version of another (TASK-0116, ADR-0041).

        Nothing is drawn: the new design's first version is that version as it is — artwork,
        stencils, skin view — and changes asked from it build a design of their own, under its own
        name, while the original keeps its versions. It costs no design from the daily limit. A
        kept camera photo is not carried over: it is a picture of the client's body, and stays
        with the design it was taken for.
        """
        key = body.get("idempotencyKey")
        source_id = body.get("fromJobId")
        if not isinstance(key, str) or not re.fullmatch("[a-f0-9-]{36}", key):
            raise ValueError("Identificador de solicitud inválido.")
        if not isinstance(source_id, str) or not re.fullmatch("[a-f0-9]{32}", source_id):
            raise ValueError("Propuesta original inválida.")
        existing = self.jobs.find(owner, key)
        if existing:
            return existing
        source = self.jobs.get(owner, source_id)
        if source["state"] != "succeeded" or not source["result"]:
            raise ValueError("La propuesta original no está disponible.")
        payload = {
            k: v for k, v in self.jobs.source_payload(owner, source_id).items() if k != "edit"
        }
        result = {k: v for k, v in source["result"].items() if k not in ("capture", "edit")}
        if source["result"].get("capture"):
            result["notice"] = COPIED_CAPTURE_NOTICE
        original = (source.get("design") or {}).get("name")
        name = clean_name(f"{original[: MAX_NAME - 9]} (copia)") if original else None
        copied = self.jobs.record(owner, {**payload, "idempotencyKey": key}, result, name=name)
        record("design", "copy", account=owner, job=copied["jobId"])
        return copied

    def rename_design(self, owner: str, family: str, name: Any) -> str:
        """Name a design (TASK-0116). An empty name gives it back the client's idea."""
        named = self.jobs.rename(owner, family, clean_name(name))
        record("design", "rename", account=owner)
        return named

    def delete_design(self, owner: str, family: str) -> int:
        """Delete a design and every version of it (TASK-0116, ADR-0041). Returns how many."""
        return self._erase_versions(owner, family, None)

    def delete_version(self, owner: str, job_id: str) -> int:
        """Delete one version of a design; the design's other versions keep everything they use."""
        return self._erase_versions(owner, self.jobs.family(owner, job_id), job_id)

    def _erase_versions(self, owner: str, family: str, only: str | None) -> int:
        """
        Erase versions of one design, and every file no version left still uses.

        Versions share files - a re-placement keeps its parent's artwork and stencils, a kept photo
        and a copied design keep everything - so a file goes only when no remaining version of the
        account points at it. Artwork goes before the uploads it descends from, and an upload goes
        only when no remaining version and no consultation in progress uses it, so a cascade from
        it can reach nothing that is kept (SEC-INV-004). The rows stay, emptied, so the day's
        designs are still counted (TASK-0078), and every link to an erased version closes.
        """
        with self.lock:
            versions = self.jobs.versions(owner, family)
            if not versions:
                raise KeyError("Diseño no encontrado")
            if any(row["state"] != "succeeded" for row in versions):
                raise ValueError(
                    "Se está creando una versión de este diseño. Espera a que termine para "
                    "eliminarlo."
                )
            erased = [row for row in versions if only is None or row["id"] == only]
            if not erased:
                raise KeyError("Trabajo no encontrado")
            gone_ids = {row["id"] for row in erased}
            files: set[str] = set()
            uploads: set[str] = set()
            designs: set[str] = set()
            for row in erased:
                result = json.loads(row["result"] or "{}")
                files |= asset_ids(result)
                uploads |= inputs_of(json.loads(row["payload"] or "{}"))
                designs |= design_ids(result)
            kept_files: set[str] = set()
            kept_designs: set[str] = set()
            with self.jobs.connect() as db:
                remaining = db.execute(
                    "SELECT id, payload, result FROM jobs WHERE owner=? AND state IN "
                    "('queued','running','succeeded')",
                    (owner,),
                ).fetchall()
                for job_id, payload, result_text in remaining:
                    if job_id in gone_ids:
                        continue
                    result = json.loads(result_text or "{}")
                    kept_files |= asset_ids(result) | inputs_of(json.loads(payload or "{}"))
                    kept_designs |= design_ids(result)
                db.executemany(
                    "UPDATE jobs SET state='cancelled',payload='{}',result=NULL WHERE id=? "
                    "AND owner=?",
                    [(job_id, owner) for job_id in gone_ids],
                )
                if only is None or len(erased) == len(versions):
                    db.execute(
                        "DELETE FROM design_names WHERE owner=? AND family=?", (owner, family)
                    )
            for job_id in gone_ids:
                self.shares.revoke(owner, job_id)
            with self.db() as db:
                vectors = {
                    design_id: asset_id
                    for design_id, asset_id in db.execute(
                        "SELECT design_id, asset_id FROM design_vector WHERE owner=?", (owner,)
                    )
                    if design_id in designs - kept_designs
                }
                in_progress = [
                    data
                    for (data,) in db.execute(
                        "SELECT data FROM consultations WHERE owner=?", (owner,)
                    )
                ]
                db.executemany(
                    "DELETE FROM design_vector WHERE design_id=? AND owner=?",
                    [(design_id, owner) for design_id in vectors],
                )
            artwork = (files | set(vectors.values())) - kept_files
            unused = {
                asset_id
                for asset_id in uploads - kept_files
                if not any(asset_id in data for data in in_progress)
            }
            for asset_id in [*sorted(artwork), *sorted(unused - artwork)]:
                self._erase_file(owner, asset_id)
        record(
            "deletion",
            "design" if only is None else "version",
            account=owner,
            detail={"versions": len(erased)},
        )
        return len(erased)

    def _erase_file(self, owner: str, asset_id: str) -> None:
        """One owned file and what descends from it, with its ownership rows."""
        with self.db() as db:
            owned = db.execute(
                "SELECT 1 FROM assets WHERE id=? AND owner=?", (asset_id, owner)
            ).fetchone()
        if not owned:
            return
        try:
            removed = self.media.delete_cascade(asset_id).removed
        except AssetNotFoundError:
            removed = (asset_id,)
        with self.db() as db:
            db.executemany(
                "DELETE FROM assets WHERE id=? AND owner=?", [(a, owner) for a in removed]
            )

    def delete(self, owner: str) -> None:
        # Counted, then the account's events lose who it was and what it wrote (TASK-0054).
        record("deletion", "erase_all", account=owner)
        forget(owner)
        # TASK-0097: every link the account gave out stops opening.
        self.shares.forget(owner)
        with self.lock:
            with self.db() as db:
                # A watermark, not a blocklist: the account keeps working, with a clean slate.
                db.execute("INSERT OR REPLACE INTO deleted VALUES (?,?)", (owner, time.time()))
                ids = [
                    row[0] for row in db.execute("SELECT id FROM assets WHERE owner=?", (owner,))
                ]
            for asset_id in ids:
                try:
                    self.media.metadata(asset_id)
                except AssetNotFoundError:
                    continue
                self.media.delete_cascade(asset_id)
            with self.jobs.connect() as db:
                db.execute(
                    "UPDATE jobs SET state='cancelled',payload='{}',result=NULL WHERE owner=?",
                    (owner,),
                )
                db.execute("DELETE FROM design_names WHERE owner=?", (owner,))
            with self.db() as db:
                db.execute("DELETE FROM assets WHERE owner=?", (owner,))
                db.execute("DELETE FROM consent WHERE owner=?", (owner,))
                db.execute("DELETE FROM consultations WHERE owner=?", (owner,))
                # Without this the account keeps rows pointing at artwork it no longer owns.
                db.execute("DELETE FROM design_vector WHERE owner=?", (owner,))


async def bounded_json(request: Request) -> dict[str, Any]:
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > 12_000_000:
            raise HTTPException(413, "La solicitud supera el límite permitido.")
    try:
        body = json.loads(data)
    except ValueError as error:
        raise HTTPException(400, "JSON inválido") from error
    if not isinstance(body, dict):
        raise HTTPException(400, "Se requiere un objeto JSON")
    return body


#: An account id as Supabase issues it: a lowercase UUID (TASK-0046).
OWNER_ID = "[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}"

#: What the web tier may report (TASK-0054). Anything else is ignored, not stored.
#: TASK-0094: `client_error` is a screen that failed in a client's browser.
WEB_EVENT_KINDS = frozenset({"provider_call", "consultation_turn", "sign_in", "client_error"})
_COUNTS = ("duration_ms", "input_tokens", "output_tokens", "images")


def web_event(item: Any) -> dict[str, Any] | None:
    """A web-reported event reduced to known, bounded fields, or None if it is not one."""
    if not isinstance(item, dict) or item.get("kind") not in WEB_EVENT_KINDS:
        return None
    operation = item.get("operation")
    if not isinstance(operation, str) or not re.fullmatch("[a-z_]{1,40}", operation):
        return None
    clean: dict[str, Any] = {"kind": item["kind"], "operation": operation}
    outcome = item.get("outcome", "ok")
    clean["outcome"] = outcome if outcome in ("ok", "error", "refused") else "error"
    for name in ("provider", "model"):
        value = item.get(name)
        if isinstance(value, str) and 0 < len(value) <= 80:
            clean[name] = value
    for name in _COUNTS:
        value = item.get(name)
        if isinstance(value, int) and not isinstance(value, bool) and 0 <= value < 10**9:
            clean[name] = value
    if isinstance(item.get("text"), str):
        clean["text"] = item["text"]
    detail = item.get("detail")
    if isinstance(detail, dict):
        clean["detail"] = {
            str(key)[:40]: value
            for key, value in list(detail.items())[:10]
            if isinstance(value, str | int | float | bool) or value is None
        }
    return clean


#: Files in a version that show a body, which the administrator is not shown (TASK-0055).
def hidden_from_admin(result: dict[str, Any]) -> list[str]:
    hidden = ["mockup", "background"] if result.get("backgroundKind") == "own_photo" else []
    return [*hidden, "capture"] if result.get("capture") else hidden


def router(studio: Studio, token: str, events: EventStore | None = None) -> APIRouter:
    routes = APIRouter(prefix="/studio")

    def owner(request: Request) -> str:
        """
        Whose work this is: the account id, since TASK-0046. The header used to carry the
        browser's consultation session id, which made the same person on a second device a
        different owner. The name follows the meaning so the next reader is not misled.
        """
        if not hmac.compare_digest(request.headers.get("authorization", ""), f"Bearer {token}"):
            raise HTTPException(401, "No autorizado")
        value = request.headers.get("x-owner-id", "")
        if not re.fullmatch(OWNER_ID, value):
            raise HTTPException(401, "Propietario inválido")
        return value

    @routes.post("/media")
    async def upload(request: Request) -> dict[str, str]:
        who = owner(request)
        body = await bounded_json(request)
        try:
            # Sync CPU/network work is offloaded, preserving status polling responsiveness.
            from starlette.concurrency import run_in_threadpool

            return await run_in_threadpool(studio.ingest, who, body)
        except QuotaExceededError as limit:
            raise HTTPException(429, str(limit)) from limit
        except ValueError as error:
            raise HTTPException(422, for_client(str(error))) from error

    def admin(request: Request) -> str:
        """
        Who the administrator is, for the audit trail. The web tier has already checked the role
        with Supabase; the worker checks that the call carries the service token and an id.
        """
        if not hmac.compare_digest(request.headers.get("authorization", ""), f"Bearer {token}"):
            raise HTTPException(401, "No autorizado")
        who = request.headers.get("x-admin-id", "")
        if not re.fullmatch(OWNER_ID, who):
            raise HTTPException(401, "Administrador inválido")
        if events is None:
            raise HTTPException(503, "La monitorización no está configurada.")
        return who

    @routes.get("/admin/overview")
    def admin_overview(request: Request, days: int = 30) -> dict[str, Any]:
        who = admin(request)
        days = min(max(days, 1), 365)
        since, until = window(days, datetime.now(UTC))
        assert events is not None
        report = overview(events.events(since, until))
        record("admin", "overview", account=who, detail={"days": days})
        return {"days": days, **report}

    @routes.get("/admin/accounts/{account}")
    def admin_account(account: str, request: Request, days: int = 90) -> dict[str, Any]:
        who = admin(request)
        if not re.fullmatch(OWNER_ID, account):
            raise HTTPException(404, "Cuenta no encontrada")
        days = min(max(days, 1), 365)
        since, until = window(days, datetime.now(UTC))
        assert events is not None
        found = account_activity(events.events(since, until), account)
        versions = [
            {**version, "adminHidden": hidden_from_admin(version.get("result") or {})}
            for version in studio.jobs.history(account)
        ]
        # Every look at a person's activity is itself recorded, with who looked.
        record("admin", "view_account", account=who, detail={"subject": account})
        return {**found, "versions": versions}

    @routes.get("/admin/media/{asset_id}")
    def admin_media(asset_id: str, request: Request) -> Response:
        who = admin(request)
        try:
            data, media_type = studio.admin_asset(asset_id)
        except PermissionError as refusal:
            raise HTTPException(403, str(refusal)) from refusal
        except KeyError as error:
            raise HTTPException(404, "Archivo no disponible") from error
        record("admin", "view_asset", account=who, detail={"asset": asset_id})
        return Response(
            data,
            media_type=media_type,
            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
        )

    @routes.get("/media/{asset_id}")
    def media(asset_id: str, request: Request, preview: bool = False) -> Response:
        try:
            # TASK-0113: `preview` is a bounded JPEG of a reference, for the prompt architect.
            if preview:
                data, media_type = studio.preview(owner(request), asset_id), "image/jpeg"
            else:
                data = studio.owned(owner(request), asset_id)
                media_type = studio.media.metadata(asset_id).media_type
            return Response(
                data,
                media_type=media_type,
                headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
            )
        except (KeyError, ValueError) as error:
            raise HTTPException(404, "Archivo no disponible") from error

    @routes.delete("/media/{asset_id}", status_code=204)
    def discard_media(asset_id: str, request: Request) -> Response:
        # TASK-0113 (ADR-0039): a reference the client removed before any design used it.
        try:
            studio.discard(owner(request), asset_id)
        except KeyError as error:
            raise HTTPException(404, "Archivo no disponible") from error
        except ValueError as error:
            raise HTTPException(409, str(error)) from error
        return Response(status_code=204)

    @routes.post("/jobs", status_code=202)
    async def submit(request: Request) -> dict[str, Any]:
        who = owner(request)
        body = await bounded_json(request)
        try:
            if body.get("edit"):
                if not isinstance(body["edit"], dict) or not isinstance(
                    body["edit"].get("parentJobId"), str
                ):
                    raise ValueError("Propuesta original inválida.")
                instruction = body["edit"].get("instruction")
                if not isinstance(instruction, str) or not 3 <= len(instruction.strip()) <= 1000:
                    raise ValueError("Escribe entre 3 y 1000 caracteres para describir el cambio.")
                body["edit"]["instruction"] = instruction.strip()
                if body["edit"].get("placement") and (
                    body["edit"].get("coverage") or body["edit"].get("referenceIds")
                ):
                    # TASK-0107: a placement moves the design as it is; it changes nothing else.
                    raise ValueError("Guarda la colocación por separado de otros cambios.")
                # TASK-0073 (audit UX-01): covering the whole zone with nothing else changed is a
                # print-size change. A sentence cannot confirm it; the control says what it does.
                phrased = coverage_request({"instruction": body["edit"]["instruction"]})
                if (
                    not body["edit"].get("coverage")
                    and not body["edit"].get("referenceIds")
                    and phrased
                    and phrased.resizes_zone
                    and phrased.placement_only
                ):
                    raise ValueError(ZONE_NEEDS_CONTROL)
                original = studio.jobs.source_payload(who, body["edit"]["parentJobId"])
                # Parent owns the brief/placement, never a client-supplied artifact ID.
                body = {**original, "idempotencyKey": body["idempotencyKey"], "edit": body["edit"]}
                body["brief"]["revision"] += 1
                parent = studio.jobs.get(who, body["edit"]["parentJobId"])["result"]
                studio.owned(who, parent["master"]["assetId"], "artifact")
                # TASK-0036: the stored payload predates any whole-zone resize, so the parent's
                # result is where its millimetres live. Without this an edit of a resized
                # version silently shrank back to the original size.
                body["brief"]["size"] = dict(parent["size"])
            if validate("studio-job", body):
                raise ValueError("Revisa la petición de cambios (entre 3 y 1000 caracteres).")
            attached = (body.get("edit") or {}).get("referenceIds") or []
            if attached:
                # TASK-0036: photos attached to a change guide it first and stay with the design
                # for later versions. The contract caps a design at five references.
                body["referenceIds"] = list(dict.fromkeys([*attached, *body["referenceIds"]]))[:5]
            for asset_id in body["referenceIds"]:
                studio.owned(who, asset_id, "reference")
            if body.get("bodyPhotoId"):
                studio.own_photo(who, body["bodyPhotoId"])
            return studio.jobs.enqueue(who, body)
        except QuotaExceededError as limit:
            # TASK-0078 (audit SEG-02): a daily limit, before any provider was called.
            raise HTTPException(429, str(limit)) from limit
        except (KeyError, ValueError) as error:
            raise HTTPException(422, for_client(str(error))) from error

    def service(request: Request) -> None:
        """The web's service token alone: a share is opened by whoever holds its link."""
        if not hmac.compare_digest(request.headers.get("authorization", ""), f"Bearer {token}"):
            raise HTTPException(401, "No autorizado")

    @routes.post("/shares", status_code=201)
    async def create_share(request: Request) -> dict[str, Any]:
        """A link to one finished design for the client's tattooer (TASK-0097, ADR-0032)."""
        who = owner(request)
        body = await bounded_json(request)
        job_id = body.get("jobId")
        if not isinstance(job_id, str) or not re.fullmatch("[a-f0-9]{32}", job_id):
            raise HTTPException(422, "Diseño inválido.")
        try:
            status = studio.jobs.get(who, job_id)
            if status["state"] != "succeeded":
                raise KeyError(job_id)
            share, _created, expires = studio.shares.create(who, job_id)
        except KeyError as error:
            raise HTTPException(404, "Este diseño no está disponible para compartir.") from error
        except ValueError as error:
            raise HTTPException(429, str(error)) from error
        record("share", "create", account=who, job=job_id)
        return {"token": share, "expiresAt": datetime.fromtimestamp(expires, UTC).isoformat()}

    @routes.get("/shares/open/{job_id}")
    def open_links(job_id: str, request: Request) -> dict[str, Any]:
        """Whether this design has links out, so the client can withdraw them on another day."""
        who = owner(request)
        if not re.fullmatch("[a-f0-9]{32}", job_id):
            raise HTTPException(422, "Diseño inválido.")
        count, until = studio.shares.open_links(who, job_id)
        return {
            "open": count,
            "expiresAt": None if until is None else datetime.fromtimestamp(until, UTC).isoformat(),
        }

    @routes.delete("/shares/{job_id}", status_code=204)
    def revoke_share(job_id: str, request: Request) -> Response:
        who = owner(request)
        if not re.fullmatch("[a-f0-9]{32}", job_id):
            raise HTTPException(422, "Diseño inválido.")
        closed = studio.shares.revoke(who, job_id)
        record("share", "revoke", account=who, job=job_id, detail={"closed": closed})
        return Response(status_code=204)

    @routes.get("/shares")
    def open_share(request: Request) -> dict[str, Any]:
        """What a link shows. The token comes in `X-Share-Token`, never in the path."""
        service(request)
        try:
            who, shared = studio.shared(request.headers.get("x-share-token", ""))
        except KeyError as error:
            raise HTTPException(404, "Enlace no disponible") from error
        record("share", "view", account=who, detail={"design": shared["designId"][:12]})
        return shared

    @routes.get("/shares/media/{asset_id}")
    def share_media(asset_id: str, request: Request) -> Response:
        """One file of a shared design, and only the files the link shows."""
        service(request)
        try:
            who, shared = studio.shared(request.headers.get("x-share-token", ""))
            if asset_id not in shared_files(shared):
                raise KeyError(asset_id)
            data = studio.owned(who, asset_id)
            return Response(
                data,
                media_type=studio.media.metadata(asset_id).media_type,
                headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
            )
        except (KeyError, ValueError) as error:
            raise HTTPException(404, "Archivo no disponible") from error

    @routes.get("/quota")
    async def quota(request: Request) -> dict[str, Any]:
        """What this account may still do today (TASK-0095, audit 2026-10-08 UX-04).

        The same counts the limits apply, so the counter and the refusal never disagree.
        """
        who = owner(request)
        limits = studio.limits
        mine, everyone = studio.jobs.designs_today(who)
        turns = studio.turns.used(who)
        return {
            "designs": {
                "used": mine,
                "limit": limits.designs_per_account,
                "remaining": designs_left(limits, mine, everyone),
            },
            "turns": {
                "used": turns,
                "limit": limits.turns_per_account,
                "remaining": max(0, limits.turns_per_account - turns),
            },
            "resetsAt": datetime.fromtimestamp(day_start() + 86400, UTC).isoformat(),
        }

    @routes.post("/quota/turns", status_code=204)
    async def reserve_turn(request: Request) -> Response:
        """Count one paid consultation turn before the web spends on it (TASK-0078).

        The web sends an id per turn, so a retried request is counted once.
        """
        who = owner(request)
        body = await bounded_json(request)
        turn_id, kind = body.get("id"), body.get("kind")
        if not isinstance(turn_id, str) or not re.fullmatch("[a-f0-9-]{36}", turn_id):
            raise HTTPException(422, "Identificador de solicitud inválido.")
        if kind not in ("message", "search"):
            raise HTTPException(422, "Tipo de solicitud inválido.")
        try:
            studio.turns.reserve(who, turn_id, kind)
        except QuotaExceededError as limit:
            raise HTTPException(429, str(limit)) from limit
        return Response(status_code=204)

    @routes.post("/events", status_code=202)
    async def web_events(request: Request) -> dict[str, int]:
        """
        Events the web tier observed: its own provider calls, consultation turns, sign-ins
        (TASK-0054). The account is the header's, never the body's, and a cost is computed here
        from the configured prices rather than accepted from the caller.
        """
        if not hmac.compare_digest(request.headers.get("authorization", ""), f"Bearer {token}"):
            raise HTTPException(401, "No autorizado")
        who = request.headers.get("x-owner-id") or None
        if who is not None and not re.fullmatch(OWNER_ID, who):
            raise HTTPException(401, "Propietario inválido")
        body = await bounded_json(request)
        items = body.get("events")
        if not isinstance(items, list) or len(items) > 50:
            raise HTTPException(422, "Se esperan entre 0 y 50 eventos.")
        accepted = 0
        for item in items:
            clean = web_event(item)
            if clean is None:
                continue
            kind, operation = clean.pop("kind"), clean.pop("operation")
            if kind == "provider_call":
                clean["cost_usd"] = usage.PRICES.cost(
                    clean.get("model"),
                    clean.get("input_tokens"),
                    clean.get("output_tokens"),
                    clean.get("images"),
                )
            record(kind, operation, account=who, **clean)
            accepted += 1
        return {"accepted": accepted}

    @routes.post("/captures", status_code=201)
    async def capture(request: Request) -> dict[str, Any]:
        """A camera try-on photograph the client chose to keep (ADR-0022)."""
        who = owner(request)
        body = await bounded_json(request)
        try:
            from starlette.concurrency import run_in_threadpool

            # The photo is screened by the moderation provider; keep status polling responsive.
            return await run_in_threadpool(studio.capture, who, body)
        except KeyError as error:
            raise HTTPException(404, "La propuesta original no está disponible.") from error
        except ValueError as error:
            raise HTTPException(422, for_client(str(error))) from error

    @routes.get("/jobs")
    def history(request: Request) -> list[dict[str, Any]]:
        return studio.jobs.history(owner(request))

    @routes.get("/jobs/{job_id}")
    def status(job_id: str, request: Request) -> dict[str, Any]:
        try:
            return studio.jobs.get(owner(request), job_id)
        except KeyError as error:
            raise HTTPException(404, "Trabajo no encontrado") from error

    # TASK-0116 (ADR-0041): the client manages their designs one by one.
    @routes.delete("/jobs/{job_id}")
    def delete_version(job_id: str, request: Request) -> dict[str, int]:
        who = owner(request)
        if not re.fullmatch("[a-f0-9]{32}", job_id):
            raise HTTPException(422, "Versión inválida.")
        try:
            return {"deleted": studio.delete_version(who, job_id)}
        except KeyError as error:
            raise HTTPException(404, "Esta versión ya no existe.") from error
        except ValueError as error:
            raise HTTPException(409, str(error)) from error

    @routes.delete("/designs/{family}")
    def delete_design(family: str, request: Request) -> dict[str, int]:
        who = owner(request)
        if not re.fullmatch("[a-f0-9]{32}", family):
            raise HTTPException(422, "Diseño inválido.")
        try:
            return {"deleted": studio.delete_design(who, family)}
        except KeyError as error:
            raise HTTPException(404, "Este diseño ya no existe.") from error
        except ValueError as error:
            raise HTTPException(409, str(error)) from error

    @routes.patch("/designs/{family}")
    async def rename_design(family: str, request: Request) -> dict[str, str]:
        who = owner(request)
        if not re.fullmatch("[a-f0-9]{32}", family):
            raise HTTPException(422, "Diseño inválido.")
        body = await bounded_json(request)
        try:
            return {"name": studio.rename_design(who, family, body.get("name"))}
        except KeyError as error:
            raise HTTPException(404, "Este diseño ya no existe.") from error
        except ValueError as error:
            raise HTTPException(422, str(error)) from error

    @routes.post("/designs", status_code=201)
    async def copy_design(request: Request) -> dict[str, Any]:
        who = owner(request)
        body = await bounded_json(request)
        try:
            return studio.copy_design(who, body)
        except KeyError as error:
            raise HTTPException(404, "La propuesta original no está disponible.") from error
        except ValueError as error:
            raise HTTPException(422, str(error)) from error

    @routes.get("/consultations/{consultation_id}")
    def load_consultation(consultation_id: str, request: Request) -> dict[str, Any]:
        """TASK-0079 (audit ARQ-01): the consultation in progress, for any web replica."""
        if not re.fullmatch(CONSULTATION_ID, consultation_id):
            raise HTTPException(404, "Consulta no encontrada")
        data = studio.load_consultation(owner(request), consultation_id)
        if data is None:
            raise HTTPException(404, "Consulta no encontrada")
        return {"data": json.loads(data)}

    @routes.put("/consultations/{consultation_id}", status_code=204)
    async def save_consultation(consultation_id: str, request: Request) -> Response:
        if not re.fullmatch(CONSULTATION_ID, consultation_id):
            raise HTTPException(422, "Consulta inválida.")
        who = owner(request)
        body = await bounded_json(request)
        data = json.dumps(body.get("data"))
        if not isinstance(body.get("data"), dict) or len(data) > MAX_CONSULTATION_BYTES:
            raise HTTPException(422, "Consulta inválida.")
        try:
            studio.save_consultation(who, consultation_id, data)
        except PermissionError as error:
            raise HTTPException(403, "Consulta de otra cuenta.") from error
        return Response(status_code=204)

    @routes.delete("/consultations/{consultation_id}", status_code=204)
    def drop_consultation(consultation_id: str, request: Request) -> Response:
        if re.fullmatch(CONSULTATION_ID, consultation_id):
            studio.drop_consultation(owner(request), consultation_id)
        return Response(status_code=204)

    @routes.delete("/session")
    def delete(request: Request) -> dict[str, bool]:
        studio.delete(owner(request))
        return {"deleted": True}

    return routes


def build_studio(settings: Settings) -> Studio | None:
    if not settings.worker_token or not settings.media_key or not settings.openai_api_key:
        return None
    return Studio(
        Path(settings.data_dir),
        bytes.fromhex(settings.media_key.get_secret_value()),
        build_provider(settings),
        PlateLibrary(),
        Limits(
            designs_per_account=settings.daily_designs,
            designs_total=settings.daily_designs_total,
            turns_per_account=settings.daily_turns,
            uploads_per_account=settings.daily_uploads,
        ),
    )


def build_provider(settings: Settings) -> StudioProvider:
    """Select the image backend by configuration (TASK-0025), never by caller."""
    if settings.openai_api_key is None:
        raise SettingsError("OPENAI_API_KEY is required for vision and moderation.")
    openai_key = settings.openai_api_key.get_secret_value()
    if settings.image_backend == "bfl":
        if settings.bfl_api_key is None:
            # Fail loudly: silently falling back to OpenAI would bill the wrong vendor.
            raise SettingsError(
                "TATTOO_IMAGE_BACKEND=bfl requires BFL_API_KEY. Values are redacted."
            )
        return BflStudioProvider(
            openai_key,
            settings.bfl_api_key.get_secret_value(),
            image_model=settings.image_model,
            vision_model=settings.vision_model,
            base_url=settings.bfl_base_url,
            background_model=settings.bfl_background_model,
        )
    return StudioProvider(openai_key, settings.image_model, settings.vision_model)
