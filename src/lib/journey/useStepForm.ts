/**
 * useStepForm — the validation and binding layer of a journey step.
 *
 * The generator knows every field (required, kind, options, label); this hook
 * turns that into bindings a page spreads onto its inputs and widgets:
 *
 *   const f = useStepForm('buchungen', { steps: { gast: 1, anreise: 2, abreise: 2 } });
 *   <Input {...f.field('name')} />                       text / email / tel / url / textarea
 *   <DatePicker {...f.date('anreise')} />                single date
 *   <ChoiceGroup {...f.choice('status')} />              lookup (≤ 6 options)
 *   <Combobox {...f.record('kunde')} items={…} />        applookup
 *   <AvailabilityRangePicker {...f.range('anreise', 'abreise', { blocked })} />
 *   <StepNav onNext={() => f.validate(['name', 'email'])} />
 *
 * Timing follows "reward early, punish late": nothing is said in an untouched
 * field, an error appears on blur, disappears the moment the value is fixed,
 * and `f.ok(key)` turns true only after the user touched the field. Messages
 * name the real field label ("„Anreisedatum" ist ein Pflichtfeld").
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { t, tp } from '@/i18n';
import { rangeIsFree } from '@/components/blocks/AvailabilityRangePicker';
import { formatFieldValue, formatRange } from './format';
import { FIELD_RULES, isEmptyValue, labelOf, optionsOf, type EntityKey, type FieldRule } from './rules';
import { occupancyRuleOf } from './occupancy';

export type FormValues = Record<string, unknown>;

export interface SummaryItem {
  key: string;
  label: string;
  value: string;
  /** Wizard step that edits this value — enables "Change" in the summary. */
  step?: number;
  /** All field keys behind this row (a range row has two). */
  keys: string[];
  /** The element to focus when the user wants to change it. */
  fieldId: string;
}

export interface FormError {
  key: string;
  label: string;
  message: string;
  fieldId: string;
}

export interface StepFormOptions {
  /** Subset and order of fields (default: every writable field of the entity). */
  fields?: string[];
  /** field key → wizard step number. Drives "Change" links and answer chips. */
  steps?: Record<string, number>;
  /** Override the platform's `required` per field (public pages declare their own). */
  required?: Record<string, boolean>;
  initial?: FormValues;
  /** Prefix for element ids (default: the entity key). */
  id?: string;
}

export interface RangeOptions {
  blocked?: Array<{ start: string; end?: string | null }>;
  minNights?: number;
}

type ChangeLike = unknown | { target: { value: unknown; type?: string; checked?: boolean } };

export interface FieldProps {
  id: string;
  name: string;
  value: string;
  onChange: (next: ChangeLike) => void;
  onBlur: () => void;
  required: boolean;
  type?: string;
  inputMode?: 'text' | 'decimal' | 'numeric' | 'tel' | 'email' | 'url';
  autoComplete?: string;
  maxLength?: number;
  step?: string;
  'aria-required'?: true;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

export interface DateProps {
  id: string;
  value: string | null;
  onChange: (next: string | null) => void;
  required: boolean;
  invalid: boolean;
  mode: 'date' | 'datetime';
}

export interface ChoiceProps {
  /** Points at the <Field> label — a radiogroup is not labelable by htmlFor. */
  'aria-labelledby'?: string;
  id: string;
  value: string | null;
  onChange: (key: string | null) => void;
  options: Array<{ key: string; label: string }>;
  required: boolean;
  invalid: boolean;
  'aria-describedby'?: string;
}

export interface CheckboxProps {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean | 'indeterminate') => void;
}

export interface RecordProps {
  id: string;
  value: string | null;
  onChange: (id: string | null) => void;
  invalid: boolean;
}

export interface RangeProps {
  value: { from: string | null; to: string | null };
  onChange: (range: { from: string | null; to: string | null }) => void;
  blocked: Array<{ start: string; end?: string | null }>;
  minNights: number;
}

