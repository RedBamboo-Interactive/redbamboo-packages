# Red Suite — API & Command Discoverability Audit

**Date:** 2026-06-10
**Scope:** RedCompute (:18800), CodeRed (:18801), RedMatter (:18802), Nova (:18803), RedLeaf (:18804), shared packages (`@redbamboo/ui|utility|chat`, `RedBamboo.AppHost`)
**Method:** Full source read of every endpoint file, command registration, and service descriptor across all six repos, plus live probes of each running app's `/discover`.

> **Implementation status (2026-06-10):** the recommendations below have been implemented across all six repos (59 commits, unpushed). See **§6 Implementation status** at the end for the per-item status table — what landed, what was partial, and what was deliberately skipped.

---

## 1. Executive summary

### Live /discover snapshot (probed 2026-06-10)

| App | Status | Endpoints in `app_endpoints` | With parameter docs | Capabilities | Icon/color in manifest |
|---|---|---|---|---|---|
| RedCompute | up | 30 | **1** (shared `/auth/login`) | 6 | `fa-microchip` / `#E55B5B` ← **wrong, that's CodeRed's red** |
| CodeRed | up | 55 | **1** | 1 | `fa-terminal` / `#E55B5B` |
| RedMatter | down | (143 registered in code) | **0** | 7 | **none** + `api_base` says **port 5000** |
| Nova | up | 38 | **1** | 3 | `fa-star` / `#D4AA4F` |
| RedLeaf | up | 42 | **32** | 6 | **none** |

### Overall health

The bones are genuinely good. Every app routes its own endpoints through the shared `EndpointRegistry`, every endpoint has a *required* description string, `/discover` + `/openapi.json` + `/ws/schema` exist on every app, and the error/auth/tunnel plumbing is shared. RedMatter's backend is the most AI-native in the suite (143 registered endpoints, 7 self-describing `/schema` endpoints, structured error envelope, `dry_run` flags, 410-Gone semantics); RedLeaf is the only app that actually uses `.WithParam()`. Nova's `POST /api/delegate` is the best-documented endpoint in the suite and should be the template for everything else.

### The five biggest gaps

1. **The most important APIs in the suite are invisible to `/discover`.** CodeRed's entire session surface is anonymous proxy catch-alls (`StaticServer.cs:455-460`) — an AI reading CodeRed's manifest, which *describes itself as "session management"*, cannot find a single session operation. RedCompute's `/ai-session/*` and `/{slug}/generate` routes bypass the registry and rely on a hand-maintained mirror that has **already drifted** (wrong timeout docs, 8 undocumented execute params, 4 whole routes missing including the agent-critical `/callback`). RedMatter's engine debug proxy (gateway to 45+ engine routes) is invisible. Nova's `/ai-session` proxy — the only way to read a chat reply — is invisible.
2. **Parameter documentation is essentially unused outside RedLeaf** — and the one TypeScript client that reads manifests (`use-service-discovery.ts`) has an `EndpointInfo` type that **drops the `parameters` field entirely**, so even RedLeaf's 32 documented endpoints lose their metadata at the last step of the pipeline. The discovery pipeline is broken end-to-end for parameters.
3. **Nova consumes nothing via discovery.** 100% of Nova's cross-app calls are hardcoded `http://localhost:PORT` URLs across 5 backend clients; its agent loop is briefed from hand-written markdown (`capabilities.md`) that already contains a wrong route (`dreaming.md:54` guesses `/api/sessions`; actual is `/ai-session/sessions`). The serving side of discovery exists everywhere; the consuming side was never built.
4. **"Ask Nova" has no API.** The suite's headline cross-app operation is a frontend-only URL-hash/postMessage protocol (`ask-nova.ts`). A backend agent must create a discussion, post a message, then has **no documented way to read the reply**. Nova→others (delegate) is superbly designed; others→Nova is a UI hack.
5. **The command palette is dramatically underpopulated and inconsistent**: CodeRed 18 app commands, Nova 8, RedCompute 3 (all nav), RedLeaf 2, RedMatter **0**. CodeRed and Nova register commands inside page components so they vanish off-route (Ctrl+N only works on the page that defines it). Two advertised shortcuts (Ctrl+W, Ctrl+Tab) are browser-reserved and mostly can't fire. There is no shortcut-conflict detection, and commands are not machine-discoverable at all.

### Top priorities

1. Route RedCompute's session/capability endpoints through the registry; delete the hand-maintained mirror (it's lying).
2. Make CodeRed's proxied session surface discoverable (synthetic registry entries or a descriptor pointer to RedCompute's manifest).
3. Fix the TS `EndpointInfo` type to carry `parameters`; then adopt `.WithParam()` suite-wide (RedLeaf proves the pattern works).
4. Give Nova a real ask/answer API and make Nova's agent brief itself from `/discover` instead of hand-written markdown.
5. Fix the three broken service descriptors (RedMatter port 5000, RedCompute wrong color, RedLeaf/RedMatter missing icons).
6. Hoist route-scoped commands to app level; populate RedMatter's and RedCompute's palettes.

---

## 2. Per-app findings

### 2.1 RedCompute (:18800) — `T:/Projects/redcompute`

**Endpoint registration: split-brain.** Two parallel discovery mechanisms exist: (1) the `EndpointRegistry` feeding `app_endpoints` (22 app endpoints — jobs, control, settings, hardware, activity, suite telemetry — all in `GlobalEndpoints.cs`, `HardwareEndpoints.cs`, `SettingsEndpoints.cs`, `SuiteTelemetryEndpoints.cs`), and (2) a **hand-maintained mirror** of the `/ai-session/*` and `/{slug}/*` routes in `RedComputeServiceDescriptor.BuildUnifiedSessionEndpoints()` (`src/RedCompute.App/Services/RedComputeServiceDescriptor.cs:124-218`), because `UnifiedSessionEndpoints.cs` and `GenericCapabilityEndpoints.cs` take `WebApplication` raw and bypass the registry (`RelayServer.cs:128-135`).

**The mirror has drifted — measurably:**
- `/ai-session/execute` descriptor says "timeout up to 1800s, default 600" (`RedComputeServiceDescriptor.cs:152-158`); the code defaults 1800 and clamps 1–7200 (`UnifiedSessionEndpoints.cs:450-452`); telemetry prose says "default 30min, max 2h" (line 34). Three contradicting sources.
- 8 execute params entirely undocumented: `env`, `effort`, `maxTurns`, `allowedTools`, `addDirs`, `container`, `dockerImage`, `sandbox` (`UnifiedSessionEndpoints.cs:454-471`) — **an agent cannot discover that sandboxed execution exists**.
- 4 routes invisible to /discover: `POST .../inject` (:170), `POST .../callback` (:275 — the single most agent-relevant hidden endpoint), `GET /ai-session/projects/{name}/icon` (:374), `POST .../open-in-codered` (:393, which also hardcodes CodeRed at `http://localhost:18801`).
- `images` attachment array on `/message` undocumented; `effort` on `/generate` undocumented; `all`/`excludeSource` on `GET /sessions` undocumented.

**Discovery silently shrinks with state:** capability endpoints vanish from /discover when no provider is active (`RedComputeServiceDescriptor.cs:68`), and custom endpoint manifests are read only from the ACTIVE provider (:108) while routes are mapped for ALL providers (`GenericCapabilityEndpoints.cs:321-328`). Concretely: with claude-code active, all `/codex/*` routes work but are invisible.

**Other endpoint issues:**
- Zero `.WithParam()` in the codebase — `/jobs` alone has 6 undocumented query filters (`GlobalEndpoints.cs:62`). The logging capability descriptor (`LogEndpoints.cs:81-107`) is the gold standard nothing else follows.
- `GetTelemetryCapabilityDescriptor()` exists (`TelemetryEndpoints.cs:77-121`) but is **never registered** — `/api/telemetry/*` is invisible despite a ready-made descriptor. One-line fix.
- `DELETE /jobs/{id}` doesn't delete — it cancels (job persists with status=Cancelled, `GlobalEndpoints.cs:143`). `PUT /settings/*` is partial-merge PATCH semantics (`SettingsEndpoints.cs:57-138`).
- Proxy catch-all `/{slug}/{**path}` (`GenericCapabilityEndpoints.cs:303-317`) is an invisible any-method passthrough; its guard does a bare `return;` → empty 200 instead of 404 (:307).
- The async-job convention (`?async`, `X-Async`, `X-Caller-Info`, `X-Idempotency-Key`, `X-Job-Name`, `X-Job-Rationale`, `X-Provider` headers; `X-Job-Id`/`X-Result-Json` response headers) appears **nowhere** in /discover.
- Multi-clip music-gen is unreachable via API: Suno makes up to 4 clips, only clip 1 is saved, `?clip=` is ignored server-side (`GenericCapabilityEndpoints.cs:269-294`; `SunoProvider.LastClipResults` write-only at `SunoProvider.cs:34,177`). The UI's clip probing renders up to 5 identical players (`job-detail.tsx:61-77`).
- **Security:** `ResolveUserId` prefers a spoofable `X-User-Id` header over the validated JWT `sub` (`UnifiedSessionEndpoints.cs:742-747`) — any bearer-token caller can read/control any user's sessions.
- Dead code: `ClaudeSessionEndpoints.cs` and `OpenCodeSessionEndpoints.cs` are empty `Map()` stubs; `/codex/models` hardcoded list disagrees with `ValidModels` (`CodexSessionEndpoints.cs:14-27` vs `:80`); the whole `/codex/*` tree duplicates `/ai-session?provider=codex`.

