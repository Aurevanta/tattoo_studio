import {
  BODY_ZONE_SPANS,
  isSleeve,
  SIZE_SCALES,
  wrapRegionOf,
  wrapSize,
  type BodyPart,
  type StyleName,
} from '@tattoo/contracts';
import type { ConsultationSlots } from '../types';

const normal = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
export const STYLE_OPTIONS: Record<StyleName, string> = {
  american_traditional: 'Tradicional americano',
  fine_line: 'Línea fina',
  black_and_grey_realism: 'Realismo',
  neo_traditional: 'Neotradicional',
  irezumi: 'Irezumi',
  blackwork: 'Blackwork',
  illustrative: 'Ilustrativo',
  ornamental: 'Ornamental',
  lettering: 'Lettering',
  surrealism: 'Surrealismo',
  tribal: 'Tribal',
  geometric: 'Geométrico',
  watercolour: 'Acuarela',
  new_school: 'New school',
  chicano: 'Chicano',
  biomechanical: 'Biomecánico',
};
export const BODY_OPTIONS: Partial<Record<BodyPart, string>> = {
  inner_forearm: 'Antebrazo interior',
  outer_forearm: 'Antebrazo exterior',
  upper_arm_outer: 'Brazo',
  shoulder: 'Hombro',
  chest: 'Pecho',
  ribs: 'Costillas',
  stomach: 'Abdomen',
  upper_back: 'Espalda alta',
  lower_back: 'Espalda baja',
  thigh_front: 'Muslo',
  calf: 'Gemelo',
  ankle: 'Tobillo',
  wrist_inner: 'Muñeca',
  hand: 'Mano',
  neck: 'Cuello',
  foot: 'Pie',
};

/** «Estilo manga», «dibujos manga», «anime»: the comic style, not a sleeve. */
const COMIC_MANGA =
  /\b(?:estilo|tipo|dibujos?|personajes?|comics?|comic) (?:de )?manga\b|\bmanga y anime\b|\banime\b/;
const LEG_SLEEVE =
  /de (?:la )?rodilla (?:al|hasta el) tobillo|del tobillo (?:a|hasta) la rodilla|toda la pierna|pierna (?:entera|completa)|(?:alrededor|la vuelta) (?:de|a) (?:la |mi |toda la )?(?:pierna|pantorrilla|gemelo|espinilla)|manga (?:de|en) (?:la |mi )?pierna|leg sleeve/;
const FOREARM_SLEEVE =
  /del codo (?:a|hasta) la muneca|de la muneca (?:al|hasta el) codo|todo el antebrazo|antebrazo (?:entero|completo)|(?:alrededor|la vuelta) (?:del|al|de mi|a mi|de todo el) antebrazo|manga (?:de|en) (?:el |mi )?antebrazo|forearm sleeve/;
const ANY_SLEEVE = /\bmanga\b|\bsleeve\b|envolvente|que (?:rodee|envuelva|de la vuelta)|\b360\b/;

/**
 * The limb a client asks a sleeve for, in their own words (TASK-0104, ADR-0034): «una manga de
 * rodilla a tobillo», «todo el antebrazo», «que rodee el gemelo». A bare «manga» counts when the
 * zone already says which limb. «Estilo manga» is the comic style and never a sleeve, and the
 * upper arm has no sleeve yet.
 */
export function sleeveLimb(
  text: string,
  bodyPart: BodyPart | undefined,
): 'leg' | 'forearm' | undefined {
  const plain = text.replace(COMIC_MANGA, ' ');
  if (LEG_SLEEVE.test(plain)) return 'leg';
  if (FOREARM_SLEEVE.test(plain)) return 'forearm';
  if (!ANY_SLEEVE.test(plain)) return undefined;
  if (/\bpierna|gemelo|pantorrilla|espinilla/.test(plain)) return 'leg';
  if (/antebrazo/.test(plain)) return 'forearm';
  const region = wrapRegionOf(bodyPart);
  if (!region) return undefined;
  return region.zones.includes('calf') ? 'leg' : 'forearm';
}

