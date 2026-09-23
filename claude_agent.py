import asyncio
import json
import time
from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions, AgentDefinition, AssistantMessage, UserMessage, ToolUseBlock, ToolResultBlock, TextBlock, ResultMessage, HookMatcher
import os

_t0 = time.time()
_LOG_LEVEL = os.getenv("LOG_LEVEL", "warn").lower()

async def _on_post_tool_use(input_data: dict, tool_use_id: str | None = None, context: dict | None = None) -> dict:
    """Log tool results after execution (only at debug level)."""
    if _LOG_LEVEL == "debug":
        try:
            tool = input_data.get("tool_name", "?")
            response = input_data.get("tool_response", "")
            output = str(response)[:4000] if response else ""
            elapsed = round(time.time() - _t0, 1)
            print(json.dumps({"type": "tool_result", "tool": tool, "output": output, "t": elapsed}), flush=True)
        except Exception as e:
            elapsed = round(time.time() - _t0, 1)
            print(json.dumps({"type": "tool_result", "tool": input_data.get("tool_name", "?"), "output": f"[hook error: {e}]", "t": elapsed}), flush=True)
    return {"continue_": True}

# Environment-specific configuration
LA_API_URL = os.getenv("LA_API_URL", "https://my.living-apps.de/rest")
LA_FRONTEND_URL = os.getenv("LA_FRONTEND_URL", "https://my.living-apps.de")

# ── Subagent prompts (only used in Phase 2 / "all" mode) ───────────

