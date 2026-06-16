import { invoke } from "@tauri-apps/api/core";

export interface FontInfo {
  family: string;
  monospace: boolean;
  has_cjk: boolean;
}

export interface FontReport {
  fonts: FontInfo[];
  recommended_cjk: string[];
  suggested_cjk_fallback: string | null;
  has_cjk_fallback: boolean;
}

/** Ask the Rust backend to enumerate installed fonts and CJK monospace status. */
export async function fetchFontReport(): Promise<FontReport> {
  return invoke<FontReport>("fonts_report");
}
