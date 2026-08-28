---
name: intent-ui
description: |
  Activate this skill when:
  - Building an intent-specific UI page (src/pages/intents/*.tsx)
  - Creating multi-step task workflows that span multiple entities
  - Building wizard/stepper interfaces for complex user tasks
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
---

# Intent UI Building Skill

Build a **multi-step task workflow** — NOT a CRUD page with different styling.

---

## What Makes an Intent UI (vs a CRUD page)

Every entity already has a CRUD page. An intent UI is fundamentally different:

| CRUD Page (already exists) | Intent UI (what you build) |
|---|---|
| Shows ONE entity's records | Orchestrates MULTIPLE entities in one flow |
| Generic table + search + dialogs | Task-specific steps with clear progression |
| Creates one record at a time | Often creates MANY records in one flow |
| No context between actions | Live feedback: totals, counts, progress |
| No clear start/end | Wizard with start → steps → completion |

**If your intent UI is just a table/list/kanban of ONE entity — you're building a CRUD page, not an intent UI. Stop and redesign.**

---

## Your Workflow

1. **Read `src/types/app.ts` FIRST** to learn the exact field names for each entity type. NEVER guess field names.
2. **Write the complete file** with `Write` tool — one shot, no read-back
3. Do NOT run `npm run build` and do NOT run the `scripts/check-*.mjs` gates — both belong to the
   orchestrator, which runs them after it has wired your page into `App.tsx` and `src/config/intents.ts`.
   `check-intents` in particular CANNOT pass while you are working: it verifies the route and the registry
   entry, and neither exists until the orchestrator's step 4. A live run had a subagent burn two Bash
   rounds on `ERROR: src/App.tsx: no import for 'AuftragAnlegenPage'` and then argue in its report why
   the failure did not count. Write the file and stop.

---

## Pre-Generated Shared Components (USE THESE — do NOT recreate!)

### IntentWizardShell — wizard container with all boilerplate
```tsx
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';

const [step, setStep] = useState(1);

<IntentWizardShell
  title="Event vorbereiten"
  subtitle="Schritt-für-Schritt zum perfekten Event"
  steps={[{label: 'Event'}, {label: 'Gäste'}, {label: 'Dienstleister'}, {label: 'Fertig'}]}
  currentStep={step}
  onStepChange={setStep}
  loading={loading}
  error={error}
  onRetry={fetchAll}
>
  {step === 1 && <EventSelect ... />}
  {step === 2 && <GuestInvite ... />}
  {step === 3 && <VendorBooking ... />}
  {step === 4 && <Summary ... />}
</IntentWizardShell>
```
Handles: step indicator circles, URL deep-linking (?step=N), loading/error states, **and a back link in
its header** (to `#/` unless you say otherwise). Each step must provide its own action/navigation buttons
(e.g., "Weiter zu Schritt 3", "Einladungen versenden") — but do NOT add a second "Zurück zum Dashboard"
link, the shell already renders one.

Props:
- `steps` — array of `{ label: string }`, one per step. Label only; the shell owns the rendering.
- `currentStep` / `onStepChange` — 1-based step number and its setter
- `title?` / `subtitle?` — the page heading. `title` is OPTIONAL and must be omitted when the shell sits
  inside a container that already renders an `<h1>` (a `PublicShell`, when this flow is mirrored as a
  public page) — otherwise the page shows the same heading twice.
- `loading?` / `error?` / `onRetry?` — pass them straight from `useDashboardData()`; the shell renders the
  skeleton and the error state for you
- `back?: { href, label } | false` — override the header back link, or pass `false` to hide it. Allowed
  hrefs are the same as everywhere in a flow: `#/` or `#/intents/<other-slug>`, never a CRUD page.

**The shell writes `?step=N` into the URL — so every step must survive arriving there cold.** Component
state does not survive a reload or a link someone shares, and the shell restores only the step NUMBER. A
body gated on state then renders NOTHING: back link, step circles, empty page, no hint, no way forward.

```tsx
// ❌ reload on ?step=3 → blank body
{step === 3 && createdAuftragId && ( … )}

// ✅ the missing prerequisite sends the user back to where it is set
{step === 3 && (createdAuftragId ? ( … ) : (
  <div className="text-center py-12 space-y-3">
    <p className="text-sm text-muted-foreground">Dieser Schritt braucht die Auswahl aus Schritt 1.</p>
    <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
  </div>
))}
```

A deep-link parameter you read yourself (`?auftragId=…`) genuinely repairs the step it fills — but only
that one; the steps after it still need the fallback.

### EntitySelectStep — reusable "pick an item" step WITH "create new" support
```tsx
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';

const [showCreate, setShowCreate] = useState(false);
const [name, setName] = useState('');
const [datum, setDatum] = useState('');

<EntitySelectStep
  items={events.map(e => ({
    id: e.record_id,
    title: e.fields.event_name ?? '',
    subtitle: `${formatDate(e.fields.event_datum)} · ${e.fields.event_location_name ?? ''}`,
    status: e.fields.event_status ? { key: e.fields.event_status.key, label: e.fields.event_status.label } : undefined,
    stats: [{ label: 'Gäste', value: guestCount }, { label: 'Budget', value: formatCurrency(e.fields.event_budget) }],
    icon: <IconCalendarEvent size={20} className="text-primary" />,
  }))}
  onSelect={(id) => { setSelectedEventId(id); setStep(2); }}
  createLabel="Neues Event"
  onCreateNew={() => setShowCreate(true)}
  createDialog={showCreate && (
    // The step's OWN mini-form — only the fields this step needs. Never a {Entity}Dialog here.
    <div className="rounded-2xl border p-4 space-y-3">
      <Input value={name} onChange={e => setName(e.target.value)} placeholder="Eventname" />
      <Input type="date" value={datum} onChange={e => setDatum(e.target.value)} />
      <Button
        disabled={!name || !datum}
        onClick={async () => {
          const created = await LivingAppsService.createEventEntry({ event_name: name, event_datum: datum });
          await fetchAll();
          setShowCreate(false);
          setSelectedEventId(created.record_id);   // auto-select what was just created
          setStep(2);
        }}
      >Anlegen</Button>
    </div>
  )}
/>
```
Provides: search input, card list with title/subtitle/status/stats, click-to-select, **"Neu erstellen" button + mini-form slot**.

Props:
- `items` — array of {id, title, subtitle?, status?, stats?, icon?}
- `onSelect` — called when user picks an existing item
- `createLabel` — optional label for the "create new" button (default: "Neu erstellen")
- `onCreateNew` — optional callback; use it to reveal the step's own mini-form
- `createDialog` — optional ReactNode for that mini-form panel (rendered alongside the list)
- `searchPlaceholder?` — placeholder of the search input (default: the localized "Suchen …")
- `emptyText?` / `emptyIcon?` — what the empty state says and shows when nothing matches

The `status` you pass is coloured through the very same `getStatusColor` that StatusBadge uses, so a
status looks identical in the list and on its badge — including the limit: an unknown key renders neutral
(see StatusBadge below).

### BudgetTracker — budget progress widget
```tsx
import { BudgetTracker } from '@/components/blocks/BudgetTracker';

// Render it only when there IS a budget — see the no-budget case below.
{event.fields.event_budget ? (
  <BudgetTracker budget={event.fields.event_budget} booked={totalBookedCost} />
) : null}
```
Shows: a progress bar in the brand colour, turning amber from 80 % and red above 100 %, plus formatted
currency and the remaining amount.

Props:
- `budget` / `booked` — the two numbers, in the same unit
- `label?` — the caption (default: "Budget"), e.g. "Materialkosten"
- `showRemaining?` — the remaining-amount row (default: on); turn it off in a dense summary step

**The no-budget case:** with `budget <= 0` the component renders a DIFFERENT, bar-less card — just the
booked total and a note that no budget is set. That is correct behaviour, but `budget={x ?? 0}` walks
into it whenever the field is empty, and a step that promised a progress bar suddenly has none. Either
guard the render as above, or accept the bar-less card deliberately.

### StatusBadge — status badge for known keys
```tsx
import { StatusBadge } from '@/components/blocks/StatusBadge';

<StatusBadge statusKey={record.fields.rsvp_status?.key} label={record.fields.rsvp_status?.label} />
```
Props: `statusKey` (renders nothing when undefined), `label?` (falls back to the raw key), `className?`.

It colours a **fixed table of known German status keys** (event / rsvp / booking / payment / condition /
availability, ~30 in total: `bestaetigt`, `ausstehend`, `gebucht`, `storniert`, `bezahlt`, `offen`,
`aktiv`, `pausiert`, `verfuegbar`, …). Everything else renders in neutral grey — including common keys
like `erledigt`, `in_bearbeitung` or `neu`. So: never rely on a colour you have not seen, and never
rebuild the table. When you need the same colour on your own element (a tile, a row, a chip), take it
from the same source instead of writing a second table:

```tsx
import { getStatusColor } from '@/components/blocks/StatusBadge';

<div className={`rounded-xl border p-3 ${getStatusColor(record.fields.status?.key)}`}>…</div>
```

### AvailabilityRangePicker — availability-aware date-range calendar
```tsx
import { AvailabilityRangePicker, rangeIsFree } from '@/components/blocks/AvailabilityRangePicker';

const blocked = belegungen
  .filter(b => b.fields.status?.key === 'belegt')
  .map(b => ({ start: b.fields.anreisedatum!, end: b.fields.abreisedatum }));
const [range, setRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });

<AvailabilityRangePicker blocked={blocked} value={range} onChange={setRange} minNights={3} />
```
Props: `blocked` (ISO `{start, end?}` ranges — `end` is EXCLUSIVE, departure
day frees the resource), `value`/`onChange` (`{from, to}` ISO strings),
`minNights?` (default 1), `months?` (default 2), `disablePast?` (default
true), `legend?` (default true).

Use it in ANY step that picks a date range against existing occupancy —
booking confirmations, room/vehicle reservations. Occupied nights render
struck-through and cannot be selected, a range can never span one, and
back-to-back bookings (new arrival on an existing departure day) work. On
submit, revalidate with `rangeIsFree(from, to, blocked)` — data can go
stale while the form is open. Never rebuild overlap logic or a month grid
by hand, and never fall back to two bare date inputs when occupancy data
exists on the page: a confirm step that lets the team double-book the
same nights is the bug this block exists to prevent.

---

## Custom Step Content

With the shared components above, you only need to write the **custom step content** — typically 200-300 lines instead of 800+. Each step is just a div inside IntentWizardShell's children.

---

## Pattern: Record Selection + Creation (MANDATORY for every selection step)

When a step requires the user to pick a record, ALWAYS use EntitySelectStep with the built-in
create support — and give "Neu erstellen" a step-tailored mini-form, NOT the generic
`{Entity}Dialog` (see the CRITICAL section below):

```tsx
const [showCreate, setShowCreate] = useState(false);
const [name, setName] = useState('');
const [telefon, setTelefon] = useState('');

<EntitySelectStep
  items={gaeste.map(g => ({ id: g.record_id, title: g.fields.name ?? '', ... }))}
  onSelect={(id) => { setSelectedGuestId(id); setStep(3); }}
  createLabel="Neuen Gast anlegen"
  onCreateNew={() => setShowCreate(true)}
  createDialog={showCreate && (
    <div className="rounded-2xl border p-4 space-y-3">
      {/* only the fields needed for a quick registration — the rest lives on the CRUD page */}
      <Input value={name} onChange={e => setName(e.target.value)} placeholder="Name" />
      <Input value={telefon} onChange={e => setTelefon(e.target.value)} placeholder="Telefon" />
      <Button onClick={async () => {
        await LivingAppsService.createGaesteEntry({ name, telefon });
        await fetchAll();
        setShowCreate(false);   // then auto-select the new record from the refreshed list
      }}>Anlegen</Button>
    </div>
  )}
