export interface Observation {
  id: number;
  memory_session_id: string;
  project: string;
  text: string | null;
  type: string;
  title: string | null;
  subtitle: string | null;
  facts: string | null;
  narrative: string | null;
  concepts: string | null;
  files_read: string | null;
  files_modified: string | null;
  prompt_number: number | null;
  created_at: string;
  created_at_epoch: number;
}

export interface SessionSummary {
  id: number;
  memory_session_id: string;
  project: string;
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
  files_read: string | null;
  files_edited: string | null;
  notes: string | null;
  prompt_number: number | null;
  created_at: string;
  created_at_epoch: number;
}

export type PendingMessageType = 'observation' | 'summarize';

export interface PendingMessage {
  id: number;
  session_db_id: number;
  content_session_id: string;
  message_type: PendingMessageType;
  tool_name: string | null;
  cwd: string | null;
  prompt_number: number | null;
  status: string;
  created_at_epoch: number;
  project: string;
}

export interface ListQuery {
  /** One or more project labels to union over (cross-clone alias set). */
  projects: string[];
  sinceEpoch?: number;
  untilEpoch?: number;
  limit?: number;
}

const MS_THRESHOLD = 10_000_000_000;

export function toSecondsEpoch(epoch: number): number {
  if (!Number.isFinite(epoch)) return 0;
  return epoch >= MS_THRESHOLD ? Math.floor(epoch / 1000) : epoch;
}