/** Extract only explicit preferences. Technical defaults are visible in the brief. */
export function extractPreferences(input: string, existing: ConsultationSlots): ConsultationSlots {
  const text = normal(input);
  const slots: ConsultationSlots = structuredClone(existing);
  if (!slots.subject?.description) slots.subject = { description: input.trim() };
  else if (/^(cambia el tema|nuevo tema|anade|añade|incluye|tambien quiero)/i.test(input)) {
    slots.subject.description = /^(cambia el tema|nuevo tema)/i.test(input)
      ? input.replace(/^[^:]+:\s*/, '')
      : `${slots.subject.description}. ${input}`;
  }
  const styles: [RegExp, StyleName][] = [
    [/linea fina|fine.?line/, 'fine_line'],
    [/neo.?tradicional|neo.?traditional/, 'neo_traditional'],
    [/tradicional|traditional/, 'american_traditional'],
    [/realismo|realista|realism/, 'black_and_grey_realism'],
    [/irezumi|japones|japanese/, 'irezumi'],
    [/blackwork/, 'blackwork'],
    [/ornamental/, 'ornamental'],
    [/lettering|caligrafia/, 'lettering'],
    [/surrealis/, 'surrealism'],
    [/ilustrativ|illustrative/, 'illustrative'],
    [/tribal|maori|polinesi|polynesian|samoan/, 'tribal'],
    [/geometric|geometri/, 'geometric'],
    [/acuarela|watercolou?r/, 'watercolour'],
    [/new.?school/, 'new_school'],
    [/chicano|chicana/, 'chicano'],
    [/biomecanic|biomechanic/, 'biomechanical'],
  ];
  for (const [pattern, style] of styles)
    if (pattern.test(text)) {
      slots.style = { primary: style };
      break;
    }
  const placements: [RegExp, BodyPart][] = [
    [/gemelo|pantorrilla|calf/, 'calf'],
    [/antebrazo exterior|outer forearm/, 'outer_forearm'],
    [/antebrazo|forearm/, 'inner_forearm'],
    [/espalda baja|lumbar|lower back/, 'lower_back'],
    [/espalda|back/, 'upper_back'],
    [/pecho|chest/, 'chest'],
    [/hombro|shoulder/, 'shoulder'],
    [/costilla|ribs/, 'ribs'],
    [/muslo|thigh/, 'thigh_front'],
    [/tobillo|ankle/, 'ankle'],
    [/muneca|wrist/, 'wrist_inner'],
    [/brazo|arm/, 'upper_arm_outer'],
    [/cuello|neck/, 'neck'],
  ];
  for (const [pattern, bodyPart] of placements)
    if (pattern.test(text)) {
      slots.placement = { ...slots.placement, bodyPart };
      break;
    }
  // TASK-0041: cues about whose body the generated plate is. "mujer/chica/femenino" and
  // "hombre/chico/masculino"; a bare "mi pierna" says nothing about sex and is left unset.
  if (/\b(?:mujer|chica|femenin[ao]|de ella|para ella)\b/.test(text))
    slots.placement = { ...slots.placement, bodyType: 'feminine' };
  else if (/\b(?:hombre|chico|masculin[ao]|varon|de el|para el)\b/.test(text))
    slots.placement = { ...slots.placement, bodyType: 'masculine' };
  if (/izquierd|\bleft\b/.test(text)) slots.placement = { ...slots.placement, side: 'left' };
  else if (/derech|\bright\b/.test(text)) slots.placement = { ...slots.placement, side: 'right' };
  else if (/centrad|\bcentre\b/.test(text))
    slots.placement = { ...slots.placement, side: 'centre' };
  if (/horizontal/.test(text)) slots.placement = { ...slots.placement, orientation: 'horizontal' };
  else if (/vertical/.test(text)) slots.placement = { ...slots.placement, orientation: 'vertical' };
  // TASK-0104 (ADR-0034): a sleeve wraps its limb, on the zone of that limb the client named or
  // its usual one (the calf, the outer forearm).
  const sleeve = sleeveLimb(text, slots.placement?.bodyPart);
  if (sleeve) {
    const zone = slots.placement?.bodyPart;
    const fits = wrapRegionOf(zone)?.zones.includes(sleeve === 'leg' ? 'calf' : 'outer_forearm');
    slots.placement = {
      ...slots.placement,
      bodyPart: fits ? zone : sleeve === 'leg' ? 'calf' : 'outer_forearm',
      orientation: 'wrapping',
    };
  }
  // TASK-0039: "parte en blanco y negro y el resto en color" names both, and means both. Reading
  // the first cue alone recorded black and grey as the client's word, which then overrode the
  // architect and made the worker desaturate the whole design. A negated cue ("sin color") is not
  // a request for colour.
  const monochrome =
    /blanco y negro|solo negro|en negro|negro y gris|black and (grey|gray)|black only|b\/n/.test(
      text,
    );
  const coloured = /\bcolou?r(es)?\b|colou?red/.test(text.replace(/\bsin colou?r(es)?\b/g, ''));
  if (/transicion|toques de color|acentos? de color|accent/.test(text) || (monochrome && coloured))
    slots.colour = { mode: 'black_and_grey_with_accent', palette: colours(text) };
  else if (monochrome) slots.colour = { mode: 'black_and_grey' };
  else if (coloured) slots.colour = { mode: 'colour', palette: colours(text) };
  // TASK-0073 (audit UX-01): «15 cm de ancho y 30 cm de alto» was not read, so the studio's
  // proposal replaced the client's measurement. One stated dimension is kept as theirs; the other
  // is proposed, never invented as if they had said it.
  const size = statedSize(text);
  // TASK-0104: a sleeve's size is its limb's skin unrolled, not a size the client picks.
  const sleeveSize = sleeve ? wrapSize(slots.placement?.bodyPart) : undefined;
  if (sleeveSize) slots.size = { ...sleeveSize };
  else if (size?.widthMm && size.heightMm) slots.size = size;
  else if (size) slots.size = { ...size, proposed: true };
  else if (!isSleeve(slots.placement, slots.size)) {
    // TASK-0027: a qualitative size resolves against the zone, because "grande" on a wrist and
    // "grande" on a back are not the same tattoo. An explicit measurement always wins.
    const scaled = qualitativeSize(text, slots.placement?.bodyPart);
    if (scaled) slots.size = scaled;
  }
  if (slots.colour?.palette?.length === 0) delete slots.colour.palette;
  return slots;
}
const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;
const UNIT = String.raw`(mm|cm|milimetros?|centimetros?)`;
const millimetres = (value: string, unit: string) =>
  Math.round(Number(value.replace(',', '.')) * (unit.startsWith('c') ? 10 : 1) * 10) / 10;