**Commands: 3, all navigation** (Capabilities F1, Jobs F2, Stats F3 — `web/src/components/layout/app-shell.tsx:60-70`, via `data-command` DOM discovery). Zero action commands. Missing from the palette: Toggle Console/Settings (dropdown items, invisible to DOM scan — `app-shell.tsx:78,87`), queue job (`capability-card.tsx:104-112`), start/stop/sleep/wake capability (`capability-card.tsx:82-125`), rerun job (`job-detail.tsx:134-141`), open in CodeRed (`ai-session-detail.tsx:168-191`), copy/download outputs, theme toggles. **Cancel job is missing from the UI entirely** — `DELETE /jobs/{id}` exists and `api.delete` exists (`web/src/api/client.ts:38`) but nothing calls it; a running job can't be cancelled from the dashboard.

**Frontend bugs found in passing:** settings panel endpoint list reads `data.management.endpoints` which doesn't exist → permanently "Loading…" (`settings-panel.tsx:38`); `queue-job-dialog.tsx:132` navigates to `/claude`, a route that doesn't exist (`App.tsx:41-50`).

**Service descriptor** (`RedComputeServiceDescriptor.cs:22-27`): good description ("AI-native inference abstraction layer — TTS, STT, image gen, music gen, AI sessions"), but **IconColor `#E55B5B` is CodeRed's red** — RedCompute's own `SuiteTelemetryEndpoints.cs:16-18` says RedCompute=`#26A69A` teal, and the frontend brand agrees. Version "0.2.0" duplicated as a literal in `RelayServer.cs:96`.

### 2.2 CodeRed (:18801) — `T:/Projects/codered`

**Endpoints: 45+ registered, well-described, zero parameter docs.** All app endpoints (git, files, issues, reviews, tackles, tests, health-checks, navigate, feedback) go through the registry — good. But not one uses `.WithParam()`, and CodeRed's house style makes that worse than elsewhere: **nearly every endpoint requires a `root=<absolute path>` query param** (even on POSTs with JSON bodies, validated at `GitEndpoints.cs:15-34`) that nothing documents. An agent must learn the suite's most idiosyncratic convention from error messages.

**The core product is invisible.** The descriptor says "Claude Code web UI — session management, voice, hands-free" (`CodeRedServiceDescriptor.cs:20`), yet sessions live entirely behind anonymous proxy catch-alls to RedCompute (`StaticServer.cs:455-460` → `ProxyEndpoints.cs:28`): `/ai-session/{**}`, `/tts/{**}`, `/stt/{**}` are in no registry, no /discover, no OpenAPI. An AI reading CodeRed's manifest gets the opposite of the truth — promised sessions it can't see, unmentioned git/issues/reviews/tests capabilities it can.

**`MapFallback` swallows every unmatched API route with 200 + index.html** (`StaticServer.cs:491-496`, verified live: `GET /api/nonexistent` → `200 text/html`). Combined with the frontend client returning `null` for non-JSON (`web/src/api/client.ts:19-23`), missing endpoints fail silently. This is how the frontend shipped **buttons wired to six nonexistent endpoints**: `POST /api/issues/tackle/{id}/retackle` (`@redbamboo/github` `tackle-client.ts:81`), `/undismiss` (:75), `POST /api/reviews/{id}/retry` (`review-client.ts:58`), `POST /api/health-checks/{id}/retry` (`health-check-client.ts:63`), `POST /api/tests/run-single` + `/api/tests/{id}/fix` (`test-client.ts:63,80`), `POST /api/git/review` (`git-client.ts:68`) — all implemented in RedMatter, none in CodeRed. Also `connect-prompt.tsx:26` probes `/status`, which CodeRed doesn't have.

**Other endpoint issues:**
- `POST /api/navigate` takes params in the query string of a POST (`StaticServer.cs:99`); its SSE sibling `/api/navigate/events` is backed by `Channel.CreateBounded(1, DropOldest)` (`StaticServer.cs:30`) — destructive read, multiple SSE clients steal each other's events.
- `GET /api/file` (`StaticServer.cs:395-423`) serves **any file on disk** with a media extension — no `ValidateRootPath`, no project scoping, unlike every other file endpoint (`FileEndpoints.cs:182-210`). Security issue, exposed through the tunnel.
- `StartTackleRequest.Mode` accepted and silently ignored (`TackleEndpoints.cs:35-36`).
- `/ws/schema` lists only `log.entry` and `telemetry.request` (verified live) while the socket actually relays RedCompute's `session.created/updated/ended/stream` (`WebSocketEndpoints.cs:27-65`) — the events the frontend lives on are unschematized.
- Two casings for the same diff data: snake_case at `/api/git/diff`, camelCase at `/api/files/git/diff` (`FileEndpoints.cs:128`).
- 404s are sometimes bare `{ok:false}` with no message (`ReviewEndpoints.cs:57`, `HealthCheckEndpoints.cs:51`); `/api/github-url` 400 is `{url:null}` (`StaticServer.cs:144`); `/api/git/align` errors use `message` not `error` (`GitEndpoints.cs:251-255`).

**Commands: 18 — the best palette in the suite, with a structural flaw.** Sessions (New Ctrl+N, Next Ctrl+Tab, Close Ctrl+W, Interrupt Esc, Resume, Plan Mode Shift+Tab — `pages/sessions.tsx:210-268`), GitHub (5 commands — `pages/github.tsx:435-459`), Code (Save Ctrl+S, Git Panel, Word Wrap, Editor Commands — `pages/code.tsx:445-464`), plus app-shell items. Problems:
- **Route-scoped registration**: page commands exist only while their page is mounted, so the palette's contents and shortcuts are route-dependent — "New Session" is unavailable from the Code page. Global actions should register at the AppLayout level.
- **Ctrl+W and Ctrl+Tab are browser-reserved** — `document.addEventListener` can't preventDefault them outside an installed PWA (`sessions.tsx:221,234`); the Settings panel documents them anyway (`settings-panel.tsx:171-178`).
- Missing commands: stop/dismiss session (sidebar hover buttons, `session-sidebar.tsx:49-63`), Execute Plan (`sessions.tsx:332`), change model/effort, theme/contrast toggles, tunnel enable/disable, Code-tab close/next-tab, repo switcher. CodeRed uses the `data-command` DOM auto-discovery mechanism **zero times** in its own code.

**Service descriptor** (`CodeRedServiceDescriptor.cs:6-32`): actively misleading (see above); only 1 capability (logging); version "0.1.0" hardcoded while the frontend uses `__APP_VERSION__`.

### 2.3 RedMatter (:18802) — `T:/Projects/redmatter`

**Not the stale sibling you'd expect — the backend is the suite's best.** 143 endpoints registered through the registry (scenes, assets, engine, git, issues, tackles, reviews, health checks, visual verifications, AI sessions/templates/roles, tests, sandboxes, diagnostics, orchestrator, services). Only 2 raw-mapped routes (the debug proxy and a CMS log WS). Unique strengths worth copying suite-wide: 7 self-describing `/schema` endpoints (`/api/ai/schema`, `/api/agent-roles/schema`, `/api/diagnostics/schema`, `/api/health-checks/schema`, `/api/preferences/schema`, `/api/verifications/schema`, `/api/orchestrator/schema`), a canonical error envelope `{ok:false, error:{code, message, details?}}` via `ApiErrors` (`Models/ApiErrors.cs`) with a global exception middleware, deliberate 410-Gone vs 404 semantics for destroyed sandboxes, `dry_run` on page revert (`VersionEndpoints.cs:205`), idempotent stop/ack/release, and a uniform SSE contract (seq, 15s keepalive, terminal frame) across tests/sessions/orchestrator/health-checks.

**What's actually stale:**
- **`ServiceDescriptor.ApiBase = "http://localhost:5000"`** (`cms/backend/Services/RedMatterServiceDescriptor.cs:20`) — the app runs on 18802. Any agent constructing URLs from `api_base` fails. No `IconClass`/`IconColor` either (frontend brand is `fa-solid fa-fire`, `App.tsx:103`). Capability statuses hardcoded `"Running"`.
- **Command palette: zero app commands.** No `useCommand`, no `data-command` anywhere in `cms/frontend/src` — everything in the palette is inherited shell boilerplate. Meanwhile ~80 UI actions carry `data-action` (for Playwright/AI-vision) which the palette scanner doesn't read, and a parallel 15-action editor keybinding system exists (`preference-defaults.ts:116-237`: gizmo W/E/R, undo/redo, copy/paste, camera, playback) that the palette doesn't know about. Mirroring these would be nearly mechanical.
- **The hand-maintained legacy `GET /api` catalog has drifted** (`ApiDiscoveryEndpoints.cs`, 587 lines): missing `POST /api/issues/reopen`, `.../apply-review`, `.../undismiss`, `POST /api/git/fetch`, all 5 `/api/verifications*`, 16 of 17 orchestrator routes, `/api/logs/summary`, telemetry, autostart — and it references **two phantom endpoints**: `GET /api/ai/models` (documented 5×: `TackleEndpoints.cs:50,375,417`, `ApiDiscoveryEndpoints.cs:159,200`; real route is `/api/ai/settings/models`) and `GET /api/nova/ticks` (real: `/api/orchestrator/ticks`). The registry-driven `/discover` is accurate; the file presented as "AI agents start here" is the stale one.
- **Debug proxy invisible**: `ANY /api/debug/instances/{id}/proxy/{**path}` (`DebugProxyEndpoints.cs:16`) is raw-mapped; the comment at line 15 claims "registry records metadata" but the registry parameter is never used. The entire engine runtime API (~45 routes with its own self-discovery, `DebugHttpServer.cs:268-273`) hides behind this undiscoverable hop.
- Zero `.WithParam()` across all 143 endpoints.