INTENT_BUILDER_PROMPT = """\
You build a single INTENT UI page — a task-oriented workflow that guides the user through a multi-step process.

LANGUAGE & TONE: All UI text (labels, buttons, headings, descriptions, empty states, tooltips) MUST be in German. \
Always use "du/dein/dir" — NEVER "Sie/Ihr/Ihnen".

## WHAT AN INTENT UI IS (vs what it is NOT)

An intent UI is NOT a fancy CRUD page. CRUD pages already exist for every entity — they have tables, search, \
create/edit/delete dialogs. Do NOT rebuild that.

An intent UI is a WORKFLOW that:
- Spans MULTIPLE entities (e.g., selecting a record from entity A, then creating linked records in entity B and C)
- Has STEPS or PHASES (e.g., Step 1: pick event → Step 2: invite guests → Step 3: book vendors → Step 4: confirm)
- Creates MULTIPLE records in a single flow (e.g., inviting 20 guests = creating 20 invitation records)
- Has a clear START state and END state (user begins the task → user completes the task)
- Shows live context as the user progresses (e.g., running budget total, guest count, progress indicator)

EXAMPLES of good intent UIs:
- "Prepare Event": Wizard — choose event → bulk-invite guests (creates Einladung records) → book vendors (creates Buchung records) → see budget summary → confirm
- "Schedule Lesson": Pick student + instructor + vehicle + timeslot in ONE focused view → creates Fahrstunde record with all relationships pre-filled
- "Record Exam Results": Select exam from pending list → set result → auto-update student status → show next pending exam

EXAMPLES of what is NOT an intent UI (just CRUD with lipstick):
- ❌ A table of events with filters and a create button
- ❌ A kanban board showing records grouped by status (that's a dashboard widget)
- ❌ A single-entity form with some extra styling

## IMPLEMENTATION

You will be given an intent description and the file path to create. Create the COMPLETE file from scratch.

Use useState to manage wizard steps, selections, and running totals.

RECORD CREATION & SELECTION — THIS IS THE #1 RULE:

🚨 NEVER build custom inline forms for creating records. NEVER. Not even "simple" ones.
The pre-generated {Entity}Dialog handles ALL field types, validation, photo scan, applookup fields, \
and lookup enrichment correctly. A custom inline form will be WRONG.

For EVERY step where the user needs to pick or add a record:

1. SHOW EXISTING RECORDS FIRST — fetch from useDashboardData(), display as a searchable list \
(use EntitySelectStep or a custom card list). The user picks from what already exists.

2. OFFER "Neu erstellen" BUTTON — a Button below or beside the list that opens {Entity}Dialog. \
After the dialog closes successfully and fetchAll() refreshes, auto-select the newly created record.

3. CONCRETE EXAMPLE:
```tsx
const [dialogOpen, setDialogOpen] = useState(false);
// Show existing articles to select from
<EntitySelectStep items={artikel.map(a => ({...}))} onSelect={handleSelect} />
<Button variant="outline" onClick={() => setDialogOpen(true)}>
  <IconPlus size={16} className="mr-2" /> Neuen Artikel anlegen
</Button>
<ArtikelDialog open={dialogOpen} onClose={() => setDialogOpen(false)}
  onSubmit={async (fields) => { await LivingAppsService.createArtikelEntry(fields); await fetchAll(); }} />
```

This applies to ALL entities in EVERY step: selecting a group, picking participants, choosing articles, etc. \
Never replace the dialog with an inline form — not even for "quick add" scenarios.

MANDATORY RULES:
- BEFORE writing any code, Read src/types/app.ts to learn the EXACT field names for each entity type. \
Use ONLY these field names when calling LivingAppsService methods. NEVER invent or guess field names.
- Use ONLY the pre-generated LivingAppsService methods (createXEntry, updateXEntry, deleteXEntry) \
from '@/services/livingAppsService'. Do NOT build custom API calls or service functions.
- Create the file with Write tool — one shot, no read-back.
- The file must be a valid React component with a default export.
- Import useDashboardData from '@/hooks/useDashboardData' for data access.
- Import types from '@/types/app', services from '@/services/livingAppsService'.
- Import enrichment functions from '@/lib/enrich' and enriched types from '@/types/enriched' if needed.
- NEVER use Bash for file operations — use Read/Write/Edit tools only.
- Rules of Hooks: ALL hooks MUST be BEFORE any early returns (loading/error).
- IMPORT HYGIENE: Only import what you use.
- ALWAYS reuse pre-generated {Entity}Dialog from '@/components/dialogs/{Entity}Dialog' for record creation/editing.
- TOUCH-FRIENDLY: NEVER hide buttons behind hover.
- Follow .claude/skills/intent-ui/SKILL.md for design patterns.
- Do NOT run npm run build — the orchestrator handles that.
- Do NOT touch any other files — only create the file you were given.
- DEEP-LINKING: Use useSearchParams to read ?step= parameter. Initialize the wizard step from the URL \
param so the dashboard can link directly to specific steps (e.g., ?eventId=xxx&step=2 skips to step 2). \
When the user navigates between steps, update the URL params to keep them in sync.

CRITICAL API RULE — lookup fields when writing:
When READING, lookups are objects: { key: 'x', label: 'X' }.
When WRITING (create/update via LivingAppsService), send ONLY the plain key string!
  ❌ status: { key: 'eingeladen', label: 'Eingeladen' }  → 400 error
  ✅ status: 'eingeladen'                                 → works
For multiplelookup, send string array: ['a', 'b'], NOT [{key,label}, ...].
"""

SUBAGENT_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]

# ── System prompt variants ──────────────────────────────────────────

