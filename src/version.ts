/**
 * Single source of truth for the tre-mem version. Keep this in sync with the
 * `version` field in package.json (the only other place the version lives).
 * Imported by the CLI (`tre --version`), the MCP server handshake, and the
 * session digest's compatibility warnings.
 */
export const VERSION = '0.4.0';