/>
```

The "Neu erstellen" button appears next to the search bar AND in the empty state.

---

## CRITICAL: NEVER use the pre-generated `{Entity}Dialog` inside an intent UI

This is the single biggest mistake. The `{Entity}Dialog` components (KundenDialog,
KatzenDialog, BuchungenDialog, …) are the generic CRUD forms. They show **every**
field, in the same modal, for every situation. That is the opposite of what an
intent UI is.

An intent UI must give the user, **at each step**, only the information that
matters for that specific decision, and the most ergonomic way to enter what's
needed. Re-using the generic CRUD dialog defeats the entire purpose of the wizard.

❌ DON'T (re-using the CRUD dialog for the "Neu erstellen" slot):
```tsx
<EntitySelectStep
  ...
  createDialog={<KundenDialog open={...} onSubmit={...} />}
/>
```
Result: the user gets the full Kunden form (vorname, nachname, telefon, email,
strasse, hausnummer, plz, ort, … plus photo-scan UI) in a modal — even when only
"first name + last name + phone" is relevant for a quick walk-in registration.

❌ DON'T (using the CRUD dialog as the main step):
```tsx
{step === 3 && <BuchungenDialog open onSubmit={handleSubmit} ... />}
```
Result: a 10-field generic modal pops over the wizard, shows fields already
captured in earlier steps, breaks the flow, and forces the user to deal with a
form designed for a totally different context.

✅ DO (build a task-tailored inline UI per step):
- Step "Pick a Kunde": search + list, plus an **inline mini-form** with only the
  3–4 fields needed for a fast registration (e.g. vorname + nachname + telefon).
  No modal, no photo-scan UI, no address fields — those can be filled later from
  the CRUD page if ever needed.
- Step "Pick a Katze for this Kunde": list filtered to that Kunde's cats, plus
  inline form with only katzenname + impfstatus + besitzer (auto-filled).
- Step "Buchungsdetails": custom inline form with a beautiful date-range picker,
  a tile-style multi-select for Zusatzleistungen with prices, a live-updating
  total card. NOT a 10-field modal.

The wizard owns the UI for each step. It calls `LivingAppsService.create…Entry()`
directly. The user gets a UX designed for *their current task*, not the generic
"edit any field of this record" CRUD experience.

---

## Pattern: Bulk Record Creation

When the user needs to create many records (e.g., invite 20 guests):

```tsx
const handleInvite = async (guestId: string) => {
  await LivingAppsService.createEinladungenEntry({
    veranstaltung: createRecordUrl(APP_IDS.VERANSTALTUNGEN, selectedEvent!),
    gast: createRecordUrl(APP_IDS.GAESTE, guestId),
    status: 'eingeladen',   // plain key — never the {key,label} object (400)
  });
  setInvitedGuests(prev => [...prev, guestId]);
  fetchAll(); // refresh data
};
```

**Show live feedback:**
- Counter: "12 von 40 Gästen eingeladen"
- Progress bar
- Running cost total if budget-relevant

---

## When a gate fails

Repair the flow. **Never delete it to get green.** An empty
`src/pages/intents/` passes every check by definition, so deleting is always
the fastest way out — and it leaves the user with a dashboard that has no
flows and no explanation. Missing registry entry → add it. Missing docblock →
write it. A generic `{Entity}Dialog` → replace it with the step's own form.

---

## Pattern: Chained Creation (create A, then link B to it)

The most common wizard shape: create the main record, then create a dependent
one that REFERENCES it. The reference needs the id of the record you just
created — and that comes from `result.record_id`.

```tsx
// Step 5: create the order, then its appointment
const auftrag = await LivingAppsService.createAuftraegeEntry({
  auftragsnummer, auftragsdatum, status: FIRST_STATUS,
  kunde: createRecordUrl(APP_IDS.KUNDEN, selectedKundeId),
});

