---
name: public-builder
description: >
  Build or upgrade PUBLIC pages — pages for anonymous visitors without a
  LivingApps account, shared via link/QR. Activate when the user asks for a
  public form, booking page, public list ("freie Termine", Speisekarte,
  offene Stellen), landing/submission page, or wants an existing public
  form to become nicer/custom.
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep]
---

# Public Page Building Skill

Public pages are served at `/#/public/<slug>` to ANONYMOUS visitors. They
talk to a restricted public API through `@/lib/publicClient` — never to
`livingAppsService` (that needs a login and would break for every visitor).

## The contract: you declare, the service grants

You never create permissions yourself. You do exactly three things:

1. **Write the page component** in `src/pages/public/<Pascal>.tsx`.
2. **Register its slug** in `src/pages/public/registry.tsx` (markers only).
3. **Declare its data needs** in `_public/surface.json`.

After the build, the Klar service validates your declaration, creates the
public permissions (as unpublished drafts — the owner publishes with one
click), and serves each page its runtime config in `public-pages.json`.

## Existing pages (upgrade path)

Read `_agent_context/public_pages.json` first. It lists the owner's current
public pages (slug, entity, fields, published). To UPGRADE one (e.g. "make
the registration form a booking page"), reuse its **exact slug** — the
shared link and QR codes keep working. Declaring a changed data policy
automatically un-publishes the page until the owner confirms it again;
that is expected, mention it in your summary.

## Reuse intent flows

`_agent_context/intents.json` (when present) lists the dashboard's internal
workflow pages ("Abläufe"): route, label, a summary docblock, the components
each flow composes and the service methods it writes with. When the requested
public page matches one of these flows — an internal booking wizard and a
requested public booking page are the same flow — mirror its step sequence,
labels, and presentational pieces instead of inventing a new flow. But swap
the data layer completely:

Wrong: copy the intent page keeping `useDashboardData()`,
`LivingAppsService.createBuchungenEntry(...)` or `<BuchungenDialog>` —
every one of these needs a login and dies for anonymous visitors.
Right: same steps and layout; reads become `listPublicRecords` behind a
`scope`, writes become `createPublicRecord`, the form is built from the
page's `fields` config.

## The page component

Compose from `PublicShell` + blocks + widgets; data flows only through
`publicClient`.

UI TEXT (multilingual): public pages follow the visitor's browser language
(de/en; more languages attach later as overlays). Write every UI string ONCE
in German and MARK it with `tx` from `@/i18n` (`{tx('Absenden')}`,
`` tx`${n} freie Plätze` `` for interpolation) — the pipeline translates
after the build; never write translations or makeT tables yourself.
`@/i18n` is anonymous-safe and allowlisted in check-public.

```tsx
import { useEffect, useState } from 'react';
import { PublicShell } from '@/components/PublicShell';
import {
  loadPublicPagesConfig, listPublicRecords, createPublicRecord,
  prepareChallenge, PageUnavailableError,
  type PublicPagesConfig, type PublicPageConfig,
} from '@/lib/publicClient';

export default function Booking() {
  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // ALWAYS pass the slug: it is what lets the OWNER open the page while it
    // is still a draft (it then renders with a preview banner). Without it an
    // unpublished page is unavailable even to its owner.
    loadPublicPagesConfig('buchung').then(c => {
      setCfg(c);
      setPage(c?.pages['buchung'] ?? null);
      setLoading(false);
    });
  }, []);

  if (loading || !cfg || !page) {
    return <PublicShell loading={loading} unavailable={!loading} />;
  }
  // list endpoints: listPublicRecords(cfg, page, { appId, limit, offset })
  //   → returns a Record<string, PublicRecordResult>, NOT an array: take
  //     Object.values(...) when you want a list.
  // create endpoints: createPublicRecord(cfg, page, fields)
  // A PublicRecordResult is { id, fields, created_at, updated_at } — the id
  // field is `id`, NOT `record_id`. That name belongs to the INTERNAL record
  // types in @/types/app, which public pages never import. A live build
  // declared `interface WebsiteRecord { record_id: string; … }` and cast the
  // result onto it: TS2352, one failed build and a repair round.
  // `fields` is a Record<string, unknown> — the anonymous surface ships no
  // schema, so every value needs its own cast on the way into your interface
  // (a live build collected 13 TS2322s in one page, one per field):
  //   WRONG: unternehmensname: r.fields.unternehmensname ?? null,
  //   RIGHT: unternehmensname: (r.fields.unternehmensname as string) ?? null,
  // page.endpoints tells you which app_id serves which op — the field is
  // OPTIONAL in the type, so always access it with `?.` (tsc errors on the
  // bare form with TS18048):
  //   WRONG: const ep = page.endpoints.find(e => e.op === 'create');
  //   RIGHT: const ep = page.endpoints?.find(e => e.op === 'create');
  return <PublicShell title={page.title} description={page.description} wide>…</PublicShell>;
}
```

Layout — pick the shell mode by page type:
- Forms and small booking flows: default column (640px), or `wide` (still
  only 672px). In these modes the shell already renders the hosted-page
  card around your children — accent strip, title block (from
  `title`/`description`), white card, footer. Put fields and content
  directly inside; the page looks finished without any layout work.
- Landing pages: `<PublicShell fullBleed>` — the shell's form columns are
  FAR too narrow for hero sections and card grids. With `fullBleed`, build
  full-width bands and give each section its own inner container
  (`max-w-5xl mx-auto px-4`).
- Wizards (`IntentWizardShell`) render INSIDE the shell's card like any
  other column content — the stepper is compact and centered, it fits.
  Never pass `plain` for a wizard: a live pair of dashboards shipped the
  same 0.0.331 shell, but the wizard page opted out and looked like a
  different product next to the carded form.
- `plain` (opt out of the shell's card) is a rare escape hatch for a page
  that genuinely composes several SEPARATE top-level surfaces. It
  sacrifices the standardized hosted look — when in doubt, stay in the
  card and separate sections inside it (spacing, borders).

Wrong: a landing page inside `wide` — the 672px column crushes a 3-column
card grid into ~200px cards and truncates every course name and time.
Right: `fullBleed` + full-width hero band + sections with their own
`max-w-5xl` containers; no `truncate` on names, dates, or prices a
visitor must read.

Wrong: `<PublicShell title={…}><div className="rounded-[27px] bg-card
shadow-lg p-6">…</div></PublicShell>` — the shell already draws that card;
nesting another one shows a card inside a card.
Right: `<PublicShell title={…}><form className="space-y-5">…</form>
</PublicShell>` — or `plain` if the page really brings its own surfaces.

Rules:
- NEVER import `livingAppsService`, `useDashboardData`, or any dialog/page
  from the dashboard — anonymous visitors have no session.
- NEVER use in-page anchors (`<a href="#...">`) — the app is hash-routed,
  so the click REPLACES the route and navigates the visitor off the page.
  Scroll with a button + `ref.scrollIntoView({ behavior: 'smooth' })`
  (check-public rejects anchor hrefs).
- Page-to-page navigation (e.g. "back to the overview") uses the router:
  `import { Link } from 'react-router-dom'` + `<Link to="/public/<slug>">`.
  Never a raw `href` — the app lives under a sub-path (`/objects/<id>/`),
  so `href="/#/public/x"` resolves against the SITE root and dumps the
  visitor on the platform (a live back button did exactly that). And never
  a target outside `/public` — anonymous visitors have no session in the
  dashboard. check-public rejects root-relative hrefs and non-public
  navigation targets.
  Wrong: `<a href="/#/public/verfuegbarkeit">Zurück</a>`
  Right: `<Link to="/public/verfuegbarkeit">Zurück</Link>`
- Call `prepareChallenge(cfg, page, 'POST', `/apps/${appId}/records`)` on
  the first form interaction so submits feel instant. It returns `void`, not
  a Promise, and already swallows its own errors — chaining `.catch(…)` onto
  it is a TS2339 that cost a live build a repair round.
- Handle `PageUnavailableError` by rendering `<PublicShell unavailable />`.
- Mobile-first; most visitors open a shared link on a phone.

## registry.tsx — markers only

```tsx
// <public:imports>
import { lazy } from 'react';
// </public:imports>
…
  // <public:pages>
  'buchung': lazy(() => import('@/pages/public/Booking')),
  // </public:pages>
```

Never touch `PublicPage.tsx`, `PublicFormPage.tsx`, or `publicClient.ts`.

## _public/surface.json — the declaration

One file, all your public pages. Ops: `list` (read with a filter) and
`create` (anonymous submit) — **there are no others**. Field names must exist
on the entity (check `app_metadata.json`).

**An anonymous visitor can never MODIFY an existing record.** "Register for
this meeting" is a `create` in a registration entity, never an edit of the
meeting.

Wrong: `{ "entity": "sitzungen", "op": "update", "fields": ["angemeldete"] }`,
or a hand-rolled `fetch(..., { method: 'PATCH' })` around publicClient. Both
pass every gate and are thrown away by the ingest AFTER the deploy — a live
page cost 304 lane-seconds and left the dashboard with no public page at all.
Right: `{ "entity": "anmeldungen", "op": "create", "fields": [...] }`.

**If the brief needs an edit and no registration entity exists, the page is
NOT buildable.** Write `<staging>/<slug>.blocked.json` =
`{"reason": "<one sentence: what is missing>"}`, write nothing else, and stop.
That is a legitimate outcome and it is reported to the owner — inventing an op
is not.

**One flow = ONE page.** Every page is a separate publish decision for the
owner. Declare ALL data a page needs as endpoints of THAT page — one page
may carry several list/create endpoints across different entities
(`page.endpoints` tells the runtime which app_id serves which op).

Wrong: a booking page plus two component-less "list pages" it reads from —
the owner must publish three things before one link works.
Right: one `buchung` page with three endpoints (list slots, list courses,
create booking); one publish, one link.

```json
{
  "version": 1,
  "pages": [{
    "slug": "buchung",
    "component": "Booking",
    "title": "Termin buchen",
    "endpoints": [
      { "entity": "slots", "op": "list",
        "fields": ["slot_start", "slot_end", "slot_label"],
        "scope": "r.v_available == True",
        "scope_description": "zeigt nur Termine mit verfügbar = ja",
        "max_records": 100 },
      { "entity": "buchungen", "op": "create",
        "fields": ["name", "email", "slot"],
        "preset_fields": { "status": "neu" } }
    ]
  }]
}
```

**A page reached with a link parameter MUST declare it.** If the page reads
`?sitzungId=…` (an invitation, a personalised booking link), add a
`link_param` block — otherwise the owner has no way to obtain a working
link: the management UI can only offer the bare page URL, which such a page
answers with "link incomplete". A live build shipped exactly that: a page
demanding a parameter that nothing in the whole dashboard produced.

```json
"link_param": {
  "slug_note": "sits next to slug/component/title, NOT inside endpoints",
  "name": "sitzungId",
  "entity": "sitzungen",
  "label_field": "titel",
  "secondary_field": "datum"
}
```
`name` is the query parameter your page reads, `entity` supplies the value
(the record's id — the `id` field of a PublicRecordResult) and needs a `list`
endpoint on this SAME page — the page can
only show a record it may read. `label_field`/`secondary_field` are what the
owner sees when picking a record. The service then generates one link per
record under Verwaltung → Öffentliche Seiten → Links. `check-public` rejects
a page that reads a parameter without declaring it.

Still give the page a sensible state WITHOUT the parameter (a short note, or
a list to pick from) — visitors do share bare URLs.

- `scope` is a vSQL filter over `r`. Two hard syntax rules (the server
  probes the expression and rejects the whole page otherwise): fields are
  ALWAYS accessed with the `v_` prefix (`r.v_status`, never `r.status`),
  and the current time is `now()` (`today` does not exist). Example:
  `r.v_einsatz_beginn >= now()`. Keep scopes simple — one or two
  conditions. ALWAYS pair scope with a plain-language `scope_description`
  — the owner confirms that text when publishing, never the vSQL.
- `preset_fields` are server-owned values the visitor can neither see nor
  override; `fields` is the strict allowlist of what a visitor may submit.
- The create payload may carry ONLY keys from that endpoint's `fields` —
  ONE undeclared key rejects the WHOLE submit at runtime, and the generic
  catch message is all the visitor ever sees.

Wrong: `createPublicRecord(cfg, page, { ...form, status: 'offen' })` with
`status` not in `fields` — every submit fails with 400.
Right: `"preset_fields": { "status": "offen" }` in the endpoint, and the
payload sends only the declared `fields`.
- A `required` control in `app_metadata.json` is an INTERNAL duty for the
  team, not an entry duty for a visitor. Ask what the visitor can actually
  know: a table number, an assigned employee, or a confirmation status is
  the team's job AFTER the submit — leave those out of `fields` entirely and
  the record is created with them empty. Only preset a field when a fixed
  value is genuinely correct for every submission (a status like "neu").
- But a field you DO list in `fields` must have a real input in the form.
  Declaring a required field and never sending it makes every submit fail
  with 400 — `check-public.mjs` rejects that.

Wrong: `preset_fields: { "tisch": "…/records/abc" }` — pinning every
visitor to one hard-coded table just to satisfy an internal duty.
Right: `tisch` appears in neither `fields` nor `preset_fields`; the
reservation arrives without a table and the team assigns one.
- Expose the MINIMUM: every field you list is world-readable (list) or
  world-writable (create).
- applookup fields in a LIST projection return the record's reference URL — a
  foreign key. To show the referenced record's data, declare a second list
  endpoint for the target entity on the SAME page and join client-side
  (extract the record id from the URL).
- **`file` fields: readable, not writable.** In a `list` projection the value
  comes through as a plain file URL you can drop straight into `<img src=…>`
  — those URLs serve anonymously. That is how a logo, a hero image or a
  gallery reaches a public page. In a `create` endpoint a file field is
  impossible (a visitor cannot upload; `/files` is not grantable) and gets
  the ENTIRE page rejected at ingest, after the deploy.
- Listing a file field HANDS OUT the link to that file. Right for a logo,
  wrong for a vaccination record or an ID scan — expose deliberately, and say
  in your summary which files the page makes public.
- WRITING an applookup value (a create endpoint, e.g. linking a registration
  to the participant you just created): the anonymous surface accepts ONLY
  grant-scoped URLs. Build them with `recordRef(cfg, page, appId, recordId)`
  from `@/lib/publicClient`, or pass a reference through exactly as a list
  response returned it. Never assemble a record URL yourself.

Wrong: `teilnehmer: \`https://…/rest/apps/${appId}/records/${id}\`` — the
REST form is rejected with 400 "Unsupported field value", and the page
only fails at the LAST step of a multi-create flow.
Right: `teilnehmer: recordRef(cfg, page, tnEp.app_id, created.id)`.

Wrong: page fetches everything and filters client-side
(`fields: [all 12 fields]`, no scope — leaks the whole table).
Right: `scope` narrows the rows server-side, `fields` lists only the 3
columns the page actually shows.

## Reusable blocks

Extract reusable presentational pieces (slot grid, option tiles, stepper)
to `src/components/blocks/` — props in, callbacks out, NO data-client
imports (`scripts/check-blocks.mjs` enforces this). Blocks are shared with
intent UIs, so keep them auth-agnostic.

Pre-provided flow blocks already live there — compose them instead of
rebuilding steppers: `IntentWizardShell` (wizard container; pass
`back={false}` on public pages — anonymous visitors have no dashboard),
`EntitySelectStep` (searchable pick-an-item list), `BudgetTracker`,
`StatusBadge`, `AvailabilityRangePicker` (availability-aware date-range
calendar, see below).

**Booking-style pages MUST use `AvailabilityRangePicker`.** Whenever the
page both LISTS occupancy (an entity with a start/end date pair and a
free/booked status) and lets the visitor request a date range, the visitor
must SEE availability in the picker itself and must be UNABLE to select an
occupied night — not learn about it from an error after submitting. The
block does all of it (month grid, blocked nights struck and unselectable,
no range across an occupied night, min-nights, legend, i18n); map the
listed records into its `blocked` prop and bind `value`/`onChange`:

```tsx
import { AvailabilityRangePicker, rangeIsFree } from '@/components/blocks/AvailabilityRangePicker';
const blocked = eintraege
  .filter(e => e.status === 'belegt')
  .map(e => ({ start: e.anreisedatum, end: e.abreisedatum }));
<AvailabilityRangePicker blocked={blocked} value={range} onChange={setRange} minNights={3} />
```

On submit, revalidate with `rangeIsFree(range.from, range.to, blocked)` —
the availability on the page can go stale between load and submit. Do not
re-derive overlap logic: departure days are EXCLUSIVE (back-to-back
bookings are legal), and the block already encodes that convention.

Availability semantics: map ONLY the occupied status into `blocked` —
**absence of a record means available**, and an explicit "free" record is
just as available as no record at all. Never render per-record "free"
markers: a calendar where three explicitly-marked days are green and
every other free day looks neutral tells the visitor the neutral days are
NOT bookable (a live page did exactly that). Occupied is the only state
worth marking; everything else is selectable.

Wrong: two bare `<DatePicker>` / `<input type="date">` fields next to a
separate availability list — the visitor can request an occupied period
and only finds out by mail days later.
Right: one `AvailabilityRangePicker` fed from the same list endpoint the
page already loads; the two dates land in the create fields on submit.

**One heading per page.** `PublicShell` renders the title and `IntentWizardShell`
renders one too — giving both the same text prints it twice, which is the most
visible flaw a visitor sees.

Wrong: `<PublicShell title="Antrag einreichen"><IntentWizardShell
title="Antrag einreichen" …>` — two identical `<h1>` above each other.
Right: title on `PublicShell`, and `IntentWizardShell` gets only a `subtitle`
(or nothing) — its `title` is optional.

## Before finishing

Run `node scripts/check-public.mjs` and `node scripts/check-blocks.mjs`
(both must be green — check-public verifies the import allowlist and that
every registered slug is declared in surface.json) plus the standard
gates, then `npm run build`. In your summary: name the page's slug, state
that it is a DRAFT until the owner publishes it, and quote the
`scope_description` you declared.
