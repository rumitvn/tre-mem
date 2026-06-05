# tre-mem Phase 4 — "Memory for every harness" (Cross-Tool Port)

> Sibling plan to [`PLAN.md`](./PLAN.md) (v0.1), [`PLAN-PHASE2.md`](./PLAN-PHASE2.md) (v0.2), [`PLAN-PHASE3.md`](./PLAN-PHASE3.md) (v0.5).
> This file is the **Phase 4 SSOT** (v0.6.x). Status: **planned** — starts after 0.5.x ships. Tick `- [x]` per task and commit with the code.

## Context

Through v0.5.x, tre-mem is branch-aware (P1), git-shared (P2), and visible via a web dashboard (P3) —
but it is still **wired only into Claude Code**. `tre setup` supports `claude-code` and stubs
`cursor`/`codex` as "coming in V3" (`src/setup.ts:148-156`), and `runMcpServer()` **hard-exits if
claude-mem is not installed** (`src/mcp/server.ts:71-76`). The strategic question the user raised:
**prove tre-mem's value across tools/harnesses, not lock-in to Claude Code.**

Research (early 2026) confirms the opening: **all four target tools speak stdio MCP** — the transport
tre-mem already implements — and **Codex CLI + Gemini CLI also expose lifecycle hooks**.

**Honest value framing (state this plainly in docs):**

- **Ingest is claude-mem's job, and it's multi-harness** _(corrected 2026-06-05 from the v13.4.0
  installer — the first draft wrongly said "Claude-Code-only")_. claude-mem installs capture into
  Claude Code, Codex CLI, Gemini CLI, Cursor, and Antigravity, all into one shared `~/.claude-mem`
  DB. tre-mem reads that DB, so **full branch-aware search is available wherever claude-mem is
  installed + ingesting** — mode is per-**machine**, not per-harness.
- **Consume is the cross-tool win.** Every tool can _read_ the git-shared team memory (pins +
  graduated from `.tre-mem/`) via MCP. A teammate on Codex/Gemini/Cursor/Antigravity clones the
  repo, runs `tre setup <tool>`, and their agent instantly knows the team's pinned decisions +
  graduated facts. When claude-mem is absent, tre-mem degrades to shared-only — no silent full mode.
- **Antigravity has no native memory** → strongest wedge; an MCP memory server is its intended
  extension point.
- **Installed ≠ ingesting (user insight).** The claude-mem DB can exist yet hold no observations on
  a machine, so tre-mem runs shared-only there. `tre doctor` + `tre status` **detect and honestly
  report** ingest health (`probeClaudeMemIngest` → `none|stale|active`) instead of implying full
  mode works everywhere.

**Decisions locked with user:**

- Depth: **MCP injection on all 4 tools** (Codex CLI, Gemini CLI, Antigravity, Codex Desktop) **+
  lifecycle hooks on Codex CLI + Gemini CLI** (auto-import teammate `.tre-mem/` + inject branch
  context). Antigravity / Codex Desktop are **inject-only via MCP** (no session-hook API).

---

## The Phase 4 Story (positioning)

> "Your team's memory shouldn't depend on which agent you happen to open. Pin a decision in Claude
> Code, and your teammate sees it whether they're in Codex CLI, Gemini CLI, Codex Desktop, or
> Antigravity. tre-mem speaks MCP — the one protocol they all share — and meets each tool where it
> already keeps its config. No lock-in. The repo is the memory; every harness can read it."

| Capability                          | Claude Code | Codex CLI | Gemini CLI | Codex Desktop | Antigravity |
| ----------------------------------- | :---------: | :-------: | :--------: | :-----------: | :---------: |
| MCP consume (shared pins/graduated) |     ✅      |    ✅     |     ✅     |      ✅       |     ✅      |
| Lifecycle hooks (import + inject)   |     ✅      |    ✅     |     ✅     |  ❌ (config)  | ❌ (no API) |
| Ingest new observations             |   ✅ (cm)   |    ❌     |     ❌     |      ❌       |     ❌      |

---

## Architecture changes from v0.5 (additive)

```
   Claude Code   Codex CLI   Gemini CLI   Codex Desktop   Antigravity
        │            │           │             │              │
        └──── stdio MCP: tre-mem server (shared-memory mode) ─┘
                          │
                 ToolDeps.adapter? (OPTIONAL)
                   ├─ present  → full retrieval (P1 path)
                   └─ absent   → shared-pin/graduated only (from .tre-mem/ + sidecar)
```

**1. Decouple claude-mem (finish what P3 started).**

- `ToolDeps.adapter` (`src/mcp/tools.ts`) becomes optional; tool handlers skip the semantic/observation
  signal when absent and serve branch/pin/graduated (search.ts already supports `source:
'shared-pin'|'graduated'`).
- `runMcpServer()` (`src/mcp/server.ts:68-104`) stops hard-exiting when claude-mem is missing — it
  runs in **shared-memory-only mode** and logs a one-line notice instead of `exitCode=1`.

**2. Tool-adapter abstraction for `tre setup`** (replace the stub at `src/setup.ts:146-164`).

