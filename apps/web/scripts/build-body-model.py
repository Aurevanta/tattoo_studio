"""Build the reference body for the whole-body 3D preview (TASK-0109, ADR-0037).

Input: the MakeHuman base mesh ``hm08`` (``makehuman/data/3dobjs/base.obj``), released as CC0 in
September 2020 (source and SHA-256 in ``.specanchor/evidence/TASK-0102/model-licence.md``).

Output: ``apps/web/public/models/body.glb``. It is the ``body`` group only (no genital helper, no
clothing) after one Catmull-Clark step, in millimetres. The floor is at y = 0, the body faces +Z,
and its left side is on +X. The scene extras carry, for each of the 21 zones the limb models do
not cover, how a design is laid there. ``lib/body-zones.ts`` reads the extras, and its shader
twin (``lib/body-scene.ts``) runs the projection:

- ``plane``: projected along ``normal`` onto the skin round ``origin`` (a point on the skin),
  with ``right`` and ``up`` across it. It is limited to skin facing the projector and to a depth
  slab (``behindMm``, ``frontMm``).
- ``cylinder``: round the axis ``up`` through ``origin``, with ``normal`` as fraction 0 and the arc
  measured at the skin's own distance from the axis. It is limited to ``radiusMm``.

Usage (numpy only)::

    python apps/web/scripts/build-body-model.py path/to/base.obj apps/web/public/models/body.glb
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np

_spec = importlib.util.spec_from_file_location(
    'build_limb_model', Path(__file__).with_name('build-limb-model.py')
)
assert _spec and _spec.loader
limb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(limb)

DM_TO_MM = 100.0


def unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v)


def ray_hit(vertices: np.ndarray, triangles: np.ndarray, start: np.ndarray, direction: np.ndarray) -> np.ndarray:
    """The first point where the ray from ``start`` along ``direction`` meets the mesh."""
    tri = vertices[triangles]
    e1 = tri[:, 1] - tri[:, 0]
    e2 = tri[:, 2] - tri[:, 0]
    p = np.cross(direction, e2)
    det = (e1 * p).sum(axis=1)
    ok = np.abs(det) > 1e-12
    inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
    s = start - tri[:, 0]
    u = (s * p).sum(axis=1) * inv
    q = np.cross(s, e1)
    v = (q * direction).sum(axis=1) * inv
    t = (e2 * q).sum(axis=1) * inv
    hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-6)
    if not hit.any():
        raise SystemExit(f'no surface from {start} along {direction}')
    return start + direction * t[hit].min()


# Plane zones: where inside the body (x, y in dm, MakeHuman frame; z is taken from the body's own
# section there), the outward direction, a hint for
# "up" on the design, how far behind the skin's centre the projection may reach (mm), whether the
# zone has a left and a right, and whether the skin there bends in two directions.
PLANES = {
    'chest': ((0.85, 4.5), (0, 0, 1), (0, 1, 0), 140, True, False),
    'sternum': ((0.0, 4.2), (0, 0, 1), (0, 1, 0), 140, False, False),
    'stomach': ((0.0, 2.4), (0, 0, 1), (0, 1, 0), 160, False, False),
    'ribs': ((0.9, 3.6), (1, 0, 0), (0, 1, 0), 120, True, False),
    'hip': ((0.9, 0.8), (1, 0, 0.35), (0, 1, 0), 120, True, False),
    'upper_back': ((0.0, 4.9), (0, 0, -1), (0, 1, 0), 140, False, False),
    'lower_back': ((0.0, 1.5), (0, 0, -1), (0, 1, 0), 140, False, False),
    'spine': ((0.0, 3.4), (0, 0, -1), (0, 1, 0), 140, False, False),
    'shoulder': ((1.6, 5.0), (0.75, 0.65, 0), (0, 1, 0), 90, True, False),
    'collarbone': ((0.75, 5.0), (0, 0.45, 1), (0, 1, 0), 90, True, False),
    'neck': ((0.0, 6.15), (1, 0, 0.25), (0, 1, 0), 60, True, True),
    'behind_ear': ((0.3, 7.0), (0.6, 0, -0.8), (0, 1, 0), 50, True, True),
}

# Cylinder zones: the distal and proximal joints, where along that axis the design sits (share of
# the length), fraction 0 round it, the radius beyond which skin belongs to something else (mm).
CYLINDERS = {
    'thigh_front': ('joint-l-knee', 'joint-l-upper-leg', 0.5, 'front', 110),
    'thigh_outer': ('joint-l-knee', 'joint-l-upper-leg', 0.5, 'outside', 110),
    'upper_arm_inner': ('joint-l-elbow', 'joint-l-shoulder', 0.45, 'inside', 65),
    'upper_arm_outer': ('joint-l-elbow', 'joint-l-shoulder', 0.45, 'outside', 65),
    'wrist_inner': ('joint-l-hand', 'joint-l-elbow', 0.12, 'palm', 55),
    'wrist_outer': ('joint-l-hand', 'joint-l-elbow', 0.12, 'back', 55),
    'finger': ('joint-l-finger-2-4', 'joint-l-finger-2-1', 0.5, 'back', 14),
}

# Zones whose outward direction points at another part of the body (the inner arm faces the
# torso; the ribs are half hidden by the hanging arm): the camera looks from here instead.
VIEWS = {
    'upper_arm_inner': (-0.2, -0.6, 0.8),
    'ribs': (1.0, 0.0, 0.75),
}

SPECIAL = {'hand', 'foot'}
COMPLEX = {'neck', 'behind_ear', 'hand', 'foot', 'finger'}


def main(source: Path, target: Path) -> None:
    vertices, groups = limb.read_obj(source)
    ground = limb.joint(vertices, groups, 'joint-ground')

    def j(name: str) -> np.ndarray:
        return limb.joint(vertices, groups, name)

    body = np.array(groups['body'])
    used, remap = np.unique(body, return_inverse=True)
    sub_vertices = vertices[used]
    sub_quads = remap.reshape(-1, 4)
    sub_vertices, sub_quads = limb.catmull_clark(sub_vertices, sub_quads)
    triangles = np.concatenate([sub_quads[:, [0, 1, 2]], sub_quads[:, [0, 2, 3]]])

    def to_mm(point: np.ndarray) -> np.ndarray:
        return (point - np.array([0.0, ground[1], 0.0])) * DM_TO_MM

    mesh_mm = to_mm(sub_vertices)
    palm = limb.palm_direction(vertices, groups)

    zones: dict[str, dict] = {}

    def plane(name: str, inside: np.ndarray, outward: np.ndarray, up_hint: np.ndarray, behind: float, paired: bool) -> None:
        d = unit(outward)
        surface = ray_hit(mesh_mm, triangles, to_mm(inside), d)
        up = unit(up_hint - d * up_hint.dot(d))
        right = np.cross(up, d)
        zones[name] = {
            'mode': 'plane',
            'origin': surface,
            'normal': d,
            'up': up,
            'right': right,
            'surface': surface,
            'behindMm': behind,
            'frontMm': 40.0,
            'paired': paired,
            'complex': name in COMPLEX,
        }

    skin = vertices[np.unique(body)]

    def inside(x: float, y: float) -> np.ndarray:
        """A point inside the body at (x, y): the middle of its section's depth there."""
        near = skin[(np.abs(skin[:, 1] - y) < 0.1) & (np.abs(skin[:, 0] - x) < 0.2)]
        return np.array([x, y, (near[:, 2].min() + near[:, 2].max()) / 2])

    for name, (xy, outward, up_hint, behind, paired, _) in PLANES.items():
        plane(name, inside(*xy), np.array(outward, float), np.array(up_hint, float), behind, paired)

    # The back of the hand, upright when the arm hangs; the top of the foot, its top towards the leg.
    hand = j('joint-l-hand')
    knuckle = j('joint-l-finger-3-2')
    plane('hand', (hand + knuckle) / 2, -palm, j('joint-l-elbow') - hand, 40, True)
    ankle = j('joint-l-ankle')
    toes = j('joint-l-foot-2')
    plane('foot', ankle + (toes - ankle) * 0.45 - np.array([0, 0.25, 0]), np.array([0, 1.0, 0.55]), ankle - toes, 60, True)

    for name, (distal, proximal, share, zero, radius) in CYLINDERS.items():
        a, b = j(distal), j(proximal)
        up = unit(b - a)
        directions = {
            'front': np.array([0, 0, 1.0]),
            'outside': np.array([1.0, 0, 0]),
            'inside': np.array([-1.0, 0, 0]),
            'palm': palm,
            'back': -palm,
        }
        z0 = directions[zero]
        if zero in ('outside', 'inside') and name.startswith('upper_arm'):
            # The arm hangs at an angle: its outside is the side away from the body in the arm's
            # own plane, not the world's +X.
            lateral = np.array([up[1], -up[0], 0.0]) * (1 if up[1] > 0 else -1)
            lateral = -lateral if lateral[0] < 0 else lateral
            z0 = lateral if zero == 'outside' else -lateral
        z0 = unit(z0 - up * z0.dot(up))
        centre = to_mm(a + (b - a) * share)
        surface = ray_hit(mesh_mm, triangles, centre, z0)
        zones[name] = {
            'mode': 'cylinder',
            'origin': centre,
            'normal': z0,
            'up': up,
            'right': np.cross(up, z0),
            'surface': surface,
            'radiusMm': float(radius),
            'lengthMm': float(np.linalg.norm(b - a) * DM_TO_MM),
            'paired': True,
            'complex': name in COMPLEX,
        }

    for name, view in VIEWS.items():
        zones[name]['view'] = unit(np.array(view, float))

    def tidy(value):  # noqa: ANN001, ANN202
        if isinstance(value, np.ndarray):
            return [round(float(x), 2 if abs(x) > 2 else 4) for x in value]
        if isinstance(value, float):
            return round(value, 1)
        return value

    extras = {
        'source': 'MakeHuman base mesh hm08, makehuman/data/3dobjs/base.obj',
        'licence': 'CC0 1.0 Universal',
        'units': 'mm',
        'body': 'neutral',
        'side': 'left',
        'heightMm': round(float(mesh_mm[:, 1].max()), 1),
        'zones': {name: {k: tidy(v) for k, v in zone.items()} for name, zone in sorted(zones.items())},
    }
    normals = limb.vertex_normals(mesh_mm, triangles)
    target.parent.mkdir(parents=True, exist_ok=True)
    limb.write_glb(target, {'POSITION': mesh_mm, 'NORMAL': normals}, triangles, extras, 'body')
    print(json.dumps({'vertices': len(mesh_mm), 'triangles': len(triangles), 'heightMm': extras['heightMm'], 'zones': len(zones)}))


if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]))
