import { useState } from 'react';
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { t, tp, dateFnsLocale } from '@/i18n';

// AvailabilityRangePicker — an availability-aware date-range calendar for
// booking flows (the Airbnb pattern): occupied nights are visible AND
// unselectable, and a range can never span one. The consumer maps its
// occupancy records into `blocked` and binds `value`/`onChange`; everything
// else (month grid, selection rules, legend, hints) lives here.
//
// Availability arrives as a PROP — this block never fetches. Public pages
// map listPublicRecords results, intent pages map useDashboardData arrays.
//
// Hotel convention: a blocked range's `end` (departure day) is EXCLUSIVE —
// the flat frees up that morning, so a new arrival on an existing departure
// day is fine, and an existing arrival day is a valid new departure
// ("checkout-only day"). The picker encodes this; do not re-derive it.

const DATE_FMT = 'yyyy-MM-dd';

export interface AvailabilityRange {
  /** Arrival date, ISO `yyyy-MM-dd`. */
  start: string;
  /** Departure date, EXCLUSIVE. Missing/null blocks only the start night. */
  end?: string | null;
}

export interface DateRangeValue {
  from: string | null;
  to: string | null;
}

/** Whether the NIGHT starting on `dayIso` is occupied (start <= day < end). */
export function isNightBlocked(dayIso: string, blocked: AvailabilityRange[]): boolean {
  return blocked.some(r => {
    if (!r.start) return false;
    const end = r.end ?? format(addDays(parseISO(r.start), 1), DATE_FMT);
    return r.start <= dayIso && dayIso < end;
  });
}

/** Every night of [fromIso, toIso) is free. Use this as the submit-time
 *  revalidation of what the picker already prevents interactively — the
 *  listed availability can go stale between page load and submit. */
export function rangeIsFree(fromIso: string, toIso: string, blocked: AvailabilityRange[]): boolean {
  if (!(fromIso < toIso)) return false;
  for (let d = parseISO(fromIso); format(d, DATE_FMT) < toIso; d = addDays(d, 1)) {
    if (isNightBlocked(format(d, DATE_FMT), blocked)) return false;
  }
  return true;
}

interface AvailabilityRangePickerProps {
  blocked: AvailabilityRange[];
  value: DateRangeValue;
  onChange: (range: DateRangeValue) => void;
  /** Shortest allowed stay in nights (default 1). */
  minNights?: number;
  /** Months rendered side by side on wide containers (default 2). */
  months?: number;
  /** Days before today are inert (default true). */
  disablePast?: boolean;
  legend?: boolean;
}

