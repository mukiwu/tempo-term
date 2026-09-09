const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * lucide icon paths, copied from the package. The CodeMirror extensions in
 * this folder build their gutter markers by hand, so the React components
 * can't be used there.
 */
export const FOLD_VERTICAL = [
  "M12 22v-6",
  "M12 8V2",
  "M4 12H2",
  "M10 12H8",
  "M16 12h-2",
  "M22 12h-2",
  "m15 19-3-3-3 3",
  "m15 5-3 3-3-3",
];
export const UNFOLD_VERTICAL = [
  "M12 22v-6",
  "M12 8V2",
  "M4 12H2",
  "M10 12H8",
  "M16 12h-2",
  "M22 12h-2",
  "m15 19-3 3-3-3",
  "m15 5-3-3-3 3",
];
/**
 * The two step controls on a collapsed-run bar. They are "from line" arrows
 * rather than plain chevrons because that is exactly what the buttons do: the
 * line is the edge of the bar, and the arrow is the direction the code grows
 * away from it.
 */
export const ARROW_UP_FROM_LINE = ["m18 9-6-6-6 6", "M12 3v14", "M5 21h14"];
export const ARROW_DOWN_FROM_LINE = ["M19 3H5", "M12 21V7", "m6 15 6 6 6-6"];
export const MESSAGE_SQUARE_PLUS = [
  "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",
  "M12 8v6",
  "M9 11h6",
];

/** One of the path sets above as an SVG element, drawn in the current color. */
export function lucideIcon(paths: readonly string[], size = 13): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}