await LivingAppsService.createTermineEntry({
  terminbezeichnung: `Reparatur: ${auftragsnummer}`,
  startzeit,
  termin_auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, auftrag.record_id),
});
```

`create…Entry()` resolves to a `MutationResult` — `record_id` (and `id`, the
same value) is the new record's id.

Wrong: digging the id out of the response as if it were a list —
`Object.entries(result)[0][0]` / `Object.keys(result)[0]` yield the STRING
`"id"`, the next write posts `/records/id`, and the API answers 400
"Unsupported field value". That rule is for LIST reads only.

**Because the failure lands on the LAST step, half the data is already saved
when the user sees the error.** Walk every chained flow through its final
step — a wizard that reaches step 5 is not a wizard that works.

---

## Pattern: Cross-Entity Selection

When the user picks from multiple entities to create a linked record:

```tsx
// Step 1: Select student (from Fahrschueler)
// Step 2: Select instructor (from Fahrlehrer, filtered by availability)
// Step 3: Select vehicle (from Fahrzeuge, filtered by type matching class)
// Step 4: Pick date/time
// Step 5: Confirm → creates Fahrstunde with all 3 applookup references
```

Each step narrows the options based on previous selections.

---

## Anti-Patterns (DO NOT BUILD)

- ❌ **Status kanban** for one entity → belongs on the dashboard, not an intent page
- ❌ **Filtered table** of one entity → that's the CRUD page
- ❌ **Single-entity form** with styling → that's the existing dialog
- ❌ **Read-only summary/stats** → belongs on the dashboard
- ❌ **Entity list with action buttons** → that's the CRUD page with extra buttons

---

## CRITICAL: Never link the user from an intent UI to a CRUD subpage

The CRUD subpages (`#/buchungen`, `#/kunden`, `#/katzen`, …) are generic admin
tables and do NOT belong in the intent flow. Linking the user there mid-task or
on success drops them into a different mental context, away from the focused
workflow they just completed.