# Phase 1 (dashboard): identical to actions branch — full detailed rules
SYSTEM_APPEND_DASHBOARD = (
    "MANDATORY RULES (highest priority):\n"
    "- No design_brief.md — analyze data in 1-2 sentences, then implement directly\n"
    "- DashboardOverview.tsx: Call Read('src/pages/DashboardOverview.tsx') FIRST, then Write ONCE with complete content. Never read back after writing.\n"
    "- NEVER use Bash for file operations (no cat, echo, heredoc, >, >>). ALWAYS use Read/Write/Edit tools. If a tool fails, retry with the SAME tool — never fall back to Bash.\n"
    "- index.css: NEVER touch — pre-generated design system (font, colors, sidebar). Use existing tokens.\n"
    "- Layout.tsx: APP_TITLE is pre-set to the appgroup name. Do NOT edit unless you need a different title.\n"
    "- CRUD pages/dialogs: NEVER touch — complete with all logic\n"
    "- App.tsx, PageShell.tsx, StatCard.tsx, ConfirmDialog.tsx: NEVER touch\n"
    "- No Read-back after Write/Edit\n"
    "- No Read of files whose contents are in .scaffold_context\n"
    "- Read .scaffold_context FIRST to understand all generated files\n"
    "- useDashboardData.ts, enriched.ts, enrich.ts, formatters.ts, ai.ts, ChatWidget.tsx: NEVER touch — use as-is\n"
    "- src/config/ai-features.ts: MAY edit — set AI_PHOTO_SCAN['Entity'] = true to enable photo scan in dialogs\n"
    "- Rules of Hooks: ALL hooks (useState, useEffect, useMemo, useCallback) MUST be BEFORE any early returns (loading/error). Never place a hook after 'if (loading) return' or 'if (error) return'.\n"
    "- IMPORT HYGIENE: Only import what you actually use. TypeScript strict mode errors on unused imports. BEFORE calling Write, mentally trace every import — if it doesn't appear in the JSX/logic body, remove it.\n"
    "- Dashboard is the PRIMARY WORKSPACE — build interactive domain-specific UI, not an info page\n"
    "- ALWAYS reuse pre-generated {Entity}Dialog from '@/components/dialogs/{Entity}Dialog' for create/edit forms in the dashboard — never build custom forms\n"
    "- TOUCH-FRIENDLY: NEVER hide action buttons/icons behind hover (no opacity-0 group-hover:opacity-100). All interactive elements must be visible without hovering.\n"
    "- After 'npm run build' succeeds, STOP immediately. Do not write summaries."
)

# Phase 2 (intents) / "all" mode: lighter orchestrator rules
SYSTEM_APPEND_ORCHESTRATOR = (
    "MANDATORY RULES (highest priority):\n"
    "- NEVER use Bash for file operations (no cat, echo, heredoc, >, >>). ALWAYS use Read/Write/Edit tools.\n"
    "- index.css: NEVER touch — pre-generated design system. CRUD pages/dialogs: NEVER touch.\n"
    "- Layout.tsx: NEVER touch — sidebar navigation is pre-generated.\n"
    "- useDashboardData.ts, enriched.ts, enrich.ts, formatters.ts, ai.ts, ChatWidget.tsx: NEVER touch\n"
    "- Rules of Hooks: ALL hooks MUST be BEFORE any early returns.\n"
    "- IMPORT HYGIENE: Only import what you actually use.\n"
    "- After 'npm run build' succeeds, STOP immediately."
)


