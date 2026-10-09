/**
 * GENERATED FILE - DO NOT EDIT.
 *
 * Source: contracts/schemas/
 * Regenerate: pnpm --filter @tattoo/contracts generate
 *
 * Editing this by hand fails the codegen reproducibility check.
 */

export const schemas: Record<string, Record<string, unknown>> = {
  'design': {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://tattoo-creator.dev/schemas/design/1.0.0",
  "title": "Design",
  "description": "A generated artwork and its lineage. Produced by the flash engine from a TattooBrief, consumed by the stencil and mockup engines. Records the brief revision that produced it (CONTRACTS-INV-003). Follows the same conventions as TattooBrief: no 'format' keyword, and every pattern spells out [0-9], so TypeScript and Python reach identical verdicts.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "designId",
    "briefId",
    "briefRevision",
    "version",
    "kind",
    "status",
    "createdAt",
    "image",
    "provenance"
  ],
  "properties": {
    "schemaVersion": {
      "description": "Fixed for this schema revision (CONTRACTS-INV-004).",
      "const": "1.0.0"
    },
    "designId": {
      "$ref": "#/$defs/uuid"
    },
    "briefId": {
      "description": "The brief this design was rendered from.",
      "$ref": "#/$defs/uuid"
    },
    "briefRevision": {
      "description": "The exact brief revision used. A design is only meaningful against the revision that produced it (CONTRACTS-INV-003).",
      "type": "integer",
      "minimum": 1
    },
    "version": {
      "description": "Design version within its lineage. Refinement produces version n+1 and never mutates n (FLASH-INV-002).",
      "type": "integer",
      "minimum": 1
    },
    "parentDesignId": {
      "description": "The design this one was refined from. Absent on a first render.",
      "$ref": "#/$defs/uuid"
    },
    "kind": {
      "description": "Which pass produced this artwork. 'flash' is the shaded reference render; 'line_art' is the dedicated stencil pass, which is generated natively rather than edge-detected from flash (ADR-0003).",
      "enum": [
        "flash",
        "line_art"
      ]
    },
    "status": {
      "enum": [
        "draft",
        "accepted",
        "superseded"
      ]
    },
    "createdAt": {
      "$ref": "#/$defs/timestamp"
    },
    "image": {
      "$ref": "#/$defs/imageRef"
    },
    "provenance": {
      "description": "What produced this artwork. Kept so a design can be explained, reproduced and audited.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "provider",
        "model",
        "prompt"
      ],
      "properties": {
        "provider": {
          "description": "Adapter name, not a credential or endpoint.",
          "type": "string",
          "minLength": 1,
          "maxLength": 60
        },
        "model": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "prompt": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        },
        "negativePrompt": {
          "type": "string",
          "maxLength": 2000
        },
        "seed": {
          "description": "Recorded when the provider exposes one, so a render can be reproduced.",
          "type": "integer",
          "minimum": 0
        }
      }
    }
  },
  "$defs": {
    "uuid": {
      "description": "Canonical lowercase UUID. A pattern rather than 'format', so both runtimes assert it.",
      "type": "string",
      "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    },
    "timestamp": {
      "description": "RFC 3339. ASCII digits only, so Python and JavaScript agree.",
      "type": "string",
      "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$"
    },
    "imageRef": {
      "description": "A handle to stored image bytes. Bytes themselves never cross a module boundary or travel through the queue (JOBS-INV-001).",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "storageKey",
        "mediaType",
        "widthPx",
        "heightPx"
      ],
      "properties": {
        "storageKey": {
          "description": "Opaque key into media storage. Never a signed or public URL (SEC-INV-008).",
          "type": "string",
          "minLength": 1,
          "maxLength": 512,
          "pattern": "^[A-Za-z0-9._/-]+$"
        },
        "mediaType": {
          "enum": [
            "image/png",
            "image/webp",
            "image/jpeg"
          ]
        },
        "widthPx": {
          "$ref": "#/$defs/pixels"
        },
        "heightPx": {
          "$ref": "#/$defs/pixels"
        },
        "byteSize": {
          "type": "integer",
          "minimum": 1
        }
      }
    },
    "pixels": {
      "description": "Raster dimensions of this stored image. These describe the artifact, not the tattoo: the tattoo's authoritative size is in millimetres on the brief, and nothing derives physical size from these (CONTRACTS-INV-001).",
      "type": "integer",
      "minimum": 1,
      "maximum": 16384
    }
  }
},
  'shared-design': {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://inkcraft.local/schemas/shared-design.schema.json",
  "title": "SharedDesign",
  "description": "TASK-0097 (ADR-0032): what a client shares with their tattooer through a link. Only the design, its stencils and what the tattooer needs to read them: never a photograph of the client's body, a camera capture, the body type or the account.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "designId",
    "createdAt",
    "expiresAt",
    "idea",
    "refined",
    "size",
    "placement",
    "style",
    "colourMode",
    "master",
    "stencil",
    "stencilMirror",
    "pdf",
    "pdfMirror",
    "mockup",
    "stencilMethod",
    "reviewRequired"
  ],
  "properties": {
    "designId": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$"
    },
    "createdAt": {
      "$ref": "#/$defs/timestamp"
    },
    "expiresAt": {
      "$ref": "#/$defs/timestamp"
    },
    "idea": {
      "description": "The client's own words for the design.",
      "type": "string",
      "minLength": 1,
      "maxLength": 2000
    },
    "refined": {
      "description": "The professional description the client accepted, when there is one.",
      "anyOf": [
        {
          "type": "string",
          "minLength": 1,
          "maxLength": 1200
        },
        {
          "type": "null"
        }
      ]
    },
    "size": {
      "description": "The accepted print size. Millimetres are authoritative.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "widthMm",
        "heightMm"
      ],
      "properties": {
        "widthMm": {
          "type": "number",
          "minimum": 5,
          "maximum": 600
        },
        "heightMm": {
          "type": "number",
          "minimum": 5,
          "maximum": 600
        }
      }
    },
    "placement": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "bodyPart"
      ],
      "properties": {
        "bodyPart": {
          "description": "A body part of the brief's vocabulary.",
          "type": "string",
          "pattern": "^[a-z][a-z_]{1,39}$"
        },
        "side": {
          "enum": [
            "left",
            "right",
            "centre"
          ]
        }
      }
    },
    "style": {
      "description": "A style of the brief's vocabulary.",
      "type": "string",
      "pattern": "^[a-z][a-z_]{1,39}$"
    },
    "colourMode": {
      "enum": [
        "black_and_grey",
        "colour",
        "black_and_grey_with_accent"
      ]
    },
    "palette": {
      "type": "array",
      "maxItems": 12,
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 40
      }
    },
    "master": {
      "$ref": "#/$defs/asset"
    },
    "stencil": {
      "$ref": "#/$defs/asset"
    },
    "stencilMirror": {
      "$ref": "#/$defs/asset"
    },
    "pdf": {
      "$ref": "#/$defs/asset"
    },
    "pdfMirror": {
      "$ref": "#/$defs/asset"
    },
    "mockup": {
      "description": "The view on the skin, only when it was composed on a generated skin plate. Null when it was composed on the client's own photograph, which is never shared.",
      "anyOf": [
        {
          "$ref": "#/$defs/asset"
        },
        {
          "type": "null"
        }
      ]
    },
    "stencilMethod": {
      "description": "How the stencil was obtained (TASK-0086), so the tattooer knows how far to trust it.",
      "anyOf": [
        {
          "enum": [
            "lineart",
            "colour_contours"
          ]
        },
        {
          "type": "null"
        }
      ]
    },
    "reviewRequired": {
      "description": "Always true: a professional reviews the design and the stencil before tattooing.",
      "const": true
    }
  },
  "$defs": {
    "timestamp": {
      "type": "string",
      "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$"
    },
    "asset": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "assetId",
        "designId",
        "mimeType"
      ],
      "properties": {
        "assetId": {
          "type": "string",
          "pattern": "^[a-f0-9]{32}$"
        },
        "designId": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "mimeType": {
          "type": "string",
          "enum": [
            "image/png",
            "image/svg+xml",
            "application/pdf"
          ]
        }
      },
      "title": "SharedAsset"
    }
  }
},
  'studio-job': {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://tattoo.local/schemas/studio-job.schema.json",
  "title": "StudioJob",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "brief",
    "referenceIds",
    "idempotencyKey",
    "referencesReviewed"
  ],
  "properties": {
    "brief": {
      "description": "The system's central contract. The consultation produces it; the flash, stencil and mockup engines consume it. Size is authoritative in millimetres (CONTRACTS-INV-001) and style is drawn from a closed vocabulary (CONTRACTS-INV-002). No 'format' keyword is used and every pattern spells out [0-9], so that TypeScript and Python reach identical verdicts.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "briefId",
        "revision",
        "createdAt",
        "subject",
        "style",
        "linework",
        "shading",
        "colour",
        "placement",
        "size"
      ],
      "properties": {
        "schemaVersion": {
          "description": "Fixed for this schema revision. A breaking change bumps it and carries a migration (CONTRACTS-INV-004).",
          "const": "1.0.0"
        },
        "briefId": {
          "description": "Canonical lowercase UUID. Uses a pattern rather than 'format' so both runtimes assert it.",
          "type": "string",
          "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
        },
        "revision": {
          "description": "Increments on every accepted change. A Design records the revision that produced it (CONTRACTS-INV-003).",
          "type": "integer",
          "minimum": 1
        },
        "createdAt": {
          "description": "RFC 3339 timestamp. ASCII digits only, so Python and JavaScript agree.",
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$"
        },
        "subject": {
          "description": "What the tattoo depicts.",
          "type": "object",
          "additionalProperties": false,
          "required": [
            "description"
          ],
          "properties": {
            "description": {
              "type": "string",
              "minLength": 10,
              "maxLength": 2000
            },
            "elements": {
              "description": "Key motifs, kept structured so engines can weight them individually.",
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 120
              },
              "maxItems": 20,
              "uniqueItems": true
            },
            "refined": {
              "description": "TASK-0065 (ADR-0029): the idea written as a professional tattoo request (composition, elements, detail, framing), in Spanish. Drafted by the consultation, editable by the client. It never replaces `description`, the client's own words.",
              "type": "string",
              "minLength": 1,
              "maxLength": 1200
            }
          }
        },
        "style": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "primary"
          ],
          "properties": {
            "primary": {
              "$ref": "#/$defs/styleName"
            },
            "secondary": {
              "$ref": "#/$defs/styleName"
            },
            "notes": {
              "description": "Free text for nuance within a style. Never a route around the closed vocabulary, and never a place to name a living artist (PROD-INV-004, enforced by the safety module).",
              "type": "string",
              "maxLength": 600
            }
          }
        },
        "linework": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "weight"
          ],
          "properties": {
            "weight": {
              "description": "Drives the stencil's single-weight linework as much as the flash render.",
              "enum": [
                "fine",
                "medium",
                "bold",
                "mixed"
              ]
            },
            "notes": {
              "type": "string",
              "maxLength": 400
            }
          }
        },
        "shading": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "technique",
            "intensity"
          ],
          "properties": {
            "technique": {
              "enum": [
                "none",
                "whip",
                "dotwork",
                "smooth_blend",
                "solid_fill",
                "mixed"
              ]
            },
            "intensity": {
              "enum": [
                "light",
                "medium",
                "heavy"
              ]
            }
          }
        },
        "colour": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "mode"
          ],
          "properties": {
            "mode": {
              "enum": [
                "black_and_grey",
                "colour",
                "black_and_grey_with_accent"
              ]
            },
            "palette": {
              "description": "Optional client colour preferences. Omit to leave colour selection to the design process using the idea and reviewed references. Forbidden for pure black-and-grey.",
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 40
              },
              "minItems": 1,
              "maxItems": 8,
              "uniqueItems": true
            }
          },
          "allOf": [
            {
              "description": "A black-and-grey brief cannot carry a palette. This conditional is why validation runs through the schema in both runtimes rather than through generated models, which cannot express it.",
              "if": {
                "properties": {
                  "mode": {
                    "const": "black_and_grey"
                  }
                },
                "required": [
                  "mode"
                ]
              },
              "then": {
                "not": {
                  "required": [
                    "palette"
                  ]
                }
              }
            }
          ]
        },
        "placement": {
          "description": "Where on the body. Embedded rather than extracted into its own schema until a second consumer exists (TASK-0002/DEC-004).",
          "type": "object",
          "additionalProperties": false,
          "required": [
            "bodyPart",
            "orientation"
          ],
          "properties": {
            "bodyPart": {
              "$ref": "#/$defs/bodyPart"
            },
            "orientation": {
              "enum": [
                "vertical",
                "horizontal",
                "diagonal",
                "wrapping"
              ]
            },
            "side": {
              "enum": [
                "left",
                "right",
                "centre"
              ]
            },
            "bodyType": {
              "description": "Presented sex of the generated skin plate, so a calf reads as a man's or a woman's (TASK-0041). It never reaches the artwork prompt, only the background. Absent when an own photograph is the surface.",
              "enum": [
                "masculine",
                "feminine"
              ]
            }
          }
        },
        "size": {
          "description": "Millimetres are authoritative. No pixel dimension appears anywhere in this contract (CONTRACTS-INV-001).",
          "type": "object",
          "additionalProperties": false,
          "required": [
            "widthMm",
            "heightMm"
          ],
          "properties": {
            "widthMm": {
              "$ref": "#/$defs/millimetres"
            },
            "heightMm": {
              "$ref": "#/$defs/millimetres"
            }
          }
        },
        "constraints": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "coverUp": {
              "description": "Covering existing work constrains density and darkness heavily.",
              "type": "boolean"
            },
            "avoid": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 120
              },
              "maxItems": 20,
              "uniqueItems": true
            }
          }
        }
      }
    },
    "referenceIds": {
      "description": "TASK-0058 (ADR-0026): may be empty. A generic idea is drawn from the brief alone; the consultation still blocks on a missing essential reference (a named emblem, flag, landmark or artwork).",
      "type": "array",
      "minItems": 0,
      "maxItems": 5,
      "uniqueItems": true,
      "items": {
        "type": "string",
        "pattern": "^[a-f0-9]{32}$"
      }
    },
    "bodyPhotoId": {
      "type": "string",
      "pattern": "^[a-f0-9]{32}$"
    },
    "idempotencyKey": {
      "type": "string",
      "pattern": "^[a-f0-9-]{36}$"
    },
    "referencesReviewed": {
      "const": true
    },
    "placement": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "x",
        "y",
        "width"
      ],
      "properties": {
        "x": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "y": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "width": {
          "type": "number",
          "exclusiveMinimum": 0,
          "maximum": 1
        },
        "photoWidthMm": {
          "type": "number",
          "minimum": 20,
          "maximum": 3000
        }
      }
    },
    "edit": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "parentJobId",
        "instruction"
      ],
      "properties": {
        "parentJobId": {
          "type": "string",
          "pattern": "^[a-f0-9]{32}$"
        },
        "instruction": {
          "type": "string",
          "minLength": 3,
          "maxLength": 1000,
          "pattern": "\\S"
        },
        "referenceIds": {
          "description": "TASK-0036: reference images the client attached to this change request, already screened and owned. They guide the edit and join the design's references.",
          "type": "array",
          "minItems": 1,
          "maxItems": 3,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "pattern": "^[a-f0-9]{32}$"
          }
        },
        "coverage": {
          "enum": [
            "larger",
            "smaller",
            "full"
          ]
        },
        "mode": {
          "enum": [
            "artwork",
            "placement"
          ]
        }
      }
    }
  },
  "$defs": {
    "styleName": {
      "description": "Curated anatomical placements' counterpart for style. Closed vocabulary: free-text style requests are mapped onto it, and anything unmapped prompts a clarifying question rather than passing through raw (CONSULT-INV-003). Extended by TASK-0027 (ADR-0011) with six styles clients ask for that were previously rejected; `tribal` was the repository's own example of an out-of-vocabulary style.",
      "enum": [
        "american_traditional",
        "fine_line",
        "black_and_grey_realism",
        "neo_traditional",
        "irezumi",
        "blackwork",
        "illustrative",
        "ornamental",
        "lettering",
        "surrealism",
        "tribal",
        "geometric",
        "watercolour",
        "new_school",
        "chicano",
        "biomechanical"
      ]
    },
    "bodyPart": {
      "description": "Curated anatomical placements. Several of these are torso areas whose reference photographs are sensitive personal data; see quality-and-security.spec.md.",
      "enum": [
        "inner_forearm",
        "outer_forearm",
        "upper_arm_inner",
        "upper_arm_outer",
        "shoulder",
        "collarbone",
        "chest",
        "sternum",
        "ribs",
        "stomach",
        "upper_back",
        "lower_back",
        "spine",
        "hip",
        "thigh_front",
        "thigh_outer",
        "calf",
        "shin",
        "ankle",
        "foot",
        "wrist_inner",
        "wrist_outer",
        "hand",
        "finger",
        "neck",
        "behind_ear"
      ]
    },
    "millimetres": {
      "description": "Bounded to what is physically plausible: smaller than 5mm will not hold detail, larger than 600mm exceeds a single sitting's placement.",
      "type": "number",
      "minimum": 5,
      "maximum": 600
    }
  }
},
  'studio-status': {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://inkcraft.local/schemas/studio-status.schema.json",
  "title": "StudioJobStatus",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "jobId": {
      "type": "string",
      "pattern": "^[a-f0-9]{32}$"
    },
    "state": {
      "type": "string",
      "enum": [
        "queued",
        "running",
        "succeeded",
        "failed",
        "cancelled"
      ]
    },
    "result": {
      "anyOf": [
        {
          "$ref": "#/$defs/artifact"
        },
        {
          "type": "null"
        }
      ]
    },
    "error": {
      "type": [
        "string",
        "null"
      ]
    },
    "stage": {
      "description": "TASK-0076 (audit UX-03): the pipeline step a running job is in, as the worker reports it. Absent when unknown.",
      "type": "string",
      "enum": [
        "references",
        "skin",
        "drawing",
        "stencil",
        "placing",
        "finishing"
      ]
    },
    "queuePosition": {
      "description": "TASK-0076: for a queued job, how many jobs (including it) are ahead in the studio's queue.",
      "type": "integer",
      "minimum": 1
    }
  },
  "required": [
    "jobId",
    "state",
    "result",
    "error"
  ],
  "$defs": {
    "asset": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "assetId": {
          "type": "string",
          "pattern": "^[a-f0-9]{32}$"
        },
        "designId": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "mimeType": {
          "type": "string",
          "enum": [
            "image/png",
            "image/svg+xml",
            "application/pdf"
          ]
        }
      },
      "required": [
        "assetId",
        "designId",
        "mimeType"
      ],
      "title": "StudioAsset"
    },
    "artifact": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "designId": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "briefId": {
          "type": "string",
          "pattern": "^[a-f0-9-]{36}$"
        },
        "briefRevision": {
          "type": "integer",
          "minimum": 1
        },
        "size": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "widthMm": {
              "type": "number",
              "minimum": 5,
              "maximum": 600
            },
            "heightMm": {
              "type": "number",
              "minimum": 5,
              "maximum": 600
            }
          },
          "required": [
            "widthMm",
            "heightMm"
          ]
        },
        "master": {
          "$ref": "#/$defs/asset"
        },
        "stencil": {
          "$ref": "#/$defs/asset"
        },
        "stencilMirror": {
          "$ref": "#/$defs/asset"
        },
        "pdf": {
          "$ref": "#/$defs/asset"
        },
        "pdfMirror": {
          "$ref": "#/$defs/asset"
        },
        "mockup": {
          "$ref": "#/$defs/asset"
        },
        "referenceAnalysis": {
          "type": "string",
          "minLength": 1,
          "maxLength": 3000
        },
        "reviewRequired": {
          "const": true
        },
        "backgroundKind": {
          "type": "string",
          "enum": [
            "own_photo",
            "generated_anatomy"
          ]
        },
        "transform": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "xPx": {
              "type": "integer",
              "minimum": 0
            },
            "yPx": {
              "type": "integer",
              "minimum": 0
            },
            "widthPx": {
              "type": "integer",
              "minimum": 0
            },
            "heightPx": {
              "type": "integer",
              "minimum": 0
            },
            "method": {
              "enum": [
                "geometric-multiply",
                "fresh-ink-composite"
              ]
            },
            "curvature": {
              "type": "number",
              "minimum": 0,
              "maximum": 1.2,
              "description": "Approximate cylindrical warp in radians, not inferred anatomy."
            },
            "taper": {
              "type": "number",
              "minimum": 0,
              "maximum": 0.35,
              "description": "Illustrative narrowing towards the lower calf, not measured anatomy."
            },
            "scaleCalibrated": {
              "type": "boolean"
            },
            "generativePostprocess": {
              "type": "boolean",
              "description": "True only when a constrained AI finish replaced the geometric composite after passing the geometry check against it (ADR-0016, ADR-0018). The stencil never derives from it."
            },
            "finish": {
              "enum": [
                "accepted",
                "declined",
                "unavailable",
                "rejected_geometry",
                "rejected_output"
              ],
              "description": "What happened to the AI finish when one was attempted (ADR-0018). Anything but accepted means the geometric composite was delivered."
            },
            "bodyFit": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "scale",
                "spill",
                "taper"
              ],
              "description": "How the design was fitted to the body silhouette read from the photograph (TASK-0039). A silhouette, not depth.",
              "properties": {
                "scale": {
                  "type": "number",
                  "exclusiveMinimum": 0,
                  "maximum": 1
                },
                "spill": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1
                },
                "taper": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 0.35
                }
              }
            },
            "sourceCropPx": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "left",
                "top",
                "width",
                "height"
              ],
              "properties": {
                "left": {
                  "type": "integer",
                  "minimum": 0
                },
                "top": {
                  "type": "integer",
                  "minimum": 0
                },
                "width": {
                  "type": "integer",
                  "minimum": 1
                },
                "height": {
                  "type": "integer",
                  "minimum": 1
                }
              }
            },
            "surface": {
              "type": "number",
              "minimum": 0,
              "maximum": 1,
              "description": "How strongly the ink is attenuated where the photograph's own shading says the body turns away. An illustrative approximation of surface form, not recovered depth, and never a displacement: the artwork's geometry is authoritative (ADR-0014, MOCKUP-INV-001)."
            },
            "freshness": {
              "type": "number",
              "minimum": 0,
              "maximum": 4,
              "description": "Strength of the fresh-ink reddening around the strokes. 0 when the render is a plain multiply. Illustrative, never a clinical prediction of healing (PROD-INV-003)."
            }
          },
          "required": [
            "xPx",
            "yPx",
            "widthPx",
            "heightPx",
            "method",
            "scaleCalibrated",
            "generativePostprocess"
          ],
          "if": {
            "properties": {
              "generativePostprocess": {
                "const": true
              }
            },
            "required": [
              "generativePostprocess"
            ]
          },
          "then": {
            "required": [
              "finish"
            ],
            "properties": {
              "finish": {
                "const": "accepted"
              }
            }
          }
        },
        "notice": {
          "type": "string",
          "minLength": 1
        },
        "stencilReview": {
          "description": "TASK-0086 (audit ARQ-03): how the stencil was obtained, so the client and the tattooer know how far to trust it. `lineart`: traced from a dedicated line-art pass; `colour_contours`: approximate contours of a colour or shaded design. `simplification`: 0 when traced at full detail, 1 to 3 for each coarser pass needed.",
          "type": "object",
          "additionalProperties": false,
          "required": [
            "method",
            "simplification"
          ],
          "properties": {
            "method": {
              "type": "string",
              "enum": [
                "lineart",
                "colour_contours"
              ]
            },
            "simplification": {
              "type": "integer",
              "minimum": 0,
              "maximum": 3
            }
          }
        },
        "background": {
          "$ref": "#/$defs/asset"
        },
        "capture": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "parentJobId",
            "photo"
          ],
          "description": "A photograph the client took with the camera try-on and chose to keep, saved as a version of the design it shows (ADR-0022). Every other field is the parent's: the design is unchanged. The photograph passed the own-photo gate and is never sent to an image model.",
          "properties": {
            "parentJobId": {
              "type": "string",
              "pattern": "^[a-f0-9]{32}$"
            },
            "photo": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "assetId",
                "designId",
                "mimeType"
              ],
              "description": "Stored as the media store keeps every own-body photograph: JPEG, EXIF stripped, encrypted at rest.",
              "properties": {
                "assetId": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{32}$"
                },
                "designId": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{64}$"
                },
                "mimeType": {
                  "type": "string",
                  "enum": [
                    "image/jpeg",
                    "image/png"
                  ]
                }
              }
            }
          }
        },
        "edit": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "parentJobId",
            "instruction"
          ],
          "properties": {
            "parentJobId": {
              "type": "string",
              "pattern": "^[a-f0-9]{32}$"
            },
            "instruction": {
              "type": "string",
              "minLength": 3,
              "maxLength": 1000
            },
            "referenceIds": {
              "type": "array",
              "minItems": 1,
              "maxItems": 3,
              "uniqueItems": true,
              "items": {
                "type": "string",
                "pattern": "^[a-f0-9]{32}$"
              }
            },
            "coverage": {
              "enum": [
                "larger",
                "smaller",
                "full"
              ]
            },
            "mode": {
              "enum": [
                "artwork",
                "placement"
              ]
            }
          }
        }
      },
      "required": [
        "designId",
        "briefId",
        "briefRevision",
        "size",
        "master",
        "stencil",
        "stencilMirror",
        "pdf",
        "pdfMirror",
        "mockup",
        "referenceAnalysis",
        "reviewRequired",
        "backgroundKind",
        "transform",
        "notice"
      ],
      "title": "GeneratedTattooArtifact"
    }
  },
  "allOf": [
    {
      "if": {
        "properties": {
          "state": {
            "const": "succeeded"
          }
        }
      },
      "then": {
        "properties": {
          "result": {
            "$ref": "#/$defs/artifact"
          },
          "error": {
            "type": "null"
          }
        }
      },
      "else": {
        "properties": {
          "result": {
            "type": "null"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "state": {
            "const": "failed"
          }
        }
      },
      "then": {
        "properties": {
          "error": {
            "type": "string",
            "minLength": 1
          }
        }
      }
    }
  ]
},
  'tattoo-brief': {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://tattoo-creator.dev/schemas/tattoo-brief/1.0.0",
  "title": "TattooBrief",
  "description": "The system's central contract. The consultation produces it; the flash, stencil and mockup engines consume it. Size is authoritative in millimetres (CONTRACTS-INV-001) and style is drawn from a closed vocabulary (CONTRACTS-INV-002). No 'format' keyword is used and every pattern spells out [0-9], so that TypeScript and Python reach identical verdicts.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "briefId",
    "revision",
    "createdAt",
    "subject",
    "style",
    "linework",
    "shading",
    "colour",
    "placement",
    "size"
  ],
  "properties": {
    "schemaVersion": {
      "description": "Fixed for this schema revision. A breaking change bumps it and carries a migration (CONTRACTS-INV-004).",
      "const": "1.0.0"
    },
    "briefId": {
      "description": "Canonical lowercase UUID. Uses a pattern rather than 'format' so both runtimes assert it.",
      "type": "string",
      "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    },
    "revision": {
      "description": "Increments on every accepted change. A Design records the revision that produced it (CONTRACTS-INV-003).",
      "type": "integer",
      "minimum": 1
    },
    "createdAt": {
      "description": "RFC 3339 timestamp. ASCII digits only, so Python and JavaScript agree.",
      "type": "string",
      "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$"
    },
    "subject": {
      "description": "What the tattoo depicts.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "description"
      ],
      "properties": {
        "description": {
          "type": "string",
          "minLength": 10,
          "maxLength": 2000
        },
        "elements": {
          "description": "Key motifs, kept structured so engines can weight them individually.",
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120
          },
          "maxItems": 20,
          "uniqueItems": true
        },
        "refined": {
          "description": "TASK-0065 (ADR-0029): the idea written as a professional tattoo request (composition, elements, detail, framing), in Spanish. Drafted by the consultation, editable by the client. It never replaces `description`, the client's own words.",
          "type": "string",
          "minLength": 1,
          "maxLength": 1200
        }
      }
    },
    "style": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "primary"
      ],
      "properties": {
        "primary": {
          "$ref": "#/$defs/styleName"
        },
        "secondary": {
          "$ref": "#/$defs/styleName"
        },
        "notes": {
          "description": "Free text for nuance within a style. Never a route around the closed vocabulary, and never a place to name a living artist (PROD-INV-004, enforced by the safety module).",
          "type": "string",
          "maxLength": 600
        }
      }
    },
    "linework": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "weight"
      ],
      "properties": {
        "weight": {
          "description": "Drives the stencil's single-weight linework as much as the flash render.",
          "enum": [
            "fine",
            "medium",
            "bold",
            "mixed"
          ]
        },
        "notes": {
          "type": "string",
          "maxLength": 400
        }
      }
    },
    "shading": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "technique",
        "intensity"
      ],
      "properties": {
        "technique": {
          "enum": [
            "none",
            "whip",
            "dotwork",
            "smooth_blend",
            "solid_fill",
            "mixed"
          ]
        },
        "intensity": {
          "enum": [
            "light",
            "medium",
            "heavy"
          ]
        }
      }
    },
    "colour": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "mode"
      ],
      "properties": {
        "mode": {
          "enum": [
            "black_and_grey",
            "colour",
            "black_and_grey_with_accent"
          ]
        },
        "palette": {
          "description": "Optional client colour preferences. Omit to leave colour selection to the design process using the idea and reviewed references. Forbidden for pure black-and-grey.",
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          },
          "minItems": 1,
          "maxItems": 8,
          "uniqueItems": true
        }
      },
      "allOf": [
        {
          "description": "A black-and-grey brief cannot carry a palette. This conditional is why validation runs through the schema in both runtimes rather than through generated models, which cannot express it.",
          "if": {
            "properties": {
              "mode": {
                "const": "black_and_grey"
              }
            },
            "required": [
              "mode"
            ]
          },
          "then": {
            "not": {
              "required": [
                "palette"
              ]
            }
          }
        }
      ]
    },
    "placement": {
      "description": "Where on the body. Embedded rather than extracted into its own schema until a second consumer exists (TASK-0002/DEC-004).",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "bodyPart",
        "orientation"
      ],
      "properties": {
        "bodyPart": {
          "$ref": "#/$defs/bodyPart"
        },
        "orientation": {
          "enum": [
            "vertical",
            "horizontal",
            "diagonal",
            "wrapping"
          ]
        },
        "side": {
          "enum": [
            "left",
            "right",
            "centre"
          ]
        },
        "bodyType": {
          "description": "Presented sex of the generated skin plate, so a calf reads as a man's or a woman's (TASK-0041). It never reaches the artwork prompt, only the background. Absent when an own photograph is the surface.",
          "enum": [
            "masculine",
            "feminine"
          ]
        }
      }
    },
    "size": {
      "description": "Millimetres are authoritative. No pixel dimension appears anywhere in this contract (CONTRACTS-INV-001).",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "widthMm",
        "heightMm"
      ],
      "properties": {
        "widthMm": {
          "$ref": "#/$defs/millimetres"
        },
        "heightMm": {
          "$ref": "#/$defs/millimetres"
        }
      }
    },
    "constraints": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "coverUp": {
          "description": "Covering existing work constrains density and darkness heavily.",
          "type": "boolean"
        },
        "avoid": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120
          },
          "maxItems": 20,
          "uniqueItems": true
        }
      }
    }
  },
  "$defs": {
    "styleName": {
      "description": "Curated anatomical placements' counterpart for style. Closed vocabulary: free-text style requests are mapped onto it, and anything unmapped prompts a clarifying question rather than passing through raw (CONSULT-INV-003). Extended by TASK-0027 (ADR-0011) with six styles clients ask for that were previously rejected; `tribal` was the repository's own example of an out-of-vocabulary style.",
      "enum": [
        "american_traditional",
        "fine_line",
        "black_and_grey_realism",
        "neo_traditional",
        "irezumi",
        "blackwork",
        "illustrative",
        "ornamental",
        "lettering",
        "surrealism",
        "tribal",
        "geometric",
        "watercolour",
        "new_school",
        "chicano",
        "biomechanical"
      ]
    },
    "bodyPart": {
      "description": "Curated anatomical placements. Several of these are torso areas whose reference photographs are sensitive personal data; see quality-and-security.spec.md.",
      "enum": [
        "inner_forearm",
        "outer_forearm",
        "upper_arm_inner",
        "upper_arm_outer",
        "shoulder",
        "collarbone",
        "chest",
        "sternum",
        "ribs",
        "stomach",
        "upper_back",
        "lower_back",
        "spine",
        "hip",
        "thigh_front",
        "thigh_outer",
        "calf",
        "shin",
        "ankle",
        "foot",
        "wrist_inner",
        "wrist_outer",
        "hand",
        "finger",
        "neck",
        "behind_ear"
      ]
    },
    "millimetres": {
      "description": "Bounded to what is physically plausible: smaller than 5mm will not hold detail, larger than 600mm exceeds a single sitting's placement.",
      "type": "number",
      "minimum": 5,
      "maximum": 600
    }
  }
},
};

export type SchemaName = 'design' | 'shared-design' | 'studio-job' | 'studio-status' | 'tattoo-brief';

export const schemaNames: readonly SchemaName[] = [
  'design',
  'shared-design',
  'studio-job',
  'studio-status',
  'tattoo-brief',
];
