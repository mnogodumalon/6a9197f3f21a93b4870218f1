import { useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { IconAlertCircle, IconCheck, IconCircleDashed, IconLoader2, IconX } from '@tabler/icons-react';
import { t } from '@/i18n';
import { planProvidedKeys } from '@/lib/journey/port';
import { mergeSummaryRows } from '@/lib/journey/summary';
import { entityLabel, isEmptyValue, labelOf } from '@/lib/journey/rules';
import type { StepForm, SummaryItem } from '@/lib/journey/useStepForm';
import type { JourneySubmit, PlanStep } from '@/lib/journey/useJourneySubmit';
import { useWizard } from './IntentWizardShell';

/**
 * SummaryStep — "Check your answers" before anything is written.
 *
 *   <SummaryStep forms={[buchung]} submit={submit} whatHappensNext="Die Buchung erscheint sofort im Belegungsplan." />
 *
 * Every answer, grouped by the step that asked it, with a "Change" link that
 * jumps back to that step AND puts focus into the field; Continue there
 * returns here. Missing required fields are listed as links and disable
 * Confirm — the page never computes that itself. While the plan runs, every
 * write shows its own status; a failure keeps the entries, names what is
 * already saved and offers a retry that only repeats what failed.
 *
 * `forms` and `submit` are required by type: a summary cannot be rendered
 * without the data it summarizes or the runner it confirms.
 */
export interface SummaryStepProps {
  forms: StepForm[];
  submit: JourneySubmit;
  title?: string;
  /** One or two sentences: what happens after Confirm. */
  whatHappensNext?: ReactNode;
  confirmLabel?: string;
  /** Extra rows the forms do not know about (a computed total, a picked option). */
  items?: SummaryItem[];
  /** Override the jump: default uses the shell (goTo step + focus field + return here). */
  onEdit?: (step: number, fieldId: string) => void;
  /** Rendered between the answers and the confirm area. */
  children?: ReactNode;
}

function stepLabelOf(step: PlanStep): string {
  if (step.label) return step.label;
  if (step.entity) return entityLabel(step.entity);
  return step.key;
}

export function SummaryStep({
  forms,
  submit,
  title,
  whatHappensNext,
  confirmLabel,
  items = [],
  onEdit,
  children,
}: SummaryStepProps) {
  const wizard = useWizard();

  // The rows below ARE the answers — the shell's chips above would double them.
  const suppressChips = wizard?.suppressChips;
  useEffect(() => suppressChips?.(), [suppressChips]);
  // "Alles richtig?" is this step's heading — the shell's would double it.
  const suppressHeading = wizard?.suppressHeading;
  useEffect(() => suppressHeading?.(), [suppressHeading]);

  // Page `items` refine, never double: an item covering a form field's keys
  // (or its label in the same step) replaces that form row.
  const rows: SummaryItem[] = mergeSummaryRows(forms.flatMap(f => f.summary()), items);
  const groups = new Map<number | undefined, SummaryItem[]>();
  for (const row of rows) {
    const list = groups.get(row.step) ?? [];
    list.push(row);
    groups.set(row.step, list);
  }
  const groupKeys = [...groups.keys()].sort((a, b) => (a ?? Infinity) - (b ?? Infinity));

  // Missing = required, empty, ASKED FOR by the form (bound) and not supplied
  // by its plan step (values, link). A required field the flow never asks for
  // is nobody's input here: "Buchung anlegen" set status via plan values,
  // "Einchecken" updates a record whose room is already there — both blocked
  // the confirm with a link to nowhere (live-seen).
  const missing = forms.flatMap(f => {
    const provided = planProvidedKeys(submit.plan.find(s => s.form === f));
    return f.keys
      .filter(k => f.bound(k) && f.required(k) && isEmptyValue(f.values[k]) && !provided.has(k))
      .map(k => ({ label: labelOf(f.entity, k), fieldId: f.fieldId(k), step: f.stepOf(k) }));
  });

  const edit = (step: number | undefined, fieldId: string) => {
    if (step === undefined) return;
    if (onEdit) onEdit(step, fieldId);
    else wizard?.goTo(step, { focus: fieldId, returnTo: wizard.step });
  };

  const canEdit = (step: number | undefined) => step !== undefined && (Boolean(onEdit) || Boolean(wizard));
  const showPlan = submit.plan.length > 1 && (submit.submitting || submit.error !== null || submit.doneCount > 0);
  const savedLabels = submit.plan.filter(s => submit.status[s.key] === 'done').map(stepLabelOf);

  return (
    <div className="space-y-6" data-journey-summary="">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title ?? t('ss_title')}</h2>
      </div>

      {groupKeys.map(step => {
        const groupRows = groups.get(step) ?? [];
        // Rows that all derive from the SAME source (a picked record's facts,
        // `keys: ['_recordId']`) are one choice, not many fields: one "Auswahl
        // ändern" on the group instead of a per-row "Ändern" that can only lead
        // back to the picker (live-seen: Anreisedatum → Ändern → record list).
        const oneSource = groupRows.length > 1 && groupRows.every(r => r.keys.join('|') === groupRows[0].keys.join('|'));
        const groupEdit = oneSource && canEdit(step) ? groupRows[0] : null;
        return (
        <section key={step ?? 'none'} className="rounded-2xl border border-border bg-card overflow-hidden">
          {step !== undefined && (
            <h3 className="flex items-center justify-between gap-3 px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b border-border">
              <span>{wizard?.steps[step - 1]?.label ?? t('ss_step_of', { n: step })}</span>
              {groupEdit && (
                <button
                  type="button"
                  onClick={() => edit(step, groupEdit.fieldId)}
                  className="normal-case tracking-normal text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
                >
                  {t('ss_change_selection')}
                </button>
              )}
            </h3>
          )}
          <dl className="divide-y divide-border">
            {groupRows.map(row => (
              <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-5 py-3 items-baseline">
                <dt className="text-sm text-muted-foreground">{row.label}</dt>
                <dd className="text-sm font-medium break-words col-span-2 sm:col-span-1 order-3 sm:order-none">{row.value}</dd>
                <div className="justify-self-end">
                  {!groupEdit && canEdit(row.step) && (
                    <button
                      type="button"
                      onClick={() => edit(row.step, row.fieldId)}
                      className="text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
                      aria-label={`${t('ss_change')}: ${row.label}`}
                    >
                      {t('ss_change')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </dl>
        </section>
        );
      })}

      {children}

      {missing.length > 0 && (
        <p role="alert" className="text-sm text-destructive flex flex-wrap items-center gap-x-1.5">
          <IconAlertCircle size={16} aria-hidden="true" />
          <span>{t('ss_missing')}</span>
          {missing.map((m, i) => (
            <span key={m.fieldId}>
              {canEdit(m.step) ? (
                <button type="button" onClick={() => edit(m.step, m.fieldId)} className="underline underline-offset-2 hover:no-underline">
                  {m.label}
                </button>
              ) : (
                m.label
              )}
              {i < missing.length - 1 ? ',' : ''}
            </span>
          ))}
        </p>
      )}

      {showPlan && (
        <ol className="rounded-2xl border border-border bg-card divide-y divide-border" aria-live="polite">
          {submit.plan.map(step => {
            const s = submit.status[step.key] ?? 'idle';
            return (
              <li key={step.key} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                {s === 'done' && <IconCheck size={16} className="text-primary shrink-0" aria-hidden="true" />}
                {s === 'failed' && <IconX size={16} className="text-destructive shrink-0" aria-hidden="true" />}
                {s === 'running' && <IconLoader2 size={16} className="animate-spin text-muted-foreground shrink-0" aria-hidden="true" />}
                {s === 'idle' && <IconCircleDashed size={16} className="text-muted-foreground shrink-0" aria-hidden="true" />}
                <span className="font-medium">{stepLabelOf(step)}</span>
                <span className="text-muted-foreground">
                  {s === 'done' ? t('ss_step_done') : s === 'failed' ? t('ss_step_failed') : s === 'running' ? t('ss_step_running') : t('ss_step_idle')}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {submit.error && (
        <div role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 space-y-2">
          <p className="font-semibold text-destructive">{t('ss_error_title')}</p>
          <p className="text-sm text-muted-foreground break-words">{submit.error.message}</p>
          {savedLabels.length > 0 && (
            <p className="text-sm">{t('ss_partial', { done: savedLabels.join(', ') })}</p>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => void submit.retry()} disabled={submit.submitting}>
            {t('ss_retry')}
          </Button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 border-t border-border pt-4">
        {whatHappensNext && <p className="text-sm text-muted-foreground flex-1">{whatHappensNext}</p>}
        <Button
          type="button"
          onClick={() => void submit.run()}
          disabled={submit.submitting || missing.length > 0}
          className="gap-2 sm:ml-auto"
          data-journey-confirm=""
        >
          {submit.submitting && <IconLoader2 size={16} className="animate-spin" aria-hidden="true" />}
          {submit.submitting ? t('ss_submitting') : (confirmLabel ?? t('ss_confirm'))}
        </Button>
      </div>
    </div>
  );
}