Allowed link targets from inside an intent UI:
- `#/` — the dashboard (the natural "home base" after a completed task)
- `#/intents/<other-slug>` — a follow-up intent that continues the task

❌ DON'T:
```tsx
<a href="#/buchungen">Zur Buchungsübersicht</a>
<Button onClick={() => { window.location.hash = '/kunden'; }}>Zur Kundenliste</Button>
```

✅ DO:
```tsx
// Success state — return to dashboard or chain to a follow-up intent
<Button onClick={handleReset}>Neue Buchung anlegen</Button>      // reset wizard
<a href="#/">Zurück zum Dashboard</a>                            // home base
<a href="#/intents/abreise-abwickeln">Weiter: Abreise abwickeln</a>  // chain
```

The dashboard is responsible for navigation to any CRUD page if the user needs it.
The intent UI is responsible for finishing the task and returning the user to
either a clean slate (new task) or the dashboard (overview).

---

## Technical Rules

These are MANDATORY — violation causes TypeScript build errors or runtime crashes:

- **Rules of Hooks**: ALL hooks (`useState`, `useEffect`, `useMemo`, `useCallback`) MUST be placed BEFORE any early returns (`if (loading) return`, `if (error) return`)
- **Import hygiene**: Only import what you actually use.
- **No `{Entity}Dialog`**: create records with a step-tailored mini-form + `LivingAppsService.create…Entry()` — see the CRITICAL section above. The generic dialogs stay on the CRUD pages.
- **No `toISOString()` — anywhere in the file**: format dates locally — see "Dates" below. The
  `check-intents.mjs` gate is file-wide and context-free; it also flags local display state that
  never reaches the API.