export interface StepForm {
  readonly entity: EntityKey;
  readonly id: string;
  readonly keys: string[];
  readonly rules: Record<string, FieldRule>;
  readonly values: FormValues;
  /** Display names learned while picking records, keyed by field key and by record id. */
  readonly labels: Record<string, string>;
  get(key: string): unknown;
  set(key: string, value: unknown, label?: string): void;
  /** Teach the form a record's display name (for summaries of multi-record fields). */
  remember(recordId: string, label: string): void;
  reset(values?: FormValues, labels?: Record<string, string>): void;
  field(key: string): FieldProps;
  number(key: string): FieldProps;
  date(key: string): DateProps;
  choice(key: string): ChoiceProps;
  checkbox(key: string): CheckboxProps;
  record(key: string): RecordProps;
  range(fromKey: string, toKey: string, opts?: RangeOptions): RangeProps;
  /** The visible error of a field (after touch or a validate() attempt). */
  error(key: string): string | undefined;
  /** True once the user touched the field and it is filled and valid. */
  ok(key: string): boolean;
  /** Errors of attempted fields — what a FieldErrorSummary lists. */
  readonly errors: FormError[];
  /** Labels of required fields that are still empty — regardless of touch state. */
  readonly missing: string[];
  readonly required: (key: string) => boolean;
  /** Validates the given fields (default all), marks them attempted, focuses
   *  the first invalid one. Returns true when everything passed. */
  validate(keys?: string[]): boolean;
  stepOf(key: string): number | undefined;
  /** True when the form ASKS for the field — listed in `fields` or given a
   *  step. A required field the page never asks for is not "missing": the
   *  plan supplies it (values/link), an update leaves it as it is, or it is
   *  the team's later duty. Without `fields` and `steps` every key is bound. */
  bound(key: string): boolean;
  fieldId(key: string): string;
  /** Formatted rows for a summary — a range shows as ONE row. Empty optional
   *  fields are skipped; empty required ones show as "—" so the gap is visible. */
  summary(): SummaryItem[];
  /** Values of the rule fields, empty ones removed — what `port.create` takes. */
  payload(): FormValues;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TEL_RE = /^\+?[0-9][0-9 ()\/.-]{4,}$/;
// Scheme optional (people type "example.org"), a dotted host, then anything.
const URL_RE = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i;

function isUrl(v: string): boolean {
  return URL_RE.test(v);
}

function isEventLike(v: ChangeLike): v is { target: { value: unknown; type?: string; checked?: boolean } } {
  return typeof v === 'object' && v !== null && 'target' in v && typeof (v as { target: unknown }).target === 'object';
}

function inputTypeFor(rule: FieldRule | undefined): string | undefined {
  switch (rule?.kind) {
    case 'email':
      return 'email';
    case 'tel':
      return 'tel';
    case 'url':
      return 'url';
    case 'number':
      return 'number';
    case 'textarea':
      return undefined;
    default:
      return 'text';
  }
}

function inputModeFor(rule: FieldRule | undefined): FieldProps['inputMode'] {
  switch (rule?.kind) {
    case 'email':
      return 'email';
    case 'tel':
      return 'tel';
    case 'url':
      return 'url';
    case 'number':
      return 'decimal';
    default:
      return undefined;
  }
}

function focusById(id: string): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(id);
  if (!el) return;
  try {
    (el as HTMLElement).focus({ preventScroll: false });
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  } catch {
    /* ignore */
  }
}

