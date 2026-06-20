import { invoke } from "@tauri-apps/api/core";

/** A pull request summarized for a card; `state` is open/draft/merged/closed. */
export interface PrInfo {
  number: number;
  state: string;
  url: string;
  title: string | null;
}

export function ghAvailable(): Promise<boolean> {
  return invoke<boolean>("gh_available");
}

export function prViaGh(cwd: string, branch: string | null): Promise<PrInfo | null> {
  return invoke<PrInfo | null>("pr_via_gh", { cwd, branch });
}

export function prViaApi(cwd: string, branch: string): Promise<PrInfo | null> {
  return invoke<PrInfo | null>("pr_via_api", { cwd, branch });
}