- **Required fields**: your mini-form carries the duty the dialog used to — see "Required fields" below.
- **A step that `create`s more than one record must not duplicate them on a retry** — see "survive its own retry" below. The error path re-enables the button; without a guard the second click writes the first record again.
- **`<SelectItem>` never gets an empty value**: see "Optional selects" below. `tsc` compiles it; Radix throws at runtime.
- **When you replace a declaration, grep for its callers** — see "Rewriting your own code" below.
- **No Bash file ops**: Use Read/Write/Edit tools only
- **No file read-back**: After Write, do NOT read the file back
- **Touch-friendly**: Never hide buttons behind hover

## Available Libraries

- **shadcn/ui**: Button, Card, Badge, Dialog, Select, Input, Tabs, Table (all in `src/components/ui/`)
- **@tabler/icons-react**: All icons prefixed with `Icon`. Use `stroke` prop, not `strokeWidth`.
- **date-fns**: `format`, `parseISO`, `isAfter`, `isBefore`, `addDays`, `differenceInDays`. Import `de` locale.

## Data Access

From `useDashboardData()` hook:
- Entity records: **plain arrays** — `kunden` is `Kunden[]`, already destructurable and
  `.filter()`/`.find()`-able. There is NO keyed object: `Object.values(kunden)` is pointless,
  `kunden as Record<string, Kunden>` does not type-check (TS2352), and `kunden[someRecordId]`
  does not either (TS7015 — a string is not an array index). To look one record up by id use
  `kunden.find(k => k.record_id === id)`, or the ready-made `kundenMap` below.
  This doc taught `Record<string, EntityType>` for several releases; two flow pages obeyed it
  in the same build and produced five type errors, ~100s of repair.
