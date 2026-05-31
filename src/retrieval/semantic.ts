import type { ClaudeMemAdapter } from '../adapter/claude-mem.js';

export interface SemanticHit {
  observationId: number;
  similarity: number;
}

export interface SemanticSearchQuery {
  query: string;
  project: string;
  k: number;
}

export interface SemanticSearcher {
  search(opts: SemanticSearchQuery): SemanticHit[];
}

const FTS_TOKEN_PATTERN = /[^A-Za-z0-9_]/g;

export function buildFtsMatchExpression(raw: string): string | null {
  const tokens = raw
    .split(/\s+/)
    .map((token) => token.replace(FTS_TOKEN_PATTERN, ''))
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token}"`).join(' OR ');
}

export class Fts5SemanticSearcher implements SemanticSearcher {
  constructor(private readonly adapter: ClaudeMemAdapter) {}

  search(opts: SemanticSearchQuery): SemanticHit[] {
    const match = buildFtsMatchExpression(opts.query);
    if (match === null) return [];
    const rows = this.adapter.fts5SearchObservations({
      match,
      project: opts.project,
      k: opts.k,
    });
    if (rows.length === 0) return [];
    const bestRank = rows[0]!.rank;
    return rows.map((row) => ({
      observationId: row.id,
      similarity: 1 / (1 + (row.rank - bestRank)),
    }));
  }
}
