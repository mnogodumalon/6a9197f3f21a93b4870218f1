#!/usr/bin/env node
// wire-intent.mjs — deterministic wiring for one intent flow page.
//
// A flow is three things at once (page, route, registry entry — see
// check-intents.mjs). Wiring them used to be five hand-written edits at the
// <custom:*> markers per build; a single slipped marker loses every custom
// route on the next scaffold update. This script is the mechanical version:
// idempotent, marker-safe, and it clears the sidebar's INTENTS_PENDING ghost
// rows in the same pass.
//
// Usage:
//   node scripts/wire-intent.mjs <PageComponent> <slug> <label> <IconName> [description]
//   node scripts/wire-intent.mjs --no-flows
//
// Examples:
//   node scripts/wire-intent.mjs NeueBuchungPage neue-buchung 'Neue Buchung' IconCalendarPlus 'Buchung in 3 Schritten anlegen'
//   node scripts/wire-intent.mjs --no-flows   # decision gate said skip: only clear the ghost rows
//
// Run it once per flow AFTER src/pages/intents/<PageComponent>.tsx exists;
// check-intents.mjs verifies the result.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const APP = 'src/App.tsx';
const REGISTRY = 'src/config/intents.ts';

function fail(msg) { console.error(`ERROR: ${msg}`); process.exit(1); }

function read(file) {
  if (!existsSync(file)) fail(`${file} not found — run from the project root`);
  return readFileSync(file, 'utf8');
}

function clearPendingFlag(src) {
  return src.replace('export const INTENTS_PENDING = true;', 'export const INTENTS_PENDING = false;');
}

const args = process.argv.slice(2);

if (args[0] === '--no-flows') {
  const src = read(REGISTRY);
  const out = clearPendingFlag(src);
  if (out === src) {
    console.log('wire-intent: INTENTS_PENDING already false — nothing to do');
  } else {
    writeFileSync(REGISTRY, out);
    console.log('wire-intent: INTENTS_PENDING → false (ghost rows cleared, no flows registered)');
  }
  process.exit(0);
}

const [page, slug, label, icon, description] = args;
if (!page || !slug || !label || !icon) {
  fail('usage: node scripts/wire-intent.mjs <PageComponent> <slug> <label> <IconName> [description]\n' +
       '       node scripts/wire-intent.mjs --no-flows');
}
if (!/^[A-Z][A-Za-z0-9]*$/.test(page)) fail(`'${page}' is not a PascalCase component name`);
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail(`'${slug}' is not a kebab-case slug`);
if (!/^Icon[A-Z][A-Za-z0-9]*$/.test(icon)) fail(`'${icon}' is not a Tabler icon name (IconLikeThis)`);

const pageFile = `src/pages/intents/${page}.tsx`;
if (!existsSync(pageFile)) fail(`${pageFile} does not exist — write the page first, then wire it`);

// Registry entries are single-quoted strings.
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// Insert `line` directly above the CLOSING marker, reusing its indentation.
// A missing marker fails loudly: the block was overwritten by something, and
// appending anywhere else would be lost the same way on the next update.
function insertBeforeMarker(src, marker, line, file) {
  const at = src.indexOf(marker);
  if (at === -1) fail(`${file}: marker '${marker}' not found — restore the marker block before wiring`);
  const lineStart = src.lastIndexOf('\n', at) + 1;
  const indent = src.slice(lineStart, at);
  if (/\S/.test(indent)) fail(`${file}: marker '${marker}' must start its own line`);
  return src.slice(0, lineStart) + indent + line + '\n' + src.slice(lineStart);
}

const done = [];
const same = [];

// ── src/App.tsx: lazy import + route ───────────────────────────────────────
// The local identifier is ALWAYS `Intent${page}` — never the bare component
// name. A flow page may legitimately share its name with an entity CRUD page
// (live-proven twice: JahresinspektionPlanenPage was both the wish-app's CRUD
// page and the flow page → TS2440, a repair agent per build). The alias makes
// that collision class impossible; the scaffold never emits Intent*-named
// pages, so the alias itself cannot collide.
const ident = `Intent${page}`;

let app = read(APP);
const appBefore = app;

