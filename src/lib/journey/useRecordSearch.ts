/**
 * useRecordSearch — the one hook a "pick a record" step uses.
 *
 * It answers the question the page cannot answer for itself: is this entity
 * small enough to hand over as an array, or does it have to be searched on the
 * server? It asks the door for a COUNT first (aggregate_records — no records
 * travel), then either loads everything as before or loads one page and hands
 * EntitySelectStep an `onSearch` that queries the server while the user types.
 *
 *   const gaeste = useRecordSearch(servicePort, 'gaeste', {
 *     searchFields: ['vorname', 'nachname', 'email'],
 *     toItem: g => ({ id: g.id, title: `${g.fields.vorname ?? ''} ${g.fields.nachname ?? ''}`.trim() }),
 *   });
 *   <EntitySelectStep {...gaeste.select} selectedId={f.get('gast') as string}
 *     onSelect={id => f.set('gast', id, gaeste.labelOf(id))} />
 *
 * The public door cannot count or filter (grants allow field/limit/offset), so
 * `count` returns null there, the hook loads what the grant hands out (≤500)
 * and EntitySelectStep searches it client-side. The step's FORM adapts either
 * way — that is resolveSelectMode's job, not this hook's.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JourneyPort, JourneyRecord } from './port';
import type { EntityKey } from './rules';
import { SERVER_SEARCH_FROM, SEARCH_PAGE_SIZE } from './selectMode';
import { t } from '@/i18n';

export interface SelectItemLike { id: string; title: string; }

export interface RecordSearchOptions<T extends SelectItemLike> {
  /** String-typed fields the search runs over (text, email, tel). check-intents 3j validates them. */
  searchFields: string[];
  /** The agent's semantic mapping record → card (title from the `^` fields, subtitle, stats). */
  toItem: (record: JourneyRecord) => T;
  /** vSQL order, e.g. ['r.v_nachname asc'] (internal door only). */
  orderby?: string[];
  /** Below this count everything is loaded once and searched client-side (default SERVER_SEARCH_FROM). */
  loadAllUpTo?: number;
  pageSize?: number;
}

export interface RecordSearch<T extends SelectItemLike> {
  /** Spread into <EntitySelectStep {...search.select} onSelect={…} />. */
  select: {
    items: T[];
    totalCount: number | null;
    onSearch?: (query: string, signal: AbortSignal) => Promise<T[]>;
    loading: boolean;
    error: string | null;
  };
  /** Display name of any record seen so far (first page or a search hit) — for f.set(key, id, label). */
  labelOf(id: string): string | undefined;
  /** Re-run the initial load (after an inline create). */
  reload(): Promise<void>;
}

/** The whole decision, as a pure function so it can be tested without React.
 *  An unknown count (`null`, the public door) loads everything — the door caps
 *  it anyway, and guessing "large" would break a public picker. The threshold
 *  is INCLUSIVE: exactly `loadAllUpTo` records still load in one go. */
export function decideStrategy(
  count: number | null,
  loadAllUpTo: number = SERVER_SEARCH_FROM,
  pageSize: number = SEARCH_PAGE_SIZE,
): { serverSearch: boolean; limit?: number } {
  if (count === null || count <= loadAllUpTo) return { serverSearch: false };
  return { serverSearch: true, limit: pageSize };
}

export function useRecordSearch<T extends SelectItemLike>(
  port: JourneyPort,
  entity: EntityKey,
  options: RecordSearchOptions<T>,
): RecordSearch<T> {
  const { searchFields, toItem, orderby, loadAllUpTo = SERVER_SEARCH_FROM, pageSize = SEARCH_PAGE_SIZE } = options;
  const [items, setItems] = useState<T[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [serverSearch, setServerSearch] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef(new Map<string, string>());
  // Never re-fetch because an inline mapper closure changed identity.
  const toItemRef = useRef(toItem);
  toItemRef.current = toItem;
  const fieldsKey = searchFields.join('|');
  const orderKey = (orderby ?? []).join('|');

  const remember = useCallback((rows: T[]) => {
    for (const r of rows) seen.current.set(r.id, r.title);
    return rows;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const count = await port.count(entity);
      setTotalCount(count);
      const strategy = decideStrategy(count, loadAllUpTo, pageSize);
      setServerSearch(strategy.serverSearch);
      const rows = await port.list(entity, strategy.serverSearch ? { limit: strategy.limit, orderby } : { orderby });
      const mapped = remember(rows.map(r => toItemRef.current(r)));
      setItems(mapped);
      // A door that cannot count still knows how much it handed over.
      if (count === null) setTotalCount(mapped.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sel_search_failed'));
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keys stand in for the arrays
  }, [port, entity, loadAllUpTo, pageSize, orderKey, remember]);

  useEffect(() => { void load(); }, [load]);

  const onSearch = useMemo(() => serverSearch
    ? async (query: string, signal: AbortSignal) => {
        const rows = await port.list(entity, { search: { query, fields: searchFields }, limit: pageSize, orderby, signal });
        return remember(rows.map(r => toItemRef.current(r)));
      }
    : undefined,
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keys stand in for the arrays
  [serverSearch, port, entity, fieldsKey, orderKey, pageSize, remember]);

  return {
    select: { items, totalCount, onSearch, loading, error },
    labelOf: id => seen.current.get(id),
    reload: load,
  };
}
