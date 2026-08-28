#!/usr/bin/env node
// Gate: public pages must stay anonymous-safe and fully declared.
//
// Agent-written pages under src/pages/public/ are served to visitors WITHOUT
// a LivingApps session. An import of the authenticated data layer
// (livingAppsService, useDashboardData, dialogs, …) compiles fine but dies
// with 401s for every real visitor — so '@/' imports are allowlisted here.
// And a page is only reachable/usable when registry.tsx and
// _public/surface.json agree: the registry routes it, the surface declares
// what the service must grant.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const PAGES_DIR = 'src/pages/public';
const SURFACE = '_public/surface.json';
const REGISTRY = join(PAGES_DIR, 'registry.tsx');
// Scaffold files — generator-owned, not subject to the page rules.
const SCAFFOLD = new Set(['PublicPage.tsx', 'PublicFormPage.tsx', 'registry.tsx']);

// The '@/' modules a public page may import. Everything else on '@/' is the
// authenticated dashboard side. Entries ending in '/' allow the subtree.
const ALLOWED_AT = [
  '@/lib/publicClient',
  '@/components/PublicShell',
  '@/components/blocks/',
  '@/components/ui/',
  '@/components/widgets/',
  '@/lib/utils',
  '@/lib/formatters',
  '@/i18n',
  '@/types/',
];

const errors = [];

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (/\.(tsx?|jsx?)$/.test(entry)) files.push(full);
  }
  return files;
}

// ── 1. Import allowlist over agent-written pages ─────────────────────────
const IMPORT_RE = /^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm;
const pageFiles = existsSync(PAGES_DIR)
  ? walk(PAGES_DIR).filter(f => !SCAFFOLD.has(basename(f)))
  : [];
