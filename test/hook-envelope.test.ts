import { describe, expect, it } from 'vitest';

import {
  emptyEnvelope,
  parseHookFormat,
  promptEnvelope,
  sessionStartEnvelope,
} from '../src/hooks/envelope.js';

describe('parseHookFormat', () => {
  it('defaults to claude, accepts codex/gemini', () => {
    expect(parseHookFormat(undefined)).toBe('claude');
    expect(parseHookFormat('whatever')).toBe('claude');
    expect(parseHookFormat('codex')).toBe('codex');
    expect(parseHookFormat('gemini')).toBe('gemini');
  });
});

describe('sessionStartEnvelope', () => {
  it('claude: continue + hookEventName + systemMessage', () => {
    expect(sessionStartEnvelope('claude', 'CTX', 'DISP')).toEqual({
      continue: true,
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'CTX' },
      systemMessage: 'DISP',
    });
  });

  it('codex: hookEventName, no continue', () => {
    expect(sessionStartEnvelope('codex', 'CTX', 'DISP')).toEqual({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'CTX' },
    });
  });

  it('gemini: additionalContext only — no hookEventName, no ANSI systemMessage', () => {
    // Gemini prints systemMessage's ANSI literally AND echoes additionalContext,
    // so it gets the plain context only (no `systemMessage`, no duplication).
    const env = sessionStartEnvelope('gemini', 'CTX', 'DISP');
    expect(env).toEqual({ hookSpecificOutput: { additionalContext: 'CTX' } });
    expect(env.systemMessage).toBeUndefined();
  });
});

describe('promptEnvelope', () => {
  it('empty context → format-appropriate no-op', () => {
    expect(promptEnvelope('claude', '')).toEqual({ continue: true });
    expect(promptEnvelope('codex', '')).toEqual({});
    expect(promptEnvelope('gemini', '')).toEqual({});
  });

  it('codex carries hookEventName, gemini does not', () => {
    expect(promptEnvelope('codex', 'X')).toEqual({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'X' },
    });
    expect(promptEnvelope('gemini', 'X')).toEqual({
      hookSpecificOutput: { additionalContext: 'X' },
    });
  });
});

describe('emptyEnvelope', () => {
  it('claude keeps continue:true; others empty', () => {
    expect(emptyEnvelope('claude')).toEqual({ continue: true });
    expect(emptyEnvelope('codex')).toEqual({});
    expect(emptyEnvelope('gemini')).toEqual({});
  });
});
