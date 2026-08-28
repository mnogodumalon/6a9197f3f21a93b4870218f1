import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { IconCircleCheck, IconEye, IconLoader2 } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/DatePicker';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';
// Feldlabels/Options folgen der Besucher-Browsersprache über das Bundle;
// das Config-Label bleibt der Fallback (Alt-Seiten, fremde Apps).
import { t, fieldLabelByAppId, lookupLabelByAppId } from '@/i18n';
import {
  loadPublicPagesConfig,
  isPreviewMode,
  prepareChallenge,
  createPublicRecord,
  listPublicRecords,
  PageUnavailableError,
  RateLimitedError,
  FieldValidationError,
  type PublicPagesConfig,
  type PublicPageConfig,
  type PublicFieldConfig,
} from '@/lib/publicClient';

// Public form page — the anonymous side of "Öffentliche Formulare".
//
// Rendered entirely from the runtime config (./public-pages.json): the Klar
// service writes that file next to the bundle when the owner creates or edits
// a public page, so new forms go live without a rebuild. The config is
// self-contained (labels, fulltypes, options per field) — this page needs no
// generated metadata. Mounted OUTSIDE <Layout>: no sidebar, no auth listener,
// mobile-first single column.

type Status = 'loading' | 'ready' | 'submitting' | 'done' | 'unavailable';

type FieldValues = Record<string, unknown>;

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

interface RefOption {
  value: string; // suffix "/apps/{app}/records/{id}" — the wire value
  label: string;
}

interface FieldInputProps {
  field: PublicFieldConfig;
  appId: string;
  value: unknown;
  onChange: (value: unknown) => void;
  refOptions?: RefOption[];
  refLoading?: boolean;
}

