import { useEffect, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { IconAlertCircle, IconArrowLeft, IconCheck } from '@tabler/icons-react';
import { t } from '@/i18n';

interface WizardStep {
  label: string;
}

interface IntentWizardShellProps {
  /** Omit inside a PublicShell that already carries the title — otherwise the
   *  page shows the same heading twice (both render an <h1>). */
  title?: string;
  subtitle?: string;
  steps: WizardStep[];
  currentStep: number;
  onStepChange: (step: number) => void;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  /** Header back link. Defaults to the dashboard; pass false to hide it
   *  (public pages have no dashboard to go back to). */
  back?: { href: string; label: string } | false;
  children: ReactNode;
}

export function IntentWizardShell({
  title,
  subtitle,
  steps,
  currentStep,
  onStepChange,
  loading,
  error,
  onRetry,
  back,
  children,
}: IntentWizardShellProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Sync step to URL params
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (currentStep > 1) {
      params.set('step', String(currentStep));
    } else {
      params.delete('step');
    }
    setSearchParams(params, { replace: true });
  }, [currentStep, searchParams, setSearchParams]);

  // Read step from URL on mount
  useEffect(() => {
    const urlStep = parseInt(searchParams.get('step') ?? '', 10);
    if (urlStep >= 1 && urlStep <= steps.length && urlStep !== currentStep) {
      onStepChange(urlStep);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <div className="flex gap-2">
          {steps.map((_, i) => <Skeleton key={i} className="h-2 flex-1 rounded-full" />)}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center">
            <IconAlertCircle size={22} className="text-destructive" />
          </div>
          <div className="text-center">
            <h3 className="font-semibold text-foreground mb-1">{t('load_error_title')}</h3>
            <p className="text-sm text-muted-foreground max-w-xs">{error.message}</p>
          </div>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>{t('retry')}</Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        {/* The default back target is the DASHBOARD — on a public route an
            anonymous visitor has no session there, so the shell suppresses
            its default itself instead of relying on every public page to
            remember `back={false}`. An explicit `back` object still wins. */}
        {back !== false && (back || !window.location.hash.startsWith('#/public')) && (
          <a href={back?.href ?? '#/'} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2">
            <IconArrowLeft size={14} className="shrink-0" />
            {back?.label ?? t('wizard_back_to_dashboard')}
          </a>
        )}
        {title && <h1 className="text-2xl font-bold tracking-tight">{title}</h1>}
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>

      {/* Step Indicator — a symmetric META element, so it centers as a
          compact group (fixed connectors, no stretching). The CONTENT column
          around it (title, description, fields) stays on the left reading
          axis — do not center those. The old layout gave every step flex-1
          but the last one had no connector to fill it, so the group hung
          visibly off to the left. */}
      <div className="flex items-start justify-center">
        {steps.map((step, idx) => (
          <div key={idx} className="flex items-start min-w-0">
            <div className="flex flex-col items-center gap-1 min-w-0">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 transition-colors ${
                  idx + 1 < currentStep
                    ? 'bg-primary text-primary-foreground'
                    : idx + 1 === currentStep
                    ? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {idx + 1 < currentStep ? <IconCheck size={14} stroke={2.5} /> : idx + 1}
              </div>
              <span className={`text-xs font-medium whitespace-nowrap hidden sm:block px-1 ${
                idx + 1 === currentStep ? 'text-primary' : 'text-muted-foreground'
              }`}>
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              /* h-0.5 line vertically centered on the 32px dot: (32-2)/2 */
              <div className={`h-0.5 w-6 sm:w-12 mt-[15px] mx-1.5 shrink-0 transition-colors ${
                idx + 1 < currentStep ? 'bg-primary' : 'bg-muted'
              }`} />
            )}
          </div>
        ))}
      </div>

      {/* Step Content */}
      <div>{children}</div>

      {/* Navigation — hidden by default; steps provide their own action buttons */}
    </div>
  );
}
