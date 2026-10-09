'use client';

import { useRef, type ReactNode } from 'react';

import { BODY_OPTIONS, STYLE_OPTIONS } from '@tattoo/consultation/preferences';

import { Confirm } from '../Confirm';
import { InkWorking } from '../InkWorking';
import type { InkTask } from '@/lib/ink-progress';
import { BODY_CHOICES, COLOUR_CHOICES, SIDE_CHOICES, type DetailValues } from './options';

export interface SummaryValues extends DetailValues {
  width: string;
  height: string;
  refined: string;
}

function Select({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <label className="wizard-summary-field">
      {label}
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Step 4 (TASK-0065): everything that will be tattooed, each value editable where it is shown,
 * and one answer: «Esto es lo que quiero» accepts it and starts the design.
 */
export function SummaryStep({
  idea,
  values,
  referenceCount,
  bodyPhotoId,
  busy,
  working,
  error,
  quotaNote,
  outOfDesigns = false,
  onChange,
  onOwnPhoto,
  onStudioSkin,
  onBack,
  onConfirm,
}: {
  idea: string;
  values: SummaryValues;
  referenceCount: number;
  bodyPhotoId: string;
  busy: boolean;
  /** What the studio is doing while `busy`, for the tattooing hand (TASK-0069). */
  working?: InkTask | null;
  error?: string;
  /** What is left today (TASK-0095); `outOfDesigns` when nothing is. */
  quotaNote?: string | null;
  outOfDesigns?: boolean;
  onChange: (patch: Partial<SummaryValues>) => void;
  onOwnPhoto: (file: File) => void;
  onStudioSkin: () => void;
  onBack: () => void;
  onConfirm: () => void;
}): ReactNode {
  const photo = useRef<HTMLInputElement>(null);
  const styles = Object.entries(STYLE_OPTIONS).map(([value, label]) => ({ value, label }));
  const zones = Object.entries(BODY_OPTIONS).map(([value, label]) => ({ value, label: label! }));
  return (
    <Confirm
      belowHeader
      wide
      title="Esto es lo que vamos a tatuar"
      onCancel={onBack}
      actions={[
        { label: 'Atrás', onClick: onBack, disabled: busy },
        {
          label: busy ? 'Preparando…' : 'Esto es lo que quiero',
          primary: true,
          disabled: busy || outOfDesigns || !values.width || !values.height,
          onClick: onConfirm,
        },
      ]}
    >
      <p className="eyebrow">Paso 4 de 4</p>
      <p className="wizard-idea-quote">«{idea}»</p>
      <label className="wizard-summary-field wizard-summary-wide">
        Descripción profesional
        <textarea
          value={values.refined}
          maxLength={1200}
          disabled={busy}
          onChange={(event) => onChange({ refined: event.target.value })}
          placeholder="Cómo se lo pediríamos a un tatuador: el motivo, su postura, los elementos y su composición."
        />
      </label>
      <div className="wizard-summary-grid">
        <Select
          label="Estilo"
          value={values.style}
          options={styles}
          disabled={busy}
          onChange={(style) => onChange({ style })}
        />
        <Select
          label="Zona"
          value={values.body}
          options={zones}
          disabled={busy}
          onChange={(body) => onChange({ body })}
        />
        <Select
          label="Lado"
          value={values.side}
          options={SIDE_CHOICES}
          disabled={busy}
          onChange={(side) => onChange({ side })}
        />
        <Select
          label="Cuerpo"
          value={values.bodyType}
          options={BODY_CHOICES}
          disabled={busy}
          onChange={(bodyType) => onChange({ bodyType })}
        />
        <Select
          label="Color"
          value={values.color}
          options={COLOUR_CHOICES}
          disabled={busy}
          onChange={(color) => onChange({ color })}
        />
        <label className="wizard-summary-field">
          Tamaño (mm)
          <span className="wizard-size">
            <input
              type="number"
              min={5}
              max={600}
              aria-label="Ancho en milímetros"
              value={values.width}
              disabled={busy}
              onChange={(event) => onChange({ width: event.target.value })}
            />
            ×
            <input
              type="number"
              min={5}
              max={600}
              aria-label="Alto en milímetros"
              value={values.height}
              disabled={busy}
              onChange={(event) => onChange({ height: event.target.value })}
            />
          </span>
        </label>
      </div>
      <fieldset className="wizard-field">
        <legend>Ver el resultado sobre</legend>
        <div className="wizard-choices">
          <button
            type="button"
            className="wizard-choice"
            aria-pressed={!bodyPhotoId}
            disabled={busy}
            onClick={onStudioSkin}
          >
            Piel de estudio
          </button>
          <button
            type="button"
            className="wizard-choice"
            aria-pressed={Boolean(bodyPhotoId)}
            disabled={busy}
            onClick={() => photo.current?.click()}
          >
            {bodyPhotoId ? 'Mi foto ✓' : 'Mi foto'}
          </button>
        </div>
        {bodyPhotoId && (
          <img
            className="wizard-photo"
            src={`/api/media?id=${bodyPhotoId}`}
            alt="Tu foto para colocar el diseño"
          />
        )}
      </fieldset>
      <p className="small-note">
        {referenceCount
          ? `Se usarán ${referenceCount} referencia${referenceCount > 1 ? 's' : ''}. `
          : 'Sin referencias: el diseño parte de la descripción. '}
        Al pulsar «Esto es lo que quiero» aceptas este resumen y empezamos a diseñar.
      </p>
      {quotaNote && (
        <p className={outOfDesigns ? 'quota-note quota-note-out' : 'quota-note'}>{quotaNote}</p>
      )}
      {working && <InkWorking task={working} />}
      {error && <p role="alert">{error}</p>}
      <input
        ref={photo}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onOwnPhoto(file);
          event.target.value = '';
        }}
      />
    </Confirm>
  );
}
