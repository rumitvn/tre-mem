import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { ClaudeMemAdapter } from '../adapter/claude-mem.js';
import { diagnoseClaudeMem } from '../adapter/preflight.js';
import { log, logError } from '../log/logger.js';
import { migrate } from '../store/migrate.js';
import { TreMemRepo } from '../store/repo.js';
import { VERSION } from '../version.js';

import { TOOL_DEFINITIONS, type ToolDeps, callTool } from './tools.js';

export interface CreateServerOptions {
  deps: ToolDeps;
  name?: string;
  version?: string;
}

export function createMcpServer(opts: CreateServerOptions): Server {
  const server = new Server(
    {
      name: opts.name ?? 'tre-mem',
      version: opts.version ?? '0.0.0',
    },
    {
      capabilities: { tools: {} },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOL_DEFINITIONS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const startedMs = Date.now();
    try {
      const result = await callTool(opts.deps, name, args);
      log({
        level: 'debug',
        component: 'mcp',
        event: 'tool_call',
        fields: { tool: name, ms: Date.now() - startedMs },
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as Record<string, unknown>,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('mcp', 'tool_error', err, { tool: name });
      return {
        content: [{ type: 'text' as const, text: `tre-mem ${name}: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

export async function runMcpServer(): Promise<void> {
  migrate();
  const cm = diagnoseClaudeMem();

  // claude-mem is OPTIONAL. When it's present + compatible we run in FULL mode
  // (semantic + observation signals). When it's absent/incompatible — the common
  // case on non-Claude-Code harnesses where claude-mem can't ingest — we run in
  // SHARED-MEMORY-ONLY mode (pins + graduated from the sidecar / .tre-mem) rather
  // than refusing to start. Either way every harness can consume team memory.
  let adapter: ClaudeMemAdapter | null = null;
  if (cm.installed && cm.compatible) {
    try {
      adapter = new ClaudeMemAdapter();
    } catch (err) {
      logError('mcp', 'adapter_open_failed', err, {});
      adapter = null;
    }
  }
  if (!adapter) {
    process.stderr.write(
      `tre-mem: ${cm.reason} — running in shared-memory-only mode ` +
        `(pins + graduated only; full search needs claude-mem).\n`,
    );
    log({
      level: 'warn',
      component: 'mcp',
      event: 'shared_only_mode',
      fields: { reason: cm.reason },
    });
  }

  const repo = new TreMemRepo();
  const server = createMcpServer({ deps: { adapter, repo }, version: VERSION });
  const transport = new StdioServerTransport();
  const cleanup = (signal: string): void => {
    log({ level: 'info', component: 'mcp', event: 'server_stop', fields: { signal } });
    try {
      adapter?.close();
    } catch {
      /* noop */
    }
    try {
      repo.close();
    } catch {
      /* noop */
    }
  };
  process.on('SIGINT', () => {
    cleanup('SIGINT');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup('SIGTERM');
    process.exit(0);
  });
  log({ level: 'info', component: 'mcp', event: 'server_start', fields: {} });
  await server.connect(transport);
}