**Method-semantics issues:** `GET /api/sandboxes/{id}/readiness` runs probe suites including a real test-suite execution (`DiagnosticEndpoints.cs:123-131`, `runTrivialSuite: true`) — a heavily side-effecting GET that should be POST. `POST /api/diagnostics/full` blocks synchronously up to ~30 min (`DiagnosticEndpoints.cs:205-243`) while the catalog claims "≤15 min cap" — everything else in the codebase is async+poll. `POST /api/orchestrator/settings` does partial update (should be PUT/PATCH; cf. `PUT /api/ai/settings`). Tackle prefix split: `/api/issues/tackle/*` vs `/api/tackles/diagnostic` (`TackleEndpoints.cs:99`).

**Error-shape deviations from its own standard:** HealthCheck, Orchestrator-notifications, AgentRole, and VisualVerify endpoints return bare `{ok:false, error:"string"}` instead of the `ApiErrors` envelope; duplicate-slug conflict is 409 for agent roles (`AgentRoleEndpoints.cs:64`) but 400 for templates (`PromptTemplateEndpoints.cs:52`); session stream 404 returns an empty body (`AiSessionEndpoints.cs:134-136`).

**API gaps:** no asset rename/replace (`/api/assets/{id}` has no PUT/PATCH); no scene duplicate at the CMS level; scenes/assets lists unpaginated; hardcoded `http://localhost:18800` in `/api/ai/schema` responses (`AiSessionEndpoints.cs:30-31,90`) despite a `RedCompute:BaseUrl` config key existing.

### 2.4 Nova (:18803) — `T:/Projects/nova`

**Endpoints: ~36 registered, all through the registry — but the body schemas live in prose or nowhere.** Zero `.WithParam()`. The two worst offenders are the two most important endpoints:
- `POST /api/discussions/{id}/message` (`DiscussionEndpoints.cs:495-610`) — **THE chat endpoint** — body (`content` required, `images[]{mediaType,base64}`, `inputMethod`) invisible to /discover; response is `{success, sessionId}` and the actual reply only arrives via `/ws` or the **invisible** `/ai-session` proxy.
- `POST /api/automations` (`AutomationEndpoints.cs:49`) — the most complex body in the app (`schedule` cron, `actionType` enum `ai-session|http-check|builtin:backup`, per-type `actionConfig`) — documented only in Nova's private `nova-workspace/config/capabilities.md:33-36`. Worse: `expiresAt`/`maxFailures` exist on the model and drive watcher-expiry logic (`AutomationService.cs:611-613`) but are **not settable** via `AutomationCreateRequest` (`AutomationEndpoints.cs:142-152`) — that engine path is unreachable through the API.

**Nova as consumer: 0% discovery-driven.** Five separate hardcoded RedCompute clients (`DiscussionEndpoints.cs:26-35`, `DelegateEndpoints.cs:18-22`, `RedComputeClient.cs:27`, `ConversationExporter.cs:13-21`, proxy mounts `StaticServer.cs:146-151`); CodeRed navigate hardcoded (`DelegateEndpoints.cs:161`, frontend `ChatView.tsx:69`); RedLeaf hardcoded in AppHost auth plumbing (`HttpPermissionDataSource.cs:9`). Nova never calls `/discover` on anything — neither C# nor TS, and AppHost has no discovery *client* at all. Nova's own agent gets suite knowledge from hand-written markdown: `MemoryManager.GenerateClaudeMd` (`MemoryManager.cs:129-169`) concatenates identity + `capabilities.md` — nothing generated from `/discover` — and `dreaming.md:54` already guesses a wrong RedCompute route while `dreaming.md:71-72` *tells the agent* to "discover available endpoints… don't assume a fixed API." The irony is complete.

**Self-calls over loopback HTTP** (`CallbackEndpoints.cs:49`, `AutomationService.cs:350-387`) with unauthenticated HttpClients — works only because local requests auto-elevate to `local-user` (`AuthMiddleware.cs:67-81`); events get attributed to `local-user`, and this breaks under `AuthMode.Required`.

**Other endpoint issues:**
- **`GET /api/discussions/{id}/images` is missing the OwnerId check** every sibling endpoint has (`DiscussionEndpoints.cs:218`) — cross-user data leak. The owner-scoping clause is copy-pasted ~12 times; this is the one that got forgotten.
- `GET /api/file` (`StaticServer.cs:94-122`) serves any absolute path with a media extension — same flaw as CodeRed's, exposed through the tunnel.
- Four error styles: `{error:"text"}`, DelegateEndpoints' excellent `{error:"snake_code", message}`, bare `Results.StatusCode(502)` empty bodies in the chat-send path (`DiscussionEndpoints.cs:533,537,608`), and `Results.Forbid()` empty 403 (`MemoryEndpoints.cs:43`).
- WS events `discussion.event` (`DiscussionEndpoints.cs:420`) and `discussion.nova-message` (:486) are broadcast **without `RegisterEvent`** — missing from `/ws/schema`, which claims to be the full catalog.
- `chat` and `automations` capabilities have `Endpoints: null` (`NovaServiceDescriptor.cs:27-43`); `chat` status keys off `_engine.IsRunning` and can report "running" while RedCompute (which it actually depends on) is down — `RedComputeClient.IsAvailableAsync` exists (`RedComputeClient.cs:72`) and is never used here.
- Automations have no update/enable/disable verb (create/trigger/delete only); `DELETE` returns 200 `{success:false}` for missing instead of 404; trigger is synchronous and can block for a 50-turn session (`AutomationEndpoints.cs:107`); `automations.json` is read only at startup (`AutomationService.cs:43`) so editing it via the memory API silently does nothing.
- `GET /api/discussions/pending` mutates state (RedCompute sync) on a GET (`DiscussionEndpoints.cs:64`).

**Bright spot:** `POST /api/delegate` (`DelegateEndpoints.cs:38`) — long, precise description covering every option and continuation semantics, structured error codes (`session_not_found`, `redcompute_unavailable`, …). **This is the standard the rest of the suite should meet.**

**Commands: 8.** Nav (F1/F2/F3), Toggle Settings/Console, New Discussion Ctrl+N / Next Ctrl+Tab / Archive Ctrl+W — but the three discussion commands are registered inside `ChatView.tsx:175-196`, so **Ctrl+N is dead on Pulse/Journal**. Missing: conversation search (`GET /api/discussions/search` exists with zero UI and zero command — the canonical Ctrl+K use case!), trigger automation (endpoint exists, no UI, no command), resume discussion, interrupt streaming, export, rename discussion (`use-discussions.ts:433` is dead code), enable/disable automation (no API either).

### 2.5 RedLeaf (:18804) — `T:/Projects/redleaf`

**The discoverability champion — 32 of 42 endpoints carry real `.WithParam()` docs, including enums and defaults.** `POST /api/entity-types/{typeSlug}/fields` (`FieldDefinitionEndpoints.cs:40`) documents all 12 field types with descriptions — the best-documented app endpoint in the suite. Schema introspection (`GET /api/entity-types/{slug}` → `{type, fields}`) makes RedLeaf the only app where an AI can genuinely learn the data model from the API.

**Bugs and gaps found:**
- **`PUT /api/entities/{id}` regenerates the slug WITHOUT the uniqueness suffix** (`EntityEndpoints.cs:176` vs POST's `slugify(name)-{8-char-guid}` at :141 and PATCH's preserved suffix at :220) — renames invite slug collisions.
- **Missing `type_slug` on create → unhandled `KeyNotFoundException` → 500** (`EntityEndpoints.cs:115`). Agents self-correct from structured 400s, not opaque 500s.
- **No default or max `limit` on `GET /api/entities`** — omitting limit returns the entire table.
- **Probable double-registration of `/api/autostart`**: `StaticServer.cs:89` calls `MapAutoStartEndpoints` directly AND `MapAppHostEndpoints` does it under `#if WINDOWS` (`AppHostExtensions.cs:156`) — on the `net9.0-windows` target this means two registrations → `AmbiguousMatchException` 500 at request time; the settings panel swallows it (`settings-panel.tsx:75`), so "Start with Windows" may be silently broken. Verify at runtime.
- **No role checks on privileged operations**: `PUT /api/settings/dev-mode` (unlocks system-entity editing, `SettingsEndpoints.cs:46`), `PUT /api/settings/tunnel` (:30), `POST /api/system/backup` (spawns pg_dump, `SystemEndpoints.cs:113`) — any token-holding agent or viewer-role user can call them.
- `GET /api/entity-types?name=` says "filter (case-insensitive)" but is `ILike` with no wildcards — effectively exact-match (`EntityTypeEndpoints.cs:19`); returns a bare array, breaking the `{items,total}` convention.
- `icon`/`color` body props on entity-type create/update accepted but undocumented (`EntityTypeEndpoints.cs:102-103, 207-210`); the `fields[]` inner object shape is undescribed.
- `data` is returned as a **JSON string**, not an object, in all responses — undocumented; every consumer must discover the double-decoding by trial (the frontend has `parseData` helpers in 5+ files).
- Casing chaos: snake_case for entity bodies (`type_slug`), camelCase for field definitions (`fieldType`); both `type_slug`/`typeSlug` accepted silently.
- GDPR refresh-token cleanup matches JSON by substring (`GdprEndpoints.cs:46`).
- Validation loads and JSON-parses ALL field definitions on every entity write (`EntityEndpoints.cs:305-315`) — a scaling cliff if Nova writes memories continuously.

