# TASK-0103: reference limbs, build and checks

Status: VERIFIED by execution on 2026-10-14.

## Source and licence

The source and licence are unchanged from `evidence/TASK-0102/model-licence.md`: the MakeHuman base
mesh `hm08`, CC0 1.0. SHA-256 of `base.obj`:
`8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c`.

## Build

```sh
python apps/web/scripts/build-limb-model.py <path>/base.obj leg apps/web/public/models/lower-leg.glb
python apps/web/scripts/build-limb-model.py <path>/base.obj forearm apps/web/public/models/forearm.glb
```

The script was renamed from `build-leg-model.py`. The leg's geometry is unchanged; its scene
extras now use limb-neutral names (`proximalMm`, `bellyMm`, `endMm`, `circumferenceMm.proximal`,
`belly`, `distal`, `distalAtMm`, `limb`, `scale`), so its hash changed.

| Model | Bytes | SHA-256 |
|---|---|---|
| `lower-leg.glb` | 1 169 560 | `97f2028c46983f8f1fdfdb0e352683b9cc7306e9f3ad467bc033762770da88b1` |
| `forearm.glb` | 1 572 300 | `f4cdfc102db97906957b35f892ea2a10873573c91c070dd40485c4981c9f6db2` |

A second build of both gave the same hashes.

## Measured on the models

- **Leg:** knee 381.7 mm above the ankle joint; circumference 329.3 mm below the knee, 343.7 mm at
  the calf (266.4 mm up), 203.8 mm at 60 mm up.
- **Forearm:**
  - The base mesh measures 226.3 mm from wrist to elbow. It is scaled uniformly by 1.1709 to 265 mm,
    a typical adult's.
  - Circumference 253.7 mm below the elbow, 254.7 mm at its widest (212.5 mm up), 155.5 mm at 30 mm
    above the wrist.
  - The cut is 25 mm above the elbow. At 60 mm it sliced the bent upper arm and left a notch, seen
    in a screenshot.

## Orientation

Status: VERIFIED by execution: mean position of vertices by ring fraction, and screenshots.

- **Leg:** fraction 0 has mean z +27 mm (the front), 0.25 mean x +57 mm (the outside), 0.5 mean
  z −75 mm (the back).
- **Forearm:** fraction 0 is the palm side, found as the hand's thinnest direction, signed towards
  where the fingers curl; 0.25 is the thumb side.
- **Screenshots:** with the design at fraction 0, «Interior» shows the palm and the design;
  «Exterior» shows the back of the hand.