```ts
interface ToolAdapter {
  id: 'claude-code' | 'codex' | 'gemini' | 'antigravity' | 'codex-desktop';
  detect(): boolean; // config dir exists?
  registerMcp(): SetupChange; // write MCP server entry to the tool's config
  registerHooks?(opts): SetupChange; // only Codex CLI + Gemini CLI
}
```

Per-tool config targets (verified in research):

- **Codex CLI** — MCP in `~/.codex/config.toml`; hooks in `~/.codex/hooks.json` (`type:"command"`,
  JSON-on-stdin; events SessionStart, UserPromptSubmit).
- **Gemini CLI** — MCP in `~/.gemini/settings.json` (`mcpServers` map); hooks in same settings /
  `hooks/hooks.json` (events SessionStart, SessionEnd, BeforeModel).
- **Codex Desktop / IDE** — shares `~/.codex` config → MCP applies; no separate hook wiring.
- **Antigravity** — MCP in `~/.gemini/.../mcp_config.json` (per-surface mcp dirs); inject-only, no hooks.

**3. Generic hook envelope.** The hook _cores_ are already tool-agnostic — `runSessionStartHook`
(`src/hooks/session-start.ts`) and `runUserPromptSubmitHook` (`src/hooks/user-prompt-submit.ts`)
return plain `{ message, context, ... }`. Only the **output envelope** differs per tool (Claude wraps
in `hookSpecificOutput`). Extract envelope serializers so the same core feeds each tool:
`tre hook session-start --format=codex|gemini|claude`.

**No schema migration** — Phase 4 is integration plumbing over existing data.

---

## Roadmap — 2 weeks (T7 foundation + Codex, T8 Gemini + Antigravity + ship)

### Week 7 — decouple + Codex

- [x] **T7D1** `ToolDeps.adapter` + `SearchDeps.adapter` now optional; `searchBranchContext` skips semantic/recency/hydration when absent (branch+pin+graduated still rank); `getBranchTimeline` guards adapter use. Tests: `test/mcp-no-claudemem.test.ts`
- [x] **T7D2** `runMcpServer()` shared-memory-only mode — no hard exit without claude-mem; one-line stderr notice + `shared_only_mode` log; `tre doctor` prints `mode: full|shared-only`. **+ ingest-health probe** (user insight): `probeClaudeMemIngest()` reports `none|stale|active` (installed ≠ ingesting — claude-mem only records the harness whose hooks it wired); doctor surfaces it. Tests: `test/preflight-ingest.test.ts`
- [x] **T7D3** `src/tooling/` module: `codex.ts` (idempotent TOML append), `json-mcp.ts` (shared idempotent `mcpServers` JSON merge), `gemini.ts`; `setupTool` dispatches per tool (claude-code path unchanged, behavior-preserving). _(Chose composable per-tool registrars + dispatch over a single class interface — same registry effect, less ceremony.)_
- [x] **T7D4** Codex: `registerCodexMcp()` → `[mcp_servers.tre-mem]` + `registerCodexHooks()` → `[[hooks.SessionStart]]` (+ `UserPromptSubmit` with `--auto-inject`) in `~/.codex/config.toml`. `tre setup codex` + `codex-desktop` (shared config).
- [x] **T7D5** Hook envelope serializers (`src/hooks/envelope.ts`, `tre hook <event> --format=claude|codex|gemini`): Codex == Claude shape (`hookSpecificOutput.{hookEventName,additionalContext}`); Gemini omits `hookEventName` + uses `BeforeModel`. UserPromptSubmit hook made claude-mem-optional. Tests: `test/hook-envelope.test.ts`. Live-verified both envelopes.
- [x] **T7D5** **Checkpoint T7 PASSED**: `tre mcp` over stdio with `CLAUDE_MEM_HOME` empty → "shared-memory-only mode", no exit, `tools/list` returns all 5 tools, `list_branches` responds.

### Week 8 — Gemini + Antigravity + Cursor + ship

- [x] **T8D6** Gemini: `registerGeminiMcp()` → `~/.gemini/settings.json` `mcpServers` + `registerGeminiHooks()` (SessionStart, BeforeModel w/ `--auto-inject`); `GEMINI_HOME` aware. Tests: `test/tooling-gemini.test.ts`.
- [x] **T8D7** Antigravity: `registerAntigravityMcp()` → `~/.gemini/antigravity[-cli]/mcp_config.json` (IDE + CLI surfaces), inject-only (hooks are Python-SDK). Tests: `test/tooling-extra.test.ts`.
- [x] **T8D8** Codex Desktop shares `~/.codex/config.toml`; `tre setup codex-desktop` reuses the Codex registration. **+ Cursor** added (`~/.cursor/mcp.json`, MCP) — claude-mem treats it first-class.
- [x] **T8D9** `tre setup --all` (auto-detects installed harnesses + always does claude-code for the repo); `detectTools()` powers a per-tool wiring line in `tre status` (`codex✓ gemini· …`). Tests: `test/tooling-extra.test.ts`.
- [x] **T8D10** Polish: `docs/CROSS-TOOL.md` (corrected ingest framing), README + README.vi multi-tool section, version `0.5.0 → 0.6.0`, CHANGELOG `[0.6.0]`, full gate, PR.
- [ ] **T8D10** **Checkpoint T8 (moment of truth, user-gated)**: user wires a real non-Claude tool and confirms "what did the team pin on this branch?" works. (User will test from the PR.)

