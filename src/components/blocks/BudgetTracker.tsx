import { formatCurrency } from '@/lib/formatters';
import { t } from '@/i18n';

interface BudgetTrackerProps {
  budget: number;
  booked: number;
  label?: string;
  showRemaining?: boolean;
}

export function BudgetTracker({ budget, booked, label = 'Budget', showRemaining = true }: BudgetTrackerProps) {
  const percent = budget > 0 ? Math.min((booked / budget) * 100, 100) : 0;
  const remaining = budget - booked;
  const overBudget = booked > budget;
  const barColor = overBudget ? 'bg-red-500' : percent >= 80 ? 'bg-amber-500' : 'bg-primary';

  if (budget <= 0) {
    return (
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="font-medium text-muted-foreground">{label}</span>
          <span className="font-semibold">{formatCurrency(booked)}</span>
        </div>
        <p className="text-xs text-muted-foreground">{t('budget_none')}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className={`font-semibold ${overBudget ? 'text-red-600' : ''}`}>
          {Math.round(percent)}%
        </span>
      </div>

      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {t('budget_booked')}: <span className="font-semibold text-foreground">{formatCurrency(booked)}</span>
        </span>
        <span>{t('budget_of')} {formatCurrency(budget)}</span>
      </div>

      {showRemaining && (
        <div className="flex items-center justify-between text-xs pt-1 border-t">
          <span className="text-muted-foreground">{t('budget_remaining')}</span>
          <span className={`font-semibold ${overBudget ? 'text-red-600' : 'text-green-600'}`}>
            {formatCurrency(remaining)}
          </span>
        </div>
      )}

      {overBudget && (
        <p className="text-xs text-red-600 font-medium">{t('budget_over')}</p>
      )}
    </div>
  );
}
