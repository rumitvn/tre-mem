/**
 * Per-harness hook output envelopes.
 *
 * The hook *cores* (runSessionStartHook / runUserPromptSubmitHook) are
 * tool-agnostic — they return plain `{ message, display, context }`. Only the
 * JSON a harness expects on stdout differs:
 *
 *  - Claude Code: `{ continue, hookSpecificOutput:{hookEventName,additionalContext}, systemMessage }`
 *  - Codex CLI:   `{ hookSpecificOutput:{hookEventName,additionalContext} }`  (same shape; no `continue`)
 *  - Gemini CLI:  `{ hookSpecificOutput:{additionalContext}, systemMessage }`  (NO hookEventName)
 *
 * Codex/Gemini ignore unknown fields, but we emit each one's documented shape.
 */
export type HookFormat = 'claude' | 'codex' | 'gemini';

export function parseHookFormat(raw: string | undefined): HookFormat {
  return raw === 'codex' || raw === 'gemini' ? raw : 'claude';
}

/** Empty/no-op response in the given format's dialect. */
export function emptyEnvelope(format: HookFormat): Record<string, unknown> {
  return format === 'claude' ? { continue: true } : {};
}

export function sessionStartEnvelope(
  format: HookFormat,
  message: string,
  display: string,
): Record<string, unknown> {
  if (format === 'gemini') {
    return { hookSpecificOutput: { additionalContext: message }, systemMessage: display };
  }
  if (format === 'codex') {
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: message } };
  }
  return {
    continue: true,
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: message },
    systemMessage: display,
  };
}

export function promptEnvelope(format: HookFormat, context: string): Record<string, unknown> {
  if (context === '') return emptyEnvelope(format);
  if (format === 'gemini') {
    return { hookSpecificOutput: { additionalContext: context } };
  }
  if (format === 'codex') {
    return {
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
    };
  }
  return {
    continue: true,
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
  };
}
