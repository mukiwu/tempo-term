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
 *
 * That line is drawn broken, which is what the edge of a collapsed stretch is:
 * not a rule in the code but the place where lines were left out. It also
 * tells the pair apart from every other arrow in the app at a glance.
 */
export const ARROW_UP_FROM_LINE: readonly IconStroke[] = [
  "m18 9-6-6-6 6",
  "M12 3v14",
  { d: "M5 21h14", dashed: true },
];
export const ARROW_DOWN_FROM_LINE: readonly IconStroke[] = [
  { d: "M19 3H5", dashed: true },
  "M12 21V7",
  "m6 15 6 6 6-6",
];
export const MESSAGE_SQUARE_PLUS = [
  "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",
  "M12 8v6",
  "M9 11h6",
];

/** One of the path sets above as an SVG element, drawn in the current color. */
/**
 * One stroke of an icon: the path data, or the same with a note that it should
 * be drawn broken.
 */
export type IconStroke = string | { d: string; dashed: true };

export function lucideIcon(paths: readonly IconStroke[], size = 13): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const stroke of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", typeof stroke === "string" ? stroke : stroke.d);
    if (typeof stroke !== "string" && stroke.dashed) {
      path.setAttribute("stroke-dasharray", "3 3");
    }
    svg.appendChild(path);
  }
  return svg;
}
