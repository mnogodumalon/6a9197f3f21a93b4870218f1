#!/usr/bin/env node
// Gate: intent flows must be reachable and findable.
//
// A flow page is three things at once, and all three have to agree:
//   1. the component in src/pages/intents/<Name>.tsx
//   2. a route in App.tsx (<custom:routes>) so the URL resolves
//   3. an entry in src/config/intents.ts (<custom:intents>) so it appears
//      in the sidebar
// Live-proven: a build shipped a complete 35 KB wizard, routed correctly, but
// with an empty registry — the flow existed and was simply invisible to the
// owner. Nothing failed, nothing warned.
//
// The docblock is checked too: app/services/intent_context.py derives
// _agent_context/intents.json from it, which is how a LATER agent run finds a
// flow worth reusing. Without it a flow is invisible to future runs as well.
//
// And the UTC day-shift trap is checked here as well, because nothing else
// can: the same rule is gate 1 of check-dashboard.mjs, but that script reads
// ONE file (src/pages/DashboardOverview.tsx). A flow step that writes a date
// field with toISOString() was therefore outside every gate — even a run that
// executes all of them.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'src/pages/intents';
const REGISTRY = 'src/config/intents.ts';
const APP = 'src/App.tsx';

const errors = [];

// App metadata for type-aware field checks (present in every sandbox).
let appMeta = null;
try {
  appMeta = JSON.parse(readFileSync('app_metadata.json', 'utf8'));
} catch {
  // metadata missing (e.g. local runs) — type checks are skipped
}

const pages = existsSync(DIR)
  ? readdirSync(DIR).filter(f => /\.tsx$/.test(f)).map(f => f.replace(/\.tsx$/, ''))
  : [];