/**
 * The size the client stated, in millimetres (TASK-0073). Reads «15 x 30 cm», «15cm x 30cm»,
 * «15 por 30 cm», «15 cm de ancho y 30 cm de alto», «de alto 30 cm y de ancho 15» and either
 * order; a dimension without a unit takes the other's. With only one dimension, only that one is
 * returned, marked `stated`. Text is the normalised (lower-case, unaccented) message.
 */
export function statedSize(
  text: string,
): { widthMm?: number; heightMm?: number; stated?: 'width' | 'height' } | undefined {
  const compact = new RegExp(
    String.raw`${NUMBER}\s*${UNIT}?\s*(?:x|×|por)\s*${NUMBER}\s*${UNIT}\b`,
  ).exec(text);
  if (compact) {
    const unit = compact[4]!;
    return {
      widthMm: millimetres(compact[1]!, compact[2] ?? unit),
      heightMm: millimetres(compact[3]!, unit),
    };
  }
  const labelled = (words: string) =>
    new RegExp(String.raw`${NUMBER}\s*${UNIT}?\s*(?:de\s+)?(?:${words})\b`).exec(text) ??
    new RegExp(String.raw`(?:${words})\s*(?:de\s+)?${NUMBER}\s*${UNIT}?`).exec(text);
  const width = labelled('ancho|anchura');
  const height = labelled('alto|altura|largo');
  const unit = width?.[2] ?? height?.[2];
  if (!unit) return undefined;
  if (width && height)
    return {
      widthMm: millimetres(width[1]!, width[2] ?? unit),
      heightMm: millimetres(height[1]!, height[2] ?? unit),
    };
  if (width) return { widthMm: millimetres(width[1]!, unit), stated: 'width' };
  if (height) return { heightMm: millimetres(height[1]!, unit), stated: 'height' };
  return undefined;
}

const SIZE_WORDS: [RegExp, keyof typeof SIZE_SCALES][] = [
  [/\b(?:muy grande|enorme|gigante|extra grande)\b/, 'large'],
  [/\b(?:grande|amplio|cubriendo|cobertura)\b/, 'large'],
  [/\b(?:mediano|mediana|intermedio|moderado)\b/, 'medium'],
  [/\b(?:pequeno|pequena|peque|mini|discreto|diminuto|sutil)\b/, 'small'],
];

