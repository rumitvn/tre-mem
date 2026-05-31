export { migrate, CURRENT_SCHEMA_VERSION } from './store/migrate.js';
export type { MigrateResult } from './store/migrate.js';
export {
  TRE_MEM_HOME,
  TRE_MEM_DB_PATH,
  CLAUDE_MEM_HOME,
  CLAUDE_MEM_DB_PATH,
  CLAUDE_MEM_CHROMA_DIR,
} from './store/paths.js';
export { ClaudeMemAdapter } from './adapter/claude-mem.js';
export type { AdapterOptions } from './adapter/claude-mem.js';
export type {
  ListQuery,
  Observation,
  PendingMessage,
  PendingMessageType,
  SessionSummary,
} from './adapter/types.js';
export { currentBranch, isDetached, DETACHED_PREFIX, NO_GIT } from './git/resolver.js';
export type { ResolverOptions } from './git/resolver.js';
export { GitWatcher } from './git/watcher.js';
export type { WatcherOptions } from './git/watcher.js';
export { parseHeadReflog, readHeadReflog, resolveBranchAt } from './git/reflog.js';
export type { BranchTransition } from './git/reflog.js';
export { backfill } from './git/backfill.js';
export type { BackfillOptions, BackfillResult } from './git/backfill.js';
export { TreMemRepo } from './store/repo.js';
export type {
  BranchState,
  BranchTag,
  BranchTagSource,
  BranchPin,
  BranchPinInsert,
  Graduated,
  GraduatedInsert,
  RepoOptions,
} from './store/repo.js';
export { Fts5SemanticSearcher, buildFtsMatchExpression } from './retrieval/semantic.js';
export type { SemanticHit, SemanticSearcher, SemanticSearchQuery } from './retrieval/semantic.js';
export { semanticSignal, branchSignal, recencySignal } from './retrieval/signals.js';
export type {
  ScoredObservation,
  BranchSignalInput,
  RecencySignalInput,
} from './retrieval/signals.js';
export { rerank, DEFAULT_RERANK_WEIGHTS } from './retrieval/rerank.js';
export type {
  RerankInput,
  RerankWeights,
  RerankOptions,
  RerankResult,
  RerankBreakdown,
} from './retrieval/rerank.js';
export { searchBranchContext } from './retrieval/search.js';
export type { SearchHit, SearchOptions, SearchDeps } from './retrieval/search.js';
export { toSecondsEpoch } from './adapter/types.js';
export { runSessionStartHook } from './hooks/session-start.js';
export type {
  SessionStartInput,
  SessionStartOptions,
  SessionStartResult,
  SessionStartSource,
} from './hooks/session-start.js';
export {
  TOOL_DEFINITIONS,
  callTool,
  getBranchContext,
  getBranchTimeline,
  graduateFact,
  listBranches,
  pinFact,
} from './mcp/tools.js';
export type {
  GetBranchContextInput,
  GetBranchContextResult,
  GetBranchTimelineInput,
  GetBranchTimelineResult,
  GraduateFactInput,
  GraduateFactResult,
  ListBranchesInput,
  ListBranchesResult,
  PinFactInput,
  PinFactResult,
  ToolDefinition,
  ToolDeps,
} from './mcp/tools.js';
export { createMcpServer, runMcpServer } from './mcp/server.js';
export type { CreateServerOptions } from './mcp/server.js';
