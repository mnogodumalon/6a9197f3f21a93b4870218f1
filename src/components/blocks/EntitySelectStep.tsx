import { useState, useMemo, useEffect, useRef, useId, type ReactNode } from 'react';
import { IconSearch, IconChevronRight, IconCheck, IconPlus, IconLoader2 } from '@tabler/icons-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getStatusColor } from '@/components/blocks/StatusBadge';
import { resolveSelectMode, type SelectMode, COMPACT_MAX, SEARCH_MIN_CHARS, SEARCH_DEBOUNCE_MS } from '@/lib/journey/selectMode';
import { t } from '@/i18n';

/**
 * EntitySelectStep — "pick a record" as people expect it from a customer
 * picker (Stripe), a guest list (Airbnb host tools) or a triage list (Linear):
 * search on top, compact cards in a grid, each card recognisable at a glance —
 * an initials avatar (or your icon), the title, ONE secondary line, a status
 * pill and up to three facts. The current pick is highlighted, so returning
 * to the step ("Ändern") shows what was chosen.
 *
 * The step picks its FORM from the count, not from the caller's guess: up to
 * five records are roomy cards WITHOUT a search box (three rooms need no
 * search, but they deserve their facts), up to fifty the cards with search,
 * beyond that the search comes first — a card grid of 3.000 guests is a wall,
 * not a choice. Pills exist only as an explicit `mode="pills"`.
 *
 * Cards are only as good as their facts: pass `subtitle` and `stats` from the
 * fields users recognise a record by (the `^` fields of the entity summary),
 * not from bookkeeping columns.
 */
export interface SelectItem {
  id: string;
  title: string;
  subtitle?: string;
  status?: { key: string; label: string };
  stats?: { label: string; value: string | number }[];
  icon?: ReactNode;
}

export interface EntitySelectStepProps {
  items: SelectItem[];
  onSelect: (id: string) => void;
  /** Highlights the current pick (e.g. `form.get('gast') as string`). */
  selectedId?: string | null;
  searchPlaceholder?: string;
  emptyIcon?: ReactNode;
  emptyText?: string;
  /** Label for the "create new" button. If set, the button is shown above the list. */
  createLabel?: string;
  /** Called when the "create new" button is clicked. Use this to reveal the
   *  step's own mini-form (never the generic {Entity}Dialog). */
  onCreateNew?: () => void;
  /** Optional: render the mini-form panel alongside the list. */
  createDialog?: ReactNode;
  /** Card columns on wide screens. Default: 2 from four items on, else 1. */
  columns?: 1 | 2;
  /** Form of the step. 'auto' (default) follows the count: ≤5 roomy cards without search, ≤50 cards, more: search-first. 'pills' only on request. */
  mode?: SelectMode;
  /** Records the step could offer in total (server count). Drives 'auto' and the "n of m" line. Default: items.length. */
  totalCount?: number | null;
  /** Server-side search. When set, typing ≥2 chars replaces the list with its results (debounced, aborted on change).
   *  Comes from useRecordSearch — spread `{...search.select}`; never hand-roll it. */
  onSearch?: (query: string, signal: AbortSignal) => Promise<SelectItem[]>;
  /** Initial load pending (from useRecordSearch). */
  loading?: boolean;
  /** Load/search error to show (from useRecordSearch). */
  error?: string | null;
}

// Eight calm pastel pairs (background / ink) — a deterministic hue per record
// so the same guest always gets the same colour and neighbours differ.
const AVATAR_TONES: Array<[string, string]> = [
  ['#fbe9df', '#9a3a0f'],
  ['#e7f0fb', '#1f4d8f'],
  ['#e9f5ee', '#1a6b42'],
  ['#fdf3df', '#8a5a00'],
  ['#f1e9fb', '#5b2e9a'],
  ['#e6f5f7', '#13636f'],
  ['#fbe8ef', '#8f2447'],
  ['#eef1f5', '#3d4653'],
];

