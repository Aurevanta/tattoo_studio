/**
 * GENERATED FILE - DO NOT EDIT.
 *
 * Source: contracts/schemas/
 * Regenerate: pnpm --filter @tattoo/contracts generate
 *
 * Editing this by hand fails the codegen reproducibility check.
 */

/**
 * Curated anatomical placements' counterpart for style. Closed vocabulary: free-text style requests are mapped onto it, and anything unmapped prompts a clarifying question rather than passing through raw (CONSULT-INV-003). Extended by TASK-0027 (ADR-0011) with six styles clients ask for that were previously rejected; `tribal` was the repository's own example of an out-of-vocabulary style.
 */
export type StyleName =
  | 'american_traditional'
  | 'fine_line'
  | 'black_and_grey_realism'
  | 'neo_traditional'
  | 'irezumi'
  | 'blackwork'
  | 'illustrative'
  | 'ornamental'
  | 'lettering'
  | 'surrealism'
  | 'tribal'
  | 'geometric'
  | 'watercolour'
  | 'new_school'
  | 'chicano'
  | 'biomechanical';
/**
 * Curated anatomical placements. Several of these are torso areas whose reference photographs are sensitive personal data; see quality-and-security.spec.md.
 */
export type BodyPart =
  | 'inner_forearm'
  | 'outer_forearm'
  | 'upper_arm_inner'
  | 'upper_arm_outer'
  | 'shoulder'
  | 'collarbone'
  | 'chest'
  | 'sternum'
  | 'ribs'
  | 'stomach'
  | 'upper_back'
  | 'lower_back'
  | 'spine'
  | 'hip'
  | 'thigh_front'
  | 'thigh_outer'
  | 'calf'
  | 'shin'
  | 'ankle'
  | 'foot'
  | 'wrist_inner'
  | 'wrist_outer'
  | 'hand'
  | 'finger'
  | 'neck'
  | 'behind_ear';
/**
 * Bounded to what is physically plausible: smaller than 5mm will not hold detail, larger than 600mm exceeds a single sitting's placement.
 */
export type Millimetres = number;

export interface StudioJob {
  /**
   * The system's central contract. The consultation produces it; the flash, stencil and mockup engines consume it. Size is authoritative in millimetres (CONTRACTS-INV-001) and style is drawn from a closed vocabulary (CONTRACTS-INV-002). No 'format' keyword is used and every pattern spells out [0-9], so that TypeScript and Python reach identical verdicts.
   */
  brief: {
    /**
     * Fixed for this schema revision. A breaking change bumps it and carries a migration (CONTRACTS-INV-004).
     */
    schemaVersion: '1.0.0';
    /**
     * Canonical lowercase UUID. Uses a pattern rather than 'format' so both runtimes assert it.
     */
    briefId: string;
    /**
     * Increments on every accepted change. A Design records the revision that produced it (CONTRACTS-INV-003).
     */
    revision: number;
    /**
     * RFC 3339 timestamp. ASCII digits only, so Python and JavaScript agree.
     */
    createdAt: string;
    /**
     * What the tattoo depicts.
     */
    subject: {
      description: string;
      /**
       * Key motifs, kept structured so engines can weight them individually.
       *
       * @maxItems 20
       */
      elements?:
        | []
        | [string]
        | [string, string]
        | [string, string, string]
        | [string, string, string, string]
        | [string, string, string, string, string]
        | [string, string, string, string, string, string]
        | [string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string, string, string]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ];
      /**
       * TASK-0065 (ADR-0029): the idea written as a professional tattoo request (composition, elements, detail, framing), in Spanish. Drafted by the consultation, editable by the client. It never replaces `description`, the client's own words.
       */
      refined?: string;
    };
    style: {
      primary: StyleName;
      secondary?: StyleName;
      /**
       * Free text for nuance within a style. Never a route around the closed vocabulary, and never a place to name a living artist (PROD-INV-004, enforced by the safety module).
       */
      notes?: string;
    };
    linework: {
      /**
       * Drives the stencil's single-weight linework as much as the flash render.
       */
      weight: 'fine' | 'medium' | 'bold' | 'mixed';
      notes?: string;
    };
    shading: {
      technique: 'none' | 'whip' | 'dotwork' | 'smooth_blend' | 'solid_fill' | 'mixed';
      intensity: 'light' | 'medium' | 'heavy';
    };
    colour: {
      [k: string]: unknown;
    } & {
      mode: 'black_and_grey' | 'colour' | 'black_and_grey_with_accent';
      /**
       * Optional client colour preferences. Omit to leave colour selection to the design process using the idea and reviewed references. Forbidden for pure black-and-grey.
       *
       * @minItems 1
       * @maxItems 8
       */
      palette?:
        | [string]
        | [string, string]
        | [string, string, string]
        | [string, string, string, string]
        | [string, string, string, string, string]
        | [string, string, string, string, string, string]
        | [string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string];
    };
    /**
     * Where on the body. Embedded rather than extracted into its own schema until a second consumer exists (TASK-0002/DEC-004).
     */
    placement: {
      bodyPart: BodyPart;
      orientation: 'vertical' | 'horizontal' | 'diagonal' | 'wrapping';
      side?: 'left' | 'right' | 'centre';
      /**
       * Presented sex of the generated skin plate, so a calf reads as a man's or a woman's (TASK-0041). It never reaches the artwork prompt, only the background. Absent when an own photograph is the surface.
       */
      bodyType?: 'masculine' | 'feminine';
    };
    /**
     * Millimetres are authoritative. No pixel dimension appears anywhere in this contract (CONTRACTS-INV-001).
     */
    size: {
      widthMm: Millimetres;
      heightMm: Millimetres;
    };
    constraints?: {
      /**
       * Covering existing work constrains density and darkness heavily.
       */
      coverUp?: boolean;
      /**
       * @maxItems 20
       */
      avoid?:
        | []
        | [string]
        | [string, string]
        | [string, string, string]
        | [string, string, string, string]
        | [string, string, string, string, string]
        | [string, string, string, string, string, string]
        | [string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string, string, string]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ];
    };
  };
  /**
   * TASK-0058 (ADR-0026): may be empty. A generic idea is drawn from the brief alone; the consultation still blocks on a missing essential reference (a named emblem, flag, landmark or artwork).
   *
   * @minItems 0
   * @maxItems 5
   */
  referenceIds:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string];
  bodyPhotoId?: string;
  idempotencyKey: string;
  referencesReviewed: true;
  placement?: {
    x: number;
    y: number;
    width: number;
    photoWidthMm?: number;
  };
  edit?: {
    parentJobId: string;
    instruction: string;
    /**
     * TASK-0036: reference images the client attached to this change request, already screened and owned. They guide the edit and join the design's references.
     *
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
}
