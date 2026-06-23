export type SshAuthMethod = "password" | "keyFile" | "agent";

export interface ConnectionDraft {
  name: string;
  host: string;
  port: number;
  user: string;
  authMethod: SshAuthMethod;
  keyPath?: string;
}

export interface ParsedSshCommand {
  draft: Partial<ConnectionDraft>;
  ignored: string[];
  warnings: string[];
}

const DEFERRED: Record<string, string> = {
  "-L": "local port forwarding",
  "-R": "remote port forwarding",
  "-D": "dynamic SOCKS forwarding",
  "-J": "jump host",
};
const DEFERRED_TAKES_ARG = new Set(["-L", "-R", "-D", "-J"]);

/** Tokenize on whitespace; v1 does not need shell-quote handling. */
function tokenize(input: string): string[] {
  return input.trim().split(/\s+/).filter(Boolean);
}

export function parseSshCommand(input: string): ParsedSshCommand {
  const draft: Partial<ConnectionDraft> = {};
  const ignored: string[] = [];
  const warnings: string[] = [];
  const tokens = tokenize(input);

  let i = 0;
  let isSshCommand = false;
  if (tokens[i] === "ssh") {
    i += 1;
    isSshCommand = true;
  }

  for (; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok === "-p") {
      const v = tokens[++i];
      if (v === undefined) {
        warnings.push("missing port after -p");
      } else {
        const port = Number(v);
        if (Number.isInteger(port) && port > 0) {
          draft.port = port;
        } else {
          warnings.push(`invalid port: ${v}`);
        }
      }
    } else if (tok === "-i") {
      const v = tokens[++i];
      if (v) {
        draft.keyPath = v;
        draft.authMethod = "keyFile";
      }
    } else if (tok === "-l") {
      const v = tokens[++i];
      if (v) {
        draft.user = v;
      }
    } else if (tok in DEFERRED) {
      ignored.push(`${tok} (${DEFERRED[tok]}) is not supported in v1 and was ignored`);
      if (DEFERRED_TAKES_ARG.has(tok)) {
        i += 1; // skip its argument
      }
    } else if (tok.startsWith("-")) {
      warnings.push(`unrecognized flag: ${tok}`);
    } else if (tok.includes("@")) {
      const [user, host] = tok.split("@");
      if (user) draft.user = user;
      if (host) draft.host = host;
    } else if (isSshCommand) {
      // Only set positional host argument if we're in an ssh command
      draft.host = tok;
    } else {
      // Non-ssh command with positional argument
      warnings.push(`unexpected argument: ${tok}`);
    }
  }

  if (draft.host && draft.port === undefined) {
    draft.port = 22;
  }
  if (draft.host && draft.name === undefined) {
    draft.name = draft.host;
  }
  if (draft.host && draft.authMethod === undefined) {
    draft.authMethod = "password";
  }
  if (!draft.host) {
    warnings.push("no host found in command");
  }

  return { draft, ignored, warnings };
}