export function useStepForm(entity: EntityKey, options: StepFormOptions = {}): StepForm {
  const rules = useMemo(
    () => (FIELD_RULES as Record<string, Record<string, FieldRule>>)[entity] ?? {},
    [entity],
  );
  const fieldsKey = options.fields?.join('|') ?? '';
  const keys = useMemo(
    () => options.fields ?? Object.keys(rules).filter(k => rules[k].writable),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rules, fieldsKey],
  );
  const formId = options.id ?? entity;
  const stepsMap = options.steps ?? {};
  const requiredOverride = options.required ?? {};
  const boundKeys = new Set<string>([...(options.fields ?? []), ...Object.keys(stepsMap)]);
  const bound = (key: string): boolean => boundKeys.size === 0 || boundKeys.has(key);
  // The stay's resource (the agent's occupancy rule in src/config/journey.ts)
  // is mandatory whenever the form carries it — a booking without its room
  // cannot be checked against occupancy. Pages need not repeat that; an
  // explicit `required` entry still wins.
  const occupancyResource = occupancyRuleOf(entity)?.resource;

  const [values, setValues] = useState<FormValues>(() => ({ ...(options.initial ?? {}) }));
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState<Record<string, boolean>>({});
  // Ranges register themselves on each render (idempotent) so validation and
  // the summary know which two fields form one input.
  const rangesRef = useRef<Record<string, { from: string; to: string; opts: RangeOptions }>>({});

  const fieldId = useCallback((key: string) => `${formId}-${key}`, [formId]);
  const errorId = useCallback((key: string) => `${formId}-${key}-error`, [formId]);
  const isRequired = useCallback(
    (key: string) =>
      requiredOverride[key] ?? (key === occupancyResource && keys.includes(key) ? true : rules[key]?.required ?? false),
    [requiredOverride, rules, occupancyResource, keys],
  );

  const rangeEndingAt = (key: string) => Object.values(rangesRef.current).find(r => r.to === key);

  const messageFor = useCallback(
    (key: string, vals: FormValues): string | undefined => {
      const rule = rules[key];
      const label = labelOf(entity, key);
      const v = vals[key];
      const asTo = rangeEndingAt(key);
      if (isEmptyValue(v)) {
        if (isRequired(key)) return t('v_required', { label });
        // A stay with an arrival but no departure is incomplete even when the
        // platform marks neither field required.
        if (asTo && !isEmptyValue(vals[asTo.from])) return t('v_required', { label });
        return undefined;
      }
      switch (rule?.kind) {
        case 'email':
          if (!EMAIL_RE.test(String(v).trim())) return t('v_email', { label });
          break;
        case 'tel':
          if (!TEL_RE.test(String(v).trim())) return t('v_tel', { label });
          break;
        case 'url':
          if (!isUrl(String(v).trim())) return t('v_url', { label });
          break;
        case 'number': {
          const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
          if (!Number.isFinite(n)) return t('v_number', { label });
          break;
        }
        case 'text':
        case 'textarea':
          if (rule.maxLength && String(v).length > rule.maxLength) return t('v_maxlength', { label, max: rule.maxLength });
          break;
        case 'lookup': {
          const k = typeof v === 'object' && v !== null && 'key' in v ? (v as { key: string }).key : String(v);
          if (rule.options && rule.options.length && !rule.options.includes(k)) return t('v_option', { label });
          break;
        }
        default:
          break;
      }
      if (asTo) {
        const from = vals[asTo.from];
        if (!isEmptyValue(from)) {
          const a = String(from).slice(0, 10);
          const b = String(v).slice(0, 10);
          if (b <= a) return t('v_range_order', { from: labelOf(entity, asTo.from), to: label });
          const nights = Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
          const min = asTo.opts.minNights ?? 1;
          if (nights < min) return tp('v_min_nights', min, { n: min });
          if (asTo.opts.blocked && asTo.opts.blocked.length && !rangeIsFree(a, b, asTo.opts.blocked)) {
            return t('v_range_blocked');
          }
        }
      }
      return undefined;
    },
    [entity, isRequired, rules],
  );

  const set = useCallback((key: string, value: unknown, label?: string) => {
    setValues(prev => (prev[key] === value ? prev : { ...prev, [key]: value }));
    if (label !== undefined) {
      setLabels(prev => {
        const next = { ...prev, [key]: label };
        if (typeof value === 'string') next[value] = label;
        return next;
      });
    }
  }, []);

  const remember = useCallback((recordId: string, label: string) => {
    setLabels(prev => (prev[recordId] === label ? prev : { ...prev, [recordId]: label }));
  }, []);

  const touch = useCallback((key: string) => {
    setTouched(prev => (prev[key] ? prev : { ...prev, [key]: true }));
  }, []);

  const visibleError = (key: string): string | undefined =>
    touched[key] || attempted[key] ? messageFor(key, values) : undefined;

  const describedBy = (key: string): string | undefined => (visibleError(key) ? errorId(key) : undefined);

  const handleChange = (key: string) => (next: ChangeLike) => {
    if (isEventLike(next)) {
      const tgt = next.target;
      set(key, tgt.type === 'checkbox' ? Boolean(tgt.checked) : tgt.value);
    } else {
      set(key, next);
    }
  };

  const field = (key: string): FieldProps => {
    const rule = rules[key];
    const raw = values[key];
    const err = visibleError(key);
    const props: FieldProps = {
      id: fieldId(key),
      name: key,
      value: raw === undefined || raw === null ? '' : String(raw),
      onChange: handleChange(key),
      onBlur: () => touch(key),
      required: isRequired(key),
    };
    const type = inputTypeFor(rule);
    if (type) props.type = type;
    const mode = inputModeFor(rule);
    if (mode) props.inputMode = mode;
    if (rule?.autoComplete) props.autoComplete = rule.autoComplete;
    if (rule?.maxLength) props.maxLength = rule.maxLength;
    if (rule?.kind === 'number') props.step = 'any';
    if (props.required) props['aria-required'] = true;
    if (err) {
      props['aria-invalid'] = true;
      props['aria-describedby'] = errorId(key);
    }
    return props;
  };

  const number = (key: string): FieldProps => field(key);

  const date = (key: string): DateProps => ({
    id: fieldId(key),
    value: values[key] === undefined || values[key] === null || values[key] === '' ? null : String(values[key]),
    onChange: next => {
      set(key, next);
      touch(key);
    },
    required: isRequired(key),
    invalid: Boolean(visibleError(key)),
    mode: rules[key]?.kind === 'datetime' ? 'datetime' : 'date',
  });

  const choice = (key: string): ChoiceProps => ({
    id: fieldId(key),
    // A radiogroup is not labelable by htmlFor — it points at the <Field> label.
    'aria-labelledby': `${fieldId(key)}-label`,
    value:
      values[key] === undefined || values[key] === null || values[key] === ''
        ? null
        : typeof values[key] === 'object' && 'key' in (values[key] as object)
          ? String((values[key] as { key: string }).key)
          : String(values[key]),
    onChange: next => {
      set(key, next);
      touch(key);
    },
    options: optionsOf(entity, key),
    required: isRequired(key),
    invalid: Boolean(visibleError(key)),
    'aria-describedby': describedBy(key),
  });

  const checkbox = (key: string): CheckboxProps => ({
    id: fieldId(key),
    checked: Boolean(values[key]),
    onCheckedChange: next => {
      set(key, next === true);
      touch(key);
    },
  });

  const record = (key: string): RecordProps => ({
    id: fieldId(key),
    value: values[key] === undefined || values[key] === null || values[key] === '' ? null : String(values[key]),
    onChange: id => {
      set(key, id);
      touch(key);
    },
    invalid: Boolean(visibleError(key)),
  });

  const range = (fromKey: string, toKey: string, opts: RangeOptions = {}): RangeProps => {
    rangesRef.current[`${fromKey}|${toKey}`] = { from: fromKey, to: toKey, opts };
    const from = values[fromKey];
    const to = values[toKey];
    return {
      value: {
        from: from === undefined || from === null || from === '' ? null : String(from),
        to: to === undefined || to === null || to === '' ? null : String(to),
      },
      onChange: next => {
        setValues(prev => ({ ...prev, [fromKey]: next.from, [toKey]: next.to }));
        touch(fromKey);
        if (next.to) touch(toKey);
      },
      blocked: opts.blocked ?? [],
      minNights: opts.minNights ?? 1,
    };
  };

  const errors: FormError[] = keys
    .filter(k => attempted[k])
    .map(k => ({ key: k, message: messageFor(k, values) }))
    .filter((e): e is { key: string; message: string } => Boolean(e.message))
    .map(e => ({ key: e.key, label: labelOf(entity, e.key), message: e.message, fieldId: fieldId(e.key) }));

  const missing = keys.filter(k => bound(k) && isRequired(k) && isEmptyValue(values[k])).map(k => labelOf(entity, k));

  const validate = (which?: string[]): boolean => {
    const target = which ?? keys.filter(bound);
    setAttempted(prev => {
      const next = { ...prev };
      for (const k of target) next[k] = true;
      return next;
    });
    const firstBad = target.find(k => messageFor(k, values));
    if (firstBad) {
      focusById(fieldId(firstBad));
      return false;
    }
    return true;
  };

  const summary = (): SummaryItem[] => {
    const items: SummaryItem[] = [];
    const rangeByFrom = new Map<string, { from: string; to: string }>();
    const consumed = new Set<string>();
    for (const r of Object.values(rangesRef.current)) {
      rangeByFrom.set(r.from, r);
      consumed.add(r.from);
      consumed.add(r.to);
    }
    for (const key of keys) {
      const asFrom = rangeByFrom.get(key);
      if (asFrom) {
        const from = values[asFrom.from];
        const to = values[asFrom.to];
        const empty = isEmptyValue(from) && isEmptyValue(to);
        if (!bound(asFrom.from) && !bound(asFrom.to)) continue;
        if (empty && !isRequired(asFrom.from) && !isRequired(asFrom.to)) continue;
        items.push({
          key: `${asFrom.from}+${asFrom.to}`,
          keys: [asFrom.from, asFrom.to],
          label: `${labelOf(entity, asFrom.from)} / ${labelOf(entity, asFrom.to)}`,
          value: formatRange(from as string | null, to as string | null),
          step: stepsMap[asFrom.from] ?? stepsMap[asFrom.to],
          fieldId: fieldId(asFrom.from),
        });
        continue;
      }
      if (consumed.has(key)) continue;
      const empty = isEmptyValue(values[key]);
      if (!bound(key) || (empty && !isRequired(key))) continue;
      items.push({
        key,
        keys: [key],
        label: labelOf(entity, key),
        value: formatFieldValue(entity, key, values[key], labels),
        step: stepsMap[key],
        fieldId: fieldId(key),
      });
    }
    return items;
  };

  const payload = (): FormValues => {
    const out: FormValues = {};
    for (const key of keys) {
      if (rules[key] && !rules[key].writable) continue;
      if (isEmptyValue(values[key])) continue;
      out[key] = values[key];
    }
    return out;
  };

  const reset = (next?: FormValues, nextLabels?: Record<string, string>) => {
    setValues({ ...(next ?? options.initial ?? {}) });
    setLabels({ ...(nextLabels ?? {}) });
    setTouched({});
    setAttempted({});
  };

  return {
    entity,
    id: formId,
    keys,
    rules,
    values,
    labels,
    get: key => values[key],
    set,
    remember,
    reset,
    field,
    number,
    date,
    choice,
    checkbox,
    record,
    range,
    error: visibleError,
    ok: key => Boolean(touched[key]) && !isEmptyValue(values[key]) && !messageFor(key, values),
    errors,
    missing,
    required: isRequired,
    validate,
    stepOf: key => stepsMap[key],
    bound,
    fieldId,
    summary,
    payload,
  };
}
