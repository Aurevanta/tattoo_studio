"""The tattooer acceptance kit for stencils (TASK-0130, owner's audit list item 9).

A folder a tattooer prints and works through: the protocol, six stencils made by the studio's own
exporters (byte-for-byte what a client downloads, never a mock-up of them), an evaluation form and a
manifest of hashes that ties a filled form to this exact kit.

    uv run python -m app.build_acceptance_kit <out-dir>

Samples 01-04 and 06 are native line art (ADR-0003); 05 is approximate contours of a real colour
design (ADR-0044). The printing, the transfers and the verdicts are human work; this module only
makes them repeatable.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
from collections.abc import Callable
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import Any

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from tattoo_contracts.sleeve import WRAP_REGIONS

from stencil.engine import Master, export_pdf, trace_colour_artwork, trace_native_lineart
from stencil.sleeve import export_panels_pdf, panels, unroll

REPO = Path(__file__).resolve().parents[3]
PUBLIC = REPO / "apps" / "web" / "public"
#: A line-art piece from the generated style catalogue (ADR-0012) and the owner's colour design
#: shown on the landing (TASK-0106). Both are studio output, so the samples are real.
LINEART_SOURCE = PUBLIC / "style-library" / "fine_line" / "botanical.webp"
COLOUR_SOURCE = PUBLIC / "ejemplos" / "cronos-diseno.webp"
#: The stroke widths the brief offers (fine, medium, bold), as `Studio.generate` maps them.
STROKES = {"fino": 0.25, "medio": 0.35, "grueso": 0.6}
#: Gaps between parallel lines on the calibration sheets, to find the smallest that survives a
#: transfer.
GAPS_MM = (0.5, 1.0, 1.5, 2.0, 3.0)


@dataclass(frozen=True)
class Sample:
    file: str
    title: str
    regime: str  # "lineart" | "colour_contours"
    size_mm: tuple[float, float]
    stroke_mm: float
    measure: str


def calibration_master(stroke_mm: float) -> Master:
    """A 100 x 100 mm sheet: a frame to measure, 10 mm ticks, circles, sharp angles, line gaps."""
    paths: list[list[tuple[float, float]]] = [[(0, 0), (100, 0), (100, 100), (0, 100), (0, 0)]]
    for i in range(1, 10):
        t = 10.0 * i
        paths += [[(t, 0), (t, 3)], [(t, 97), (t, 100)], [(0, t), (3, t)], [(97, t), (100, t)]]
    for radius in (6.0, 12.0, 18.0):
        steps = max(48, int(radius * 8))
        paths.append(
            [
                (
                    30 + radius * math.cos(2 * math.pi * k / steps),
                    30 + radius * math.sin(2 * math.pi * k / steps),
                )
                for k in range(steps + 1)
            ]
        )
    # A five-pointed star: sharp angles a centreline trace or a transfer may round off.
    star = [
        (
            72 + (16 if k % 2 == 0 else 6.5) * math.sin(math.pi * k / 5),
            30 - (16 if k % 2 == 0 else 6.5) * math.cos(math.pi * k / 5),
        )
        for k in range(11)
    ]
    paths.append(star)
    # Pairs of parallel lines, 30 mm long, with the gaps to tell apart after a transfer.
    x = 12.0
    for gap in GAPS_MM:
        paths += [[(x, 58), (x, 88)], [(x + gap, 58), (x + gap, 88)]]
        x += gap + 12
    return Master(paths, 100.0, 100.0, stroke_mm)


def calibration_pdf(stroke_mm: float) -> bytes:
    return export_pdf(calibration_master(stroke_mm))


def sleeve_master() -> Master:
    """A lower-leg sleeve with rings and a diagonal: does a panel's ticks meet its neighbour's?"""
    region = WRAP_REGIONS["lower_leg"]
    width, height = region.circumference_mm, region.length_mm
    paths = [[(0.0, y), (width, y)] for y in (20.0, height / 2, height - 20)]
    paths.append([(0.0, 20.0), (width, height - 20)])
    return Master(paths, width, height, 0.35)


def protocol_pdf(samples: list[Sample]) -> bytes:
    """The protocol, in the tattooer's language (the studio's users are in Spain)."""
    output = io.BytesIO()
    pdf = canvas.Canvas(output, pagesize=A4, pageCompression=0)
    pdf.setTitle("Inkcraft - prueba de aceptación de plantillas")
    lines: list[tuple[str, int, str]] = [
        ("Helvetica-Bold", 15, "Prueba de aceptación de plantillas Inkcraft"),
        ("Helvetica", 9, "Para tatuadores profesionales. Duración aproximada: 45 minutos."),
        ("", 6, ""),
        ("Helvetica-Bold", 11, "Qué se evalúa"),
        ("Helvetica", 9, "La escala 1:1, la limpieza del trazo, el detalle que se conserva y si"),
        ("Helvetica", 9, "la plantilla sirve para transferir. Hay dos tipos de plantilla:"),
        (
            "Helvetica",
            9,
            "- Line-art nativo (01-04 y 06): dibujado como líneas desde el principio.",
        ),
        ("Helvetica", 9, "- Contornos aproximados (05): derivados de un diseño a color; avisan en"),
        ("Helvetica", 9, "  la propia hoja de que hay que revisar y redibujar los detalles."),
        ("", 6, ""),
        ("Helvetica-Bold", 11, "Material"),
        ("Helvetica", 9, "Impresora térmica de plantillas o láser y papel de transferencia; regla"),
        ("Helvetica", 9, "metálica o calibre; piel sintética de práctica."),
        ("", 6, ""),
        ("Helvetica-Bold", 11, "Pasos"),
        (
            "Helvetica",
            9,
            "1. Imprime cada PDF al 100 %, sin «ajustar a la página». Si una plantilla",
        ),
        ("Helvetica", 9, "   no cabe en tu papel, imprime sus piezas A4 (páginas siguientes)."),
        (
            "Helvetica",
            9,
            "2. Mide la barra de 50 mm y la medida indicada de cada muestra; anótalas.",
        ),
        ("Helvetica", 9, "3. Transfiere 01-06 a la piel de práctica con tu método habitual."),
        (
            "Helvetica",
            9,
            "4. Valora de 1 a 5 limpieza, detalle y transferencia, y si es utilizable.",
        ),
        ("Helvetica", 9, "5. En 01-03, anota el hueco más pequeño entre líneas que distingues"),
        (
            "Helvetica",
            9,
            "   después de transferir: de izquierda a derecha, 0,5 / 1 / 1,5 / 2 / 3 mm.",
        ),
        ("Helvetica", 9, "6. En 06, une los paneles por sus marcas numeradas y mide el desfase."),
        ("Helvetica", 9, "7. Devuelve el formulario y fotos de las transferencias, sin personas."),
        ("", 6, ""),
        ("Helvetica-Bold", 11, "Criterios de aceptación (propuestos; los confirma el propietario)"),
        ("Helvetica", 9, "A. Escala: barra 50 ± 0,5 mm y medidas indicadas ± 1 mm, en todas."),
        ("Helvetica", 9, "B. Line-art (02-04, 06): 2 de 3 tatuadores o más lo valoran «Sí» o"),
        ("Helvetica", 9, "   «Con retoques menores»."),
        (
            "Helvetica",
            9,
            "C. Trazo mínimo: el más fino que 2 de 3 valoran utilizable fija el mínimo.",
        ),
        ("Helvetica", 9, "D. Contornos aproximados (05): 2 de 3 o más los consideran útiles como"),
        ("Helvetica", 9, "   guía de colocación; si no, hará falta un pase de line-art nativo."),
        ("Helvetica", 9, "E. Paneles de manga (06): las marcas casan con 2 mm de desfase o menos."),
        ("", 6, ""),
        ("Helvetica-Bold", 11, "Muestras"),
    ]
    lines += [
        (
            "Helvetica",
            9,
            f"{s.file[:2]}  {s.title} - {s.size_mm[0]:g} x {s.size_mm[1]:g} mm, "
            f"trazo {s.stroke_mm:g} mm. Medir: {s.measure}.",
        )
        for s in samples
    ]
    lines += [
        ("", 6, ""),
        ("Helvetica", 8, "Datos: el formulario pide iniciales y años de experiencia; ningún dato"),
        ("Helvetica", 8, "de clientes ni fotos de personas. Comprueba que el manifiesto coincide."),
    ]
    y = A4[1] - 20 * 72 / 25.4
    for font, size, text in lines:
        if font:
            pdf.setFont(font, size)
            pdf.drawString(20 * 72 / 25.4, y, text)
        y -= size * 1.45
        if y < 20 * 72 / 25.4:
            pdf.showPage()
            y = A4[1] - 20 * 72 / 25.4
    pdf.showPage()
    pdf.save()
    return output.getvalue()


def form_pdf(samples: list[Sample]) -> bytes:
    """One form per tattooer: a row per sample, the columns the criteria need."""
    output = io.BytesIO()
    mm = 72 / 25.4
    width, height = A4[1], A4[0]  # landscape
    pdf = canvas.Canvas(output, pagesize=(width, height), pageCompression=0)
    pdf.setTitle("Inkcraft - formulario de evaluación de plantillas")
    pdf.setFont("Helvetica-Bold", 13)
    pdf.drawString(15 * mm, height - 15 * mm, "Formulario de evaluación de plantillas Inkcraft")
    pdf.setFont("Helvetica", 9)
    pdf.drawString(
        15 * mm,
        height - 22 * mm,
        "Iniciales: ______   Años tatuando: ____   Fecha: __________   "
        "Impresora y papel: ______________________________   Kit (manifiesto): ________",
    )
    columns = [
        ("Muestra", 52),
        ("Barra 50 mm", 22),
        ("Medida", 22),
        ("Limpieza 1-5", 22),
        ("Detalle 1-5", 22),
        ("Transferencia 1-5", 28),
        ("Hueco mínimo", 22),
        ("¿Utilizable?", 34),
        ("Notas", 43),
    ]
    top, row_h = height - 32 * mm, 16 * mm
    x0 = 15 * mm
    total = sum(w for _, w in columns) * mm
    pdf.setFont("Helvetica-Bold", 8)
    x = x0
    for name, w in columns:
        pdf.drawString(x + 1.5 * mm, top - 5 * mm, name)
        x += w * mm
    pdf.setFont("Helvetica", 8)
    rows = len(samples) + 1
    for r in range(rows + 1):
        pdf.line(x0, top - r * row_h if r else top, x0 + total, top - r * row_h if r else top)
    for r, sample in enumerate(samples, start=1):
        y = top - r * row_h - 5 * mm
        pdf.drawString(x0 + 1.5 * mm, y, f"{sample.file[:2]} {sample.title}"[:34])
        pdf.drawString(
            x0 + 1.5 * mm, y - 4 * mm, f"{sample.size_mm[0]:g} x {sample.size_mm[1]:g} mm"
        )
        pdf.drawString(
            x0 + (52 + 22 + 22 + 22 + 22 + 28 + 22 + 1.5) * mm, y, "Sí / Con retoques / No"
        )
    x = x0
    for _, w in [("", 0), *columns]:
        x += w * mm
        pdf.line(x, top, x, top - rows * row_h)
    pdf.line(x0, top, x0, top - rows * row_h)
    pdf.drawString(15 * mm, 12 * mm, "Observaciones generales:")
    pdf.showPage()
    pdf.save()
    return output.getvalue()


def build(
    out: Path, lineart: Path = LINEART_SOURCE, colour: Path = COLOUR_SOURCE
) -> dict[str, Any]:
    """Write the kit into `out` and return its manifest."""
    out.mkdir(parents=True, exist_ok=True)
    makers: list[tuple[Sample, Callable[[], bytes]]] = []
    for index, (name, stroke) in enumerate(STROKES.items(), start=1):
        makers.append(
            (
                Sample(
                    f"0{index}-calibracion-trazo-{name}.pdf",
                    f"Calibración, trazo {name}",
                    "lineart",
                    (100.0, 100.0),
                    stroke,
                    "el marco (100 x 100 mm) y la barra",
                ),
                partial(calibration_pdf, stroke),
            )
        )
    botanical = trace_native_lineart(lineart.read_bytes(), 90, 120, STROKES["medio"])
    makers.append(
        (
            Sample(
                "04-lineart-botanico.pdf",
                "Line-art real (fine line)",
                "lineart",
                (90.0, 120.0),
                STROKES["medio"],
                "el ancho de la página menos 20 mm y la barra",
            ),
            lambda: export_pdf(botanical),
        )
    )
    cronos, _ = trace_colour_artwork(colour.read_bytes(), 140, 366, STROKES["medio"])
    makers.append(
        (
            Sample(
                "05-contornos-color-cronos.pdf",
                "Contornos aprox. (color)",
                "colour_contours",
                (140.0, 366.0),
                STROKES["medio"],
                "la barra; une las piezas A4 por sus marcas",
            ),
            lambda: export_pdf(cronos),
        )
    )
    region = WRAP_REGIONS["lower_leg"]
    sleeve = sleeve_master()
    makers.append(
        (
            Sample(
                "06-manga-paneles.pdf",
                "Manga de gemelo en 4 paneles",
                "lineart",
                (round(region.circumference_mm, 1), region.length_mm),
                sleeve.stroke_mm,
                "el desfase entre marcas numeradas",
            ),
            lambda: export_panels_pdf(panels(unroll(sleeve, region), region, "calf")),
        )
    )
    samples = [sample for sample, _ in makers]
    files: dict[str, bytes] = {"00-protocolo.pdf": protocol_pdf(samples)}
    files.update({sample.file: make() for sample, make in makers})
    files["07-formulario.pdf"] = form_pdf(samples)
    digests = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
    for name, data in files.items():
        (out / name).write_bytes(data)
    manifest: dict[str, Any] = {
        "kit": hashlib.sha256("".join(digests[n] for n in sorted(digests)).encode()).hexdigest()[
            :12
        ],
        "files": digests,
        "samples": [{**sample.__dict__, "size_mm": list(sample.size_mm)} for sample in samples],
    }
    (out / "manifiesto.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("out", type=Path)
    parser.add_argument("--lineart", type=Path, default=LINEART_SOURCE)
    parser.add_argument("--colour", type=Path, default=COLOUR_SOURCE)
    args = parser.parse_args()
    manifest = build(args.out, args.lineart, args.colour)
    print(f"Kit {manifest['kit']} in {args.out}")


if __name__ == "__main__":
    main()
