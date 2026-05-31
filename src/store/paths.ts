import { homedir } from 'node:os';
import { join } from 'node:path';

export const TRE_MEM_HOME =
  process.env.TRE_MEM_HOME && process.env.TRE_MEM_HOME.trim() !== ''
    ? process.env.TRE_MEM_HOME
    : join(homedir(), '.tre-mem');

export const TRE_MEM_DB_PATH = join(TRE_MEM_HOME, 'tre-mem.db');

export const CLAUDE_MEM_HOME =
  process.env.CLAUDE_MEM_HOME && process.env.CLAUDE_MEM_HOME.trim() !== ''
    ? process.env.CLAUDE_MEM_HOME
    : join(homedir(), '.claude-mem');

export const CLAUDE_MEM_DB_PATH = join(CLAUDE_MEM_HOME, 'claude-mem.db');
export const CLAUDE_MEM_CHROMA_DIR = join(CLAUDE_MEM_HOME, 'chroma');