**Nova-memory readiness verdict:** workable today as a *structured* store (typed memories, audit trail with an `"ai"` source enum already designed in at `VersionEndpoints.cs:79`, point-in-time revert, all discoverable) — but **not as a *searchable* one**. Blocking: `search=` matches only `Name` (`EntityEndpoints.cs:62`); `data.*` filters are string-equality JSONB containment (`EntityEndpoints.cs:39`) — no numeric/boolean/range/contains/OR operators; no full-text or semantic search; no bulk import (one HTTP call per memory); no upsert/idempotency (retries duplicate).

**Commands: 2 app commands + 2 auto-discovered nav tabs.** Toggle Settings/Console (`web/src/components/layout/app-shell.tsx:44,54`); Workspace F1 / Entities F2 via NavTab `data-command`. Missing: Toggle History panel (`app-shell.tsx:136`), Backup Database (:153), New Project/Entity/Type/Folder, pin entity, export seeds, dev mode, theme toggles. **"Create View" is dead UI** — `CreateViewDialog` is rendered but `setCreateViewDialogOpen(true)` is never called anywhere (`ProjectView.tsx:34,185-191`), while /discover advertises a "views" capability. **"Send Feedback" is a no-op** — no `onFeedbackSubmit` in shellConfig so the dialog never renders (utility `app-shell.tsx:417`).

**Service descriptor** (`RedLeafServiceDescriptor.cs:16-19`): honest description, but no `IconClass`/`IconColor` (frontend has `fa-solid fa-leaf`), and all six capabilities pass `Endpoints: null` — "tags" and "views" capabilities have zero dedicated API surface and nothing explains they're just entity types.

### 2.6 Shared packages — `T:/Projects/redbamboo-packages`

**EndpointRegistry** (`dotnet/RedBamboo.AppHost/Discovery/EndpointRegistry.cs`): description is a required positional param (good — compile-time enforced), `.WithParam()` optional and fluent (`:61-66`). The complete expressible metadata (`ServiceManifest.cs`): method, path, description, flat params (name/type/required/description/default/enum). **No request-body nesting, no response shapes, no content types, no auth annotations, no WS/SSE registration** (verbs only). `type` is a free-form unvalidated string. No enforcement: no startup diff of actual routes vs registry, no empty-description warning, no duplicate detection.

**AppHost violates its own registry.** Only the auth endpoints go through it (`AuthEndpoints.cs` via `MapAuthEndpoints`). Everything else — `/ping`, `/health`, `/discover`, `/openapi.json`, `/api/remote/*`, `/api/logs*`, `/api/telemetry*`, `/api/autostart`, `/ws`, proxy routes — is raw-mapped, with visibility recovered by three divergent ad-hoc mechanisms: the hardcoded `management` block (`DiscoveryEndpoints.cs:78-91`), opt-in capability descriptors (logs/telemetry helpers), and synthesized WS entries (:55-65). Already drifted: **`PUT /api/remote/token` is in `/openapi.json` (`OpenApiGenerator.cs:19`) but missing from `/discover`'s management block**; `/api/autostart` is invisible to both despite every app's settings UI using it; the telemetry descriptor helper exists but no app registers it (except none).

**OpenAPI generator** (`OpenApiGenerator.cs`): emits 3.1.0; POST/PUT/PATCH params become flat requestBody schemas, GET/DELETE become query params (so `ParameterDescriptor` is location-blind — a required query param on a POST is indistinguishable from a body field). **Every operation's response is the stub `{"200": {description: "Success"}}`** (:62-65).

**The discovery pipeline is broken at the last step:** the one TS client that reads manifests, `packages/utility/src/use-service-discovery.ts`, has an `EndpointInfo` type (:4-8) that **omits `parameters`**, and its `ServiceManifest` omits `iconClass`/`iconColor`. The `AppSwitcher` (`app-switcher.tsx:21-47`) pings `/discover` and **throws the body away** — only `r.ok` is used; icons/colors come from the hardcoded `APP_REGISTRY` (:13-19).

**Suite topology is hardcoded in 5+ places** with drift already: `app-switcher.tsx:13-19` says Nova is `#C74B7A` while Nova's own descriptor says `#D4AA4F`; also `chat/src/components/context-card.tsx:18-24` (`APP_META`), `ask-nova.ts:34,166`, `app-shell.tsx:98`. No single source of truth, and nothing consumes the manifest's `iconClass`/`iconColor` — which is why three apps shipping wrong/missing colors went unnoticed.

**Command palette infra** (`packages/utility/src/command-provider.tsx`, `use-command.ts`, `command-palette.tsx`): clean store, fuzzy search, DOM auto-discovery of `data-command`. Gaps:
- `register()` **silently overwrites** duplicate ids (`command-provider.tsx:29-33`); duplicate shortcuts resolve by registration order with no warning (:203-212). DOM-scan ids are `__dom:<label>` (:76) — label collisions are invisible.
- Shortcuts are raw display strings; each app does its own `isMac` formatting; no shared shortcut constants (Ctrl+Shift+N for Ask Nova is hardcoded in `app-shell.tsx:143` AND `ask-nova.ts:318`).
- **Double-registration hazard**: `AppShell` registers `ask-nova`/`ask-nova-selection` (`app-shell.tsx:140-155`) and `useAskNovaCommand` (`ask-nova.ts:316-352`) registers the same ids — silent overwrite.
- The `Command` type (`types.ts:3-11`) has no `description` field and commands are **trapped in React state** — no `window.__commands`, no HTTP surface; Nova cannot enumerate or trigger another app's commands.
- No App Switcher command (brand-click only, `app-header.tsx:24-33`), no "Switch to X" commands, no theme toggle anywhere in the shared layer despite `@redbamboo/ui` owning the tokens.

**Conventions provided vs missing:** Bearer + JWT + local-bypass auth is genuinely standardized; `X-Caller-Info`/`X-User-Id` proxy injection (`ProxyEndpoints.cs:33-37`); WS `{type,data}` envelope + `/ws/schema`. But: **no error-envelope helper** (the `{error: code, message}` pattern exists by imitation and AppHost itself drifts — `LogEndpoints.cs:27` puts a sentence in `error`); no shared fetch wrapper (four utility modules hand-roll fetch+auth); no pagination convention (AppHost itself uses cursor for logs, offset for telemetry); **bearer cookie default `apphost_token` (`BearerAuthOptions.cs:6`) doesn't match the `redsuite_token` that proxy/WS forwarding reads** (`ProxyEndpoints.cs:43`, `WebSocketEndpoints.cs:41`); **`/discover` is NOT in the bearer-mode bypass list** (`BearerAuthOptions.cs:7`) — a remote agent must already hold the token to discover the service, while JWT-mode apps bypass it (`AuthOptions.cs:10`). No TS types generated from the C# records (hand-mirrored, already drifting).

**Chat package**: clean adapter interfaces, no commands registered. Bakes in a real cross-app convention nobody documents: `createProxySpeechTransport` (`lib/speech-backend.ts:114-154`) hardcodes `POST /stt/transcribe`, `/tts/generate`, `/ai-session/generate` — every consumer app must reverse-proxy these prefixes to RedCompute, and this contract appears in no `/discover` output.

---

## 3. Cross-app consistency issues

### 3.1 URL patterns
- **RedCompute is the outlier**: bare domain routes (`/jobs`, `/status`, `/control/*`, `/{slug}/generate`, `/ai-session/*`) with `/api/` reserved for infra. Everyone else: `/api/*` for app routes. RedCompute's SPA fallback returns index.html for unknown bare paths unless the first segment is a known slug (`RelayServer.cs:152-166`) — agents get HTML instead of JSON 404s.
- Nested-prefix oddities: CodeRed tackles under `/api/issues/tackle/*` while reviews/tests/health-checks are top-level; RedMatter splits `/api/issues/tackle/*` vs `/api/tackles/diagnostic`.
- No versioning anywhere (`/v1` etc.) — only the service-level `version` string.

