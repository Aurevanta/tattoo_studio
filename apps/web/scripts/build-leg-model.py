"""Build the reference lower leg for the 3D preview (TASK-0101, ADR-0033).

Input: the MakeHuman base mesh ``hm08`` (``makehuman/data/3dobjs/base.obj``), released as CC0 in
September 2020. Output: ``apps/web/public/models/lower-leg.glb``, the client's left lower leg from
just above the knee to the sole, in millimetres, with the limb axis on +Y (ankle joint at the
origin), the front on +Z and the outside of the left leg on +X.

Each vertex carries, besides its position and normal:

- ``_HEIGHT``: height along the limb axis, in mm.
- ``_PERIM``: the perimeter of the leg's cross-section at that height, in mm.
- ``_RING``: (cos 2πs, sin 2πs), where s in [0, 1) is the arc-length fraction around that
  cross-section, starting at the front and growing towards the outside. Interpolating the unit
  vector rather than s itself keeps the ring free of a seam.

So the viewer places a design in true millimetres around the leg without hand-made UVs.

Usage (numpy only)::

    python apps/web/scripts/build-leg-model.py path/to/base.obj apps/web/public/models/lower-leg.glb
"""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

import numpy as np

DM_TO_MM = 100.0  # MakeHuman base mesh units are decimetres.
ABOVE_KNEE_MM = 70.0  # How much of the knee the preview keeps above the joint.
SLICES = 160
ANGLES = 720


def read_obj(path: Path) -> tuple[np.ndarray, dict[str, list[list[int]]]]:
    vertices: list[list[float]] = []
    groups: dict[str, list[list[int]]] = {}
    current = ''
    for line in path.read_text(encoding='utf-8').splitlines():
        if line.startswith('v '):
            vertices.append([float(t) for t in line.split()[1:4]])
        elif line.startswith('g '):
            current = line.split()[1]
        elif line.startswith('f '):
            groups.setdefault(current, []).append(
                [int(t.split('/')[0]) - 1 for t in line.split()[1:]]
            )
    return np.array(vertices, dtype=np.float64), groups


def joint(vertices: np.ndarray, groups: dict[str, list[list[int]]], name: str) -> np.ndarray:
    ids = sorted({i for face in groups[name] for i in face})
    return vertices[ids].mean(axis=0)