/**
 * Resolve "grande" / "mediano" / "pequeño" into millimetres for the stated zone.
 *
 * Returns nothing when the zone is unknown: the size would be a guess about a body part the
 * client has not named yet, and the consultation asks for the zone anyway.
 */
export function qualitativeSize(
  text: string,
  bodyPart: BodyPart | undefined,
): { widthMm: number; heightMm: number } | undefined {
  if (!bodyPart) return undefined;
  const span = BODY_ZONE_SPANS[bodyPart];
  if (!span) return undefined;
  const hit = SIZE_WORDS.find(([pattern]) => pattern.test(text));
  if (!hit) return undefined;
  const scale = SIZE_SCALES[hit[1]];
  if (!scale) return undefined;
  return {
    widthMm: Math.round(span.widthMm * scale),
    heightMm: Math.round(span.heightMm * scale),
  };
}

/**
 * Propose a size once a zone is known and the client has not stated one (TASK-0034, ADR-0010).
 *
 * The recommendation (the architect's, when there is one) is scaled down to fit the zone's
 * reference span, preserving its aspect; without one, a medium fraction of the zone is used. The
 * result is flagged `proposed` so it is labelled as ours. A stated size always wins. A proposal is
 * kept while the zone stays the same and re-made when it changes; with no zone there is none.
 */
export function proposeSize(
  slots: ConsultationSlots,
  recommended?: { widthMm: number; heightMm: number },
  previousZone?: BodyPart,
): ConsultationSlots {
  const size = slots.size;
  if (size?.widthMm && size?.heightMm && !size.proposed) return slots;
  // TASK-0073: the one dimension the client gave stays theirs, whatever else is proposed.
  const kept =
    size?.stated === 'width' ? size.widthMm : size?.stated === 'height' ? size.heightMm : undefined;
  const zone = slots.placement?.bodyPart;
  const span = zone ? BODY_ZONE_SPANS[zone] : undefined;
  if (!zone || !span) {
    if (!size?.proposed) return slots;
    const rest = { ...slots };
    delete rest.size;
    return rest;
  }
  if (
    size?.proposed &&
    size.widthMm &&
    size.heightMm &&
    zone === previousZone &&
    (!recommended || kept)
  )
    return slots;
  let width: number;
  let height: number;
  if (recommended) {
    const fit = Math.min(
      1,
      span.widthMm / recommended.widthMm,
      span.heightMm / recommended.heightMm,
    );
    width = recommended.widthMm * fit;
    height = recommended.heightMm * fit;
  } else {
    const scale = SIZE_SCALES['medium'] ?? 0.6;
    width = span.widthMm * scale;
    height = span.heightMm * scale;
  }
  if (kept && size?.stated === 'width') {
    height = (height * kept) / width;
    width = kept;
  } else if (kept && size?.stated === 'height') {
    width = (width * kept) / height;
    height = kept;
  }
  return {
    ...slots,
    size: {
      widthMm: Math.max(10, Math.round(width)),
      heightMm: Math.max(10, Math.round(height)),
      proposed: true,
      ...(kept ? { stated: size!.stated } : {}),
    },
  };
}

function colours(text: string): string[] {
  const palette = ['rojo', 'azul', 'verde', 'amarillo', 'naranja', 'violeta', 'dorado'].filter(
    (c) => text.includes(c),
  );
  return palette.length ? palette : [];
}
export function missingPreferences(s: ConsultationSlots): string[] {
  const missing: string[] = [];
  if (!s.subject?.description) missing.push('tema');
  if (!s.placement?.bodyPart) missing.push('zona');
  if (!s.style?.primary) missing.push('estilo');
  if (!s.colour?.mode) missing.push('color');
  return missing;
}
/** Marks a linework the studio proposed itself, so a later, better-informed value may replace it. */
export const DEFAULT_LINEWORK_NOTE = 'Propuesta técnica ajustable por el tatuador';

export function withTechnicalDefaults(s: ConsultationSlots): ConsultationSlots {
  return {
    ...s,
    linework:
      s.linework && s.linework.notes !== DEFAULT_LINEWORK_NOTE
        ? s.linework
        : {
            weight: s.style?.primary === 'fine_line' ? 'fine' : 'medium',
            notes: DEFAULT_LINEWORK_NOTE,
          },
    shading: s.shading ?? { technique: 'none', intensity: 'light' },
    placement: { ...s.placement, orientation: s.placement?.orientation ?? 'vertical' },
  };
}