// No flows at all is a legitimate state (phase 2 may build none).
if (pages.length > 0) {
  const registrySrc = existsSync(REGISTRY) ? readFileSync(REGISTRY, 'utf8') : '';
  const appSrc = existsSync(APP) ? readFileSync(APP, 'utf8') : '';

  // Registry paths live inside the <custom:intents> marker; read only that
  // block so the doc comment's example entry above it is not counted.
  const block = /\/\/ <custom:intents>([\s\S]*?)\/\/ <\/custom:intents>/.exec(registrySrc);
  const registryBody = block ? block[1] : '';
  const registryPaths = new Set(
    [...registryBody.matchAll(/path:\s*['"]([^'"]+)['"]/g)].map(m => m[1]),
  );

  // Routes: <Route path="intents/…"> — App.tsx writes them without a leading
  // slash because they are nested; the registry stores the absolute path.
  const routePaths = new Set(
    [...appSrc.matchAll(/<Route\s+path=["'](intents\/[^"']+)["']/g)].map(m => `/${m[1]}`),
  );

  for (const name of pages) {
    const file = join(DIR, `${name}.tsx`);
    const src = readFileSync(file, 'utf8');

    // 1. Imported and routed?
    if (!appSrc.includes(`@/pages/intents/${name}`)) {
      errors.push(`${APP}: no import for '${name}' — add it inside <custom:imports> and route it in <custom:routes>`);
    }

    // 2. Docblock (purpose + steps + reads/writes) at the very top.
    if (!/^\s*\/\*\*/.test(src)) {
      errors.push(`${file}: missing the leading /** … */ docblock (purpose, Steps, Reads, Writes, Composes) — later agent runs find reusable flows through it`);
    }

    // 3. Generic dialogs belong on the CRUD pages, not in a wizard step.
    const dialogImport = /import\s[^;]*?from\s+['"]@\/components\/dialogs\/([^'"]+)['"]/.exec(src);
    if (dialogImport) {
      errors.push(`${file}: imports the generic dialog '${dialogImport[1]}' — a wizard step uses its own small form (the generic dialogs stay on the CRUD pages)`);
    }

    // 3b. The journey layer. Types can force HOW SummaryStep/SuccessStep are
    //     used (forms+submit, result) but not THAT they are rendered — a flow
    //     that skips the review step or hand-rolls its success screen compiles
    //     fine and ships below the floor. So this is a presence check.
    if (!/useJourneySubmit\s*\(/.test(src)) {
      errors.push(`${file}: no useJourneySubmit(...) — every flow writes through the plan runner (import { useJourneySubmit } from '@/lib/journey'; const submit = useJourneySubmit(servicePort, [{ key, entity, form, primary: true }], { draftKey }))`);
    }
    if (!/<SummaryStep[\s/>]/.test(src)) {
      errors.push(`${file}: no <SummaryStep> — render <SummaryStep forms={[…]} submit={submit} whatHappensNext="…" /> as the review step before the write`);
    }
    if (!/<SuccessStep[\s/>]/.test(src)) {
      errors.push(`${file}: no <SuccessStep> — render {submit.result && <SuccessStep result={submit.result} next={[…]} />} instead of a hand-written success screen`);
    }

    // 3c. A delete inside a flow is reversible (undoToast), never a confirm
    //     dialog — the same rule check-dashboard enforces for drag/status
    //     writes on the overview. Checked on the CALL, not on a word.
    if (/LivingAppsService\.delete\w*\s*\(/.test(src) && !src.includes('undoToast(')) {
      errors.push(`${file}: LivingAppsService.delete…(…) without undoToast(…) — a removal in a flow executes immediately and offers Rückgängig (undoToast from '@/lib/polish'), it does not ask for confirmation`);
    }

    // 3d. The start screen's description is ONE short sentence. The steps
    //     are listed right below it, so an enumeration ("… — Gast zuordnen,
    //     Zimmer wählen, Zeitraum prüfen.") doubles them (live-seen). The
    //     skill asks for ≤90 chars; the gate fails only a paragraph (>140) —
    //     a 105-char sentence cost a full repair round live and read fine.
    const introDesc = src.match(/intro=\{\{[\s\S]*?description:\s*(?:\w+\()?\s*(['"`])([\s\S]*?)\1/);
    if (introDesc) {
      const text = introDesc[2];
      const enumerates = /\s[—–-]\s[^,]*,/.test(text) || /:\s[^,]*,[^,]*,/.test(text);
      if (text.length > 140 || enumerates) {
        errors.push(`${file}: intro.description is ${text.length} chars${enumerates ? ' and enumerates the steps' : ''} — one short sentence (aim for 90, hard limit 140) saying what the flow achieves; the steps are listed right below it, never repeat them. Now: "${text.slice(0, 70)}"`);
      }
    }

    // 3f. The review step comes BEFORE the write. A live page rendered
    //     <SummaryStep> only while `submit.done` was true and put a StepNav
    //     "Weiter" on the last step instead — wizard.next() went nowhere, the
    //     record was never written and the button did nothing.
    for (const m of src.matchAll(/<SummaryStep\b/g)) {
      const guard = src.slice(Math.max(0, m.index - 260), m.index);
      const afterWrite = /(?<![!\w.])\w+\.(?:done|result)\s*&&/.exec(guard);
      if (afterWrite) {
        const line = src.slice(0, m.index).split('\n').length;
        errors.push(`${file}:${line}: <SummaryStep> is rendered only after the write (guarded by '${afterWrite[0].trim()}') — the review comes BEFORE it: {step === N && !submit.result && <SummaryStep forms={[f]} submit={submit} />}; its confirm button runs the plan, a StepNav "Weiter" on the last step calls nothing`);
      }
    }

    // 3g. A date is a form value, not a pixel. A native <input type="date"
    //     defaultValue={today}> LOOKS filled while useStepForm holds nothing —
    //     validation said "Ausgabedatum fehlt" over a visibly filled field, and
    //     re-picking the shown day fires no change event (live). Dates render
    //     through <DatePicker {...f.date('key')} />; initial values belong in
    //     useStepForm(entity, { initial: { key: todayIso() } }).
    for (const m of src.matchAll(/type\s*=\s*["'](date|datetime-local|time)["']/g)) {
      const line = src.slice(0, m.index).split('\n').length;
      errors.push(`${file}:${line}: native <input type="${m[1]}"> — use <DatePicker {...f.date('key')} /> from '@/components/DatePicker' (the form owns the value); a native date input with a default shows a day the form never has`);
    }
    for (const m of src.matchAll(/\bdefaultValue\s*=/g)) {
      const line = src.slice(0, m.index).split('\n').length;
      errors.push(`${file}:${line}: defaultValue on an input — initial values belong to the form: useStepForm(entity, { initial: { key: value } }) (dates: todayIso() from '@/lib/journey'); an uncontrolled default is never submitted and fails validation`);
    }

    // 3h. Every bound control sits under a label. The bindings carry id, value,
    //     aria-* — not the label; a step with five bare inputs shipped (live).
    //     <Field form={f} name="key"> renders label, hint and error from the
    //     entity's rules; a hand-written <Label htmlFor={f.fieldId('key')}> also counts.
    {
      const bound = new Set();
      for (const m of src.matchAll(/\.(?:field|number|date|choice|checkbox|record)\(\s*['"]([\w]+)['"]/g)) bound.add(m[1]);
      for (const key of bound) {
        const wrapped = new RegExp(`<Field\\b[^>]*\\bname=["']${key}["']`).test(src);
        const labelled = new RegExp(`htmlFor=\\{[^}]*fieldId\\(\\s*['"]${key}['"]`).test(src);
        if (!wrapped && !labelled) {
          errors.push(`${file}: the control bound with f.…('${key}') has no label — wrap it: <Field form={f} name="${key}">…</Field> (label from the entity's rules, error and hint included; from '@/components/blocks/Field')`);
        }
      }
    }

    // 3i. The page may only render steps it declares. A live flow declared
    //     three steps and rendered its review as step 4: the indicator said
    //     "3 von 3", wizard.next() had nowhere to go, the last "Weiter" was dead.
    {
      const stepsLiteral = /steps=\{\s*\[([\s\S]*?)\]\s*\}/.exec(src) || /const\s+\w+(?:\s*:\s*WizardStep\[\])?\s*=\s*\[([\s\S]*?\blabel\b[\s\S]*?)\];/.exec(src);
      if (stepsLiteral) {
        const declared = (stepsLiteral[1].match(/\blabel\s*:/g) || []).length;
        let rendered = 0;
        for (const m of src.matchAll(/\b(?:step|currentStep|activeStep)\s*===\s*(\d+)/g)) rendered = Math.max(rendered, Number(m[1]));
        if (declared > 0 && rendered > declared) {
          errors.push(`${file}: renders step ${rendered} but declares only ${declared} step(s) in \`steps\` — add the missing step(s) (e.g. { label: 'Prüfen' }); the indicator, "Schritt n von m" and wizard.next() follow the array, so an undeclared step is unreachable`);
        }
      }
    }


    // 3j. useRecordSearch searches STRING fields only — the vSQL filter wraps
    //     each field in `str(...).lower()`, so a lookup, date or number field
    //     matches its raw storage form and effectively never hits. A typo names
    //     a field the entity does not have, which silently searches nothing.
    {
      const RS_RE = /useRecordSearch\(\s*\w+\s*,\s*['"]([\w]+)['"]\s*,\s*\{[\s\S]*?searchFields\s*:\s*\[([^\]]*)\]/g;
      for (const m of src.matchAll(RS_RE)) {
        const entity = m[1];
        const fields = [...m[2].matchAll(/['"]([\w]+)['"]/g)].map(x => x[1]);
        const controls = appMeta?.apps?.[entity]?.controls;
        if (appMeta && !controls) {
          errors.push(`${file}: useRecordSearch names unknown entity '${entity}' — use the identifier from app_metadata.json`);
          continue;
        }
        // The repair agent once "fixed" an unknown field by picking the two
        // applookups of a link entity — plausible names, dead search. Name the
        // fields that WOULD work, so the first fix is the right one.
        const stringFields = controls ? Object.keys(controls).filter(k => (controls[k]?.fulltype || '').startsWith('string')) : [];
        const stringHint = controls ? ` — string fields of '${entity}': ${stringFields.length ? stringFields.join(', ') : "(none)"}` : '';
        if (fields.length === 0) {
          errors.push(`${file}: useRecordSearch('${entity}') has an empty searchFields — name 1–4 string fields users recognise a record by`);
        }
        for (const f of fields) {
          const ft = controls?.[f]?.fulltype;
          if (controls && !ft) {
            errors.push(`${file}: useRecordSearch('${entity}') searchFields names '${f}', which '${entity}' does not have${stringHint}`);
          } else if (ft && ft.includes('applookup')) {
            errors.push(`${file}: useRecordSearch('${entity}') searchFields '${f}' is ${ft} — a LINK never matches typed text (vSQL sees the record URL, not the name). Users search the linked record's NAME: give that record its own pick step (useRecordSearch on the target entity) and keep '${entity}' filtered by the picked id${stringHint}`);
          } else if (ft && !ft.startsWith('string')) {
            errors.push(`${file}: useRecordSearch('${entity}') searchFields '${f}' is ${ft} — only string fields are searchable (text, email, tel, textarea)${stringHint}`);
          }
        }
      }
    }

    // 3k. The DATA PATH of a pick step is decided at RUNTIME by useRecordSearch —
    //     an items= array from useDashboardData freezes the build-time count: a page
    //     built with 13 employees still loads and client-searches all of them at
    //     5.000 (live-seen on Werkzeugverwaltung). The hook counts, pages and
    //     switches to server-side search by itself.
    {
      const dd = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*useDashboardData\s*\(/.exec(src);
      if (dd) {
        const arrays = dd[1].split(',').map(s => s.split(':')[0].trim())
          .filter(n => /^[a-z]\w*$/.test(n) && !/^(loading|error|fetchAll)$/.test(n) && !/Map$/.test(n));
        for (const m of src.matchAll(/<EntitySelectStep\b[\s\S]{0,400}?\bitems=\{\s*(\w+)\b/g)) {
          if (arrays.includes(m[1])) {
            errors.push(`${file}: <EntitySelectStep items={${m[1]}.…}> feeds a pick step from the useDashboardData array '${m[1]}' — the data path is a RUNTIME decision: const x = useRecordSearch(servicePort, '<entity>', { searchFields: [...], toItem }); <EntitySelectStep {...x.select} …/>; and drop the table from the hook: useDashboardData({ omit: ['<entity>'] })`);
          }
        }
      }
    }

    // 4. UTC day-shift trap — same rule as gate 1 of check-dashboard.mjs, which
    //    only ever sees DashboardOverview.tsx. A wizard step writes date fields
    //    DIRECTLY via the service, so this is exactly where the shift lands.
    //    The offending lines are quoted VERBATIM (untrimmed) so the fix is a
    //    direct Edit with that exact string — no re-Read to locate them.
    if (src.includes('toISOString')) {
      const lines = src.split('\n');
      const hits = [];
      for (let i = 0; i < lines.length && hits.length < 6; i++) {
        if (lines[i].includes('toISOString')) hits.push(`    line ${i + 1}: ${lines[i]}`);
      }
      errors.push(
        `${file}: toISOString() found — it is UTC, so the day flips at the wrong hour and the record lands on the neighbouring date. ` +
        `Write date fields with date-fns format(): a date/date field → format(d, 'yyyy-MM-dd'), a date/datetimeminute field → format(d, "yyyy-MM-dd'T'HH:mm").` +
        (hits.length ? '\n' + hits.join('\n') : ''),
      );
    }
  }

  // 5. Every route needs a registry entry, or the flow is invisible in the
  //    sidebar even though its URL works.
  for (const path of routePaths) {
    if (!registryPaths.has(path)) {
      errors.push(`${REGISTRY}: route '${path}' has no entry inside <custom:intents> — the flow works by URL but never appears in the sidebar; add { path: '${path}', label: …, icon: …, description: … }`);
    }
  }

  // 6. …and the other way round: a registry entry without a route is a dead
  //    sidebar link.
  for (const path of registryPaths) {
    if (!routePaths.has(path)) {
      errors.push(`${APP}: registry lists '${path}' but no <Route path="${path.replace(/^\//, '')}"> exists — the sidebar link leads nowhere`);
    }
  }

  // 7. Flows exist, so the Phase-1 ghost rows must be gone. INTENTS_PENDING
  //    lives outside the markers and is flipped by the orchestrator, not by
  //    any file this gate already checks — leave it true and the sidebar
  //    shows "werden erstellt…" forever next to the finished flows.
  if (/export const INTENTS_PENDING = true/.test(registrySrc)) {
    errors.push(`${REGISTRY}: INTENTS_PENDING is still true although ${pages.length} flow(s) exist — set it to false, the sidebar keeps showing ghost rows otherwise`);
  }
}

// Runtime i18n: intent pages mark their UI text with tx (source language
// once, pipeline translates) — the dashboard has a live language switcher.
// Same rule and same escape hatch as check-dashboard gate 21. WARNING, not
// error: the i18n finalize step wraps leftovers mechanically after the
// build — a gate-red here only bought a 30-60s agent repair loop.
const warnings = [];
for (const page of pages) {
  const file = join(DIR, `${page}.tsx`);
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  // The closing `<` must start a tag (`</` or `<Tag`). Without that a
  // comparison pair reads as JSX text: `x > 0 && (a.fields.b ?? 0) < y`
  // matched, and the fixer dutifully annotated pure logic (live-seen).
  // The `>` must close a TAG. Without the lookbehind the `>` of an arrow
  // function matched, so `(key: K) => (e: React.ChangeEvent<HTMLInputElement
  // | HTMLTextAreaElement>) =>` was reported as hardcoded UI text and cost a
  // run a gate-red plus an /* i18n-exempt */ on pure type syntax.
  const jsxText = /(?<![=-])>[^<>{}\n]*[A-Za-zÄÖÜäöüßÀ-ž]{3,}[^<>{}\n]*<[/A-Za-z]/;
  const attrText = /\b(?:title|placeholder|label|aria-label|alt|emptyLabel|emptyText)=(?:\{\s*)?(?:"[^"{}]*[A-Za-zÄÖÜäöüßÀ-ž]{3,}[^"{}]*"|'[^'{}]*[A-Za-zÄÖÜäöüßÀ-ž]{3,}[^'{}]*')/;
  const objText = /\b(?:title|label|name|emptyLabel|emptyText|hint|description)\s*:\s*(?:"[^"{}]*[A-Za-zÄÖÜäöüßÀ-ž]{3,}[^"{}]*"|'[^'{}]*[A-Za-zÄÖÜäöüßÀ-ž]{3,}[^'{}]*')/;
  // A sentence computed in a helper and rendered as {subtitle} is in no
  // JSX text, no attribute and no allowlisted prop — it stayed German
  // while the page around it turned English. One word may be a status
  // key the API reads back ('Aktiv'), so only whole phrases count.
  const returnText = /\breturn\s+(?:"(?=[^"]*[A-Za-zÄÖÜäöüßÀ-ž]{3,})(?=[^"]*\s)[^"{}]*"|'(?=[^']*[A-Za-zÄÖÜäöüßÀ-ž]{3,})(?=[^']*\s)[^'{}]*')/;
  const hits = [];
  for (let i = 0; i < lines.length && hits.length < 8; i++) {
    const l = lines[i];
    if (l.includes('i18n-exempt')) continue;
    const trimmed = l.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (jsxText.test(l) || attrText.test(l) || objText.test(l) || returnText.test(l)) hits.push(`    line ${i + 1}: ${l}`);
  }
  if (hits.length) {
    warnings.push(
      `${file}: unmarked UI text (healed mechanically after the build — no action needed); ` +
      `write it as {tx('…')} from '@/i18n' next time; brand names/codes take /* i18n-exempt */ on the line.\n` + hits.join('\n')
    );
  }
  // LOOKUP_OPTIONS labels are locale-aware getters — resolving them at module
  // scope freezes one language at import time (same rule as check-dashboard 22).
  // Statement-based: multi-line `.map(` statements escaped a per-line regex.
  let optName = 'LOOKUP_OPTIONS';
  const importM = src.match(/import\s*\{([^}]*)\}\s*from\s*'@\/types\/app'/);
  const aliasM = importM && importM[1].match(/LOOKUP_OPTIONS\s+as\s+(\w+)/);
  if (aliasM) optName = aliasM[1];
  for (let i = 0; i < lines.length; i++) {
    if (!/^(?:export\s+)?const\s/.test(lines[i])) continue;
    let j = i;
    let stmt = lines[i];
    while (!/;\s*$/.test(lines[j]) && j + 1 < lines.length && j - i < 12) {
      j++;
      stmt += '\n' + lines[j];
    }
    if (stmt.includes(optName) && /(?:\.label\b|label\s*:)/.test(stmt)) {
      errors.push(`${file}:${i + 1}: module-scope LOOKUP_OPTIONS label read — move it inside the component body, the getters freeze at import otherwise:\n    ${lines[i]}`);
    }
    i = j;
  }
}

for (const w of warnings) console.log(`WARN: ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`ERROR: ${e}`);
  process.exit(1);
}
console.log(`check-intents: OK (${pages.length} flows)`);