/** How many rows the search-first list shows at once. Beyond this the footer
 *  asks for a narrower query instead of growing the list — the point of the
 *  form is that you type, not that you scroll. */
const VISIBLE_MAX = 20;

function toneFor(id: string): [string, string] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

function initialsOf(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '·';
  const first = words[0].replace(/^[^\p{L}\p{N}]+/u, '');
  const last = words.length > 1 ? words[words.length - 1].replace(/^[^\p{L}\p{N}]+/u, '') : '';
  const a = first.charAt(0);
  const b = last.charAt(0) || first.charAt(1);
  return (a + b).toUpperCase() || '·';
}

/**
 * The server-search half of the step (same shape as AddressAutocomplete's
 * lookup): debounce, one in-flight request, abort the previous one on every
 * keystroke and on unmount. `results === null` means "no server answer in
 * play" — the caller then shows its own client-filtered list, so a step
 * without `onSearch` behaves exactly as it always did.
 */
function useServerSearch(onSearch: EntitySelectStepProps['onSearch'], query: string) {
  const [results, setResults] = useState<SelectItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!onSearch) return;
    const q = query.trim();
    if (q.length < SEARCH_MIN_CHARS) {
      abortRef.current?.abort();
      setResults(null);
      setSearching(false);
      setSearchError(null);
      return;
    }
    const handle = setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setSearching(true);
      setSearchError(null);
      onSearch(q, ac.signal)
        .then(rows => { if (!ac.signal.aborted) setResults(rows); })
        .catch(err => {
          if (ac.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
          setSearchError(t('sel_search_failed'));
        })
        .finally(() => { if (!ac.signal.aborted) setSearching(false); });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [onSearch, query]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { results, searching, searchError };
}

