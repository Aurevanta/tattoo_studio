/**
 * Where a design goes on the body (TASK-0108).
 *
 * The worker serves every result with the zone of the brief it was made from, so a design opened
 * from the history knows it without the consultation that made it. A result served before that
 * falls back to the open consultation, as the studio did until TASK-0108, and only when the design
 * belongs to it.
 */
import { BODY_ZONE_SPANS, isSleeve } from '@tattoo/contracts';
import type { GeneratedTattooArtifact } from '@/types/generation';
import { isLimbZone, type LimbSide, type LimbZone } from './limb-wrap';
import { isBodyZone, type BodySide } from './body-zones';

export interface DesignZone {
  bodyPart: string;
  orientation?: string | undefined;
  side?: string | undefined;
}

/** The design's own zone, or the open consultation's when the design is one of its own. */
export function designZone(
  artifact: Pick<GeneratedTattooArtifact, 'briefId' | 'placement'>,
  consultation:
    | {
        sessionId: string;
        placement?:
          | {
              bodyPart?: string | undefined;
              orientation?: string | undefined;
              side?: string | undefined;
            }
          | undefined;
      }
    | undefined,
): DesignZone | undefined {
  if (artifact.placement) return artifact.placement;
  const open = consultation?.placement;
  return artifact.briefId === consultation?.sessionId && open?.bodyPart
    ? { bodyPart: open.bodyPart, orientation: open.orientation, side: open.side }
    : undefined;
}

/** The 3D view for a lower-leg or forearm design (ADR-0033, ADR-0034). */
export function limbViewOf(
  zone: DesignZone | undefined,
  size: { widthMm: number },
): { zone: LimbZone; side: LimbSide; wraps: boolean } | undefined {
  if (!zone || !isLimbZone(zone.bodyPart)) return undefined;
  return {
    zone: zone.bodyPart,
    side: zone.side === 'right' ? 'right' : 'left',
    wraps: isSleeve(zone, size),
  };
}

/** The reference span of the design's zone, for «Ocupar toda la zona» (TASK-0073). */
export function zoneSpanOf(
  zone: DesignZone | undefined,
): { widthMm: number; heightMm: number } | undefined {
  return zone ? BODY_ZONE_SPANS[zone.bodyPart] : undefined;
}

/** TASK-0109 (ADR-0037): the whole-body 3D view, for every zone the limb view does not cover. */
export function bodyViewOf(
  zone: DesignZone | undefined,
): { zone: string; side: BodySide } | undefined {
  if (!zone || !isBodyZone(zone.bodyPart)) return undefined;
  return { zone: zone.bodyPart, side: zone.side === 'right' ? 'right' : 'left' };
}