for (const file of pageFiles) {
  const src = readFileSync(file, 'utf8');
  // A record reference written for the authenticated REST API is rejected by
  // the anonymous surface with 400 "Unsupported field value" — applookup
  // values must be grant-scoped. Live-proven twice: a course registration
  // built the participant URL by hand in one literal, and a document form
  // glued origin+"/rest" from parts — which a one-literal regex
  // (/['"`]…\/rest\/apps\/…['"`]/) provably missed. The authenticated
  // prefix has NO legitimate use in a public page, however it is spelled, so
  // flag `/rest` wherever a delimiter follows (`/rest'`, `/rest"`,
  // backtick, `/rest/`) — that catches glued forms without tripping on
  // words like "/restaurants".
  const restUrl = /\/rest['"`\/]/.exec(src);
  if (restUrl) {
    const line = src.slice(0, restUrl.index).split('\n').length;
    errors.push(`${file}:${line}: reference to the authenticated /rest surface — public pages must not build /rest URLs (the anonymous surface rejects them); use recordRef(cfg, page, appId, recordId) from '@/lib/publicClient', or pass a reference URL through exactly as a list response returned it`);
  }
  // In-page anchors are broken by design here: the app is HASH-routed, so an
  // href of "#anfrage" REPLACES the route (from the public slug route to a
  // route named anfrage) and navigates the visitor off the page instead of
  // scrolling. Live-proven by a hero CTA that kicked every visitor back to
  // the router. Only hrefs continuing with a slash are real routes.
  const ANCHOR_RE = /href\s*=\s*[{]?\s*["'`]#(?!\/)/g;
  let anchor;
  while ((anchor = ANCHOR_RE.exec(src)) !== null) {
    const line = src.slice(0, anchor.index).split('\n').length;
    errors.push(`${file}:${line}: in-page anchor href — the app is hash-routed, so this REPLACES the route and navigates the visitor off the page; scroll with a button + ref.scrollIntoView({ behavior: 'smooth' }) instead`);
  }
  // Root-relative hrefs are broken by design as well: the SPA is deployed
  // under /objects/<id>/, so href="/#/public/x" resolves against the SITE
  // root and dumps the visitor on the platform, not the dashboard. This is
  // the historic evasion of the anchor rule above — forbidden href="#…",
  // a live lane wrote href="/#/…", which passed the gate and broke worse.
  const ROOT_HREF_RE = /href\s*=\s*[{]?\s*["'`]\//g;
  let rootHref;
  while ((rootHref = ROOT_HREF_RE.exec(src)) !== null) {
    const line = src.slice(0, rootHref.index).split('\n').length;
    errors.push(`${file}:${line}: root-relative href — the app is deployed under a sub-path, so "/…" resolves against the site root and throws the visitor off the dashboard; navigate page-to-page with react-router's <Link to="/public/<slug>">, and use a full https:// URL for external targets`);
  }
  // Router targets outside /public bounce an anonymous visitor into the
  // authenticated shell. A public page may only navigate to public pages.
  const INTERNAL_NAV_RE = /(?:to\s*=\s*[{]?\s*|navigate\(\s*)["'`]\/(?!public\b)/g;
  let internalNav;
  while ((internalNav = INTERNAL_NAV_RE.exec(src)) !== null) {
    const line = src.slice(0, internalNav.index).split('\n').length;
    errors.push(`${file}:${line}: navigation target outside /public — an anonymous visitor has no session there and gets bounced; public pages may only link to other public pages (<Link to="/public/<slug>">)`);
  }
  // The hosted-page look is standardized by the shell's card. A wizard fits
  // inside it (the stepper is compact) — opting out with `plain` made two
  // live dashboards on the SAME scaffold version look like different
  // products, so the combination is rejected outright.
  const plainWizard = src.includes('IntentWizardShell')
    && /<PublicShell\b[^>]*\bplain\b/.test(src);
  if (plainWizard) {
    errors.push(`${file}: PublicShell \`plain\` combined with IntentWizardShell — wizards render INSIDE the shell's card (drop \`plain\`); the standardized hosted look must be identical across pages`);
  }
  let m;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    const spec = m[1];
    const line = src.slice(0, m.index).split('\n').length;
    if (spec.startsWith('@/')) {
      const ok = ALLOWED_AT.some(a => spec === a || (a.endsWith('/') && spec.startsWith(a)));
      if (!ok) {
        errors.push(`${file}:${line}: '${spec}' is dashboard-side (needs a login) — public pages may import only: ${ALLOWED_AT.join(', ')}`);
      }
    } else if (spec.startsWith('..')) {
      errors.push(`${file}:${line}: relative import '${spec}' escapes ${PAGES_DIR} — use an allowlisted '@/' module or a sibling './' import`);
    }
  }
}

// ── 2. registry.tsx ↔ surface.json consistency ───────────────────────────
const registrySlugs = new Map(); // slug -> imported module name
if (existsSync(REGISTRY)) {
  const src = readFileSync(REGISTRY, 'utf8');
  // Form 1 (canonical): slug mapped to an inline lazy dynamic import of the
  // page module. (Kept prose-only so the snapshot import-scanner doesn't
  // read the example as a real import.)
  const INLINE_RE = /['"]([\w-]+)['"]\s*:\s*lazy\(\s*\(\)\s*=>\s*import\(\s*['"]@\/pages\/public\/([\w.-]+)['"]\s*\)\s*\)/g;
  let m;
  while ((m = INLINE_RE.exec(src)) !== null) registrySlugs.set(m[1], m[2]);
  // Form 2 (equally legal, agents write it regularly): a lazy-bound const
  // referenced by name in the mapping. Two runs self-healed around a false
  // "component unreachable" here — recognize the form instead.
  const VAR_DEF_RE = /const\s+(\w+)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*['"]@\/pages\/public\/([\w.-]+)['"]\s*\)\s*\)/g;
  const varFiles = new Map();
  while ((m = VAR_DEF_RE.exec(src)) !== null) varFiles.set(m[1], m[2]);
  const VAR_REF_RE = /['"]([\w-]+)['"]\s*:\s*([A-Za-z_$][\w$]*)\s*[,}]/g;
  while ((m = VAR_REF_RE.exec(src)) !== null) {
    if (!registrySlugs.has(m[1]) && varFiles.has(m[2])) registrySlugs.set(m[1], varFiles.get(m[2]));
  }
}

// App metadata for type-aware field checks (present in every sandbox).
let appMeta = null;
try {
  appMeta = JSON.parse(readFileSync('app_metadata.json', 'utf8'));
} catch {
  // metadata missing (e.g. local runs) — type checks are skipped
}

let surface = null;
if (existsSync(SURFACE)) {
  try {
    surface = JSON.parse(readFileSync(SURFACE, 'utf8'));
  } catch (e) {
    errors.push(`${SURFACE}: invalid JSON — ${e.message}`);
  }
}
if (surface !== null) {
  // The service ingests only this exact shape — a missing version field
  // once silently dropped an entire deploy's declarations.
  if (surface.version !== 1) {
    errors.push(`${SURFACE}: missing or wrong "version" — add "version": 1 at the top level (the service ingests only {"version": 1, "pages": [...]})`);
  }
  if (!Array.isArray(surface.pages)) {
    errors.push(`${SURFACE}: "pages" must be an array`);
  }
}
const surfacePages = new Map(((surface && Array.isArray(surface.pages) && surface.pages) || []).map(p => [p.slug, p]));

for (const [slug, module] of registrySlugs) {
  if (!surfacePages.has(slug)) {
    errors.push(`${REGISTRY}: slug '${slug}' is registered but ${SURFACE} declares no page for it — without the declaration the service grants nothing and the page renders "unavailable"`);
  }
  if (!existsSync(join(PAGES_DIR, `${module}.tsx`))) {
    errors.push(`${REGISTRY}: slug '${slug}' imports '@/pages/public/${module}' but ${PAGES_DIR}/${module}.tsx does not exist`);
  }
}
for (const [slug, page] of surfacePages) {
  if (page.component && !registrySlugs.has(slug)) {
    errors.push(`${SURFACE}: page '${slug}' declares component '${page.component}' but ${REGISTRY} has no entry for it — the component is unreachable`);
  }
  // One flow = one page = ONE publish decision for the owner. A page
  // without a component is a data-carrier: it renders nothing itself but
  // forces the owner to publish it separately before the real page works.
  if (!page.component) {
    errors.push(`${SURFACE}: page '${slug}' has no "component" — declare its data as additional endpoints of the page that shows it (one page may carry several list/create endpoints); extra carrier pages each force a separate publish`);
  }
  // A page reached with `?x=<record_id>` MUST declare that parameter: the
  // management UI can otherwise only offer the bare page URL, which for such
  // a page is a dead end. Live proof: an invitation page demanded
  // ?sitzungId=… and nothing in the whole dashboard produced one — correct
  // and unreachable at the same time.
  const src = existsSync(join(PAGES_DIR, `${page.component}.tsx`))
    ? readFileSync(join(PAGES_DIR, `${page.component}.tsx`), 'utf8')
    : '';
  const readsParam = /useSearchParams|searchParams|URLSearchParams/.test(src);
  if (readsParam && !page.link_param) {
    errors.push(`${SURFACE}: page '${slug}' reads a query parameter but declares no "link_param" — without it the owner only gets the bare page URL, which shows "link incomplete". Add link_param: { name, entity, label_field } (entity needs a list endpoint on this page).`);
  }
  if (page.link_param) {
    const lp = page.link_param;
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(String(lp.name || ''))) {
      errors.push(`${SURFACE}: page '${slug}' link_param.name '${lp.name}' is not a query-parameter identifier`);
    }
    if (readsParam && src && !src.includes(String(lp.name || ' '))) {
      errors.push(`${SURFACE}: page '${slug}' declares link_param '${lp.name}' but ${page.component}.tsx never reads that name — the generated links would carry a parameter the page ignores`);
    }
    const listed = (page.endpoints || []).some(e => e.op === 'list' && e.entity === lp.entity);
    if (!listed) {
      errors.push(`${SURFACE}: page '${slug}' link_param entity '${lp.entity}' has no list endpoint on this page — the page could not read the linked record`);
    }
  }
  for (const ep of page.endpoints || []) {
    // A public page can READ and CREATE — nothing else. There is no update,
    // no delete: a grant that lets an anonymous visitor MODIFY an existing
    // record is not something the platform hands out. A live build declared
    // `op: 'update'` (to append a member to a meeting's participant list),
    // hand-rolled its own PATCH, passed every gate, and was thrown away by
    // the ingest AFTER the deploy — 304 lane-seconds for nothing, and the
    // dashboard was left without any public page at all.
    // "Register for an existing X" is therefore a CREATE in a registration
    // entity, never an edit of X.
    if (!['list', 'create'].includes(ep.op)) {
      errors.push(`${SURFACE}: page '${slug}' endpoint '${ep.entity}' declares op '${ep.op}' — only 'list' (read) and 'create' (anonymous submit) exist. An anonymous visitor can never MODIFY an existing record: model the action as a create in a registration entity. If this page cannot be built that way, write _public/<slug>.blocked.json instead (see the public-builder skill) — never invent an op.`);
    }
    if (ep.scope && !ep.scope_description) {
      errors.push(`${SURFACE}: page '${slug}' endpoint '${ep.entity}' has a scope but no scope_description — the owner confirms that text when publishing, never the vSQL`);
    }
    // The entity identifier must EXIST. Guessing it from the app's display
    // name is the classic failure: an app called "Kurse & Workshops" has the
    // identifier `kurse_workshops`, not `kurse_&_workshops`. The ingest then
    // raises "unknown entity" and drops the WHOLE page — visible only as one
    // [WARNING] line in the deploy stream, so the owner just sees nothing.
    // Every check below silently passes for an unknown entity (`controls`
    // falls back to {}), which is why this has to come first.
    if (appMeta) {
      const known = Object.keys(appMeta.apps || {});
      if (!known.includes(ep.entity)) {
        errors.push(`${SURFACE}: page '${slug}' references unknown entity '${ep.entity}' — use the IDENTIFIER from app_metadata.json, never the display name. Known: ${known.join(', ')}`);
        continue;
      }
      // Same trap one level down: a field key that does not exist is rejected
      // by the ingest with "invalid field selection", again dropping the page.
      const controlKeys = Object.keys(appMeta.apps[ep.entity].controls || {});
      for (const key of [...(ep.fields || []), ...Object.keys(ep.preset_fields || {}), ...Object.keys(ep.default_fields || {})]) {
        if (!controlKeys.includes(key)) {
          errors.push(`${SURFACE}: page '${slug}' endpoint '${ep.entity}' references unknown field '${key}' — known fields: ${controlKeys.join(', ')}`);
        }
      }
    }
    // Scope shape: the server probes the vSQL expression when the grant is
    // created (at publish) — a malformed scope fails silently late, so the
    // known-fatal shapes are rejected here.
    if (ep.scope) {
      if (!/r\.v_\w+/.test(ep.scope)) {
        errors.push(`${SURFACE}: page '${slug}' endpoint '${ep.entity}' scope '${ep.scope}' is not vSQL — fields are ALWAYS accessed as r.v_<field> (e.g. r.v_status == 'geplant'), never bare`);
      }
      if (/\b(true|false)\b/.test(ep.scope)) {
        errors.push(`${SURFACE}: page '${slug}' endpoint '${ep.entity}' scope uses lowercase true/false — vSQL booleans are Python-style True/False (e.g. r.v_aktiv == True)`);
      }
      if (/\btoday\b/.test(ep.scope)) {
        errors.push(`${SURFACE}: page '${slug}' endpoint '${ep.entity}' scope uses 'today' — vSQL has no today, the current time is now()`);
      }
    }
    // A list endpoint without an explicit projection is rejected by the
    // service — and an implicit "all fields" would be a data leak anyway.
    // applookup fields ARE allowed (raw record URL, join client-side);
    // file fields are not.
    if (ep.op === 'list' && !(Array.isArray(ep.fields) && ep.fields.length > 0)) {
      errors.push(`${SURFACE}: page '${slug}' endpoint '${ep.entity}' is a list without a "fields" projection — name exactly the columns the page shows`);
    }
    // file fields: READING is fine — a file URL answers an anonymous GET with
    // 200 and `cache-control: public` (measured), so a listed logo or hero
    // image simply renders. UPLOADING is not: /files is not grantable, so a
    // visitor has nowhere to put the bytes and the service rejects the page.
    if (ep.op === 'create' && Array.isArray(ep.fields) && appMeta) {
      const controls = appMeta.apps?.[ep.entity]?.controls || {};
      for (const key of ep.fields) {
        if (controls[key]?.fulltype?.startsWith('file')) {
          errors.push(`${SURFACE}: page '${slug}' endpoint '${ep.entity}' asks visitors to submit file field '${key}' — anonymous UPLOAD is impossible (/files is not grantable); drop it from the create endpoint (listing a file field for DISPLAY is fine)`);
        }
      }
    }
    // preset_fields are server-owned — a key listed in fields too would make
    // the visitor's value win, defeating the preset.
    const epFields = ep.fields || [];
    for (const key of Object.keys(ep.preset_fields || {})) {
      if (epFields.includes(key)) {
        errors.push(`${SURFACE}: page '${slug}' endpoint '${ep.entity}' lists '${key}' in both fields and preset_fields — preset fields are server-owned, remove '${key}' from fields`);
      }
    }
    // A required field the page DECLARES must also be submitted. Leaving an
    // internally-required field out of the declaration is legal (internal
    // requirement is an editing duty, not an entry duty) — but declaring it
    // and never sending it makes EVERY submit fail with 400, and the page
    // looks perfect until a visitor presses the button (live-proven with a
    // reservation form and its required 'tisch').
    if (ep.op === 'create' && appMeta) {
      const controls = appMeta.apps?.[ep.entity]?.controls || {};
      const preset = ep.preset_fields || {};
      const module = registrySlugs.get(slug);
      const pageFile = module ? join(PAGES_DIR, `${module}.tsx`) : null;
      const pageSrc = pageFile && existsSync(pageFile) ? readFileSync(pageFile, 'utf8') : null;
      if (pageSrc !== null) {
        for (const key of epFields) {
          if (!controls[key]?.required || key in preset) continue;
          const referenced = new RegExp(`(['"\`]${key}['"\`])|(\\b${key}\\s*:)`).test(pageSrc);
          if (!referenced) {
            errors.push(`${pageFile}: required field '${key}' of '${ep.entity}' is declared in ${SURFACE} but the page never submits it — either add an input for it (createPublicRecord must include '${key}') or drop '${key}' out of the endpoint's field projection so the team fills it internally`);
          }
        }
      }
    }
  }
}

if (errors.length > 0) {
  for (const e of errors) console.error(`ERROR: ${e}`);
  process.exit(1);
}
console.log(`check-public: OK (${pageFiles.length} pages, ${registrySlugs.size} registered slugs)`);