- Map objects: `{entity}Map` for applookup resolution — a real `Map`, so `.get(id)`, not `[id]`
- `fetchAll()` — refetch after creating/updating records
- `loading`, `error` — handle in the component

**CRUD operations — use ONLY pre-generated service methods with EXACT field names from src/types/app.ts:**
```typescript
await LivingAppsService.createXEntry(fields);  // fields must match the type definition exactly
await LivingAppsService.updateXEntry(recordId, fields);
await LivingAppsService.deleteXEntry(recordId);
```
Do NOT create custom service functions. Do NOT invent field names — read them from the types.

### Required fields are yours now

The mini-form replaces the generated `{Entity}Dialog` — and with it the dialog's required-field check.
The entity summary marks which fields the app itself requires. A marked field either belongs in this
step's form, or you leave it empty on purpose: the API accepts the record either way, so **nothing will
tell you afterwards** — the record is simply created incomplete and shows up as a gap in the owner's
Living-Apps view.

Deciding is part of designing the step, not an afterthought: a quick walk-in registration may legitimately
skip a required address (it gets filled later on the CRUD page), a booking may not skip its date. When you
skip one, say so in the step — a one-line hint beats a silent gap.

### Optional selects: the sentinel, all three parts

A `<SelectItem>` with an empty value **throws at runtime** — Radix refuses it, the ErrorBoundary swallows
the whole step, and `tsc` never sees it. Use the sentinel the scaffold uses (`BulkEditDialog`,
`PublicFormPage`), and strip it again on write:

```tsx
// ❌ <SelectItem value="">Keine Einheit</SelectItem>          // crashes when the dropdown opens
// ✅ <SelectItem value="none">Keine Einheit</SelectItem>
…
if (einheit && einheit !== 'none') payload.einheit_position = einheit;   // never send 'none'
```
The first keeps the dropdown from crashing; the second keeps `'none'` out of the record — it is not a
lookup key, so the API would reject it or store nonsense.

**Third: the state holding the sentinel must NOT be named after the field.** `check-lookup-keys` reads
`<field>: '<literal>'` as a write and rejects every literal that is not a real key. It cannot tell your
form object from a payload, and `''` fails it just as `'none'` does:

```tsx
// ❌ setPositions([...prev, { menge: '1', einheit_position: 'none' }]);   // gate: 'none' is not a valid key
// ✅ setPositions([...prev, { menge: '1', einheitKey: 'none' }]);         // map to einheit_position on write
```
When the gate prints `(Local UI property sharing the name? Rename it.)` that IS the fix — rename the
property and move on; do not hunt for a literal the gate will swallow. A live run tried four other things
first and ended by DELETING its `<SelectItem value="none">`, which silently took away the user's only way
to clear the field. A green gate that costs a control is not a fix.

### Rewriting your own code

Spotting a mistake in what you just wrote and fixing it is right. Finishing the fix is the part that gets
dropped: when you REPLACE a block, the declarations inside it disappear while their callers elsewhere in
the file survive. Live case — a `useState` pair was replaced by a `useEffect`, and the reset handler still
called the setter that no longer existed: `TS2304: Cannot find name 'setDidAutoSelect'`. Every gate stayed
green; only `tsc` caught it, one build later.

So before you replace a region: `Grep` the file for each name declared inside it, and fix or remove every
hit. The name you are deleting is the search term — one grep, not a re-read of the whole file.