def catmull_clark(vertices: np.ndarray, quads: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """One Catmull-Clark step on a quad mesh, with boundary rules for the open cut."""
    n_v = len(vertices)
    face_points = vertices[quads].mean(axis=1)
    raw = np.stack([quads, np.roll(quads, -1, axis=1)], axis=2).reshape(-1, 2)
    keyed = np.sort(raw, axis=1)
    edges, edge_of = np.unique(keyed, axis=0, return_inverse=True)
    edge_of = edge_of.reshape(-1)
    face_of = np.repeat(np.arange(len(quads)), 4)
    edge_face_sum = np.zeros((len(edges), 3))
    edge_face_count = np.zeros(len(edges))
    np.add.at(edge_face_sum, edge_of, face_points[face_of])
    np.add.at(edge_face_count, edge_of, 1)
    midpoints = vertices[edges].mean(axis=1)
    boundary = edge_face_count == 1
    edge_points = np.where(
        boundary[:, None],
        midpoints,
        (vertices[edges[:, 0]] + vertices[edges[:, 1]] + edge_face_sum)
        / (2 + edge_face_count)[:, None],
    )

    # Interior vertices: (Q + 2R + (n - 3) P) / n.
    q_sum = np.zeros((n_v, 3))
    q_count = np.zeros(n_v)
    np.add.at(q_sum, quads.reshape(-1), np.repeat(face_points, 4, axis=0))
    np.add.at(q_count, quads.reshape(-1), 1)
    r_sum = np.zeros((n_v, 3))
    valence = np.zeros(n_v)
    for side in (0, 1):
        np.add.at(r_sum, edges[:, side], midpoints)
        np.add.at(valence, edges[:, side], 1)
    q = q_sum / np.maximum(q_count, 1)[:, None]
    r = r_sum / np.maximum(valence, 1)[:, None]
    n = np.maximum(valence, 3)[:, None]
    moved = (q + 2 * r + (n - 3) * vertices) / n

    # Boundary vertices: 3/4 P + 1/8 (a + b) over their two boundary neighbours.
    b_sum = np.zeros((n_v, 3))
    b_count = np.zeros(n_v)
    for side, other in ((0, 1), (1, 0)):
        np.add.at(b_sum, edges[boundary, side], vertices[edges[boundary, other]])
        np.add.at(b_count, edges[boundary, side], 1)
    on_boundary = b_count == 2
    moved[on_boundary] = 0.75 * vertices[on_boundary] + 0.125 * b_sum[on_boundary]
    moved[b_count > 2] = vertices[b_count > 2]

    new_vertices = np.concatenate([moved, edge_points, face_points])
    e_base = n_v
    f_base = n_v + len(edges)
    e = edge_of.reshape(-1, 4) + e_base  # e[:, k] is the edge from corner k to corner k + 1.
    f = np.arange(len(quads)) + f_base
    new_quads = np.concatenate(
        [np.stack([quads[:, k], e[:, k], f, e[:, k - 1]], axis=1) for k in range(4)]
    )
    return new_vertices, new_quads


def cap_top(vertices: np.ndarray, triangles: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Close the open cut above the knee with a fan from its centroid."""
    raw = np.stack([triangles, np.roll(triangles, -1, axis=1)], axis=2).reshape(-1, 2)
    keyed = np.sort(raw, axis=1)
    _, inverse, counts = np.unique(keyed, axis=0, return_inverse=True, return_counts=True)
    directed = raw[counts[inverse.reshape(-1)] == 1]
    succ = {int(a): int(b) for a, b in directed}
    seen: set[int] = set()
    loops = []
    for a in succ:
        if a in seen:
            continue
        loop = [a]
        seen.add(a)
        b = succ[a]
        while b != a and b not in seen:
            loop.append(b)
            seen.add(b)
            b = succ[b]
        loops.append(loop)
    top = max(loops, key=lambda lp: vertices[lp, 1].mean())
    centre = vertices[top].mean(axis=0)
    c = len(vertices)
    fan = np.array([[top[i + 1 if i + 1 < len(top) else 0], top[i], c] for i in range(len(top))])
    return np.concatenate([vertices, centre[None]]), np.concatenate([triangles, fan])


def ring_tables(
    vertices: np.ndarray, triangles: np.ndarray, heights: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """For each slice height: perimeter (mm), centre (x, z) and s(theta) on ANGLES directions."""
    angles = np.linspace(-np.pi, np.pi, ANGLES, endpoint=False)
    perimeters = np.zeros(len(heights))
    centres = np.zeros((len(heights), 2))
    fractions = np.zeros((len(heights), ANGLES))
    tri = vertices[triangles]
    for k, h in enumerate(heights):
        points = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            ya, yb = tri[:, a, 1], tri[:, b, 1]
            cross = (ya - h) * (yb - h) < 0
            t = (h - ya[cross]) / (yb[cross] - ya[cross])
            points.append(tri[cross, a] + t[:, None] * (tri[cross, b] - tri[cross, a]))
        pts = np.concatenate(points)[:, [0, 2]]
        centre = pts.mean(axis=0)
        theta = np.arctan2(pts[:, 0] - centre[0], pts[:, 1] - centre[1])  # 0 = front (+Z).
        order = np.argsort(theta)
        ring = pts[order]
        ring_theta = theta[order]
        seg = np.linalg.norm(np.roll(ring, -1, axis=0) - ring, axis=1)
        perimeter = seg.sum()
        arc = np.concatenate([[0.0], np.cumsum(seg)[:-1]])
        # Arc length measured from the front (theta = 0), growing towards +X (the outside).
        front = np.interp(0.0, ring_theta, arc, period=2 * np.pi)
        s = ((arc - front) % perimeter) / perimeter
        unwrapped = np.unwrap(2 * np.pi * s) / (2 * np.pi)
        fractions[k] = np.interp(angles, ring_theta, unwrapped, period=2 * np.pi) % 1.0
        perimeters[k] = perimeter
        centres[k] = centre
    return perimeters, centres, fractions


def vertex_normals(vertices: np.ndarray, triangles: np.ndarray) -> np.ndarray:
    tri = vertices[triangles]
    face = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    normals = np.zeros_like(vertices)
    for k in range(3):
        np.add.at(normals, triangles[:, k], face)
    return normals / np.maximum(np.linalg.norm(normals, axis=1), 1e-9)[:, None]


def write_glb(path: Path, attributes: dict[str, np.ndarray], indices: np.ndarray, extras: dict) -> None:
    blobs: list[bytes] = []
    views = []
    accessors = []
    offset = 0
    kinds = {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3'}

    def add(data: np.ndarray, component: int, target: int, kind: str, minmax: bool) -> int:
        nonlocal offset
        raw = data.tobytes()
        pad = (-len(raw)) % 4
        blobs.append(raw + b'\0' * pad)
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(raw), 'target': target})
        accessor = {
            'bufferView': len(views) - 1,
            'componentType': component,
            'count': len(data),
            'type': kind,
        }
        if minmax:
            accessor['min'] = data.min(axis=0).tolist()
            accessor['max'] = data.max(axis=0).tolist()
        accessors.append(accessor)
        offset += len(raw) + pad
        return len(accessors) - 1

    mapping = {}
    for name, data in attributes.items():
        data = np.ascontiguousarray(data, dtype=np.float32)
        width = 1 if data.ndim == 1 else data.shape[1]
        mapping[name] = add(data, 5126, 34962, kinds[width], name == 'POSITION')
    index_type = 5123 if indices.max() < 65536 else 5125
    flat = indices.reshape(-1).astype(np.uint16 if index_type == 5123 else np.uint32)
    index_accessor = add(flat, index_type, 34963, 'SCALAR', False)

    gltf = {
        'asset': {'version': '2.0', 'generator': 'tattoo_studio build-leg-model.py'},
        'scene': 0,
        'scenes': [{'nodes': [0], 'extras': extras}],
        'nodes': [{'mesh': 0, 'name': 'lower-leg'}],
        'meshes': [{'primitives': [{'attributes': mapping, 'indices': index_accessor}]}],
        'buffers': [{'byteLength': offset}],
        'bufferViews': views,
        'accessors': accessors,
    }
    body = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    body += b' ' * ((-len(body)) % 4)
    binary = b''.join(blobs)
    total = 12 + 8 + len(body) + 8 + len(binary)
    with path.open('wb') as out:
        out.write(struct.pack('<4sII', b'glTF', 2, total))
        out.write(struct.pack('<I4s', len(body), b'JSON') + body)
        out.write(struct.pack('<I4s', len(binary), b'BIN\0') + binary)


def main(source: Path, target: Path) -> None:
    vertices, groups = read_obj(source)
    knee = joint(vertices, groups, 'joint-l-knee')
    ankle = joint(vertices, groups, 'joint-l-ankle')
    ground_y = joint(vertices, groups, 'joint-ground')[1]

    # Frame: ankle joint at the origin, limb axis on +Y, front on +Z, outside (+X) kept.
    up = (knee - ankle) / np.linalg.norm(knee - ankle)
    front = np.array([0.0, 0.0, 1.0])
    front = front - up * front.dot(up)
    front /= np.linalg.norm(front)
    side = np.cross(up, front)
    if side[0] < 0:  # Keep the outside of the left leg (+X in MakeHuman) on +X.
        side = -side
    frame = np.stack([side, up, front])

    body = np.array(groups['body'])
    knee_h = (knee - ankle).dot(up)
    local = (vertices - ankle) @ frame.T
    keep = np.all((vertices[body, 0] > 0.15) & (local[body, 1] < knee_h + 1.6), axis=1)
    quads = body[keep]
    used, remap = np.unique(quads, return_inverse=True)
    sub_vertices = local[used]
    sub_quads = remap.reshape(-1, 4)
    for _ in range(2):
        sub_vertices, sub_quads = catmull_clark(sub_vertices, sub_quads)
    sub_vertices *= DM_TO_MM
    knee_mm = knee_h * DM_TO_MM
    top_mm = knee_mm + ABOVE_KNEE_MM

    # Keep every face that reaches below the cut, then lay the vertices above it onto the cut
    # plane: the mesh rows are not level, and a cut by whole faces would leave a jagged rim.
    lowest = sub_vertices[sub_quads][:, :, 1].min(axis=1)
    sub_quads = sub_quads[lowest < top_mm]
    used, remap = np.unique(sub_quads, return_inverse=True)
    sub_vertices = sub_vertices[used]
    sub_quads = remap.reshape(-1, 4)
    sub_vertices[:, 1] = np.minimum(sub_vertices[:, 1], top_mm)
    triangles = np.concatenate([sub_quads[:, [0, 1, 2]], sub_quads[:, [0, 2, 3]]])
    sub_vertices, triangles = cap_top(sub_vertices, triangles)

    sole_mm = sub_vertices[:, 1].min()
    heights = np.linspace(20.0, top_mm - 15.0, SLICES)
    perimeters, centres, fractions = ring_tables(sub_vertices, triangles[:-1], heights)

    h = np.clip(sub_vertices[:, 1], heights[0], heights[-1])
    level = np.interp(h, heights, np.arange(len(heights)))
    k0 = np.floor(level).astype(int)
    k1 = np.minimum(k0 + 1, len(heights) - 1)
    w = level - k0
    centre = centres[k0] * (1 - w)[:, None] + centres[k1] * w[:, None]
    theta = np.arctan2(sub_vertices[:, 0] - centre[:, 0], sub_vertices[:, 2] - centre[:, 1])
    a_idx = ((theta + np.pi) / (2 * np.pi) * ANGLES).astype(int) % ANGLES
    s0 = fractions[k0, a_idx]
    s1 = fractions[k1, a_idx]
    ds = ((s1 - s0 + 0.5) % 1.0) - 0.5
    s = (s0 + w * ds) % 1.0
    perim = perimeters[k0] * (1 - w) + perimeters[k1] * w

    normals = vertex_normals(sub_vertices, triangles)
    ring = np.stack([np.cos(2 * np.pi * s), np.sin(2 * np.pi * s)], axis=1)

    def circumference(at_mm: float) -> float:
        return float(np.interp(at_mm, heights, perimeters))

    calf_band = (heights > 0.45 * knee_mm) & (heights < 0.85 * knee_mm)
    calf_mm = float(heights[calf_band][np.argmax(perimeters[calf_band])])
    extras = {
        'source': 'MakeHuman base mesh hm08, makehuman/data/3dobjs/base.obj',
        'licence': 'CC0 1.0 Universal',
        'units': 'mm',
        'side': 'left',
        'ankleMm': 0.0,
        'kneeMm': round(float(knee_mm), 1),
        'topMm': round(float(top_mm), 1),
        'soleMm': round(float(sole_mm), 1),
        'groundMm': round(float((ground_y - ankle[1]) * DM_TO_MM), 1),
        'calfMm': round(calf_mm, 1),
        'circumferenceMm': {
            'belowKnee': round(circumference(knee_mm - 40.0), 1),
            'calf': round(circumference(calf_mm), 1),
            'ankle': round(circumference(60.0), 1),
        },
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    write_glb(
        target,
        {
            'POSITION': sub_vertices,
            'NORMAL': normals,
            '_RING': ring,
            '_PERIM': perim,
            '_HEIGHT': sub_vertices[:, 1],
        },
        triangles,
        extras,
    )
    print(json.dumps({**extras, 'vertices': len(sub_vertices), 'triangles': len(triangles)}))


if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]))