### 3.2 Error shapes — five suites, five dialects
| App | Canonical shape | Deviations |
|---|---|---|
| RedCompute | `{error: snake_code, message, fields?}` (`ErrorResponse.cs`) — with actionable remediation text (e.g. "Wake it via POST /control/wake/{slug}") | ProblemDetails in `SttLocalProvider.cs:136`; message-less `{error}`; body-less 502s |
| CodeRed | `{ok:false, error: "text"}` | `{url:null}` 400s; bare `{ok:false}` 404s; `message` instead of `error` on align |
| RedMatter | `{ok:false, error:{code,message,details?}}` (`ApiErrors.cs`) + global exception middleware — **the best** | bare `{ok:false,error:"str"}` in 4 endpoint groups; 409-vs-400 for the same conflict |
| Nova | mixed | four styles incl. empty-body 502s on the chat path |
| RedLeaf | `{error, message}` / `{error, details}` | empty-body 404s; code-vs-sentence in the same field |

A generic agent must implement five error parsers. RedMatter's envelope (machine code + human message + optional details, wrapped consistently, enforced by middleware) is the one to standardize on; RedCompute's remediation-hint texts are the best *content*.

### 3.3 CRUD conventions
- **PUT-as-PATCH is endemic**: RedCompute `/settings/*`, RedMatter scenes/templates/ai-settings, RedLeaf entities, Nova — all do partial merge under PUT. RedLeaf is the only app using actual PATCH (entities + data merge-patch). RedMatter's `POST /api/orchestrator/settings` does partial update under POST.
- DELETE means three things: cancel-but-keep (RedCompute jobs), archive (Nova discussions), hard delete (everywhere else).
- POST-with-action-suffix (`/stop`, `/approve`, `/merge`, `/dismiss`, `/ack`) is consistent suite-wide — genuinely good.
- Create status codes: 201+Location (RedMatter scenes/assets, RedLeaf) vs 200 (RedMatter templates, most others).
- Two mutating GETs: RedMatter `/api/sandboxes/{id}/readiness`, Nova `/api/discussions/pending`.

### 3.4 Pagination — four generations coexist
`page`/`per_page` + `total_count/total_pages/has_more` (CodeRed commits/issues, RedMatter issues/git) · `limit`/`offset` + `{items,total}` (RedCompute jobs, RedLeaf entities) · `limit`-only bare arrays (`/ai-session/sessions`, most lists) · cursor `after_id` (AppHost logs). Response envelopes: `{items,total}`, `{entries,count}`, bare array, `{items}` without total. Several lists are unbounded (RedLeaf entities has **no default limit**; RedMatter scenes/assets have none at all).

### 3.5 Casing
snake_case bodies/queries dominate, but: CodeRed serves the same diff data in snake_case at one route and camelCase at another; RedLeaf mixes snake_case entities with camelCase field definitions and accepts `type_slug`/`typeSlug` both; `/discover` itself mixes `api_base` with `iconClass`. The C# records serialize camelCase by default, so every hand-built anonymous object is one `JsonNamingPolicy` away from drift.

### 3.6 Auth
Genuinely consistent (the shared layer's win): bearer token + cookie + `?token=`, local-loopback bypass, JWT layered on top, `X-User-Id`/`X-Caller-Info` propagation. Inconsistencies: cookie name `apphost_token` vs `redsuite_token` vs per-app `{app}_token`; `/discover` bypassed in JWT mode but not bearer mode; RedCompute trusts spoofable `X-User-Id` over JWT (`UnifiedSessionEndpoints.cs:742-747`); RedLeaf privileged settings endpoints skip role checks.

### 3.7 Command naming & shortcuts across apps
- **Consistent and good**: F1/F2/F3 nav tabs everywhere (via shared NavTab `data-command`); Ctrl+K palette; Ctrl+Shift+N Ask Nova; Ctrl+N = "new primary object" in CodeRed and Nova.
- **Inconsistent**: Ctrl+W is "Close Session" (CodeRed) vs "Archive Discussion" (Nova) — same key, different destructiveness; both are browser-reserved and mostly can't fire anyway. Naming is fine where commands exist ("New Session"/"New Discussion" map naturally), but three of five apps barely have commands to be inconsistent about.
- **No cross-app conflict detection is possible** — shortcuts are per-app islands with no shared registry.

### 3.8 Service descriptors
| | RedCompute | CodeRed | RedMatter | Nova | RedLeaf |
|---|---|---|---|---|---|
| Description quality | good | **misleading** | good | good | good |
| ApiBase | ok | ok | **wrong (5000)** | ok | ok |
| Icon/color | **wrong color** | ok | **missing** | ok (but app-switcher disagrees) | **missing** |
| Capabilities w/ endpoint lists | 1 of 6 | 1 of 1 | 1 of 7 | 1 of 3 | 0 of 6 |
| Version | hardcoded ×2 | hardcoded | hardcoded | hardcoded | hardcoded |

Only the `logging` capability ever carries endpoint lists — because AppHost ships that descriptor pre-built. Nothing consumes `iconClass`/`iconColor`, which is why three apps shipped them wrong/missing without anyone noticing.

---

## 4. AI discoverability gaps

### 4.1 Can an AI act from `/discover` alone?
**For RedLeaf: mostly yes.** For everything else: **no.** The registry's flat param model can't express request bodies (chat messages with image arrays, automation configs, entity-type field arrays), documents zero response shapes (`OpenApiGenerator.cs:62-65` stubs every response as "Success"), and is location-blind (query vs body indistinguishable). And since only RedLeaf populates params, an agent hitting RedCompute/CodeRed/Nova gets a route list with prose hints.

### 4.2 Nova integration scenarios — current state

| Scenario | Works? | Discoverable? | Blockers |
|---|---|---|---|
| Nova delegates to CodeRed sessions | ✅ via Nova's `/api/delegate` → RedCompute | Delegate itself: yes, excellently | Underlying RedCompute callback/inject endpoints invisible; CodeRed only touched for navigate |
| Nova queries RedLeaf entities (memory migration) | ✅ structured CRUD | ✅ best in suite | **No content search, equality-only string filters, no bulk import, no upsert** — usable as a store, not as recall |
| Nova triggers RedCompute jobs (oneshot, TTS, image gen) | ✅ | ✅ mostly | Execute timeout docs wrong; sandbox/docker params undocumented; async headers (`X-Async`, `X-Idempotency-Key`, `X-Caller-Info`) in no manifest; multi-clip music output unreachable |
| Nova reads CodeRed session state/results | ✅ via proxied `/ai-session/*` | ❌ **completely invisible** | Proxy routes in no registry; `/ws/schema` omits the session.* events actually on the wire |
| Nova manages automations programmatically | partial | partial | No update/enable/disable; `actionConfig` schemas only in Nova's private markdown; `expiresAt`/`maxFailures` unsettable |
| Other agents ask Nova a question | ❌ | ❌ | **No ask endpoint.** Create discussion → post message → reply only readable via invisible proxy or unschematized WS events |
| Any agent discovers the suite roster | ❌ | — | No suite-level discovery; topology hardcoded in 5+ client locations with drift |
| Any agent triggers UI commands | ❌ | — | Commands trapped in React state; no machine-facing surface |

### 4.3 Description quality
Where descriptions exist they're mostly serviceable; the failures are: vague ("Update general settings" with zero params — `SettingsEndpoints.cs:57`), wrong (RedCompute execute timeout; `/api/file` "image" endpoints that also serve video in both CodeRed and Nova), or misleading at the service level (CodeRed's descriptor). RedMatter's 7 `/schema` endpoints and Nova's delegate description show the ceiling; nothing enforces the floor.

### 4.4 Trust killers for agents
- CodeRed's `MapFallback` 200-HTML for unknown API routes — an agent probing endpoints gets false positives everywhere (and the frontend already shipped 6 buttons against nonexistent endpoints because of it).
- RedCompute's state-dependent manifest — endpoints appear/disappear with provider state while routes stay live.
- RedMatter's "AI agents start here" catalog documenting two phantom endpoints.
- `/discover` requiring a bearer token in bearer-mode apps — chicken-and-egg for remote agents.

---

## 5. Recommended changes

> Per-item implementation status is tracked in **§6** below.

### Critical — blocks AI usage

