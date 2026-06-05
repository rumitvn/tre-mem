# Cross-tool setup — tre-mem beyond Claude Code

tre-mem speaks **MCP (stdio)**, the one protocol every major AI coding harness
shares. That makes the team's git-shared memory portable: clone a repo, wire
tre-mem into your tool, and your agent can read the team's pinned decisions and
graduated facts — no lock-in to Claude Code.

## The honest model: ingest vs consume

|                                 | Claude Code | Codex CLI | Codex Desktop | Gemini CLI | Antigravity |
| ------------------------------- | :---------: | :-------: | :-----------: | :--------: | :---------: |
| **Consume** shared memory (MCP) |     ✅      |    ✅     |      ✅       |     ✅     | ✅ _(soon)_ |
| **Ingest** new observations     |     ✅      |    ❌     |      ❌       |     ❌     |     ❌      |

- **Consume** = read git-shared pins + graduated facts (and, where claude-mem is
  present, full branch-aware search). This works on every harness over MCP.
- **Ingest** = recording new observations. That is **claude-mem's** job, and
  claude-mem only wires its hooks into **Claude Code**. So on another harness
  tre-mem runs in **shared-memory-only mode** — it surfaces what the team has
  curated, but won't create new observations there.

> **Installed ≠ ingesting.** claude-mem's DB may exist on a machine yet receive
> no new observations on a non-Claude-Code harness. Run **`tre doctor`** — it
> reports `mode: full | shared-only` and the claude-mem **ingest health**
> (`active` / `stale` / none), so you always know what a given harness will do.

## Setup

All commands are idempotent and non-clobbering (they never overwrite your other
config). They assume the `tre` binary is on your `PATH` (`npm i -g tre-mem`).

### Codex CLI

```bash
tre setup codex
```

Adds `[mcp_servers.tre-mem]` to `~/.codex/config.toml` (override the dir with
`CODEX_HOME`). Restart Codex; `get_branch_context`, `list_branches`, etc. appear.

### Codex Desktop / IDE

```bash
tre setup codex-desktop
```

Codex Desktop shares `~/.codex/config.toml`, so this is the same registration —
running either `codex` or `codex-desktop` wires both surfaces.

### Gemini CLI

```bash
tre setup gemini
```

Adds `tre-mem` to the `mcpServers` map in `~/.gemini/settings.json` (override the
dir with `GEMINI_HOME`).

### Antigravity

_Coming next._ Antigravity registers MCP servers under `~/.gemini/…/mcp_config.json`
and has **no native memory**, which makes an MCP memory server its intended
extension point — a strong fit for tre-mem's consume model.

## Verify

```bash
tre doctor          # mode + claude-mem ingest health on this machine
tre mcp             # start the server by hand; on a non-CC harness it prints
                    #   "running in shared-memory-only mode" and still serves tools
```

In the tool itself, list MCP tools — you should see `tre-mem`'s
`get_branch_context`, `get_branch_timeline`, `list_branches`, `pin_fact`,
`graduate_fact`. Ask: _"what has the team pinned on this branch?"_

## What's not here yet

- **Lifecycle hooks** (auto-import teammate `.tre-mem/` + inject branch context on
  session start) for Codex CLI and Gemini CLI — those harnesses expose hook
  engines; wiring is in progress. Today the integration is **MCP consumption**,
  which already delivers the cross-tool value.
- **Antigravity** registration (inject-only via MCP; no session-hook API).
