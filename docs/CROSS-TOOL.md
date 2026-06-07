# Cross-tool setup — tre-mem beyond Claude Code

tre-mem speaks **MCP (stdio)**, the one protocol every major AI coding harness
shares. That makes the team's git-shared memory portable: clone a repo, wire
tre-mem into your tool, and your agent can read the team's pinned decisions and
graduated facts — no lock-in to Claude Code.

## The model: consume (tre-mem) vs ingest (claude-mem)

Two layers, two responsibilities:

- **tre-mem = consume + branch-awareness.** It serves the git-shared team memory
  (pins + graduated) and branch-aware ranking over MCP. You wire it per harness
  with `tre setup <tool>`.
- **claude-mem = ingest.** It records observations. claude-mem (v13+) installs
  its capture into **Claude Code, Codex CLI, Gemini CLI, Cursor, and Antigravity**
  and writes them all to **one shared `~/.claude-mem` DB**.

Because tre-mem reads that one shared DB, **full branch-aware search is available
wherever claude-mem is installed and ingesting — it is _not_ Claude-Code-only.**
When claude-mem is absent (or hasn't ingested yet), tre-mem still runs in
**shared-only mode**: pins + graduated from the committed `.tre-mem/`, with a
substring search. Mode is per-**machine**, not per-harness.

| Harness       | `tre setup` wires                    | Ingest (claude-mem v13) |
| ------------- | ------------------------------------ | :---------------------: |
| Claude Code   | hooks + MCP (plugin)                 |           ✅            |
| Codex CLI     | MCP + SessionStart/Prompt hooks      |           ✅            |
| Codex Desktop | MCP (shares `~/.codex`)              |           ✅            |
| Gemini CLI    | MCP + SessionStart/BeforeModel hooks |           ✅            |
| Cursor        | MCP                                  |           ✅            |
| Antigravity   | MCP (inject-only)                    |           ✅            |

> **Installed ≠ ingesting.** The claude-mem DB can exist yet hold no observations
> on a given machine. Run **`tre doctor`** — it reports `mode: full | shared-only`
> and claude-mem **ingest health** (`active` / `stale` / none), so you always know
> what you'll get.

## Setup

Idempotent and non-clobbering (your other config is preserved). Assumes `tre` is
on your `PATH` (`npm i -g tre-mem`). Set up everything installed at once:

```bash
tre setup --all                # claude-code (this repo) + every installed harness
tre setup --all --auto-inject  # also wire the per-prompt inject hook where supported
```

Or one at a time:

| Command                   | Writes                                              | Notes                                                         |
| ------------------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| `tre setup codex`         | `~/.codex/config.toml` (MCP + hooks)                | `CODEX_HOME` aware                                            |
| `tre setup codex-desktop` | `~/.codex/config.toml`                              | shares Codex config                                           |
| `tre setup gemini`        | `~/.gemini/settings.json` (MCP + hooks)             | `GEMINI_HOME` aware; prompt hook → `BeforeModel`              |
| `tre setup cursor`        | `~/.cursor/mcp.json` (MCP)                          | `CURSOR_HOME` aware                                           |
| `tre setup antigravity`   | `~/.gemini/antigravity[-cli]/mcp_config.json` (MCP) | inject-only; hooks are SDK-only                               |
| `tre setup claude-code`   | `.claude/settings.json` (hooks)                     | per-repo; `--with-hook` adds the local graduate-on-merge hook |

`--auto-inject` adds the prompt-time inject hook (Codex `UserPromptSubmit`,
Gemini `BeforeModel`, Claude `UserPromptSubmit`). SessionStart is always wired.

## How hooks differ per harness

`tre hook <event> --format=<tool>` emits the right output envelope for each:

- **Claude Code / Codex**: `{ hookSpecificOutput: { hookEventName, additionalContext } }`
  (Codex's contract matches Claude's).
- **Gemini**: `{ hookSpecificOutput: { additionalContext } }` — no `hookEventName`,
  and there's no `UserPromptSubmit` event, so per-prompt injection maps to
  `BeforeModel`.

## Verify

```bash
tre doctor          # mode + claude-mem ingest health on this machine
tre status          # per-tool wiring line: codex✓ gemini· cursor✓ …
tre mcp             # start by hand; without claude-mem it prints "shared-memory-only mode"
```

In the tool, list MCP tools — you should see `get_branch_context`,
`get_branch_timeline`, `list_branches`, `pin_fact`, `graduate_fact`,
`unpin_fact`, `ungraduate_fact`, `export_memory`, `get_share_status`. Ask:
_"what has the team pinned on this branch?"_

## Notes

- **Antigravity** has no native memory, which makes an MCP memory server its
  intended extension point — a strong fit. Its lifecycle hooks are exposed via a
  Python SDK (not declarative config), so tre-mem integrates there inject-only.
- Codex/Gemini hook engines are young and evolving; if an envelope changes, the
  serializer in `src/hooks/envelope.ts` is the single place to adjust.