export function EntitySelectStep({
  items,
  onSelect,
  selectedId,
  // Destructuring defaults are evaluated on every render, so these follow a
  // language switch without any extra wiring.
  searchPlaceholder = t('search'),
  emptyIcon,
  emptyText = t('no_results'),
  createLabel,
  onCreateNew,
  createDialog,
  columns,
  mode = 'auto',
  totalCount,
  onSearch,
  loading = false,
  error = null,
}: EntitySelectStepProps) {
  const [search, setSearch] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const listId = useId();

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(item =>
      item.title.toLowerCase().includes(q) ||
      (item.subtitle ?? '').toLowerCase().includes(q) ||
      (item.stats ?? []).some(s => String(s.value).toLowerCase().includes(q))
    );
  }, [items, search]);

  // `totalCount` is what the SERVER holds; `items` may be one page of it.
  const total = totalCount ?? items.length;
  const resolved = resolveSelectMode(total, mode);

  const { results, searching, searchError } = useServerSearch(onSearch, search);
  // A server answer wins over the client filter; without one nothing changes.
  const shown = results ?? filtered;
  const message = searchError ?? error;

  useEffect(() => { setActiveIdx(0); }, [search]);

  const cols = columns ?? (items.length >= 4 ? 2 : 1);
  const createButton = onCreateNew ? (
    <Button type="button" variant="outline" onClick={onCreateNew} className="shrink-0 gap-1.5">
      <IconPlus size={15} aria-hidden="true" />
      {createLabel ?? t('step_create_new')}
    </Button>
  ) : null;

  const emptyBlock = (
    <div className="text-center py-12 text-muted-foreground">
      {emptyIcon && <div className="mb-3 flex justify-center opacity-40">{emptyIcon}</div>}
      <p className="text-sm">{emptyText}</p>
      {onCreateNew && (
        <Button type="button" variant="outline" size="sm" onClick={onCreateNew} className="mt-3 gap-1.5">
          <IconPlus size={14} aria-hidden="true" />
          {createLabel ?? t('step_create_new')}
        </Button>
      )}
    </div>
  );

  const loadingBlock = (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground" aria-live="polite">
      <IconLoader2 size={16} className="animate-spin" aria-hidden="true" />
      {t('sel_loading')}
    </div>
  );

  const errorLine = message ? (
    <p role="alert" className="text-xs text-destructive">{message}</p>
  ) : null;

  function footer(shownCount: number) {
    if (shownCount >= total) return null;
    return (
      <p className="text-xs text-muted-foreground text-center pt-1" aria-live="polite">
        {t('sel_showing_of', { shown: shownCount, total })}
      </p>
    );
  }

  // ── pills: few enough that a search box would be noise ────────────
  if (resolved === 'pills') {
    return (
      <div className="space-y-3">
        {createButton && <div className="flex justify-end">{createButton}</div>}
        {createDialog}
        {errorLine}
        {loading ? loadingBlock : items.length === 0 ? emptyBlock : (
          <div role="radiogroup" aria-label={searchPlaceholder} className="flex flex-wrap gap-2">
            {items.map(item => {
              const selected = selectedId != null && item.id === selectedId;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onSelect(item.id)}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                    selected
                      ? 'border-primary bg-accent text-foreground'
                      : 'border-input bg-muted/40 hover:bg-card text-foreground'
                  }`}
                >
                  {selected ? <IconCheck size={16} className="text-primary" aria-hidden="true" /> : null}
                  <span className="font-medium">{item.title}</span>
                  {item.subtitle ? <span className="text-muted-foreground">· {item.subtitle}</span> : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── search-first: the list is a result, not a catalogue ───────────
  if (resolved === 'combobox') {
    const typed = search.trim();
    const tooShort = typed.length > 0 && typed.length < SEARCH_MIN_CHARS;
    const rows = (typed.length === 0 ? items : shown).slice(0, VISIBLE_MAX);
    const candidates = typed.length === 0 ? items.length : shown.length;

    function handleKey(e: React.KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => Math.min(i + 1, rows.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = rows[activeIdx];
        if (item) onSelect(item.id);
      } else if (e.key === 'Escape') {
        setSearch('');
      }
    }

    return (
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              role="combobox"
              aria-expanded={true}
              aria-controls={listId}
              aria-autocomplete="list"
              autoFocus
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleKey}
              className="pl-9"
            />
            {searching && (
              <IconLoader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" />
            )}
          </div>
          {createButton}
        </div>

        {createDialog}
        {errorLine}

        {loading ? loadingBlock : tooShort ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            {t('sel_min_chars', { n: SEARCH_MIN_CHARS })}
          </p>
        ) : rows.length === 0 ? emptyBlock : (
          <>
            <ul id={listId} role="listbox" className="max-h-[22rem] overflow-y-auto rounded-2xl border border-border divide-y divide-border list-none m-0 p-0">
              {rows.map((item, idx) => {
                const selected = selectedId != null && item.id === selectedId;
                const [bg, ink] = toneFor(item.id);
                return (
                  <li key={item.id} className="min-w-0">
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => onSelect(item.id)}
                      className={`w-full text-left flex items-center gap-3 px-3.5 py-2.5 transition-colors focus-visible:outline-none ${
                        idx === activeIdx ? 'bg-accent' : 'bg-card hover:bg-accent/60'
                      }`}
                    >
                      {item.icon ? (
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 text-primary">
                          {item.icon}
                        </div>
                      ) : (
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-semibold tracking-wide"
                          style={{ backgroundColor: bg, color: ink }}
                          aria-hidden="true"
                        >
                          {initialsOf(item.title)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-sm truncate block">{item.title}</span>
                        {item.subtitle && (
                          <span className="text-xs text-muted-foreground truncate block">{item.subtitle}</span>
                        )}
                      </div>
                      {item.status && (
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${getStatusColor(item.status.key)}`}>
                          {item.status.label}
                        </span>
                      )}
                      {selected && <IconCheck size={16} className="text-primary shrink-0" aria-hidden="true" />}
                    </button>
                  </li>
                );
              })}
            </ul>
            {typed.length === 0 && (
              <p className="text-xs text-muted-foreground text-center">{t('sel_type_to_search')}</p>
            )}
            {/* Without a query the list is a sample of everything; with one it is
                a sample of the hits. Both cases say so rather than pretending
                the twenty rows are all there is. */}
            {typed.length === 0
              ? footer(rows.length)
              : rows.length < candidates && (
                  <p className="text-xs text-muted-foreground text-center pt-1" aria-live="polite">
                    {t('sel_showing_of', { shown: rows.length, total: candidates })}
                  </p>
                )}
          </>
        )}
      </div>
    );
  }

  // ── cards: ≤ COMPACT_MAX roomy and without a search box, else with search ──
  const compact = !onSearch && items.length <= COMPACT_MAX;
  return (
    <div className="space-y-3">
      {/* Search + Create New row — a handful of records needs no search box */}
      {compact ? (createButton ? <div className="flex justify-end">{createButton}</div> : null) : (
      <div className="flex gap-2">
        <div className="relative flex-1">
          <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
          {search && !searching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground tabular-nums" aria-live="polite">
              {shown.length}/{items.length}
            </span>
          )}
          {searching && (
            <IconLoader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        {createButton}
      </div>
      )}

      {/* createDialog slot — the step's own inline mini-form (never the
          generic {Entity}Dialog; check-intents fails the build on that import) */}
      {createDialog}
      {errorLine}

      {loading ? loadingBlock : shown.length === 0 ? emptyBlock : (
        <>
          <ul className={`grid gap-2 list-none m-0 p-0 ${cols === 2 ? 'sm:grid-cols-2' : ''}`}>
            {shown.map(item => {
              const selected = selectedId != null && item.id === selectedId;
              const [bg, ink] = toneFor(item.id);
              return (
                <li key={item.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onSelect(item.id)}
                    aria-pressed={selected}
                    className={`w-full h-full text-left flex items-start gap-3 ${compact ? 'p-5' : 'p-3.5'} rounded-2xl border transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                      selected
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-card hover:bg-accent hover:border-primary/40'
                    }`}
                  >
                    {item.icon ? (
                      <div className={`${compact ? 'w-12 h-12' : 'w-10 h-10'} rounded-xl bg-primary/10 flex items-center justify-center shrink-0 text-primary`}>
                        {item.icon}
                      </div>
                    ) : (
                      <div
                        className={`${compact ? 'w-12 h-12 text-base' : 'w-10 h-10 text-sm'} rounded-xl flex items-center justify-center shrink-0 font-semibold tracking-wide`}
                        style={{ backgroundColor: bg, color: ink }}
                        aria-hidden="true"
                      >
                        {initialsOf(item.title)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-medium ${compact ? 'text-base' : 'text-sm'} truncate group-hover:text-primary transition-colors`}>
                          {item.title}
                        </span>
                        {item.status && (
                          // Colours come from StatusBadge's single table (getStatusColor)
                          // so a status looks the same here as on its badge. Its classes
                          // include a border-* colour, which stays inert without a
                          // `border` width utility — this pill deliberately has none.
                          <span className={`ml-auto text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${getStatusColor(item.status.key)}`}>
                            {item.status.label}
                          </span>
                        )}
                      </div>
                      {item.subtitle && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.subtitle}</p>
                      )}
                      {item.stats && item.stats.length > 0 && (
                        <div className="flex gap-x-3 gap-y-0.5 mt-1.5 text-xs text-muted-foreground flex-wrap">
                          {item.stats.slice(0, 3).map((s, i) => (
                            <span key={i} className="whitespace-nowrap">
                              {s.label}: <span className="font-medium text-foreground tabular-nums">{s.value}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {selected ? (
                      <IconCheck size={16} className="text-primary shrink-0 mt-2.5" aria-hidden="true" />
                    ) : (
                      <IconChevronRight size={16} className="text-muted-foreground shrink-0 mt-2.5 group-hover:text-primary transition-colors" aria-hidden="true" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {footer(shown.length)}
        </>
      )}
    </div>
  );
}
