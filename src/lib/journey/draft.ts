/**
 * Draft persistence for a journey — localStorage, namespaced per dashboard.
 *
 * Dashboards share one origin (`my.living-apps.de`), so the key carries the
 * pathname (`/objects/<appgroup>/`) — a draft of one dashboard never leaks
 * into another (live-seen once). All storage access is try/catch: private
 * mode, quota, or a blocked API must never break the wizard.
 */
export const DRAFT_CLEARED_EVENT = 'journey-draft-cleared';

export interface JourneyDraft {
  step: number;
  /** One entry per form, in the order the shell received them. */
  data: Array<Record<string, unknown>>;
  labels?: Array<Record<string, string>>;
  savedAt: number;
}

/** A draft older than this is not "your work from earlier" any more. */
export const DRAFT_MAX_AGE_MS = 30 * 86_400_000;

export function draftStorageKey(draftKey: string): string {
  return `${window.location.pathname}#${draftKey}`;
}

function filled(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** True when the draft carries at least one answer — a step number alone is
 *  not worth resuming (a reload on step 3 with nothing typed produced exactly
 *  that: "Entwurf fortgesetzt" over an empty summary, live-seen). */
export function draftHasValues(draft: Pick<JourneyDraft, 'data'>): boolean {
  return draft.data.some(d => Object.values(d ?? {}).some(filled));
}

/** Removes the draft WITHOUT signalling completion (the shell keeps saving). */
export function removeJourneyDraft(draftKey: string): void {
  try {
    window.localStorage.removeItem(draftStorageKey(draftKey));
  } catch {
    /* ignore */
  }
}

export function readJourneyDraft(draftKey: string): JourneyDraft | null {
  try {
    const raw = window.localStorage.getItem(draftStorageKey(draftKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<JourneyDraft>;
    if (!parsed || typeof parsed.step !== 'number' || !Array.isArray(parsed.data)) return null;
    const draft: JourneyDraft = { step: parsed.step, data: parsed.data, labels: parsed.labels, savedAt: parsed.savedAt ?? 0 };
    const stale = draft.savedAt > 0 && Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS;
    if (stale || !draftHasValues(draft)) {
      removeJourneyDraft(draftKey);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function writeJourneyDraft(draftKey: string, draft: JourneyDraft): void {
  try {
    window.localStorage.setItem(draftStorageKey(draftKey), JSON.stringify(draft));
  } catch {
    /* storage unavailable — the wizard still works, just without a draft */
  }
}

/** Removes the draft and tells the shell to stop saving until the wizard
 *  restarts — a success step must not re-write the draft it just cleared. */
export function clearJourneyDraft(draftKey: string): void {
  try {
    window.localStorage.removeItem(draftStorageKey(draftKey));
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(DRAFT_CLEARED_EVENT, { detail: draftKey }));
  } catch {
    /* ignore */
  }
}
