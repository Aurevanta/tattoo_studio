'use client';
import { useState, type ReactNode } from 'react';

import { LimbViewer3D } from './LimbViewer3D';

/**
 * The landing example on the reference lower leg in 3D (TASK-0106). The viewer, three.js and the
 * model load only when the visitor asks for it, so the landing stays light.
 */
export function LandingLimbPreview({
  designUrl,
  size,
}: {
  designUrl: string;
  size: { widthMm: number; heightMm: number };
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div className="leg-view-toggle landing-3d">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? 'Ocultar la vista 3D' : 'Girarlo en 3D alrededor de la pierna'}
      </button>
      {open && <LimbViewer3D designUrl={designUrl} size={size} zone="calf" />}
    </div>
  );
}
