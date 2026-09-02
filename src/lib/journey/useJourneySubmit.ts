/**
 * useJourneySubmit — the plan runner that writes a journey's records.
 *
 * Creates are DATA, not a try/catch pyramid:
 *
 *   const submit = useJourneySubmit(port, [
 *     { key: 'auftrag',   entity: 'auftraege',          form: auftrag, primary: true },
 *     { key: 'protokoll', entity: 'wartungsprotokolle', form: protokoll,
 *       needs: ['auftrag'], link: { auftrag: 'auftrag' } },   // field ← id of the done step
 *   ], { draftKey: 'auftrag-anlegen' });
 *
 * Steps that already succeeded stay done across retries — a retry after the
 * second create failed runs ONLY the second create (a live flow once created
 * two identical protocols). Double clicks are ignored while a run is busy.
 * `result` is set only after EVERY step succeeded; it is the only thing a
 * SuccessStep accepts, so the success screen can never render from a refetched
 * list or a half-written journey. The draft is cleared at that moment.
 */
import { useCallback, useRef, useState } from 'react';
import { clearJourneyDraft } from './draft';
import { JourneyPortError, type JourneyPort, type JourneyRecord } from './port';
import type { EntityKey } from './rules';
import type { FormValues, StepForm } from './useStepForm';

export interface PlanContext {
  port: JourneyPort;
  /** Records of the steps that already succeeded, by step key. */
  done: Record<string, JourneyRecord>;
}

export interface PlanStep {
  key: string;
  /** Shown in the per-step status list (default: the entity label / the key). */
  label?: string;
  entity?: EntityKey;
  /** Its payload() is the base of the create. */
  form?: StepForm;
  /** Extra values merged over the form payload (static or computed from done steps). */
  values?: FormValues | ((ctx: PlanContext) => FormValues);
  /** field key → step key: the field receives the id of that done step's record. */
  link?: Record<string, string>;
  /** Steps that must be done first (the plan runs in order anyway). */
  needs?: string[];
  /** The record this journey is about — reference and facts come from it (default: first step). */
  primary?: boolean;
  /** Escape hatch for anything that is not a plain create. */
  /** Return the record you touched (a MutationResult from update…Entry works) so the
   *  success screen gets its reference; returning nothing is fine for pure updates. */
  run?: (ctx: PlanContext) => Promise<JourneyRecord | { id?: string; record_id?: string; fields?: Record<string, unknown> } | void>;
}

export type PlanStepStatus = 'idle' | 'running' | 'done' | 'failed';

export interface JourneyResult {
  primary: JourneyRecord;
  entity?: EntityKey;
  records: Record<string, JourneyRecord>;
}

export interface JourneySubmit {
  /** Runs the plan (skipping done steps). Resolves to the result or null on failure / when busy. */
  run(): Promise<JourneyResult | null>;
  retry(): Promise<JourneyResult | null>;
  /** Forgets everything — for "create another one". */
  reset(): void;
  readonly submitting: boolean;
  readonly done: boolean;
  readonly error: Error | null;
  readonly result: JourneyResult | null;
  readonly status: Record<string, PlanStepStatus>;
  readonly failedStep: string | null;
  readonly doneCount: number;
  readonly plan: PlanStep[];
}

export interface JourneySubmitOptions {
  /** Cleared once the whole plan succeeded. */
  draftKey?: string;
  onSuccess?: (result: JourneyResult) => void;
}

async function createFromStep(step: PlanStep, ctx: PlanContext): Promise<JourneyRecord> {
  if (!step.entity) {
    throw new JourneyPortError(`Plan step '${step.key}' has neither 'entity' nor 'run'.`);
  }
  const base = step.form ? step.form.payload() : {};
  const extra = typeof step.values === 'function' ? step.values(ctx) : (step.values ?? {});
  const linked: FormValues = {};
  for (const [field, stepKey] of Object.entries(step.link ?? {})) {
    const rec = ctx.done[stepKey];
    if (!rec) throw new JourneyPortError(`Plan step '${step.key}' links '${field}' to '${stepKey}', which has not succeeded.`);
    linked[field] = rec.id;
  }
  return ctx.port.create(step.entity, { ...base, ...extra, ...linked });
}

function normalizeRecord(raw: unknown): JourneyRecord | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { id?: unknown; record_id?: unknown; fields?: unknown; createdAt?: unknown };
  const id = r.id ?? r.record_id;
  if (id === undefined || id === null || id === '') return undefined;
  return {
    id: String(id),
    fields: (r.fields && typeof r.fields === 'object' ? r.fields : {}) as Record<string, unknown>,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : null,
  };
}

export function useJourneySubmit(
  port: JourneyPort,
  plan: PlanStep[],
  options: JourneySubmitOptions = {},
): JourneySubmit {
  const doneRef = useRef<Record<string, JourneyRecord>>({});
  const completedRef = useRef<Set<string>>(new Set());
  const busyRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<JourneyResult | null>(null);
  const [failedStep, setFailedStep] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, PlanStepStatus>>({});

  const planRef = useRef(plan);
  planRef.current = plan;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const setStepStatus = (key: string, s: PlanStepStatus) =>
    setStatus(prev => (prev[key] === s ? prev : { ...prev, [key]: s }));

  const run = useCallback(async (): Promise<JourneyResult | null> => {
    if (busyRef.current) return null;
    if (result) return result;
    busyRef.current = true;
    setSubmitting(true);
    setError(null);
    setFailedStep(null);
    const steps = planRef.current;
    const ctx: PlanContext = { port, done: doneRef.current };
    try {
      for (const step of steps) {
        if (completedRef.current.has(step.key)) continue;
        for (const need of step.needs ?? []) {
          if (!completedRef.current.has(need)) {
            throw new JourneyPortError(`Plan step '${step.key}' needs '${need}' first — order the plan accordingly.`);
          }
        }
        setStepStatus(step.key, 'running');
        const record = normalizeRecord(step.run ? await step.run(ctx) : await createFromStep(step, ctx));
        if (record) doneRef.current[step.key] = record;
        completedRef.current.add(step.key);
        setStepStatus(step.key, 'done');
      }
      const primaryStep = steps.find(s => s.primary) ?? steps.find(s => doneRef.current[s.key]);
      // A journey that only UPDATES (return a tool, check a guest out) yields no
      // new record. It still succeeded — the success screen then shows the facts
      // without a reference (live: "The plan produced no record" over two green
      // ticks). run() may return the touched record to get a reference anyway.
      const primary = (primaryStep ? doneRef.current[primaryStep.key] : undefined) ?? { id: '', fields: {}, createdAt: null };
      const out: JourneyResult = { primary, entity: primaryStep?.entity, records: { ...doneRef.current } };
      if (optionsRef.current.draftKey) clearJourneyDraft(optionsRef.current.draftKey);
      setResult(out);
      optionsRef.current.onSuccess?.(out);
      return out;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const failing = steps.find(s => !completedRef.current.has(s.key));
      if (failing) setStepStatus(failing.key, 'failed');
      setFailedStep(failing?.key ?? null);
      setError(err);
      return null;
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  }, [port, result]);

  const reset = useCallback(() => {
    doneRef.current = {};
    completedRef.current = new Set();
    busyRef.current = false;
    setSubmitting(false);
    setError(null);
    setResult(null);
    setFailedStep(null);
    setStatus({});
  }, []);

  return {
    run,
    retry: run,
    reset,
    submitting,
    done: result !== null,
    error,
    result,
    status,
    failedStep,
    doneCount: completedRef.current.size,
    plan,
  };
}
