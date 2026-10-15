"""Measure a sleeve band's circumference profile on a limb model (TASK-0105, TASK-0110).

Reads the ``_HEIGHT`` and ``_PERIM`` attributes of a GLB built by ``build-limb-model.py`` and
prints the limb's circumference every ``step`` mm down the band, from 30 mm below the knee or
elbow, for ``length`` mm: the median perimeter of the vertices within 3 mm of each height (6 mm,
then 9, where a row has none that close). That
is how ``circumferenceProfileMm`` in ``contracts/reference/body-zones.json`` was measured.

Usage (numpy only)::

    python apps/web/scripts/measure-limb-profile.py apps/web/public/models/lower-leg-feminine.glb 310
"""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

import numpy as np

BELOW_PROXIMAL_MM = 30.0
STEP_MM = 10.0
WINDOW_MM = 3.0


def read_glb(path: Path) -> tuple[dict, dict[str, np.ndarray]]:
    data = path.read_bytes()
    length = struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20 : 20 + length])
    binary = data[20 + length + 8 :]
    attributes = gltf['meshes'][0]['primitives'][0]['attributes']
    out = {}
    for name in ('_HEIGHT', '_PERIM'):
        accessor = gltf['accessors'][attributes[name]]
        view = gltf['bufferViews'][accessor['bufferView']]
        out[name] = np.frombuffer(
            binary, dtype=np.float32, count=accessor['count'], offset=view['byteOffset']
        )
    return gltf['scenes'][0]['extras'], out


def profile(path: Path, length_mm: float) -> list[float]:
    extras, attributes = read_glb(path)
    top = float(extras['proximalMm']) - BELOW_PROXIMAL_MM
    heights, perimeters = attributes['_HEIGHT'], attributes['_PERIM']
    values = []
    for depth in np.arange(0.0, length_mm + STEP_MM / 2, STEP_MM):
        window = WINDOW_MM
        near = np.abs(heights - (top - depth)) < window
        while not near.any():  # a lengthened limb can leave a row without a vertex this close
            window += WINDOW_MM
            near = np.abs(heights - (top - depth)) < window
        values.append(round(float(np.median(perimeters[near])), 1))
    return values


if __name__ == '__main__':
    print(json.dumps(profile(Path(sys.argv[1]), float(sys.argv[2]))))
