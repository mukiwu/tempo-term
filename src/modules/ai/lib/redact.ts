/** Placeholder substituted for any detected secret. */
const REDACTED = "[REDACTED]";

/**
 * Ordered list of redaction rules. Each rule is a global regex and its
 * replacement; a replacement may reference capture groups (`$1`, `$2`, ...) to
 * keep the non-secret parts of a match (a scheme word, a key name, a host) so
 * the surrounding context stays useful to the model.
 */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // PEM / OpenSSH key blocks, e.g. `-----BEGIN OPENSSH PRIVATE KEY----- ... -----END ...-----`.
  // The end alternates between the closing marker and end-of-string so a key
  // whose tail was truncated away (context blocks are truncated before
  // redaction) is still scrubbed instead of leaking.
  [/-----BEGIN [^-]+-----[\s\S]*?(?:-----END [^-]+-----|$)/g, REDACTED],
  // OpenAI-style secret keys, e.g. `sk-...` and `sk-proj-...`.
  [/\bsk-[A-Za-z0-9_-]{20,}/g, REDACTED],
  // GitHub personal/OAuth/app tokens, e.g. `ghp_...`, `gho_...`.
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED],
  // AWS access key ids, e.g. `AKIA...` (long-lived) and `ASIA...` (temporary).
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  // `Bearer <token>` auth headers — keep the scheme word, drop the token.
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, `Bearer ${REDACTED}`],
  // `password=...` / `passwd:...` assignments — keep the key, drop the value.
  // The value may be a single/double-quoted string (so spaces inside quotes are
  // covered) or an unquoted run of non-space chars. `pwd` is deliberately
  // excluded: it collides with the very common `PWD` working-directory
  // environment variable, which is not a secret.
  [
    /\b(password|passwd)(\s*[=:]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+)/gi,
    `$1$2${REDACTED}`,
  ],
  // Credentials embedded in a URL, e.g. `postgres://user:pass@host` — keep user and host, drop the password.
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+):([^\s:@/]+)@/gi, `$1:${REDACTED}@`],
];

/**
 * Strip credentials and key material out of text before it is sent to an LLM.
 * Matches are replaced with `[REDACTED]`; everything else is left untouched so
 * the surrounding context stays useful to the model.
 */
export function redactSecrets(text: string): string {
  return RULES.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}
