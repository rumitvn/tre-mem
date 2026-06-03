/**
 * Secret detection for the export path. `tre export` is fail-closed: if any
 * pin/graduated field matches a rule, export aborts and writes nothing unless
 * the caller explicitly opts into placeholder redaction.
 */

export interface SecretRule {
  name: string;
  pattern: RegExp;
}

export interface SecretMatch {
  rule: string;
  field: string;
  /** A masked preview safe to print in an error report (never the raw secret). */
  preview: string;
}

// Each pattern carries the global flag so we can find every occurrence.
export const SECRET_RULES: ReadonlyArray<SecretRule> = [
  { name: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  // anthropic before openai, and openai excludes the sk-ant- prefix, so an
  // Anthropic key is labeled correctly instead of being caught as openai.
  { name: 'anthropic-key', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'openai-key', pattern: /sk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { name: 'aws-access-key', pattern: /AKIA[0-9A-Z]{16}/g },
  { name: 'github-token', pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: 'google-api-key', pattern: /AIza[0-9A-Za-z_-]{35}/g },
  { name: 'slack-token', pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  {
    name: 'jwt',
    pattern: /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
];

function mask(secret: string): string {
  if (secret.length <= 8) return '*'.repeat(secret.length);
  return `${secret.slice(0, 4)}…${secret.slice(-2)} (${secret.length} chars)`;
}

/** Scan a set of named fields for secrets. Returns every match found. */
export function scanForSecrets(
  fields: ReadonlyArray<{ field: string; value: string | null }>,
  rules: ReadonlyArray<SecretRule> = SECRET_RULES,
): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const { field, value } of fields) {
    if (!value) continue;
    for (const rule of rules) {
      // Reset lastIndex — these are global regexes reused across calls.
      rule.pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.pattern.exec(value)) !== null) {
        matches.push({ rule: rule.name, field, preview: mask(m[0]) });
        if (m[0].length === 0) rule.pattern.lastIndex++;
      }
    }
  }
  return matches;
}

/** Replace every secret in `text` with `[REDACTED:<rule>]`. */
export function redactText(
  text: string,
  rules: ReadonlyArray<SecretRule> = SECRET_RULES,
): { redacted: string; count: number } {
  let redacted = text;
  let count = 0;
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    redacted = redacted.replace(rule.pattern, () => {
      count++;
      return `[REDACTED:${rule.name}]`;
    });
  }
  return { redacted, count };
}

export class RedactionError extends Error {
  readonly matches: ReadonlyArray<SecretMatch>;
  constructor(matches: ReadonlyArray<SecretMatch>) {
    super(
      `export blocked: ${matches.length} potential secret(s) detected. ` +
        `Fix the source, add a .shareignore pattern, or re-run with --force --redact.`,
    );
    this.name = 'RedactionError';
    this.matches = matches;
  }
}
