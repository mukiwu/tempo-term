import { resolveFileIcon, resolveFolderIcon } from "../lib/iconTheme/resolveIcon";
import { getIconSvg } from "../lib/iconTheme/iconSvgs";

interface FileIconProps {
  /** File or folder name used to pick the icon. */
  name: string;
  isDir: boolean;
  /** Only meaningful for directories: pick the open-folder variant. */
  open?: boolean;
  size?: number;
}

/**
 * Renders the inlined Catppuccin SVG for a file/folder. The SVG is injected as
 * markup (not via <img>) so its `var(--vscode-ctp-*)` colours resolve against
 * the document palette and recolour with the active theme.
 */
export function FileIcon({ name, isDir, open = false, size = 16 }: FileIconProps) {
  const basename = isDir ? resolveFolderIcon(name, open) : resolveFileIcon(name);
  const svg = getIconSvg(basename) ?? getIconSvg(isDir ? "_folder" : "_file") ?? "";

  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        flex: "none",
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
