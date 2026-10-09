/**
 * GENERATED FILE - DO NOT EDIT.
 *
 * Source: contracts/schemas/
 * Regenerate: pnpm --filter @tattoo/contracts generate
 *
 * Editing this by hand fails the codegen reproducibility check.
 */

export type Timestamp = string;

/**
 * TASK-0097 (ADR-0032): what a client shares with their tattooer through a link. Only the design, its stencils and what the tattooer needs to read them: never a photograph of the client's body, a camera capture, the body type or the account.
 */
export interface SharedDesign {
  designId: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  /**
   * The client's own words for the design.
   */
  idea: string;
  /**
   * The professional description the client accepted, when there is one.
   */
  refined: string | null;
  /**
   * The accepted print size. Millimetres are authoritative.
   */
  size: {
    widthMm: number;
    heightMm: number;
  };
  placement: {
    /**
     * A body part of the brief's vocabulary.
     */
    bodyPart: string;
    side?: 'left' | 'right' | 'centre';
  };
  /**
   * A style of the brief's vocabulary.
   */
  style: string;
  colourMode: 'black_and_grey' | 'colour' | 'black_and_grey_with_accent';
  /**
   * @maxItems 12
   */
  palette?:
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
      ];
  master: SharedAsset;
  stencil: SharedAsset;
  stencilMirror: SharedAsset;
  pdf: SharedAsset;
  pdfMirror: SharedAsset;
  /**
   * The view on the skin, only when it was composed on a generated skin plate. Null when it was composed on the client's own photograph, which is never shared.
   */
  mockup: SharedAsset | null;
  /**
   * How the stencil was obtained (TASK-0086), so the tattooer knows how far to trust it.
   */
  stencilMethod: ('lineart' | 'colour_contours') | null;
  /**
   * Always true: a professional reviews the design and the stencil before tattooing.
   */
  reviewRequired: true;
}
export interface SharedAsset {
  assetId: string;
  designId: string;
  mimeType: 'image/png' | 'image/svg+xml' | 'application/pdf';
}