### A step that writes SEVERAL records must survive its own retry

The writing step is the one place a user presses the same button twice. The first record lands, the
second call fails, your `catch` shows the error, `finally` re-enables the button — and the next click
re-runs the handler from the top. Live case: the step created the Prüfprotokoll, the follow-up status
PATCH failed, and the retry left the order with **two identical protocols**. Nothing reports that — the
second write succeeds.

The id you already store for the summary IS the idempotency key. Read it before writing, don't only
display it:

```tsx
// ❌ every retry re-creates the record
const p = await LivingAppsService.createPruefprotokollEntry({…});
setProtokollId(p.record_id);
await LivingAppsService.updateAuftraegeEntry(id, { status: next });   // fails → next click duplicates p

// ✅ the stored id gates the create; the local variable carries it through this run
let pid = protokollId;
if (!pid) {
  pid = (await LivingAppsService.createPruefprotokollEntry({…})).record_id;
  setProtokollId(pid);
}
await LivingAppsService.updateAuftraegeEntry(id, { status: next });
```

Same shape for a parent plus N children: hold the parent id in state and create it only while that id is
still empty, so a failure partway through the children cannot produce a second parent. An `update` is
naturally repeatable — only `create` needs the guard.

### Dates: never `toISOString()`

A date written with `toISOString()` carries the UTC shift: a slot the user picked for the 6th at 00:00
arrives as the 5th at 23:00. Nothing catches it later — the service only trims the string to the field's
format, it cannot move the hour back — so the record is quietly wrong.

```typescript
// ❌ WRONG — UTC shift, silently off by a day or an hour
await LivingAppsService.createTermineEntry({ startzeit: new Date(day).toISOString() });
// ✅ RIGHT — format locally, in the field's own format
await LivingAppsService.createTermineEntry({ startzeit: format(day, "yyyy-MM-dd'T'HH:mm") });
```

`date/date` → `format(d, 'yyyy-MM-dd')`, `date/datetimeminute` → `format(d, "yyyy-MM-dd'T'HH:mm")` (both
from `date-fns`). A value taken straight out of an `<Input type="date">` or `type="datetime-local"` is
already in the right form — pass it through unchanged, do not route it through a `Date`.

The rule is not "no toISOString in API writes" — it is **no `toISOString()` anywhere in the file**.
`check-intents.mjs` scans the whole file and has no context; a live run lost a repair round because a
locally constructed record object filled its `created_at`/`createdat` state fields (never sent to the
API) with `toISOString()`. Use `format(new Date(), "yyyy-MM-dd'T'HH:mm")` for such placeholders too.

### Lookup field values when writing

When READING, lookup fields are enriched objects: `{ key: 'gut', label: 'Gut' }`. When WRITING, send the
plain key string — that is the clear form, and the one the API takes:

```typescript
await LivingAppsService.createEinladungenEntry({ status: 'eingeladen' });   // just the key
// multiplelookup → array of key strings
await LivingAppsService.createArtikelEntry({ tags: ['neu', 'aktion'] });
```

Handing the whole `{ key, label }` object through is not an error: every `create…Entry()` /
`update…Entry()` runs its fields through `cleanFieldsForApi`, which unwraps lookup objects to their key
(arrays too) and trims a date string to the field's format. So re-using a value you just read is safe.
Note where that help ends: it lives in the service call. A value you hand to something else — a dialog's
`defaultValues`, a public page's `createPublicRecord` — is passed on exactly as you wrote it, so use the
plain key there.

