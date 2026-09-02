import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { IconCheck, IconCircleCheck, IconCopy, IconPrinter } from '@tabler/icons-react';
import { t } from '@/i18n';
import { makeReference } from '@/lib/journey/reference';
import { entityLabel } from '@/lib/journey/rules';
import type { StepForm, SummaryItem } from '@/lib/journey/useStepForm';
import type { JourneyResult } from '@/lib/journey/useJourneySubmit';
import { useWizard } from './IntentWizardShell';

/**
 * SuccessStep — the end of a journey that keeps working.
 *
 *   {submit.result && (
 *     <SuccessStep result={submit.result} forms={[buchung]}
 *       next={[{ label: 'Nächste Buchung anlegen', onClick: restart }, { label: 'Zur Belegungsübersicht', href: '#/' }]}
 *       whatHappensNext="Der Gast bekommt die Bestätigung per E-Mail." />
 *   )}
 *
 * Renders ONLY from a `JourneyResult` — the runner sets it after every write
 * succeeded, so this screen can never appear over a half-written journey or
 * be derived from a refetched list. Shows a deterministic reference
 * (`B-42D81A`, from the record id — nothing to store), the facts of what was
 * created, the next logical actions (first = primary), and lets the user copy
 * or print the confirmation.
 */
export interface SuccessAction {
  label: string;
  /** `#/…` or `#/intents/<slug>` — never a platform record list. */
  href?: string;
  onClick?: () => void;
  icon?: ReactNode;
}

export interface SuccessStepProps {
  result: JourneyResult;
  /** Folgeaktionen — the first is rendered as the primary button. */
  next?: SuccessAction[];
  /** Default: "<Entity> angelegt". */
  title?: string;
  /** Facts are derived from these forms (filled fields only) … */
  forms?: StepForm[];
  /** … or passed explicitly. */
  facts?: Array<Pick<SummaryItem, 'label' | 'value'>>;
  whatHappensNext?: ReactNode;
  /** Reference prefix (default: first letter of the entity). */
  referencePrefix?: string;
  children?: ReactNode;
}

export function SuccessStep({
  result,
  next = [],
  title,
  forms = [],
  facts,
  whatHappensNext,
  referencePrefix,
  children,
}: SuccessStepProps) {
  const [copied, setCopied] = useState(false);
  const wizard = useWizard();

  // The journey is complete: the shell drops the draft and stops saving —
  // regardless of whether the page wired a draftKey into the runner.
  useEffect(() => {
    wizard?.markCompleted();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The result heading ("Buchung angelegt") replaces the shell's step heading.
  const suppressHeading = wizard?.suppressHeading;
  useEffect(() => suppressHeading?.(), [suppressHeading]);

  // An update-only journey (return a tool, check a guest out) has no new record
  // and therefore no reference — the screen then shows heading and facts only.
  const reference = result.primary.id ? makeReference(result.entity ?? '', result.primary.id, referencePrefix) : null;
  const heading = title ?? (result.entity && result.primary.id ? t('sx_default_title', { entity: entityLabel(result.entity) }) : t('sx_saved'));
  const rows = (facts ?? forms.flatMap(f => f.summary()).filter(r => r.value !== '—')).slice(0, 10);

  const copy = async () => {
    const lines = [heading, ...(reference ? [`${t('sx_reference')}: ${reference}`] : []), ...rows.map(r => `${r.label}: ${r.value}`)];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the reference is still on screen */
    }
  };

  const go = (action: SuccessAction) => {
    if (action.onClick) action.onClick();
    else if (action.href) window.location.href = action.href;
  };

  return (
    <div className="journey-print space-y-6" data-journey-success="" data-reference={reference ?? undefined}>
      <style>{`@media print { body * { visibility: hidden; } .journey-print, .journey-print * { visibility: visible; } .journey-print { position: absolute; left: 0; top: 0; width: 100%; } .journey-print [data-no-print] { display: none !important; } }`}</style>

      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
          <IconCircleCheck size={26} stroke={1.75} className="text-primary" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">{heading}</h2>
          {reference && (
            <p className="text-sm text-muted-foreground mt-1">
              {t('sx_reference')}: <span className="font-mono font-semibold text-foreground tracking-wide">{reference}</span>
            </p>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <dl className="rounded-2xl border border-border bg-card divide-y divide-border">
          {rows.map((r, i) => (
            <div key={`${r.label}-${i}`} className="grid grid-cols-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] gap-x-4 px-5 py-2.5 items-baseline">
              <dt className="text-sm text-muted-foreground">{r.label}</dt>
              <dd className="text-sm font-medium break-words">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {children}

      {whatHappensNext && (
        // Screen-only: a "what happens next" hint is guidance for the person at
        // the screen, not part of the printed confirmation.
        <div className="rounded-2xl bg-muted/40 px-5 py-4" data-no-print="">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{t('sx_next_title')}</h3>
          <p className="text-sm">{whatHappensNext}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2" data-no-print="">
        {next.map((action, i) => (
          <Button key={`${action.label}-${i}`} type="button" variant={i === 0 ? 'default' : 'outline'} onClick={() => go(action)} className="gap-1.5">
            {action.icon}
            {action.label}
          </Button>
        ))}
        <span className="flex-1" />
        <Button type="button" variant="ghost" size="sm" onClick={() => void copy()} className="gap-1.5">
          {copied ? <IconCheck size={16} aria-hidden="true" /> : <IconCopy size={16} aria-hidden="true" />}
          {copied ? t('sx_copied') : t('sx_copy')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => window.print()} className="gap-1.5">
          <IconPrinter size={16} aria-hidden="true" />
          {t('sx_print')}
        </Button>
      </div>
    </div>
  );
}
