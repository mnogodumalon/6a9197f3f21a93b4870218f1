import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { labelOf } from '@/lib/journey/rules';
import type { StepForm } from '@/lib/journey/useStepForm';

/**
 * Field — label, control, hint and error for ONE form field, in that order and
 * wired for screen readers. The label is the entity's real field label
 * (`labelOf`), so a page never ships a bare input (live: a maintenance step
 * showed a date, a number and two textareas without a single label — the user
 * had to guess which was which).
 *
 *   <Field form={f} name="kosten"><Input {...f.number('kosten')} /></Field>
 *   <Field form={f} name="wartungsart" hint="Was wurde gemacht?"><ChoiceGroup {...f.choice('wartungsart')} /></Field>
 *
 * The error line is the same message `useStepForm` shows on blur; the control's
 * `aria-describedby` (set by the binding) already points at its id.
 */
export interface FieldProps {
  form: StepForm;
  name: string;
  /** Overrides the entity's field label. */
  label?: ReactNode;
  /** One short line under the control (what to enter, an example). Hidden while an error shows. */
  hint?: ReactNode;
  /** The control carries its own visible text (a Checkbox with a sentence): keep the label for screen readers only. */
  hideLabel?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ form, name, label, hint, hideLabel = false, children, className = '' }: FieldProps) {
  const id = form.fieldId(name);
  const error = form.error(name);
  return (
    <div className={`space-y-1.5 ${className}`} data-field={name}>
      <Label htmlFor={id} id={`${id}-label`} className={hideLabel ? 'sr-only' : undefined}>
        {label ?? labelOf(form.entity, name)}
        {form.required(name) && (
          <span aria-hidden="true" className="text-muted-foreground"> *</span>
        )}
      </Label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive" role="alert">{error}</p>
      )}
    </div>
  );
}
