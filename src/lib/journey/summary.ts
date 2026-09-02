/**
 * Review rows — the ONE place that merges what the form knows with what the
 * page adds (`items`). The form's `summary()` already covers every bound field;
 * a page item that covers the same field keys, or repeats a label inside the
 * same step, REPLACES that form row — it is the richer line ("Bohrmaschine
 * (WZ-2024-001)" over the bare lookup label). Live: a maintenance flow listed
 * Werkzeug, Prüfer, Wartungsart and Datum twice, once from each source.
 */
import type { SummaryItem } from './useStepForm';

function labelKey(row: Pick<SummaryItem, 'label' | 'step'>): string {
  return `${row.step ?? ''}|${row.label.trim().toLowerCase()}`;
}

export function mergeSummaryRows(formRows: SummaryItem[], items: SummaryItem[]): SummaryItem[] {
  if (items.length === 0) return formRows;
  const coveredKeys = new Set(items.flatMap(i => i.keys ?? []));
  const coveredLabels = new Set(items.map(labelKey));
  const kept = formRows.filter(r => !r.keys.some(k => coveredKeys.has(k)) && !coveredLabels.has(labelKey(r)));
  // Items themselves: the first wins over a later twin (same key or same label+step).
  const seen = new Set<string>();
  const uniqueItems = items.filter(i => {
    const id = `${i.key}|${labelKey(i)}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return [...kept, ...uniqueItems];
}