**What is NOT forgiving is the key itself.** Nothing validates a lookup key on the way out: an invented
key that merely sounds right reaches the API and comes back 400 "must be a valid lookup key", which
breaks the step for the user. Read the valid keys from `LOOKUP_OPTIONS` in `@/types/app` (or from the
field's options in the types file) and copy the literal from there — never guess one.

```typescript
// ❌ WRONG — 'offen' sounds plausible; the schema's keys are bezahlt|ausstehend|gemahnt
await LivingAppsService.createBeitraegeEntry({ zahlungsstatus: 'offen' });
// ✅ RIGHT — literal copied from the schema
await LivingAppsService.createBeitraegeEntry({ zahlungsstatus: 'ausstehend' });
```

`node scripts/check-lookup-keys.mjs` flags every unknown literal before the build.

**How you REACH the options matters as much as the key.** Index `LOOKUP_OPTIONS` with `?.` on BOTH levels
and end in `?? []`. The type asserts every key is present, so `tsc` accepts the bare form — but these are
usually module-level `const`s, and an absent key there throws while the module loads: the whole page goes
white before a single component renders, and no gate sees it.

```typescript
// ❌ const STATUS = LOOKUP_OPTIONS['auftraege']['status'] ?? [];      // white page if either key is absent
// ✅ const STATUS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];
```

And prefer the schema over a literal for a form's DEFAULT: `useState(STATUS[0]?.key ?? '')` keeps working
when the app's first stage is renamed, while `useState('offen')` silently starts the form on a stage that
may no longer be first. The gate catches an invented key; it cannot catch a real key that is the wrong
one to start on.

### CRITICAL: multipleapplookup field values when writing to the API

`multipleapplookup/*` fields (e.g. a booking's `extras` referencing many `Zusatzleistung`
records) expect either `null` or an **array of full record URLs** — `string[]`.
This is the single most common bug in intent UI code that selects multiple records
via tiles/chips/checkboxes and posts directly to the API. NEVER join, stringify, or
collapse the array into a single string.

```typescript
// Wizard state — typical pattern: Set<recordId> toggled by tile clicks
const [selected, setSelected] = useState<Set<string>>(new Set());

// On submit — map IDs to full record URLs, send the ARRAY directly
const urls = Array.from(selected).map(id => createRecordUrl(APP_IDS.ZUSATZLEISTUNGEN, id));

// ✅ CORRECT — string[] (or undefined when empty)
await LivingAppsService.createBuchungenEntry({
  extras: urls.length > 0 ? urls : undefined,
});

// ❌ WRONG — API returns 422 "type none or list expected, not str"
extras: urls.join(',')

// ❌ WRONG — single URL when the field expects a list
extras: createRecordUrl(APP_IDS.ZUSATZLEISTUNGEN, oneId)

// ❌ WRONG — JSON string instead of an actual array
extras: JSON.stringify(urls)
```

Rule of thumb: if the form-state is a `Set<id>` or `id[]`, map to URLs first, then pass
the ARRAY directly. Singular `applookup/*` (`/select` and `/choice` behave the same) → one URL string.
Multiple `multipleapplookup/*` → array of URL strings, always. To CLEAR a reference you may pass
`undefined`: the service turns it into `null` for a single reference and into `[]` for a multiple one.

Scope: `createRecordUrl` builds the AUTHENTICATED `/rest` form. Public pages are a different
surface with a different form: `recordRef(cfg, page, appId, recordId)` from `@/lib/publicClient`
instead — never `createRecordUrl`; see the `public-builder` skill.

## Design Tokens

Use existing CSS custom properties — do NOT create new ones:
- `bg-card`, `bg-secondary`, `bg-primary`, `bg-destructive/10`
- `text-foreground`, `text-muted-foreground`, `text-primary-foreground`
- `rounded-2xl`, `shadow-lg` for card wrappers

## Reusable Blocks (src/components/blocks/)

When a step contains a reusable presentational piece (a slot grid, option
tiles, a quantity stepper), do NOT inline it in the wizard page — extract it
to `src/components/blocks/<Name>.tsx`. Blocks are shared with PUBLIC pages
(anonymous visitors, different auth), so they must be strictly
presentational: **props in, callbacks out, no data access**. Never import
`livingAppsService`, `useDashboardData`, `publicClient`, or `actions-agent`
inside a block — `scripts/check-blocks.mjs` fails the build if you do. The
page owns the data and passes it down.

```tsx
// ❌ WRONG — block loads its own data, now it only works logged-in
export function SlotGrid() { const { records } = useDashboardData(); … }

// ✅ RIGHT — block renders what it's given
export function SlotGrid({ slots, onSelect }: { slots: Slot[]; onSelect: (s: Slot) => void }) { … }
```
