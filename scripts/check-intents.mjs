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
