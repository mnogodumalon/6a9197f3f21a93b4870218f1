import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { IconArrowLeft, IconArrowRight, IconLoader2 } from '@tabler/icons-react';
import { t } from '@/i18n';
import { useWizard } from './IntentWizardShell';

/**
 * StepNav — Back / Continue for a wizard step, with a label that says WHERE
 * the button leads ("Weiter: Zimmer wählen") instead of a bare "Weiter".
 *
 *   <StepNav onNext={() => f.validate(['gast'])} nextStepLabel="Zimmer wählen" />
 *
 * `onNext` may return false (or a Promise of false) to stay on the step — the
 * usual case is a `form.validate(...)` call. Navigation itself comes from the
 * shell context: after "Change" in the summary, Continue returns straight to
 * the summary instead of walking every remaining step.
 */
export interface StepNavProps {
  onBack?: () => void;
  onNext?: () => boolean | void | Promise<boolean | void>;
  /** Full label override. */
  nextLabel?: string;
  /** The next step's name → "Continue: <name>". Defaults to the shell's next step label. */
  nextStepLabel?: string;
  backLabel?: string;
  nextDisabled?: boolean;
  hideBack?: boolean;
  busy?: boolean;
  /** Rendered between the two buttons (a hint, a counter, a secondary action). */
  children?: ReactNode;
  className?: string;
}

export function StepNav({
  onBack,
  onNext,
  nextLabel,
  nextStepLabel,
  backLabel,
  nextDisabled,
  hideBack,
  busy,
  children,
  className = '',
}: StepNavProps) {
  const wizard = useWizard();
  const [pending, setPending] = useState(false);

  const handleNext = async () => {
    if (pending) return;
    setPending(true);
    try {
      const ok = onNext ? await onNext() : true;
      if (ok === false) return;
      wizard?.next();
    } finally {
      setPending(false);
    }
  };

  const handleBack = () => {
    if (onBack) onBack();
    else wizard?.prev();
  };

  const showBack = !hideBack && (onBack || (wizard ? wizard.position > 1 : false));
  const label =
    nextLabel ??
    (wizard?.returnTo != null && wizard.returnTo !== wizard.step
      ? t('sn_to_summary')
      : nextStepLabel
        ? t('sn_next_to', { step: nextStepLabel })
        : wizard?.nextLabel
          ? t('sn_next_to', { step: wizard.nextLabel })
          : t('sn_next'));
  const working = busy || pending;
  // On the last enabled step `wizard.next()` goes nowhere — a "Weiter" there
  // is a button that does nothing (live-seen on a check-out page whose
  // review was gated behind submit.done). The last step confirms through
  // SummaryStep; StepNav only offers the way back.
  const atEnd = wizard !== null && wizard.position >= wizard.total;

  return (
    <div className={`flex flex-wrap items-center gap-3 border-t border-border pt-4 mt-6 ${className}`}>
      {showBack ? (
        <Button type="button" variant="ghost" onClick={handleBack} className="gap-1.5">
          <IconArrowLeft size={16} aria-hidden="true" />
          {backLabel ?? t('sn_back')}
        </Button>
      ) : (
        <span />
      )}
      <div className="flex-1 min-w-0 text-sm text-muted-foreground">{children}</div>
      {!atEnd && (
        <Button type="button" onClick={handleNext} disabled={nextDisabled || working} className="gap-1.5">
          {working ? <IconLoader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
          {label}
          {!working && <IconArrowRight size={16} aria-hidden="true" />}
        </Button>
      )}
    </div>
  );
}