| # | Change | Files | Why | Scope |
|---|---|---|---|---|
| C1 | Fix RedMatter `ApiBase` → `http://localhost:{port}` (18802); add `IconClass`/`IconColor` (`fa-solid fa-fire`) | `redmatter/cms/backend/Services/RedMatterServiceDescriptor.cs:20` | Agents constructing URLs from `api_base` hit a dead port | One-liner |
| C2 | Route `UnifiedSessionEndpoints` + `GenericCapabilityEndpoints` through `EndpointRegistry`; delete `BuildUnifiedSessionEndpoints()` hand-mirror | `redcompute/src/RedCompute.App/Api/Endpoints/UnifiedSessionEndpoints.cs`, `GenericCapabilityEndpoints.cs`, `Services/RedComputeServiceDescriptor.cs:124-218`, `RelayServer.cs:128-135` | The mirror has already drifted (wrong timeouts, 8 missing params, 4 missing routes incl. `/callback` — the one endpoint an orchestrating agent needs most) | Significant refactor, highest-value in the suite |
| C3 | Make CodeRed's proxied surface discoverable: add registry entries (or a manifest `proxies` block) for `/ai-session/**`, `/tts/**`, `/stt/**` pointing at RedCompute's `/discover`; rewrite the descriptor description to name the git/issues/reviews/tests surface | `codered/src/CodeRed.App/Api/StaticServer.cs:455-460`, `Services/CodeRedServiceDescriptor.cs:20`, possibly `AppHost/Proxy/ProxyEndpoints.cs` | CodeRed promises "session management" and exposes none of it; agents can't find the core product | Small-medium (synthetic entries) |
| C4 | Fix `EndpointInfo` TS type to include `parameters` (and manifest type to include `iconClass`/`iconColor`/`name`) | `packages/utility/src/use-service-discovery.ts:4-8,18-37` | The only manifest consumer drops the param metadata — the pipeline is broken at the last step | One-liner |
| C5 | CodeRed: make `MapFallback` return 404 for `/api/*`, `/ai-session/*`, `/tts/*`, `/stt/*` | `codered/src/CodeRed.App/Api/StaticServer.cs:491-496` | Silent 200-HTML for missing endpoints poisons every agent interaction and already hid 6 broken UI buttons | One-liner + test |
| C6 | Nova: add a machine-usable ask pathway — either `POST /api/ask {content, timeout?} → {reply}` (sync, bounded) or document the create→message→poll/WS pattern in the manifest, register the `/ai-session` proxy, and register `discussion.*` WS events | `nova/src/Nova.App/Api/DiscussionEndpoints.cs`, `StaticServer.cs:146-151`, WS registration in startup | The suite's conversational hub can't be conversed with by other agents | Medium |
| C7 | RedLeaf: return 400 (not 500) on missing `type_slug`; add default + max `limit` on `GET /api/entities`; fix PUT slug-suffix regression | `redleaf/src/RedLeaf.App/Api/EntityEndpoints.cs:115,20,176` | 500s break agent self-correction; unbounded lists break everything; slug collisions corrupt refs | Three small fixes |
| C8 | RedLeaf: add data-content search (Postgres FTS over `Data`) and filter operators (`gte/lte/contains/since`) on `data.*` | `redleaf/src/RedLeaf.App/Api/EntityEndpoints.cs:39,62` | Stated prerequisite for Nova memory migration — "recall about X" is impossible today | Medium |
| C9 | Register the invisible AppHost endpoints: add `/api/remote/token` to the management block; surface `/api/autostart`; have apps register the existing telemetry capability descriptor | `AppHost/Discovery/DiscoveryEndpoints.cs:78-91`, `Startup/AutoStartEndpoints.cs`, each app's ServiceDescriptor (e.g. `RedComputeServiceDescriptor.cs:52-53` + one line) | /discover and /openapi.json currently disagree; settings UIs depend on endpoints agents can't see | Small |
| C10 | Fix phantom-endpoint documentation: RedMatter `GET /api/ai/models` → `/api/ai/settings/models` (5 sites), `GET /api/nova/ticks` → `/api/orchestrator/ticks`; Nova `dreaming.md:54` wrong route | `redmatter/cms/backend/Endpoints/TackleEndpoints.cs:50,375,417`, `ApiDiscoveryEndpoints.cs:159,200`, `nova/nova-workspace/.../dreaming.md:54` | Docs that 404 teach agents to distrust all docs | One-liners |

**Security fixes found during audit (do alongside C-tier; they gate safe agent access):**
- RedCompute: stop trusting `X-User-Id` over JWT `sub` (`UnifiedSessionEndpoints.cs:742-747`).
- CodeRed + Nova: confine `GET /api/file` to allowed roots (`codered .../StaticServer.cs:395`, `nova .../StaticServer.cs:94`).
- Nova: add the missing OwnerId check on `GET /api/discussions/{id}/images` (`DiscussionEndpoints.cs:218`) and extract the copy-pasted owner-scope clause into a helper.
- RedLeaf: role-gate `dev-mode`, `tunnel`, `backup` (`SettingsEndpoints.cs:30,46`, `SystemEndpoints.cs:113`); fix the probable `/api/autostart` double-registration (`StaticServer.cs:89`).

### Important — degrades AI experience