export function AvailabilityRangePicker({
  blocked,
  value,
  onChange,
  minNights = 1,
  months = 2,
  disablePast = true,
  legend = true,
}: AvailabilityRangePickerProps) {
  const locale = dateFnsLocale();
  const todayIso = format(new Date(), DATE_FMT);
  const [cursor, setCursor] = useState(() =>
    startOfMonth(value.from ? parseISO(value.from) : new Date()),
  );
  const [hint, setHint] = useState<string | null>(null);

  const selectingDeparture = Boolean(value.from && !value.to);
  const nights = value.from && value.to
    ? differenceInCalendarDays(parseISO(value.to), parseISO(value.from))
    : 0;

  const clickDay = (iso: string) => {
    if (disablePast && iso < todayIso) return;
    // Second click: try to complete the range.
    if (selectingDeparture && value.from && iso > value.from) {
      if (rangeIsFree(value.from, iso, blocked)) {
        const n = differenceInCalendarDays(parseISO(iso), parseISO(value.from));
        if (n < minNights) {
          setHint(t('arp_hint_min_nights', { n: minNights }));
          return;
        }
        setHint(null);
        onChange({ from: value.from, to: iso });
        return;
      }
      // The span crosses an occupied night — fall through: the click
      // restarts the selection (free day) or explains itself (blocked day).
    }
    if (isNightBlocked(iso, blocked)) {
      setHint(t('arp_hint_blocked'));
      return;
    }
    setHint(null);
    onChange({ from: iso, to: null });
  };

  const prevDisabled = disablePast && format(cursor, DATE_FMT) <= format(startOfMonth(new Date()), DATE_FMT);
  const monthStarts = Array.from({ length: Math.max(1, months) }, (_, i) => addMonths(cursor, i));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {value.from && value.to
            ? tp('arp_nights', nights)
            : selectingDeparture
              ? t('arp_pick_departure')
              : t('arp_pick_arrival')}
        </p>
        <div className="flex items-center gap-1">
          {value.from ? (
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 mr-2"
              onClick={() => { setHint(null); onChange({ from: null, to: null }); }}
            >
              {t('arp_clear')}
            </button>
          ) : null}
          <button
            type="button"
            aria-label={t('arp_prev_month')}
            disabled={prevDisabled}
            className="h-8 w-8 flex items-center justify-center rounded-md border bg-card hover:bg-accent disabled:opacity-40 disabled:pointer-events-none transition-colors"
            onClick={() => setCursor(c => addMonths(c, -1))}
          >
            <IconChevronLeft size={16} />
          </button>
          <button
            type="button"
            aria-label={t('arp_next_month')}
            className="h-8 w-8 flex items-center justify-center rounded-md border bg-card hover:bg-accent transition-colors"
            onClick={() => setCursor(c => addMonths(c, 1))}
          >
            <IconChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {monthStarts.slice(0, 2).map(monthStart => {
          const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
          const gridEnd = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 });
          const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
          const monthIso = format(monthStart, 'yyyy-MM');
          return (
            <div key={monthIso}>
              <p className="text-sm font-medium text-center mb-2 capitalize">
                {format(monthStart, 'LLLL yyyy', { locale })}
              </p>
              <div className="grid grid-cols-7 gap-y-1 text-center">
                {days.slice(0, 7).map(d => (
                  <span key={`h-${format(d, 'i')}`} className="text-xs text-muted-foreground py-1">
                    {format(d, 'EEEEEE', { locale })}
                  </span>
                ))}
                {days.map(d => {
                  const iso = format(d, DATE_FMT);
                  if (!iso.startsWith(monthIso)) {
                    return <span key={iso} aria-hidden="true" />;
                  }
                  const past = disablePast && iso < todayIso;
                  const nightBlocked = isNightBlocked(iso, blocked);
                  const isFrom = value.from === iso;
                  const isTo = value.to === iso;
                  const inRange = Boolean(
                    value.from && value.to && value.from < iso && iso < value.to,
                  );
                  // A blocked day still accepts a click while a departure is
                  // being picked — it may be a valid checkout-only day; the
                  // handler decides. Only past days are truly inert.
                  const cls = past
                    ? 'text-muted-foreground/40'
                    : isFrom || isTo
                      ? 'bg-primary text-primary-foreground font-medium'
                      : inRange
                        ? 'bg-primary/10'
                        : nightBlocked
                          ? 'text-muted-foreground/60 line-through bg-muted/60'
                          : 'hover:bg-accent';
                  return (
                    <button
                      key={iso}
                      type="button"
                      disabled={past}
                      aria-label={format(d, 'PPP', { locale })}
                      aria-pressed={isFrom || isTo}
                      className={`h-9 sm:h-10 w-full max-w-10 mx-auto text-sm rounded-md flex items-center justify-center transition-colors ${cls}`}
                      onClick={() => clickDay(iso)}
                    >
                      {format(d, 'd')}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {hint ? (
        <p className="text-sm text-destructive" role="status">{hint}</p>
      ) : null}

      {legend ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm border bg-card" aria-hidden="true" />
            {t('arp_legend_free')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-muted line-through" aria-hidden="true" />
            {t('arp_legend_blocked')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-primary" aria-hidden="true" />
            {t('arp_legend_selected')}
          </span>
        </div>
      ) : null}
    </div>
  );
}
