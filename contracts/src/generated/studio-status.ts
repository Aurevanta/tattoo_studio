/**
 * GENERATED FILE - DO NOT EDIT.
 *
 * Source: contracts/schemas/
 * Regenerate: pnpm --filter @tattoo/contracts generate
 *
 * Editing this by hand fails the codegen reproducibility check.
 */

export type StudioJobStatus = {
  jobId: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  result: GeneratedTattooArtifact | null;
  error: string | null;
  /**
   * TASK-0076 (audit UX-03): the pipeline step a running job is in, as the worker reports it. Absent when unknown. `seam` (TASK-0104) is a sleeve's join being redrawn.
   */
  stage?: 'references' | 'skin' | 'drawing' | 'seam' | 'stencil' | 'placing' | 'finishing';
  /**
   * TASK-0076: for a queued job, how many jobs (including it) are ahead in the studio's queue.
   */
  queuePosition?: number;
};

export interface GeneratedTattooArtifact {
  designId: string;
  briefId: string;
  briefRevision: number;
  size: {
    widthMm: number;
    heightMm: number;
  };
  master: StudioAsset;
  stencil: StudioAsset;
  stencilMirror: StudioAsset;
  pdf: StudioAsset;
  pdfMirror: StudioAsset;
  panels?: StudioAsset;
  panelsMirror?: StudioAsset;
  mockup: StudioAsset;
  referenceAnalysis: string;
  reviewRequired: true;
  backgroundKind: 'own_photo' | 'generated_anatomy';
  transform: {
    xPx: number;
    yPx: number;
    widthPx: number;
    heightPx: number;
    method: 'geometric-multiply' | 'fresh-ink-composite';
    /**
     * Approximate cylindrical warp in radians, not inferred anatomy.
     */
    curvature?: number;
    /**
     * Illustrative narrowing towards the lower calf, not measured anatomy.
     */
    taper?: number;
    scaleCalibrated: boolean;
    /**
     * True only when a constrained AI finish replaced the geometric composite after passing the geometry check against it (ADR-0016, ADR-0018). The stencil never derives from it.
     */
    generativePostprocess: boolean;
    /**
     * What happened to the AI finish when one was attempted (ADR-0018). Anything but accepted means the geometric composite was delivered.
     */
    finish?: 'accepted' | 'declined' | 'unavailable' | 'rejected_geometry' | 'rejected_output';
    /**
     * How the design was fitted to the body silhouette read from the photograph (TASK-0039). A silhouette, not depth.
     */
    bodyFit?: {
      scale: number;
      spill: number;
      taper: number;
    };
    sourceCropPx?: {
      left: number;
      top: number;
      width: number;
      height: number;
    };
    /**
     * How strongly the ink is attenuated where the photograph's own shading says the body turns away. An illustrative approximation of surface form, not recovered depth, and never a displacement: the artwork's geometry is authoritative (ADR-0014, MOCKUP-INV-001).
     */
    surface?: number;
    /**
     * Strength of the fresh-ink reddening around the strokes. 0 when the render is a plain multiply. Illustrative, never a clinical prediction of healing (PROD-INV-003).
     */
    freshness?: number;
    /**
     * TASK-0107 (ADR-0036): a placement the client chose in the live editor. Centre as a fraction of the skin image; width and height of the design before rotation, as fractions of the image's width and height; angle in degrees, clockwise.
     */
    placement?: {
      centreX: number;
      centreY: number;
      width: number;
      height: number;
      angle: number;
    };
    /**
     * TASK-0107 (ADR-0036): how far the design's width-to-height ratio has been stretched from the drawing as generated, accumulated across versions. 1 = undeformed.
     */
    stretch?: number;
  };
  notice: string;
  /**
   * TASK-0086 (audit ARQ-03): how the stencil was obtained, so the client and the tattooer know how far to trust it. `lineart`: traced from a dedicated line-art pass; `colour_contours`: approximate contours of a colour or shaded design. `simplification`: 0 when traced at full detail, 1 to 3 for each coarser pass needed.
   */
  stencilReview?: {
    method: 'lineart' | 'colour_contours';
    simplification: number;
  };
  background?: StudioAsset;
  /**
   * A photograph the client took with the camera try-on and chose to keep, saved as a version of the design it shows (ADR-0022). Every other field is the parent's: the design is unchanged. The photograph passed the own-photo gate and is never sent to an image model.
   */
  capture?: {
    parentJobId: string;
    /**
     * Stored as the media store keeps every own-body photograph: JPEG, EXIF stripped, encrypted at rest.
     */
    photo: {
      assetId: string;
      designId: string;
      mimeType: 'image/jpeg' | 'image/png';
    };
  };
  edit?: {
    parentJobId: string;
    instruction: string;
    /**
     * @minItems 1
     * @maxItems 3
     */
    referenceIds?: [string] | [string, string] | [string, string, string];
    coverage?: 'larger' | 'smaller' | 'full';
    mode?: 'artwork' | 'placement';
    /**
     * TASK-0107 (ADR-0036): a placement the client chose in the live editor. Centre as a fraction of the skin image; width and height of the design before rotation, as fractions of the image's width and height; angle in degrees, clockwise.
     */
    placement?: {
      centreX: number;
      centreY: number;
      width: number;
      height: number;
      angle: number;
    };
  };
  /**
   * TASK-0108: where on the body this design goes, copied from its brief when the status is served, so a design opened from the history knows its zone. TASK-0110: and which reference body (bodyType) it was drawn for. Not the brief itself: no subject, no sizes beyond `size`.
   */
  placement?: {
    /**
     * A member of the brief's `bodyPart` enum.
     */
    bodyPart: string;
    orientation: 'vertical' | 'horizontal' | 'diagonal' | 'wrapping';
    side?: 'left' | 'right' | 'centre';
    bodyType?: 'masculine' | 'feminine';
  };
}
export interface StudioAsset {
  assetId: string;
  designId: string;
  mimeType: 'image/png' | 'image/svg+xml' | 'application/pdf';
}
