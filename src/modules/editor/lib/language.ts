import type { Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { python } from "@codemirror/lang-python";

export type LanguageId =
  | "javascript"
  | "json"
  | "html"
  | "css"
  | "markdown"
  | "rust"
  | "python"
  | "plaintext";

const EXTENSION_MAP: Record<string, LanguageId> = {
  ts: "javascript",
  tsx: "javascript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  html: "html",
  htm: "html",
  css: "css",
  md: "markdown",
  markdown: "markdown",
  rs: "rust",
  py: "python",
};

/** Pick a language id from a file path's extension, plaintext when unknown. */
export function languageIdForPath(path: string): LanguageId {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return "plaintext";
  }
  const ext = name.slice(dot + 1).toLowerCase();
  return EXTENSION_MAP[ext] ?? "plaintext";
}

/**
 * Short, freeform language hint from a file path's extension, used to prime the
 * inline-completion model. Unlike {@link languageIdForPath} this keeps the raw
 * extension (e.g. "go", "java"), so it is not limited to the grammars we bundle.
 * Falls back to "text" when there is no extension (including dotfiles).
 */
export function languageLabel(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return "text";
  }
  const ext = name.slice(dot + 1).toLowerCase();
  return ext.length > 0 ? ext : "text";
}

/** Resolve the CodeMirror language extension for a path (empty for plaintext). */
export function languageExtension(path: string): Extension[] {
  switch (languageIdForPath(path)) {
    case "javascript":
      return [javascript({ jsx: true, typescript: true })];
    case "json":
      return [json()];
    case "html":
      return [html()];
    case "css":
      return [css()];
    case "markdown":
      return [markdown()];
    case "rust":
      return [rust()];
    case "python":
      return [python()];
    default:
      return [];
  }
}
