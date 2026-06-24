import type { Extension } from "@codemirror/state";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

/**
 * Short, freeform language hint from a file path's extension, used to prime the
 * inline-completion model. Keeps the raw extension (e.g. "go", "java") so it is
 * not limited to grammars we can highlight. Falls back to "text" when there is
 * no extension (including dotfiles).
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

/**
 * Find the CodeMirror language for a path using the bundled language-data
 * registry, which matches hundreds of languages by extension/filename (vue,
 * yaml, sql, go, java, php, c/c++, shell, ...). Returns null when nothing
 * matches so the caller can fall back to plain text.
 */
export function languageDescriptionForPath(path: string): LanguageDescription | null {
  const name = path.split(/[\\/]/).pop() ?? "";
  if (name.length === 0) {
    return null;
  }
  return LanguageDescription.matchFilename(languages, name);
}

/**
 * Load the CodeMirror language support extension for a path. Returns an empty
 * list for unknown files (or when the grammar fails to load), so the editor
 * just renders without highlighting. Async because language-data loads each
 * grammar on demand.
 */
export async function loadLanguageExtension(path: string): Promise<Extension[]> {
  const description = languageDescriptionForPath(path);
  if (!description) {
    return [];
  }
  try {
    const support = await description.load();
    return [support];
  } catch {
    return [];
  }
}