---

## Critical files (modify / create)

**Create:**

- `src/tooling/tool-adapter.ts` (interface + registry), `src/tooling/codex.ts`, `src/tooling/gemini.ts`, `src/tooling/antigravity.ts`, `src/tooling/claude-code.ts` (extracted from `src/setup.ts`)
- `src/hooks/envelope.ts` (per-tool output serializers)
- `docs/CROSS-TOOL.md`
- Tests: `test/tooling-codex.test.ts`, `test/tooling-gemini.test.ts`, `test/tooling-antigravity.test.ts`, `test/hook-envelope.test.ts`, `test/mcp-no-claudemem.test.ts`

**Modify:**

- `src/mcp/tools.ts` — optional adapter; `src/mcp/server.ts` — shared-memory-only mode
- `src/setup.ts` — delegate to the tool-adapter registry; remove the V3 stub
- `src/cli.ts` — `tre setup <tool> [--all] [--auto-inject]`, `tre hook <event> [--format=…]`, extend `tre status` / `tre doctor`
- `README.md`, `README.vi.md`, `CHANGELOG.md`, `package.json` (`0.5.x → 0.6.0`), `src/version.ts`

**Reuse (do not reinvent):**

- `runSessionStartHook` / `runUserPromptSubmitHook` cores (`src/hooks/*`) — already tool-agnostic
- `createMcpServer` (`src/mcp/server.ts:20-66`) — transport-generic; `TOOL_DEFINITIONS` / `callTool` (`src/mcp/tools.ts`)
- `searchBranchContext` shared-pin/graduated surfacing (`src/retrieval/search.ts`)
- `importDir` (`src/sync/import.ts`) for the hook auto-import; `withHook` idempotent-write pattern (`src/setup.ts:78-91`)

---

## Verification (end-to-end)

1. **Unit** (vitest, ≥25 new): null-adapter MCP handlers; each tool adapter writes correct config
   idempotently (snapshot the written TOML/JSON); hook envelope per `--format`; setup is re-runnable.
2. **MCP-without-claude-mem**: start server with `CLAUDE_MEM_HOME` pointing at an empty dir →
   `tools/list` succeeds, `get_branch_context` returns shared pins from `.tre-mem/` (no crash).
3. **Per-tool handshake** (where binaries available locally): `codex` / `gemini` show `tre-mem` tools;
   hook command runs on SessionStart and reports `imported=Npin/Mgrad`. Mock the transport otherwise.
4. **Honest-value doc check**: `docs/CROSS-TOOL.md` states ingest=CC-only, consume=all-tools.
5. **Pre-push gate** (Node 20 + 22): `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

---

## Out of scope (Phase 4)

- New ingest pipelines for Codex/Gemini/Antigravity sessions (no upstream observation store to read).
- GitLab/Bitbucket graduate actions (after GitHub validated).
- Encrypted/BYO-key memory; enterprise SSO — wait for paid-tier signal.
- Cursor/Cline adapters — add once the four chosen tools are validated.

---

## Risks & mitigations

| Risk                                                       | Mitigation                                                                                                 |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Each tool's config format drifts across versions           | One small adapter per tool; snapshot tests; pin documented config schema versions in `docs/CROSS-TOOL.md`. |
| TOML editing for Codex (no native toml dep)                | Use a tiny vetted TOML writer or surgical section-append with idempotent guard; never clobber user keys.   |
| Antigravity `~/.gemini/GEMINI.md` collides with Gemini CLI | Inject-only via MCP dir; do NOT write the shared GEMINI.md path; document the collision (issue #16058).    |
| Users expect new memories to appear on non-CC tools        | `docs/CROSS-TOOL.md` + `tre status` make the consume-only reality explicit; no silent over-promise.        |
| Hooks unavailable/unstable on a tool version               | MCP is the floor everywhere; hooks are additive and feature-detected; setup degrades to MCP-only.          |

---

## Changelog (decisions & pivots)

- **2026-06-04** — Phase 4 planned. Depth: MCP on all 4 tools + hooks on Codex CLI & Gemini CLI;
  Antigravity/Codex Desktop inject-only. Foundation (claude-mem-optional) begins in Phase 3 and is
  completed here.
- **2026-06-05** — Shipped T7+T8 in one pass: claude-mem decoupling, ingest-health probe, and
  `tre setup` for Codex CLI/Desktop, Gemini CLI, Cursor, Antigravity (+ hooks for Codex/Gemini,
  `--all`, status detection). **Corrected the value framing** after the v13.4.0 installer showed
  claude-mem ingests from all five harnesses (not Claude-Code-only): full mode is per-machine
  (claude-mem installed + ingesting); consume works on every harness via MCP.