| # | Change | Files | Why | Scope |
|---|---|---|---|---|
| I1 | Adopt `.WithParam()` suite-wide — priority order: RedCompute `/jobs` filters + `/ai-session/execute|generate|message`, Nova `/api/automations` + `/message`, CodeRed's pervasive `root` param + git/issues filters, RedMatter's top 20 | All `*Endpoints.cs` registration sites | RedLeaf proves the registry delivers; 3 apps publish `parameters: null` on every endpoint | Mechanical but broad (~150 endpoints) |
| I2 | Extend the registry: `WithRequestBody(schema)` / `WithResponse(schema)` (accept JSON-schema objects), param `location` (query/body/path), optional `auth` annotation; emit in /discover + OpenAPI | `AppHost/Discovery/EndpointRegistry.cs`, `ServiceManifest.cs`, `OpenApiGenerator.cs` | Flat params can't express the suite's real request bodies; responses are 100% undocumented | Significant, shared-layer |
| I3 | Standardize the error envelope on RedMatter's `{ok, error:{code,message,details?}}` — ship `ApiError` helper in AppHost (C#) + TS type, convert AppHost middlewares first, then apps | New `AppHost/ApiError.cs`, then per-app sweeps | Five dialects today; agents need one parser. Keep RedCompute's remediation-hint style in `message` | Medium per app |
| I4 | Make Nova discovery-driven: startup task fetches each suite app's `/discover` → generates `config/runtime/suite-apis.md` into the agent's CLAUDE.md; replace hardcoded ports in the 5 C# clients with a config-backed `SuiteServices` map | `nova/src/Nova.App/Services/MemoryManager.cs:129-169`, `DiscussionEndpoints.cs:26-35`, `DelegateEndpoints.cs:18-28`, `RedComputeClient.cs:27`, `ConversationExporter.cs:13` | Nova's agent brief already contains a wrong route; discovery exists server-side everywhere and is consumed nowhere | Medium — highest-leverage Nova change |
| I5 | Hoist route-scoped commands to app level: CodeRed session/GitHub/Code commands → AppLayout with `enabled:` predicates; Nova discussion commands likewise; drop Ctrl+W/Ctrl+Tab for non-reserved keys (e.g. Alt+W / Ctrl+J) | `codered/web/src/pages/sessions.tsx:210-268`, `github.tsx:435-459`, `code.tsx:445-464`, `nova/web/src/panels/ChatView.tsx:175-196` | A palette whose contents depend on the current route defeats its purpose; two advertised shortcuts can't fire | Medium |
| I6 | Populate RedMatter's palette (0 commands): nav commands, mirror the 15 editor keybindings, scene/engine/test/Nova-panel actions — or teach the DOM scanner to read its existing `data-action` attributes | `redmatter/cms/frontend/src/App.tsx`, `GameViewPage.tsx`, `preference-defaults.ts:116-237`, or `packages/utility/src/command-provider.tsx:69` | The most capable backend has the least capable palette | Medium, largely mechanical |
| I7 | RedCompute action commands: queue job, start/stop/sleep/wake capability, cancel job (also **add the missing cancel UI**), rerun, open console/settings | `redcompute/web/src/components/...` (capability-card, job-detail, app-shell) | 3 nav-only commands today; cancel-job has an API and no UI at all | Small-medium |
| I8 | Command infra hardening: dev-mode warnings on id/shortcut collision; `description` field on `Command`; deprecate one of AppShell-vs-`useAskNovaCommand` duplicate registrations; export shared `SHORTCUTS` constants | `packages/utility/src/command-provider.tsx:29-33,203-212`, `types.ts:3-11`, `ask-nova.ts:316-352` | Silent overwrites and order-dependent shortcut resolution are landmines as palettes grow | Small |
| I9 | Machine-discoverable commands: mirror the command list to `window.__redbamboo_commands` (id/label/group/shortcut/description) and optionally a backend `/commands` endpoint | `packages/utility/src/command-provider.tsx` + app wiring | "Every user-facing action in the palette" + "AI can call any operation" meet here — Nova could enumerate and trigger UI actions | Medium |
| I10 | Register all broadcast WS events: Nova `discussion.event`/`discussion.nova-message`; CodeRed relayed `session.*`; type the `WsEventSchema.Fields` (name+type, not just name) | `nova .../DiscussionEndpoints.cs:420,486` + startup, `codered .../AppHostExtensions` usage, `AppHost/WebSockets/WebSocketBroadcaster.cs:9-13` | `/ws/schema` claims to be the full catalog and isn't, on the two apps where it matters most | Small |
| I11 | Capability→endpoint linking: populate `Endpoints:` on Nova chat/automations, RedLeaf all six, RedCompute telemetry; make capability `Status` reflect reality (Nova chat ← RedCompute health via the unused `IsAvailableAsync`) | Each `*ServiceDescriptor.cs` | A 38-entry flat list with no grouping forces agents to infer workflows | Small per app |
| I12 | Decide `/discover` auth posture: add `/discover` + `/openapi.json` to bearer bypass (it's metadata) or document token-first; unify the bearer cookie default with `redsuite_token` | `AppHost/Auth/BearerAuthOptions.cs:6-7` | Bearer-mode and JWT-mode apps currently disagree; proxy cookie forwarding silently breaks on defaults | One-liner + decision |
| I13 | RedCompute: surface the async-job contract (`?async`, `X-Async`, `X-Idempotency-Key`, `X-Caller-Info`, `X-Job-Id`/`X-Result-Json`) in the manifest — as registry params or a `conventions` block in /discover | `RedComputeServiceDescriptor.cs` / registry entries | The suite's most important invocation pattern is pure folklore | Small |
| I14 | Nova automations: add `PUT /api/automations/{name}` (update/enable/disable), expose `expiresAt`/`maxFailures`, make trigger async (`{jobId}` + poll), 404 on missing delete | `nova/src/Nova.App/Api/AutomationEndpoints.cs:49,107,127,142-152` | Agents managing automations is a stated goal; today they can create and destroy but not modify | Medium |
| I15 | Fix RedCompute IconColor → `#26A69A`; align app-switcher's hardcoded Nova color with Nova's descriptor (or better: consume manifest colors — see N2) | `redcompute .../RedComputeServiceDescriptor.cs:26`, `packages/utility/src/app-switcher.tsx:13-19` | Two apps claim the same brand color; AI service identification by color is broken | One-liners |

### Nice-to-have — polish and consistency

| # | Change | Files | Why | Scope |
|---|---|---|---|---|
| N1 | Pick one pagination convention (recommend `limit`+`offset` with `{items,total}`, cursor for streams) and codify as `ParameterDescriptor` presets in AppHost; apply opportunistically | `AppHost/Discovery/`, app endpoints | Four generations coexist | Gradual |
| N2 | Single suite-topology source: export `SUITE_REGISTRY` from `@redbamboo/utility`, consume it in app-switcher/context-card/ask-nova; have AppSwitcher read `iconClass`/`iconColor`/`description` from the `/discover` bodies it already fetches and discards | `packages/utility/src/app-switcher.tsx:13-47`, `chat/src/components/context-card.tsx:18-24`, `ask-nova.ts:34,166` | 5+ hardcoded copies, already drifted (Nova's color) | Small |
| N3 | Shared `apiFetch` wrapper (auth headers, base URL, error-envelope parsing) in `@redbamboo/utility`; migrate the four hand-rolled fetch sites | `packages/utility/src/` (new), `use-service-discovery.ts`, `use-log-stream.ts`, `remote-access-provider.tsx`, `tunnel-settings-panel.tsx` | Five apps are about to hand-roll this five more ways | Small |
| N4 | Registry enforcement: startup pass diffing `app.DataSources` routes vs registry entries, log a warning per unregistered/undescribed route | `AppHost/Extensions/AppHostExtensions.cs` | The cheapest mechanism to stop future invisible endpoints | Small |
| N5 | PUT/PATCH semantics cleanup: convert partial-merge PUTs to PATCH (RedCompute settings, RedMatter scenes/templates, Nova sub-resources → one PATCH); RedMatter orchestrator settings POST→PUT; RedCompute `DELETE /jobs/{id}` → `POST /jobs/{id}/cancel` (keep DELETE as deprecated alias) | per-app | Method semantics are how agents predict side effects | Medium, breaking-ish |
| N6 | Dead code/UI sweep: RedCompute empty `ClaudeSessionEndpoints`/`OpenCodeSessionEndpoints` stubs + write-only `LastClipResults` + deprecated `/codex/*` tree; CodeRed ignored `Mode` param + `tackle_id` dead fields; Nova dead `renameDiscussion`; RedLeaf dead CreateViewDialog + no-op feedback command; RedCompute `/claude` broken navigate + settings-panel `management.endpoints` bug | listed per-app above | Dead surfaces mislead both users and agents | Small each |
| N7 | Implement or remove CodeRed's six phantom-endpoint buttons (retackle/undismiss/review-retry/health-retry/run-single/test-fix — RedMatter has reference implementations) | `codered/src/CodeRed.App/Api/` + `packages/github/src/` | Buttons that silently no-op; trivial to port from RedMatter | Medium |
| N8 | Versions from assembly metadata instead of hardcoded literals (all five descriptors + RedCompute's duplicate in `RelayServer.cs:96`) | each `*ServiceDescriptor.cs` | Five "0.1.0"/"0.2.0" literals waiting to drift | Small |
| N9 | RedLeaf: document the `data`-is-a-JSON-string contract (or return parsed objects); unify `type_slug`/`typeSlug`; bulk create + upsert-by-external-key for memory migration | `redleaf .../EntityEndpoints.cs` | Smooths the Nova migration | Medium |
| N10 | Shared-layer commands: App Switcher command + per-app "Switch to X…" commands + theme/contrast toggle in `AppShell` | `packages/utility/src/app-shell.tsx`, `app-header.tsx:24-33` | The canonical cross-app commands belong in the shared layer; theme toggle is the most-expected palette command and no app has it | Small |
| N11 | Casing normalization: standardize on snake_case for the wire (matching the dominant convention), fix CodeRed's dual-casing diff routes and `/discover`'s own `api_base`/`iconClass` mix | various | Minor but visible to every consumer | Gradual |
| N12 | Generate TS types from C# records (or add a contract test) for `ServiceManifest`/`EndpointDescriptor`/`RemoteAccessStatus`/`LogEntry` | `packages/utility/src/` ↔ `AppHost/Discovery/` | Hand-mirrored types already drifted once (C4) and will again | Medium |
| N13 | RedMatter: retire the legacy `GET /api` catalog (generate it from the registry or redirect to `/discover`); add asset PUT/PATCH; fix readiness GET→POST and the 30-min synchronous diagnostics | `redmatter .../ApiDiscoveryEndpoints.cs`, `AssetEndpoints.cs`, `DiagnosticEndpoints.cs:123,205` | 587 hand-maintained lines guarantee perpetual drift | Medium |
| N14 | RedCompute: fix multi-clip music output (`?clip=` server-side, consume `LastClipResults`) or remove the clip-probing UI | `redcompute .../GenericCapabilityEndpoints.cs:269-294`, `SunoProvider.cs:34,177`, `job-detail.tsx:61-77` | UI renders up to 5 identical players; API can't reach clips 2-4 | Medium |

---

## Appendix: what "good" looks like in this codebase today

When implementing fixes, copy these existing patterns rather than inventing new ones:

- **Endpoint description + params:** Nova's `POST /api/delegate` (`DelegateEndpoints.cs:38`) for prose; RedLeaf's `POST /api/entity-types/{typeSlug}/fields` (`FieldDefinitionEndpoints.cs:40`) for `.WithParam()` with enums/defaults; AppHost's `GetLogCapabilityDescriptor` (`LogEndpoints.cs:81-107`) for capability-level docs.
- **Error envelope:** RedMatter's `ApiErrors` + `ErrorHandlingMiddleware` (`Models/ApiErrors.cs`, `Middleware/ErrorHandlingMiddleware.cs:36`); RedCompute's remediation-hint messages (`GenericCapabilityEndpoints.cs:56,70`).
- **Async long-ops:** RedMatter's `{id, status}` + poll + SSE with seq/keepalive/terminal-frame (`TestEndpoints.cs:140`).
- **Self-describing subsystems:** RedMatter's 7 `/schema` endpoints; the engine debug server's `GET /` + `/api` + `/schema` (`DebugHttpServer.cs:268-273`).
- **WS discoverability:** RedCompute's 11 registered event types with field schemas (`RelayServer.cs:176-202`).
- **Agent-friendly semantics:** RedMatter's 410-vs-404, `dry_run` on page revert (`VersionEndpoints.cs:205-243`), idempotent stop/ack; RedLeaf's version-history `source: "ai"` provenance enum (`VersionEndpoints.cs:79`).

---

## 6. Implementation status (2026-06-10)

All commits are local (unpushed) on each repo's `main`. Legend: ✅ implemented · 🟡 partial · ⏭️ skipped.

### Security fixes

| Item | Status | Commits / notes |
|---|---|---|
| RedCompute: stop trusting `X-User-Id` over JWT `sub` | ✅ | redcompute `dd9e536` — JWT claim first; header honored only from loopback (cross-service calls keep working) |
| CodeRed: confine `GET /api/file` | ✅ | codered `989d94d` — system-dir blocklist applied |
| Nova: confine `GET /api/file` + missing OwnerId check on discussion images | ✅ | nova `5612c47` — workspace-confined; owner-scope condition extracted into a helper and applied everywhere |
| RedLeaf: role-gate dev-mode / tunnel / backup | ✅ | redleaf `4845096` — admin required (also gated export-seeds) |

### Critical

| # | Status | Commits / notes |
|---|---|---|
| C1 RedMatter descriptor (port 5000 → 18802, icon) | ✅ | redmatter `9bc0c12` |
| C2 RedCompute session/capability endpoints → registry, delete hand-mirror | ✅ | redcompute `548a426`, `22c7355` — all 22 `/ai-session/*` routes registered (incl. previously invisible inject/callback/icon/open-in-codered), execute schema corrected (default 1800, clamp 1-7200, sandbox/docker params), mirror deleted, capability endpoints no longer vanish without an active provider, custom manifests merged from ALL providers; Codex models single-sourced via `ModelCatalog` |
| C3 CodeRed session surface discoverable + honest descriptor | ✅ | codered `e5eb95c` (descriptor); `proxies` block auto-emitted by the shared layer (redbamboo `89535ac`); relayed `session.*` WS schemas `0b5e34b` |
| C4 TS `EndpointInfo` carries `parameters` | ✅ | redbamboo `db56913` — plus requestBody/response/auth, proxies, full management typing |
| C5 CodeRed fallback 404s API prefixes | ✅ | codered `d9d1049` |
| C6 Nova `POST /api/ask` | ✅ | nova `2a6260b` — sync bounded (default 60s, clamp 10-300), polls the session, returns `{ok, reply, discussionId, sessionId}`; timeout returns ids so callers can follow up |
| C7 RedLeaf validation/paging/slug fixes | ✅ | redleaf `f812241` — 400 on missing type_slug, default 100 / max 500 limit, PUT preserves slug suffix |
| C8 RedLeaf content search + filter operators | ✅ | redleaf `85e4be9` — `search=` matches Data, `data.<prop>__gte/__lte/__gt/__lt/__ne/__contains`, native bool/number equality |
| C9 Register invisible AppHost endpoints | ✅ | redbamboo `89535ac` (management block: remote.token, logs, telemetry, autostart) + redcompute `79b618e` (telemetry capability registered) |
| C10 Phantom-endpoint docs | ✅ | redmatter `547080c` (7 references fixed), nova `1068e8f` (dreaming.md route) |

### Important

| # | Status | Commits / notes |
|---|---|---|
| I1 `.WithParam()` suite-wide | ✅ | redcompute `1542d0c` + C2 commits; codered `239025e` (incl. the ubiquitous `root` param); redmatter `50f776a` + `b2cafda`; nova `c478fbd`; redleaf already compliant + new endpoints documented. Bonus: the RedMatter pass found `POST /api/engine/launch` body fields never bound (missing JsonPropertyName) — fixed in `b2cafda` |
| I2 Registry request/response schemas, locations, auth | ✅ | redbamboo `0623b88` — WithRequestBody/WithResponse/WithAuth, ParameterDescriptor.Location, registry.Describe() |
| I3 Standard error envelope | 🟡 | helper shipped (redbamboo `0623b88` `ApiError`); per-app deviations fixed (redcompute `4a9fb34`, codered `fb9d899`, redmatter `eb7b00c`, nova `c478fbd`); wholesale per-app shape migration deliberately deferred — each frontend parses its house shape |
| I4 Nova discovery-driven | ✅ | nova `1068e8f` — SuiteDiscoveryService writes `config/runtime/suite-apis.md` at startup, CLAUDE.md points at it, cross-app URLs centralized into `Suite:*` config |
| I5 Command hoisting + non-reserved shortcuts | ✅ | codered `71c7b71` (command-bus navigate-then-act; Alt+W / Alt+ArrowDown; settings docs updated); nova `04323d7` |
| I6 RedMatter palette (0 → useful) | ✅ | redmatter `6c2bb84` — 31 commands (7 nav, editor-action mirror, Nova/engine/test actions). `camera.focusSelected` not mirrored: defined in preference-defaults but dispatched nowhere (pre-existing dead config) |
| I7 RedCompute action commands + cancel-job UI | ✅ | redcompute `5ade837`, `2c01e71` — Cancel button (was missing from UI entirely), Queue Job/Toggle Console/Toggle Settings/Rerun/Cancel commands |
| I8 Command infra hardening | ✅ | redbamboo `dcca506` — id/shortcut collision warnings, `description` field; `useAskNovaCommand` deprecated (`db56913`) |
| I9 Machine-discoverable commands | ✅ | redbamboo `dcca506` — `window.__redbamboo_commands` + `window.__redbamboo_runCommand(id)`; a backend `/commands` endpoint was not added (the window mirror covers the browser-driver path) |
| I10 Register all broadcast WS events | 🟡 | codered `0b5e34b` (relayed session.*), nova `17f31d3` (discussion.*); typed field schemas in `WsEventSchema` (names+types) deferred — shared-model change |
| I11 Capability→endpoint linking + honest statuses | 🟡 | nova `17f31d3` (endpoint lists + chat status from live RedCompute check, 30s memo), redleaf `5c3db68`, redcompute `79b618e`; RedMatter capability statuses remain hardcoded "Running" |
| I12 /discover auth posture + cookie unify | ✅ | redbamboo `89535ac` — /discover + /openapi.json in bearer bypass; cookie default → `redsuite_token` |
| I13 RedCompute async-job contract surfaced | ✅ | in `548a426`/`22c7355` — `?async` + X-Async/X-Caller-Info/X-Idempotency-Key/X-Job-Name/X-Job-Rationale/X-Provider documented with header locations. (`/ai-session/generate` does not read `?async` — documented only where the handler supports it) |
| I14 Nova automation management | ✅ | nova `20f4080` — PUT update (incl. enabled/expiresAt/maxFailures), 202 background trigger, 404 on missing delete, WithRequestBody schemas |
| I15 Brand colors | ✅ | redcompute `e68f665` (#26A69A + RedMatter #D4A03C in suite telemetry), nova `17f31d3` (#C74B7A); app-switcher now prefers live manifest colors (redbamboo `db56913`) |

### Nice-to-have

| # | Status | Commits / notes |
|---|---|---|
| N1 Pagination convention codified | ⏭️ | needs a design decision on the canonical style; no app changed |
| N2 Suite-topology single source | ✅ | redbamboo `db56913` — `SUITE_APPS` consumed by app-switcher, chat context-card, ask-nova |
| N3 Shared `apiFetch` wrapper | 🟡 | shipped (redbamboo `db56913`); migrating the four existing hand-rolled fetch sites deferred |
| N4 Registry enforcement warnings | ✅ | redbamboo `89535ac` — startup warning per route outside the registry |
| N5 PUT/PATCH semantics cleanup | 🟡 | redmatter `a67f233` (readiness POST primary, GET deprecated), `fd27605` (orchestrator settings PUT primary); RedCompute DELETE-as-cancel and the PUT→PATCH conversions skipped (breaking) |
| N6 Dead code/UI sweep | ✅ | redcompute `e8f0a82` (empty endpoint stubs) + `5ade837` (settings-panel manifest bug, /claude route); codered `fb9d899` (ignored Mode param); nova `04323d7` (renameDiscussion wired into UI); redleaf `9b65baa` (dead Create View fixed); redbamboo `1ce630a` (no-op feedback command) |
| N7 CodeRed phantom endpoints | 🟡 | 4 of 6: retackle/undismiss `b6f2b36`, review retry `5bd23d7`, health retry + run-single `9ef8cf5`; `tests/{id}/fix` (no AI-session service in CodeRed) and `git/review` (no terminal-spawn infra; autonomous review covers it) skipped — neither had a UI call site |
| N8 Versions from one source | 🟡 | redcompute `e68f665` (const shared by descriptor + header); other apps still hardcode version strings |
| N9 RedLeaf data contract / bulk / upsert | ✅ | redleaf `847334a` (bulk + PUT by-slug upsert), `e76e516` (double-encoding documented, GDPR JSON parse, typeSlug alias, icon/color + fields[] schemas) |
| N10 Shared-layer commands | 🟡 | redbamboo `dcca506` — Switch App… + Open <App> commands; per-app theme commands (codered `71c7b71`, redleaf `9b65baa`); a SHARED theme toggle skipped — no shared persistence mechanism exists (design decision) |
| N11 Casing normalization | ⏭️ | breaking wire change; needs a migration plan |
| N12 TS types from C# records | ⏭️ | needs a codegen/contract-test tooling decision |
| N13 RedMatter catalog + diagnostics | 🟡 | `5209901` (catalog marked deprecated + self-generating `registry_endpoints`), `ae0ed18` (honest ~30 min doc; background-start conversion skipped — needs a new run entity + migration), `a67f233` (readiness), `1871955` (asset PATCH) |
| N14 Music multi-clip | ✅ | redcompute `23f9722` — `JobResult.ExtraOutputs`, clips saved as `{jobId}_clip{i}.mp3`, `?clip=N` honored, JSON 404 when absent |

### Bonus fixes found during implementation

- **RedMatter engine launch was broken**: `POST /api/engine/launch` body DTO had no `JsonPropertyName` attributes, so the frontend's `scene_id`/`use_warp` never bound — launches silently ignored the chosen scene (redmatter `b2cafda`).
- **Remote token validation accepted any token**: ConnectPrompt validated against `/ping`, which is in the auth bypass list — switched to `/health` (redbamboo `480a16d`).
- API telemetry middleware was never enabled in RedMatter (redmatter `694c94f`).
- CodeRed `/api/navigate/events` SSE converted to multi-subscriber broadcast — multiple tabs no longer steal each other's navigation events (codered `fb9d899`).

### Known remaining gaps (deliberate)

1. Per-app error shapes still differ (RedCompute `{error,message}`, CodeRed `{ok,error}`, RedMatter/new-code `{ok,error:{code,message}}`) — deviations within each app are fixed, but unifying across apps is a coordinated breaking change.
2. `WsEventSchema.Fields` are still untyped names; SSE endpoints are still only described in prose.
3. RedMatter capability statuses are hardcoded; `POST /api/diagnostics/full` still blocks synchronously (docs now honest).
4. Shared theme toggle, pagination convention, casing normalization, TS codegen — all need explicit design decisions before implementation.
