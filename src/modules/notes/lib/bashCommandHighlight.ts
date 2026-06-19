import bash from "highlight.js/lib/languages/bash";
import type { HLJSApi, Language, Mode } from "highlight.js";

const SHELL_KEYWORDS = [
  "if", "then", "else", "elif", "fi", "for", "while", "until",
  "do", "done", "case", "esac", "function", "select", "in",
  "time", "return", "coproc",
].join("|");

/**
 * Bash grammar that also colors the leading command of each statement
 * (ssh, git, custom scripts), not only highlight.js's built-in whitelist.
 * Reuses the `built_in` scope so commands share the existing accent color.
 */
export function bashCommandHighlight(hljs: HLJSApi): Language {
  const grammar = bash(hljs);
  const commandMode: Mode = {
    begin: [
      // 1: statement boundary (start of block, newline, ; | & ( ) + trailing space
      /(?:^|[\n;&|(])\s*/,
      // 2: optional leading env-var assignments, e.g. FOO=bar
      /(?:\w+=\S*\s+)*/,
      // 3: optional command wrappers
      /(?:sudo\s+|command\s+|exec\s+)?/,
      // 4: the command name (only this group is scoped); excludes shell keywords,
      //    allows ./ ../ / path prefixes for script invocations
      new RegExp(`(?!(?:${SHELL_KEYWORDS})\\b)(?:\\.{0,2}/)?[A-Za-z_][\\w./-]*`),
    ],
    beginScope: { 4: "built_in" },
    relevance: 0,
  };
  grammar.contains = [commandMode, ...grammar.contains];
  return grammar;
}
