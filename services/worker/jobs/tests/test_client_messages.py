"""TASK-0072: failures reach the client in plain words."""

from __future__ import annotations

import pytest

from jobs.client_messages import BUSY, CONTENT, GENERIC, UNAVAILABLE, for_client


@pytest.mark.parametrize(
    ("raised", "told"),
    [
        (
            "El proveedor no ha completado la solicitud (400). No se ha generado un resultado.",
            GENERIC,
        ),
        ("FLUX ha superado el tiempo máximo de espera.", BUSY),
        ("BFL ha limitado la frecuencia de solicitudes. Reintenta más tarde.", BUSY),
        ("Sin créditos en Black Forest Labs. Recarga en dashboard.bfl.ai.", UNAVAILABLE),
        # TASK-0100: `generation.studio.OUT_OF_CREDIT`, an OpenAI account without credit.
        ("El proveedor de imágenes se ha quedado sin créditos.", UNAVAILABLE),
        ("BFL rechazó la credencial (revisa BFL_API_KEY).", UNAVAILABLE),
        ("Configura OPENAI_API_KEY en el worker para generar imágenes.", UNAVAILABLE),
        ("La comprobación de contenido de FLUX rechazó la solicitud.", CONTENT),
        ("BFL devolvió una respuesta inválida.", GENERIC),
        ("", GENERIC),
    ],
)
def test_a_technical_failure_is_said_plainly(raised: str, told: str) -> None:
    assert for_client(raised) == told


def test_a_known_stencil_failure_says_what_to_do() -> None:
    told = for_client("Line-art demasiado complejo para un stencil fiable.")
    assert "demasiado detalle" in told and "Line-art" not in told
    assert "proveedor" not in for_client(
        "El proveedor no produjo line-art limpio. Reintenta con otro diseño."
    )


@pytest.mark.parametrize(
    "plain",
    [
        "El tamaño solicitado elimina demasiados detalles. Aumenta las medidas o simplifica el "
        "diseño antes de volver a generar.",
        "Revisa la petición de cambios (entre 3 y 1000 caracteres).",
        "La imagen debe ocupar entre 1 byte y 8 MB.",
    ],
)
def test_a_message_written_for_the_client_passes_unchanged(plain: str) -> None:
    assert for_client(plain) == plain
