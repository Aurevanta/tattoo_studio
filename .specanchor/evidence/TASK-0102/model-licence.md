# TASK-0102 — reference leg model: source, licence and build

Status: VERIFIED by execution on 2026-10-14 (download, build and hashes below).

## Source

- File: `makehuman/data/3dobjs/base.obj` (MakeHuman base mesh `hm08`), downloaded from
  `https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/3dobjs/base.obj`.
- SHA-256 of the downloaded file: `8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c`.
- The file is not committed; only the derived model is.

## Licence

- The file's own header reads: "This asset was explicitly released as CC0 in september 2020."
  It names Data Collection AB, Joel Palmius and Jonas Hauquier as the copyright holders at release.
- `LICENSE.md` of the same repository, section C: the base mesh and proxies, targets, textures,
  clothes and poses "have been released under CC0 1.0 Universal". Section D: exports and other
  derived output carry no claim from the project.
- `LICENSE.ASSETS.md` holds the CC0 1.0 Universal legal text.
- The derived model therefore needs no attribution. Its scene `extras` still name the source and
  the licence, and `leg-wrap.test.ts` asserts both.

## Build

```sh
python apps/web/scripts/build-leg-model.py <path>/base.obj apps/web/public/models/lower-leg.glb
```

- Toolchain: Python 3, numpy 2.5.3.
- Output: `apps/web/public/models/lower-leg.glb`, 1 169 528 bytes, SHA-256
  `5c05c27c9182587e985b0c4cb18cc3a2b4c763eea3089e398ba845bdb2efb0c4`.
- A second build gave the same hash.
- Contents: 22 461 vertices and 44 918 triangles (left lower leg, two Catmull-Clark steps, cut 70 mm
  above the knee joint and capped).
- Measured on the model: knee joint 381.7 mm above the ankle joint; circumference 329.3 mm below
  the knee, 343.7 mm at the calf (266.4 mm), 203.8 mm at the ankle.

## Ring tables on known shapes

Status: VERIFIED by execution on 2026-10-14 (`ring_tables` imported from the build script).

| Shape | Perimeter error | s at front / outside / back / inside |
|---|---|---|
| Cylinder of radius 55 mm, off-axis centre | 0.003 % | 0.0000 / 0.2500 / 0.4986 / 0.7500 |
| Frustum, radius 35 → 60 mm | 0.003 % | same |

The 0.4986 at the back is the sampling of the angle grid at ±π (720 directions), not a mapping
error.
