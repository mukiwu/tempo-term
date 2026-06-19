// Eager raw import of the vendored Catppuccin SVGs (~656 small files). They are
// bundled once into the app chunk; for a local Tauri app there is no network
// cost, and inlining lets each icon's `var(--vscode-ctp-*)` strokes inherit the
// document-level palette.
const modules = import.meta.glob("../../../../assets/icons/catppuccin/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const byBasename = new Map<string, string>();
for (const [path, svg] of Object.entries(modules)) {
  const base = path
    .split("/")
    .pop()!
    .replace(/\.svg$/, "");
  byBasename.set(base, svg);
}

/** Raw SVG markup for an icon basename, or undefined when not vendored. */
export function getIconSvg(basename: string): string | undefined {
  return byBasename.get(basename);
}
