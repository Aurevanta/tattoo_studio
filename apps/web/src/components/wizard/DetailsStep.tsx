'use client';

import type { ReactNode } from 'react';

import { BODY_OPTIONS, STYLE_OPTIONS } from '@tattoo/consultation/preferences';
import { styleOffers } from '@tattoo/consultation/style-library';

import { Confirm } from '../Confirm';
import { InkWorking } from '../InkWorking';
import type { InkTask } from '@/lib/ink-progress';
import type { DetailField } from '@/lib/wizard';
import { BODY_CHOICES, COLOUR_CHOICES, SIDE_CHOICES, type DetailValues } from './options';

function Choices({
  label,
  choices,
  value,
  onPick,
  disabled,
  wide = false,
}: {
  label: string;
  choices: { value: string; label: string; image?: string | undefined; swatch?: string }[];
  value: string;
  onPick: (value: string) => void;
  disabled: boolean;
  wide?: boolean;
}): ReactNode {
  return (
    <fieldset className="wizard-field">
      <legend>{label}</legend>
      <div className={wide ? 'wizard-choices wizard-choices-images' : 'wizard-choices'}>
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            className="wizard-choice"
            aria-pressed={value === choice.value}
            disabled={disabled}
            onClick={() => onPick(choice.value)}
          >
            {choice.image && <img src={choice.image} alt="" loading="lazy" />}
            {choice.swatch && <span className="swatch" style={{ background: choice.swatch }} />}
            <span>{choice.label}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Step 2 (TASK-0065, TASK-0099): one pop-up with every detail as buttons, preset from the idea. */
export function DetailsStep({
  fields,
  values,
  busy,
  working,
  onChange,
  onBack,
  onContinue,
}: {
  fields: DetailField[];
  values: DetailValues;
  busy: boolean;
  /** What the studio is doing while `busy`, for the tattooing hand (TASK-0069). */
  working?: InkTask | null;
  onChange: (patch: Partial<DetailValues>) => void;
  onBack: () => void;
  onContinue: () => void;
}): ReactNode {
  const answered: Record<DetailField, string> = {
    style: values.style,
    zone: values.body,
    side: values.side,
    body: values.bodyType,
    colour: values.color,
  };
  const complete = fields.every((field) => answered[field]);
  const preset = fields.some((field) => answered[field]);
  const styles = Object.entries(STYLE_OPTIONS).map(([value, label]) => ({
    value,
    label,
    image: styleOffers(value)[0]?.image,
  }));
  const zones = Object.entries(BODY_OPTIONS).map(([value, label]) => ({ value, label: label! }));
  return (
    <Confirm
      belowHeader
      wide
      title="Nos faltan unos datos"
      onCancel={onBack}
      actions={[
        { label: 'Atrás', onClick: onBack, disabled: busy },
        {
          label: busy ? 'Guardando…' : 'Continuar',
          primary: true,
          disabled: !complete || busy,
          onClick: onContinue,
        },
      ]}
    >
      <p className="eyebrow">Paso 2 de 4</p>
      <p className="wizard-lead">
        {preset
          ? 'Hemos marcado lo que entendimos de tu idea. Cámbialo si no es lo que quieres y completa lo que falte.'
          : 'Elige cómo quieres tu tatuaje.'}
      </p>
      {fields.includes('style') && (
        <Choices
          wide
          label="Estilo"
          choices={styles}
          value={values.style}
          disabled={busy}
          onPick={(style) => onChange({ style })}
        />
      )}
      {fields.includes('zone') && (
        <Choices
          label="Zona del cuerpo"
          choices={zones}
          value={values.body}
          disabled={busy}
          onPick={(body) => onChange({ body })}
        />
      )}
      {fields.includes('side') && (
        <Choices
          label="Lado"
          choices={SIDE_CHOICES}
          value={values.side}
          disabled={busy}
          onPick={(side) => onChange({ side })}
        />
      )}
      {fields.includes('body') && (
        <Choices
          label="Cuerpo para la vista previa"
          choices={BODY_CHOICES}
          value={values.bodyType}
          disabled={busy}
          onPick={(bodyType) => onChange({ bodyType })}
        />
      )}
      {fields.includes('colour') && (
        <Choices
          label="Color"
          choices={COLOUR_CHOICES}
          value={values.color}
          disabled={busy}
          onPick={(color) => onChange({ color })}
        />
      )}
      {working && <InkWorking task={working} />}
    </Confirm>
  );
}
