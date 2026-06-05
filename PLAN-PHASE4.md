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

- **Ingest stays Claude-Code-only.** claude-mem only observes Claude Code sessions; tre-mem cannot
  create _new_ observations on other tools. We do not pretend otherwise.
- **Consume is the cross-tool win.** Every tool can _read_ the git-shared team memory (pins +
  graduated from `.tre-mem/`) via MCP. A teammate on Codex/Gemini/Antigravity clones the repo, runs
  `tre setup <tool>`, and their agent instantly knows the team's pinned decisions + graduated facts.
- **Antigravity has no native memory** → strongest wedge; an MCP memory server is its intended
  extension point.
- **Installed ≠ ingesting (user insight).** claude-mem only records the harness whose hooks it has
  wired (Claude Code). On another harness the DB may exist but stay empty, so tre-mem runs there in
  shared-only mode. `tre doctor` and `tre setup <tool>` must **detect and honestly report** ingest
  health (`probeClaudeMemIngest` → `none|stale|active`) instead of implying full mode works
  everywhere.

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
- [ ] **T7D3** `src/tooling/tool-adapter.ts` interface + registry; refactor `setupClaudeCode` to implement it (behavior-preserving, existing tests stay green)
- [ ] **T7D4** Codex adapter: `registerMcp()` → `~/.codex/config.toml`; `registerHooks()` → `~/.codex/hooks.json`; `tre setup codex [--auto-inject]`
- [ ] **T7D5** Hook envelope serializers (`--format=codex|gemini|claude`) over the existing hook cores; round-trip tests per format
- [ ] **T7D5** **Checkpoint T7**: in a repo with `.tre-mem/`, Codex CLI lists `tre-mem` MCP tools and `get_branch_context` returns shared pins **with claude-mem absent**

### Week 8 — Gemini + Antigravity + Codex Desktop + ship

- [ ] **T8D6** Gemini adapter: `registerMcp()` → `~/.gemini/settings.json`; `registerHooks()` (SessionStart/SessionEnd); `tre setup gemini [--auto-inject]`
- [ ] **T8D7** Antigravity adapter: `registerMcp()` → `~/.gemini/.../mcp_config.json` (inject-only); `tre setup antigravity` + GEMINI.md-path collision guard
- [ ] **T8D8** Codex Desktop: document shared `~/.codex` path; `tre setup codex-desktop` aliases the Codex MCP registration; verify both surfaces see the server
- [ ] **T8D9** `tre setup --all` / auto-detect installed tools; `tre status` reports which tools are wired; cross-tool E2E matrix (MCP handshake per tool, mocked where binaries unavailable)
- [ ] **T8D10** Polish: `docs/CROSS-TOOL.md` (per-tool setup + honest value framing), README + README.vi multi-tool section, version bump `0.5.x → 0.6.0`, CHANGELOG `[0.6.0]`, full pre-push gate, PR
- [ ] **T8D10** **Checkpoint T8 (moment of truth)**: same `.tre-mem/` repo opened in ≥2 non-Claude tools; each agent answers "what did the team pin on this branch?" from shared memory

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
  completed here. Value framing locked as **ingest = Claude-Code-only, consume = every harness**.