if (app.includes(`@/pages/intents/${page}`)) {
  same.push(`${APP}: import for ${page} already present`);
} else {
  app = insertBeforeMarker(
    app, '// </custom:imports>',
    `const ${ident} = lazy(() => import('@/pages/intents/${page}'));`, APP,
  );
  done.push(`${APP}: lazy import for ${page} (as ${ident})`);
}

if (new RegExp(`<Route\\s+path=["']intents/${slug}["']`).test(app)) {
  same.push(`${APP}: route intents/${slug} already present`);
} else {
  app = insertBeforeMarker(
    app, '{/* </custom:routes> */}',
    `<Route path="intents/${slug}" element={<Suspense fallback={null}><${ident} /></Suspense>} />`, APP,
  );
  done.push(`${APP}: route intents/${slug}`);
}

if (app !== appBefore) writeFileSync(APP, app);

// ── src/config/intents.ts: icon import + registry entry + pending flag ─────
let reg = read(REGISTRY);
const regBefore = reg;

// The doc comment at the top of intents.ts shows the markers WITHOUT the
// leading `//`, so matching on the commented form skips the example block.
const importBlock = /\/\/ <custom:intent-imports>([\s\S]*?)\/\/ <\/custom:intent-imports>/.exec(reg);
if (!importBlock) fail(`${REGISTRY}: marker '// <custom:intent-imports>' not found — restore the marker block before wiring`);

if (new RegExp(`\\b${icon}\\b`).test(importBlock[1])) {
  same.push(`${REGISTRY}: ${icon} already imported`);
} else {
  const tabler = /import \{ ([^}]*) \} from '@tabler\/icons-react';/.exec(importBlock[1]);
  if (tabler) {
    // Merge into the existing tabler import; replace the whole marker block
    // so the doc comment's example import can never be hit instead.
    const mergedBlock = importBlock[0].replace(
      tabler[0], `import { ${tabler[1]}, ${icon} } from '@tabler/icons-react';`,
    );
    reg = reg.replace(importBlock[0], mergedBlock);
  } else {
    reg = insertBeforeMarker(
      reg, '// </custom:intent-imports>',
      `import { ${icon} } from '@tabler/icons-react';`, REGISTRY,
    );
  }
  done.push(`${REGISTRY}: import ${icon}`);
}

const entriesBlock = /\/\/ <custom:intents>([\s\S]*?)\/\/ <\/custom:intents>/.exec(reg);
if (!entriesBlock) fail(`${REGISTRY}: marker '// <custom:intents>' not found — restore the marker block before wiring`);

if (entriesBlock[1].includes(`path: '/intents/${slug}'`)) {
  same.push(`${REGISTRY}: entry /intents/${slug} already present`);
} else {
  // Label: preferred is a JSON object with both UI languages
  // ('{"de":"Neue Buchung","en":"New booking"}');
  // a plain string stays valid and renders unchanged in every language.
  let labelLiteral = `'${esc(label)}'`;
  if (label.trim().startsWith('{')) {
    let parsed;
    try { parsed = JSON.parse(label); } catch { fail(`label looks like JSON but does not parse: ${label}`); }
    const parts = ['de', 'en', 'cs']
      .filter((l) => typeof parsed[l] === 'string' && parsed[l].trim())
      .map((l) => `${l}: '${esc(parsed[l])}'`);
    if (!parts.length) fail(`label JSON must carry at least one of de/en/cs: ${label}`);
    labelLiteral = `{ ${parts.join(', ')} }`;
  }
  const desc = description ? `, description: '${esc(description)}'` : '';
  reg = insertBeforeMarker(
    reg, '// </custom:intents>',
    `{ path: '/intents/${slug}', label: ${labelLiteral}, icon: ${icon}${desc} },`, REGISTRY,
  );
  done.push(`${REGISTRY}: entry /intents/${slug}`);
}

const flipped = clearPendingFlag(reg);
if (flipped !== reg) {
  reg = flipped;
  done.push(`${REGISTRY}: INTENTS_PENDING → false`);
}

if (reg !== regBefore) writeFileSync(REGISTRY, reg);

for (const d of done) console.log(`wire-intent: + ${d}`);
for (const s of same) console.log(`wire-intent: = ${s}`);
console.log(`wire-intent: OK (${page} ↔ #/intents/${slug})`);