async def main():
    # Build phase support for two-phase builds
    build_phase = os.getenv('BUILD_PHASE', 'all')  # "dashboard", "intents", or "all"

    # Subagent definitions — only needed for phases that use orchestration
    agents = None
    if build_phase in ("intents", "all"):
        agents = {
            "intent_builder": AgentDefinition(
                description="Builds one intent-specific UI page from scratch. Give it the file path to create and the intent description.",
                prompt=INTENT_BUILDER_PROMPT,
                tools=SUBAGENT_TOOLS,
                model="inherit",
            ),
        }

    # Select system prompt based on build phase
    if build_phase == "dashboard":
        system_append = SYSTEM_APPEND_DASHBOARD
    else:
        system_append = SYSTEM_APPEND_ORCHESTRATOR

    options = ClaudeAgentOptions(
        hooks={
            "PostToolUse": [HookMatcher(matcher=None, hooks=[_on_post_tool_use], timeout=60)],
        },
        system_prompt={
            "type": "preset",
            "preset": "claude_code",
            "append": system_append,
        },
        thinking={"type": "disabled"},
        setting_sources=["project"],
        permission_mode="bypassPermissions",
        disallowed_tools=["TodoWrite", "NotebookEdit", "WebFetch", "ExitPlanMode", "SlashCommand"],
        cwd="/home/user/app",
        model="claude-sonnet-4-6",
    )

    # Only register agents when needed (Phase 2 / all)
    if agents:
        options.agents = agents

    # Session-Resume Unterstützung
    # BUG: agents + resume crashes the Claude CLI (tested SDK 0.1.50 + 0.1.58).
    # Skip resume when agents are registered — Phase 2 doesn't need conversation history.
    resume_session_id = os.getenv('RESUME_SESSION_ID')
    if agents and resume_session_id:
        print(f"[KLAR] Skipping resume (agents + resume = SDK crash)")
        resume_session_id = None
    if resume_session_id:
        options.resume = resume_session_id
        print(f"[KLAR] Resuming session: {resume_session_id}")

    # User Prompt - prefer file over env var (handles special chars better)
    user_prompt = None

    prompt_file = "/home/user/app/.user_prompt"
    if os.path.exists(prompt_file):
        try:
            with open(prompt_file, 'r') as f:
                user_prompt = f.read().strip()
            if user_prompt:
                print(f"[KLAR] Prompt aus Datei gelesen: {len(user_prompt)} Zeichen")
        except Exception as e:
            print(f"[KLAR] Fehler beim Lesen der Prompt-Datei: {e}")

    if not user_prompt:
        user_prompt = os.getenv('USER_PROMPT')
        if user_prompt:
            print(f"[KLAR] Prompt aus ENV gelesen")

    # Build instructions — optional user notes for fresh builds (NOT continue mode)
    user_instructions = None
    instructions_file = "/home/user/app/.user_instructions"
    if os.path.exists(instructions_file):
        try:
            with open(instructions_file, 'r') as f:
                user_instructions = f.read().strip()
            if user_instructions:
                print(f"[KLAR] User instructions aus Datei gelesen: {len(user_instructions)} Zeichen")
        except Exception as e:
            print(f"[KLAR] Fehler beim Lesen der User-Instructions-Datei: {e}")

    if not user_instructions:
        user_instructions = os.getenv('USER_INSTRUCTIONS')
        if user_instructions:
            print(f"[KLAR] User instructions aus ENV gelesen")

    if user_prompt:
        # Continue/Resume-Mode: Custom prompt vom User (no subagents, direct editing)
        query = f"""🚨 AUFGABE: Du MUSST das existierende Dashboard ändern!

User-Anfrage: "{user_prompt}"

PFLICHT-SCHRITTE (alle müssen ausgeführt werden):

1. LESEN: Lies src/pages/DashboardOverview.tsx um die aktuelle Struktur zu verstehen
2. ÄNDERN: Implementiere die User-Anfrage mit dem Edit-Tool
3. TESTEN: Führe 'npm run build' aus um sicherzustellen dass es kompiliert
4. BAUEN: Führe 'npm run build' aus. Bei Fehler: fixen und erneut bauen bis es klappt.

⚠️ KRITISCH:
- Du MUSST Änderungen am Code machen (Edit-Tool verwenden!)
- Analysieren alleine reicht NICHT - du musst HANDELN!
- Deployment passiert automatisch nach deiner Arbeit — deploye NICHT manuell!

Das Dashboard existiert bereits. Mache NUR die angeforderten Änderungen, nicht mehr.
Starte JETZT mit Schritt 1!"""
        print(f"[KLAR] Continue-Mode mit User-Prompt: {user_prompt}")

    elif build_phase == "dashboard":
        # Phase 1: Identical to actions branch — direct agent, no orchestrator overhead
        query = (
            "Read .scaffold_context and app_metadata.json. "
            "Analyze data, decide UI paradigm in 1-2 sentences, then implement directly. "
            "Follow .claude/skills/frontend-impl/SKILL.md. "
            "Use existing types and services from src/types/ and src/services/. "
            "Only import what you actually use — TypeScript strict mode errors on unused imports. "
            "Run 'npm run build' when done. Deployment is automatic."
        )

        if user_instructions:
            query += (
                f"\n\nADDITIONAL user instructions (treat as MINIMUM requirements, not as limits):\n"
                f"<user-instructions>\n{user_instructions}\n</user-instructions>\n"
                f"You MUST still build the full dashboard with all features you think are useful for the users — "
                f"analyze the data, decide the best UI paradigm, and implement everything you normally would. "
                f"The user instructions above are ADDITIONS on top of your normal work, not replacements. "
                f"Implement both: everything you would build anyway PLUS what the user asked for."
            )
            print(f"[KLAR] Phase 1: Dashboard build MIT User Instructions: {user_instructions}")
        else:
            print(f"[KLAR] Phase 1: Dashboard build (direct, no subagent)")

    elif build_phase == "intents":
        # Phase 2: Only intent builders — dashboard already deployed
        query = """\
You are the BUILD ORCHESTRATOR (Phase 2 — Intent UIs only). \
Read .entity_summary (short, ~30 lines) for entity info. Do NOT read .scaffold_context or app_metadata.json.

## WHAT ARE INTENT UIs?

Every entity ALREADY has a full CRUD page (table + search + create/edit/delete). Intent UIs are NOT more CRUD pages \
with different styling. They are TASK WORKFLOWS.

An intent UI is a MULTI-STEP WIZARD that:
- Spans MULTIPLE entities in one flow (selecting from entity A → creating linked records in entity B and C)
- Has STEPS (wizard/stepper pattern with clear step progression)
- Often creates MULTIPLE records in a single flow (e.g., inviting 20 guests = 20 invitation records)
- Shows LIVE FEEDBACK as the user progresses (running totals, counts, progress bar, budget remaining)
- Has a clear START → END (user begins task → user completes task with a result)
- Supports deep-linking to specific steps via URL params (e.g., ?eventId=xxx&step=2)

## CRITICAL: NO REDUNDANT INTENTS

Each intent MUST be a UNIQUE workflow that does NOT overlap with other intents. \
If one wizard has steps A→B→C, do NOT create separate intent pages for step B and step C — \
instead, make the wizard support deep-linking to specific steps via URL query params.

EXAMPLE — WRONG (redundant):
- "Prepare Event" wizard: pick event → invite guests → book vendors → summary
- "Manage RSVPs" page: pick event → update guest statuses  ← THIS IS JUST STEP 2 OF THE WIZARD!
- "Book Vendors" page: pick event → browse vendors → book them  ← THIS IS JUST STEP 3 OF THE WIZARD!

EXAMPLE — CORRECT (each intent is unique):
- "Prepare Event" wizard: pick event → invite guests → book vendors → summary
  - Dashboard links to specific steps: ?eventId=xxx&step=2 for guest management
- "Close Event" wizard: pick event → review payment statuses → finalize RSVPs → set event to completed → generate report
  - This is a DIFFERENT lifecycle phase, not a subset of "Prepare"

RULE: Before finalizing your intent list, check each pair — if intent B is a subset of intent A's steps, \
DELETE intent B and add deep-link support to intent A instead.

BAD (these are just CRUD with lipstick — DO NOT BUILD THESE):
- ❌ A table of records with nicer filters (= the CRUD page already does this)
- ❌ A kanban board showing one entity grouped by status (= a dashboard widget, not a workflow)
- ❌ A single-entity form with extra styling (= that's just the existing dialog)
- ❌ A read-only status overview (= belongs on the dashboard, not a separate page)

## YOUR JOB (INTENT PHASE ONLY)

The DashboardOverview.tsx is ALREADY BUILT and deployed. Do NOT rebuild it from scratch.

1. ANALYZE entities, fields, relationships. Identify 2-3 DISTINCT multi-entity workflow phases.

**DECISION GATE — MOST WORKFLOWS BELONG IN THE DASHBOARD, NOT IN INTENT UIs:** \
The dashboard already has interactive, domain-specific UIs with full CRUD. \
Intent UIs are separate pages — they are ONLY justified when a workflow is SO COMPLEX \
that it would overload the dashboard (5+ steps, 3+ entities in a single flow, \
branching logic, or heavy state tracking like budgets/progress across steps). \
\
Ask yourself: "Can this workflow be handled by the dashboard + existing CRUD dialogs?" \
If YES → skip intent UIs, just run 'npm run build' and STOP. \
\
SKIP intent UIs when: \
- The app has fewer than 4 entities \
- Workflows can be handled by the dashboard + existing CRUD dialogs \
- There are no workflows spanning 3+ entities in a single multi-step sequence \
\
Only proceed if there is at least ONE workflow that genuinely \
cannot fit in the dashboard because of its complexity. \
\
**IF SKIPPING:** The dashboard currently shows WorkflowPlaceholders (loading skeletons). \
You MUST clean them up before stopping: \
1. Edit src/App.tsx — remove the WorkflowPlaceholders import and replace \
   `<><div className="mb-8"><WorkflowPlaceholders /></div><DashboardOverview /></>` \
   with just `<DashboardOverview />` \
2. Run 'npm run build' and STOP.

2. IF intent UIs are justified, DISPATCH 'intent_builder' subagents IN PARALLEL (in a single response) for each intent:
   - File path: src/pages/intents/{PascalCaseName}Page.tsx
   - DETAILED step-by-step description: what are the STEPS of the workflow, which entities are touched \
in each step, what records get created/updated, what live feedback to show between steps
   - Tell it to USE these pre-generated shared components (already available, no need to rebuild):
     * IntentWizardShell from '@/components/IntentWizardShell' — wizard container with step indicator, \
deep-linking (?step=N), loading/error. Props: steps, currentStep, onStepChange, loading, error, children. \
Each step must provide its own action/navigation buttons — the shell does NOT render back/next buttons.
     * EntitySelectStep from '@/components/EntitySelectStep' — reusable "pick an item" step with search. \
Props: items (id, title, subtitle, status, stats), onSelect
     * BudgetTracker from '@/components/BudgetTracker' — budget progress bar. Props: budget, booked
     * StatusBadge from '@/components/StatusBadge' — universal status badge. Props: statusKey, label
   - Tell it to import types, APP_IDS, LivingAppsService, extractRecordId, createRecordUrl from the scaffold
   - Remind: lookup fields when WRITING use plain string keys, NOT {key, label} objects
   - CRITICAL: Tell it which {Entity}Dialog components exist and MUST be used for record creation. \
List ALL available dialogs by name (e.g., "ArtikelDialog from '@/components/dialogs/ArtikelDialog'") \
and their list props (e.g., "einkaufsgruppeList={einkaufsgruppe}"). \
The intent builder MUST use these dialogs for creating new records — NEVER build inline forms. \
Every step that involves selecting a record must ALSO show a "Neu erstellen" button opening the dialog.

DO NOT dispatch 'dashboard_builder'.

3. After ALL intent_builder subagents complete:
   - Edit src/App.tsx to:
     * Remove the WorkflowPlaceholders import and its usage from the index route
     * Add lazy imports and routes for the new intent pages
     * CRITICAL: Keep ALL existing imports, providers (ActionsProvider), wrappers (ErrorBoundary), and route structure intact — only ADD intent routes and remove WorkflowPlaceholders
   - Read src/pages/DashboardOverview.tsx, then Edit it to ADD a workflow navigation section \
at the TOP of the dashboard (before other content):
     * NO section header or title — just the cards directly
     * Cards with LEFT accent border (border-l-4 border-primary) + icon + title + description + IconChevronRight arrow
     * Each card is a clickable <a href="#/intents/{slug}"> link
     * Cards: bg-card border border-border rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow
   - Run 'npm run build', fix any TypeScript errors, keep fixing until build succeeds

4. After 'npm run build' succeeds, STOP immediately.

CRITICAL: Dispatch ALL intent_builder subagents in a SINGLE response for maximum parallelism."""

        print(f"[KLAR] Phase 2: Intents-only build")

    else:
        # Build-Mode (all): Orchestrator dispatches subagents for dashboard + intent UIs
        query = """\
You are the BUILD ORCHESTRATOR. Read .entity_summary (short, ~30 lines) for entity info. Do NOT read .scaffold_context or app_metadata.json — they are too large and waste time.

## WHAT ARE INTENT UIs?

Every entity ALREADY has a full CRUD page (table + search + create/edit/delete). Intent UIs are NOT more CRUD pages \
with different styling. They are TASK WORKFLOWS.

An intent UI is a MULTI-STEP WIZARD that:
- Spans MULTIPLE entities in one flow (selecting from entity A → creating linked records in entity B and C)
- Has STEPS (wizard/stepper pattern with clear step progression)
- Often creates MULTIPLE records in a single flow (e.g., inviting 20 guests = 20 invitation records)
- Shows LIVE FEEDBACK as the user progresses (running totals, counts, progress bar, budget remaining)
- Has a clear START → END (user begins task → user completes task with a result)
- Supports deep-linking to specific steps via URL params (e.g., ?eventId=xxx&step=2)

## CRITICAL: NO REDUNDANT INTENTS

Each intent MUST be a UNIQUE workflow that does NOT overlap with other intents. \
If one wizard has steps A→B→C, do NOT create separate intent pages for step B and step C — \
instead, make the wizard support deep-linking to specific steps via URL query params.

EXAMPLE — WRONG (redundant):
- "Prepare Event" wizard: pick event → invite guests → book vendors → summary
- "Manage RSVPs" page: pick event → update guest statuses  ← THIS IS JUST STEP 2 OF THE WIZARD!
- "Book Vendors" page: pick event → browse vendors → book them  ← THIS IS JUST STEP 3 OF THE WIZARD!

EXAMPLE — CORRECT (each intent is unique):
- "Prepare Event" wizard: pick event → invite guests → book vendors → summary
  - Dashboard links to specific steps: ?eventId=xxx&step=2 for guest management
- "Close Event" wizard: pick event → review payment statuses → finalize RSVPs → set event to completed → generate report
  - This is a DIFFERENT lifecycle phase, not a subset of "Prepare"

RULE: Before finalizing your intent list, check each pair — if intent B is a subset of intent A's steps, \
DELETE intent B and add deep-link support to intent A instead. Only keep intents that represent \
DIFFERENT phases or completely different multi-entity workflows.

BAD (these are just CRUD with lipstick — DO NOT BUILD THESE):
- ❌ A table of records with nicer filters (= the CRUD page already does this)
- ❌ A kanban board showing one entity grouped by status (= a dashboard widget, not a workflow)
- ❌ A single-entity form with extra styling (= that's just the existing dialog)
- ❌ A read-only status overview (= belongs on the dashboard, not a separate page)

## YOUR JOB

1. ANALYZE entities, fields, relationships. Think: what real-world MULTI-ENTITY WORKFLOWS do users perform? \
A workflow always involves creating/updating records across 2+ entities in a sequence of steps. \
Identify 2-3 DISTINCT workflow phases (e.g., preparation phase vs. closing phase vs. reporting phase). \
Check for redundancy — if two workflows share most steps, merge them into one wizard with deep-linking.

**DECISION GATE — MOST WORKFLOWS BELONG IN THE DASHBOARD, NOT IN INTENT UIs:** \
The dashboard agent already builds interactive, domain-specific UIs with full CRUD. \
Intent UIs are separate pages — they are ONLY justified when a workflow is SO COMPLEX \
that it would overload the dashboard (5+ steps, 3+ entities in a single flow, \
branching logic, or heavy state tracking like budgets/progress across steps). \
\
Ask yourself: "Can the dashboard agent build this as a section or interactive widget \
on the main page?" If YES → it belongs in the dashboard, NOT in an intent UI. \
\
SKIP intent UIs when: \
- The app has fewer than 4 entities \
- Workflows can be handled by the dashboard + existing CRUD dialogs \
- There are no workflows spanning 3+ entities in a single multi-step sequence \
\
Only proceed with intent UIs if there is at least ONE workflow that genuinely \
cannot fit in the dashboard because of its complexity. \
\
**IF SKIPPING:** The dashboard currently shows WorkflowPlaceholders (loading skeletons). \
You MUST clean them up before stopping: \
1. Edit src/App.tsx — remove the WorkflowPlaceholders import and replace \
   `<><div className="mb-8"><WorkflowPlaceholders /></div><DashboardOverview /></>` \
   with just `<DashboardOverview />` \
2. Run 'npm run build' and STOP.

2. IF intent UIs are justified, DISPATCH ALL SUBAGENTS IN PARALLEL (in a single response):
   a) For EACH intent, dispatch 'intent_builder' with:
      - File path: src/pages/intents/{PascalCaseName}Page.tsx
      - DETAILED step-by-step description: what are the STEPS of the workflow, which entities are touched \
in each step, what records get created/updated, what live feedback to show between steps
      - Tell it to USE these pre-generated shared components (already available, no need to rebuild):
        * IntentWizardShell from '@/components/IntentWizardShell' — wizard container with step indicator, \
deep-linking (?step=N), loading/error. Props: steps, currentStep, onStepChange, loading, error, children. \
Each step must provide its own action/navigation buttons — the shell does NOT render back/next buttons.
        * EntitySelectStep from '@/components/EntitySelectStep' — reusable "pick an item" step with search. \
Props: items (id, title, subtitle, status, stats), onSelect
        * BudgetTracker from '@/components/BudgetTracker' — budget progress bar. Props: budget, booked
        * StatusBadge from '@/components/StatusBadge' — universal status badge. Props: statusKey, label
      - Tell it to import types, APP_IDS, LivingAppsService, extractRecordId, createRecordUrl from the scaffold
      - Remind: lookup fields when WRITING use plain string keys, NOT {key, label} objects
      - CRITICAL: Tell it which {Entity}Dialog components exist and MUST be used for record creation. \
List ALL available dialogs by name and their list props. \
The intent builder MUST use these dialogs — NEVER inline forms. \
Every step that involves selecting a record must ALSO show a "Neu erstellen" button opening the dialog.

3. After ALL subagents complete:
   - Edit src/App.tsx to:
     * Remove the WorkflowPlaceholders import and its usage from the index route
     * Add lazy imports and routes for the new intent pages
     * CRITICAL: Keep ALL existing imports, providers (ActionsProvider), wrappers (ErrorBoundary), and route structure intact — only ADD intent routes and remove WorkflowPlaceholders
   - Read src/pages/DashboardOverview.tsx, then Edit it to ADD a workflow navigation section \
at the TOP of the dashboard (before other content):
     * NO section header or title — just the cards directly
     * Cards with LEFT accent border (border-l-4 border-primary) + icon + title + description + IconChevronRight arrow
     * Each card is a clickable <a href="#/intents/{slug}"> link
     * Cards: bg-card border border-border rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow
   - Run 'npm run build', fix any TypeScript errors, keep fixing until build succeeds

4. After 'npm run build' succeeds, STOP immediately.

CRITICAL: Dispatch ALL subagents in a SINGLE response for maximum parallelism."""

        if user_instructions:
            query += (
                f"\n\nADDITIONAL user instructions:\n"
                f"<user-instructions>\n{user_instructions}\n</user-instructions>"
            )
            print(f"[KLAR] Orchestrator-Mode MIT User Instructions: {user_instructions}")
        else:
            print(f"[KLAR] Orchestrator-Mode: Dashboard + Intent UIs")

    t_agent_total_start = time.time()
    print(f"[KLAR] Initialisiere Client")

    async with ClaudeSDKClient(options=options) as client:

        await client.query(query)

        t_last_step = t_agent_total_start

        async for message in client.receive_response():
            now = time.time()
            elapsed = round(now - t_agent_total_start, 1)
            dt = round(now - t_last_step, 1)
            t_last_step = now

            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        print(json.dumps({"type": "think", "content": block.text, "t": elapsed, "dt": dt}), flush=True)

                    elif isinstance(block, ToolUseBlock):
                        print(json.dumps({"type": "tool", "tool": block.name, "input": str(block.input), "t": elapsed, "dt": dt}), flush=True)

            elif isinstance(message, UserMessage):
                if isinstance(message.content, list):
                    for block in message.content:
                        if isinstance(block, ToolResultBlock) and _LOG_LEVEL == "debug":
                            content = str(block.content)[:4000] if block.content else ""
                            print(json.dumps({"type": "tool_result", "tool_use_id": block.tool_use_id, "output": content, "is_error": block.is_error, "t": elapsed}), flush=True)

            elif isinstance(message, ResultMessage):
                status = "success" if not message.is_error else "error"
                print(f"[KLAR] Session ID: {message.session_id}")

                if message.session_id:
                    try:
                        with open("/home/user/app/.claude_session_id", "w") as f:
                            f.write(message.session_id)
                        print(f"[KLAR] ✅ Session ID in Datei gespeichert")
                    except Exception as e:
                        print(f"[KLAR] ⚠️ Fehler beim Speichern der Session ID: {e}")

                t_agent_total = time.time() - t_agent_total_start
                print(json.dumps({
                    "type": "result",
                    "status": status,
                    "cost": message.total_cost_usd,
                    "session_id": message.session_id,
                    "duration_s": round(t_agent_total, 1)
                }), flush=True)

if __name__ == "__main__":
    import sys
    try:
        asyncio.run(main())
    except Exception as e:
        print(f"\n[KLAR] FATAL ERROR: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
