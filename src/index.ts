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
export {
  currentBranch,
  isDetached,
  DETACHED_PREFIX,
  NO_GIT,
} from './git/resolver.js';
export type { ResolverOptions } from './git/resolver.js';
export { GitWatcher } from './git/watcher.js';
export type { WatcherOptions } from './git/watcher.js';
export {
  parseHeadReflog,
  readHeadReflog,
  resolveBranchAt,
} from './git/reflog.js';
export type { BranchTransition } from './git/reflog.js';
export { backfill } from './git/backfill.js';
export type { BackfillOptions, BackfillResult } from './git/backfill.js';
export { TreMemRepo } from './store/repo.js';
export type {
  BranchState,
  BranchTag,
  BranchTagSource,
  RepoOptions,
} from './store/repo.js';