function FieldInput({ field, appId, value, onChange, refOptions, refLoading }: FieldInputProps) {
  const ft = field.fulltype;
  const options = field.options ?? [];

  if (ft.includes('applookup')) {
    if (refLoading) {
      return <IconLoader2 size={18} stroke={1.5} className="animate-spin text-muted-foreground" />;
    }
    const opts = refOptions ?? [];
    if (field.multiple) {
      const current = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="space-y-2">
          {opts.map(opt => (
            <div key={opt.value} className="flex items-center gap-2">
              <Checkbox
                id={`${field.key}_${opt.value}`}
                checked={current.includes(opt.value)}
                onCheckedChange={checked => {
                  const next = checked ? [...current, opt.value] : current.filter(v => v !== opt.value);
                  onChange(next.length ? next : undefined);
                }}
              />
              <Label htmlFor={`${field.key}_${opt.value}`} className="font-normal">{opt.label}</Label>
            </div>
          ))}
        </div>
      );
    }
    return (
      <Select value={(value as string) ?? ''} onValueChange={v => onChange(v === 'none' ? undefined : v)}>
        <SelectTrigger id={field.key} className="max-sm:h-11"><SelectValue placeholder="" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">—</SelectItem>
          {opts.map(opt => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (ft === 'string/textarea') {
    return (
      <Textarea
        id={field.key}
        rows={3}
        value={(value as string) ?? ''}
        onChange={e => onChange(e.target.value || undefined)}
      />
    );
  }

  if (ft === 'string/email') {
    return (
      <Input
        id={field.key}
        type="email"
        placeholder=""
        value={(value as string) ?? ''}
        onChange={e => onChange(e.target.value || undefined)}
      />
    );
  }

  if (ft === 'number' || ft.startsWith('number/')) {
    return (
      <Input
        id={field.key}
        type="number"
        step="any"
        placeholder=""
        value={value === undefined || value === null ? '' : (value as number)}
        onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    );
  }

  if (ft === 'bool') {
    return (
      <div className="flex items-center gap-2 pt-1">
        <Checkbox id={field.key} checked={!!value} onCheckedChange={v => onChange(!!v)} />
        <Label htmlFor={field.key} className="font-normal">{fieldLabelByAppId(appId, field.key) ?? field.label}</Label>
      </div>
    );
  }

  if (ft === 'date/date' || ft === 'date/datetimeminute') {
    return (
      <DatePicker
        id={field.key}
        placeholder=""
        mode={ft === 'date/date' ? 'date' : 'datetime'}
        value={(value as string) ?? null}
        onChange={v => onChange(v ?? undefined)}
      />
    );
  }

  if ((ft === 'lookup/select' || ft === 'lookup/radio') && options.length > 0) {
    // ≤5 options → segmented pills (matches the dialog UX); larger sets → Select.
    if (options.length <= 5) {
      return (
        <div role="radiogroup" className="flex flex-wrap gap-1.5">
          {options.map(opt => {
            const selected = value === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(selected ? undefined : opt.key)}
                className={`inline-flex items-center justify-center min-h-9 max-sm:min-h-11 max-sm:px-4 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  selected
                    ? 'bg-foreground text-background border-foreground'
                    : 'bg-background text-foreground border-input hover:bg-accent'
                }`}
              >
                {lookupLabelByAppId(appId, field.key, opt.key) ?? opt.label}
              </button>
            );
          })}
        </div>
      );
    }
    return (
      <Select
        value={(value as string) ?? ''}
        onValueChange={v => onChange(v === 'none' ? undefined : v)}
      >
        <SelectTrigger id={field.key} className="max-sm:h-11"><SelectValue placeholder="" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">—</SelectItem>
          {options.map(opt => (
            <SelectItem key={opt.key} value={opt.key}>{lookupLabelByAppId(appId, field.key, opt.key) ?? opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (ft.includes('multiplelookup') && options.length > 0) {
    const current = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="space-y-2">
        {options.map(opt => (
          <div key={opt.key} className="flex items-center gap-2">
            <Checkbox
              id={`${field.key}_${opt.key}`}
              checked={current.includes(opt.key)}
              onCheckedChange={checked => {
                const next = checked ? [...current, opt.key] : current.filter(k => k !== opt.key);
                onChange(next.length ? next : undefined);
              }}
            />
            <Label htmlFor={`${field.key}_${opt.key}`} className="font-normal">{lookupLabelByAppId(appId, field.key, opt.key) ?? opt.label}</Label>
          </div>
        ))}
      </div>
    );
  }

  if (ft === 'geo') {
    const geo = value as { lat: number; long: number; info?: string } | undefined;
    return (
      <div className="space-y-2">
        <AddressAutocomplete
          placeholder={t('pf_address_placeholder')}
          onSelect={r => onChange({ lat: r.lat, long: r.long, info: r.label })}
        />
        {geo ? (
          <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
            <span className="truncate">{geo.info ?? `${geo.lat}, ${geo.long}`}</span>
            <button type="button" className="underline shrink-0" onClick={() => onChange(undefined)}>
              {t('pf_remove_text')}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  // string/text and anything else → plain input.
  return (
    <Input
      id={field.key}
      placeholder=""
      value={(value as string) ?? ''}
      onChange={e => onChange(e.target.value || undefined)}
    />
  );
}

export default function PublicFormPage() {
  const { slug } = useParams<{ slug: string }>();
  const [status, setStatus] = useState<Status>('loading');
  const [config, setConfig] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [values, setValues] = useState<FieldValues>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // applookup options fetched at runtime, keyed by field key. Value is the
  // wire suffix "/apps/{targetApp}/records/{id}" the create endpoint expects.
  const [refOptions, setRefOptions] = useState<Record<string, RefOption[]>>({});
  const [refLoading, setRefLoading] = useState(false);
  const preparedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cfg = await loadPublicPagesConfig(slug);
      if (cancelled) return;
      const pg = cfg && slug ? cfg.pages[slug] : undefined;
      if (!cfg || !pg) {
        setStatus('unavailable');
        return;
      }
      setConfig(cfg);
      setPage(pg);
      setStatus('ready');

      // Load option lists for applookup fields from their target apps
      // (chained read grant). Best-effort: a field whose list fails just
      // renders empty.
      const refFields = pg.fields.filter(f => f.fulltype.includes('applookup') && f.target_app_id);
      if (refFields.length > 0) {
        setRefLoading(true);
        const loaded: Record<string, RefOption[]> = {};
        for (const f of refFields) {
          try {
            const records = await listPublicRecords(cfg, pg, { appId: f.target_app_id!, limit: 500 });
            loaded[f.key] = Object.entries(records).map(([id, rec]) => ({
              value: `/apps/${f.target_app_id}/records/${id}`,
              label: String((f.display_field && rec.fields[f.display_field]) ?? id),
            }));
          } catch {
            loaded[f.key] = [];
          }
        }
        if (!cancelled) {
          setRefOptions(loaded);
          setRefLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Pre-solve the anti-abuse challenge on first interaction so submitting
  // feels instant. Fire-and-forget; submit re-solves if this one went stale.
  const handleFirstInteraction = () => {
    if (preparedRef.current || !config || !page) return;
    preparedRef.current = true;
    prepareChallenge(config, page, 'POST', `/apps/${page.app_id}/records`);
  };

  const setField = (key: string, value: unknown) => {
    handleFirstInteraction();
    setValues(v => ({ ...v, [key]: value }));
    setFieldErrors(errs => {
      if (!(key in errs)) return errs;
      const next = { ...errs };
      delete next[key];
      return next;
    });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!config || !page || status === 'submitting') return;
    setFormError(null);

    const missing: Record<string, string> = {};
    for (const field of page.fields) {
      if (field.required && isEmpty(values[field.key])) {
        missing[field.key] = t('pf_required_error_text');
      }
    }
    if (Object.keys(missing).length > 0) {
      setFieldErrors(missing);
      return;
    }

    setStatus('submitting');
    try {
      const fields: FieldValues = {};
      for (const field of page.fields) {
        if (!isEmpty(values[field.key])) fields[field.key] = values[field.key];
      }
      await createPublicRecord(config, page, fields);
      setStatus('done');
    } catch (err) {
      if (err instanceof PageUnavailableError) {
        setStatus('unavailable');
        return;
      }
      setStatus('ready');
      if (err instanceof FieldValidationError) {
        const errs: Record<string, string> = {};
        for (const key of err.missingFields) errs[key] = t('pf_required_error_text');
        setFieldErrors(errs);
        if (err.unallowedFields.length > 0 || err.missingFields.length === 0) {
          setFormError(t('pf_error_generic_text'));
        }
      } else if (err instanceof RateLimitedError) {
        setFormError(t('pf_rate_limit_text'));
      } else {
        setFormError(t('pf_error_generic_text'));
      }
    }
  };

  const resetForAnotherEntry = () => {
    setValues({});
    setFieldErrors({});
    setFormError(null);
    setStatus('ready');
    preparedRef.current = false;
  };

  // Same chrome as PublicShell (bespoke pages) — keep the two in sync.
  const shell = (children: ReactNode) => (
    <div className="min-h-screen bg-background flex flex-col">
      {isPreviewMode() ? (
        <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-white">
          <IconEye size={14} stroke={1.5} className="shrink-0" />
          <span>{t('ps_preview_banner')}</span>
        </div>
      ) : null}
      <main className="flex-1 w-full max-w-[640px] mx-auto px-4 py-8 sm:py-12">{children}</main>
      <footer className="py-4 text-center text-xs text-muted-foreground">
        {t('pf_powered_by_text')}
      </footer>
    </div>
  );

  if (status === 'loading') {
    return shell(
      <div className="flex justify-center pt-16">
        <IconLoader2 size={28} stroke={1.5} className="animate-spin text-muted-foreground" />
      </div>,
    );
  }

  if (status === 'unavailable' || !page || !config) {
    return shell(
      <div className="rounded-[27px] bg-card shadow-lg p-6 sm:p-8 text-center">
        <h1 className="text-xl font-medium mb-2">{t('pf_unavailable_title')}</h1>
        <p className="text-muted-foreground">{t('pf_unavailable_message')}</p>
      </div>,
    );
  }

  if (status === 'done') {
    return shell(
      <div className="rounded-[27px] bg-card shadow-lg overflow-hidden">
        <div className="h-2 bg-primary" aria-hidden="true" />
        <div className="p-6 sm:p-8 text-center">
          <IconCircleCheck size={44} stroke={1.5} className="mx-auto mb-3 text-primary" />
          <h1 className="text-xl font-medium mb-2">{page.thank_you_title}</h1>
          <p className="text-muted-foreground mb-6">{page.thank_you_message}</p>
          <Button variant="outline" onClick={resetForAnotherEntry}>{t('pf_another_entry_text')}</Button>
        </div>
      </div>,
    );
  }

  return shell(
    <div className="rounded-[27px] bg-card shadow-lg overflow-hidden">
      <div className="h-2 bg-primary" aria-hidden="true" />
      <div className="p-6 sm:p-8">
      <header className="mb-6 pb-5 border-b border-border">
        <h1 className="text-2xl font-semibold">{page.title}</h1>
        {page.description ? <p className="text-base text-muted-foreground mt-1">{page.description}</p> : null}
      </header>
      <form
        className="space-y-5"
        onSubmit={handleSubmit}
        noValidate
      >
        {page.fields.map(field => (
          <div key={field.key} className="space-y-2" onFocusCapture={handleFirstInteraction}>
            {field.fulltype !== 'bool' ? (
              <Label htmlFor={field.key}>
                {fieldLabelByAppId(page.app_id, field.key) ?? field.label}
                {field.required ? ' *' : ''}
              </Label>
            ) : null}
            <FieldInput
              field={field}
              appId={page.app_id}
              value={values[field.key]}
              onChange={v => setField(field.key, v)}
              refOptions={refOptions[field.key]}
              refLoading={refLoading && field.fulltype.includes('applookup')}
            />
            {fieldErrors[field.key] ? (
              <p className="text-sm text-destructive" role="alert">{fieldErrors[field.key]}</p>
            ) : null}
          </div>
        ))}
        {formError ? (
          <p className="text-sm text-destructive" role="alert">{formError}</p>
        ) : null}
        <Button type="submit" className="w-full max-sm:h-11" disabled={status === 'submitting'}>
          {status === 'submitting' ? (
            <span className="inline-flex items-center gap-2">
              <IconLoader2 size={16} stroke={1.5} className="animate-spin" />
              {t('pf_submitting_text')}
            </span>
          ) : (
            t('pf_submit_text')
          )}
        </Button>
      </form>
      </div>
    </div>,
  );
}
