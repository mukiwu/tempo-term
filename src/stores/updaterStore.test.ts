import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub the Tauri updater/process plugins so the store can run outside a real
// app window. vi.hoisted keeps the mock fns reachable from the hoisted factory.
const { check, relaunch } = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));

import { useUpdaterStore } from "./updaterStore";

function resetStore() {
  useUpdaterStore.setState({
    status: "idle",
    version: "",
    notes: "",
    releaseUrl: "",
    update: null,
    installing: false,
    errorMessage: "",
  });
}

describe("updaterStore", () => {
  beforeEach(() => {
    check.mockReset();
    relaunch.mockReset();
    resetStore();
  });

  it("flags an update as available with its version, notes and release link", async () => {
    check.mockResolvedValue({ version: "0.0.2", body: "Bug fixes" });

    await useUpdaterStore.getState().checkForUpdate();

    const s = useUpdaterStore.getState();
    expect(s.status).toBe("available");
    expect(s.version).toBe("0.0.2");
    expect(s.notes).toBe("Bug fixes");
    expect(s.releaseUrl).toContain("v0.0.2");
  });

  it("reports up to date when nothing newer exists", async () => {
    check.mockResolvedValue(null);

    await useUpdaterStore.getState().checkForUpdate();

    expect(useUpdaterStore.getState().status).toBe("upToDate");
  });

  it("stays idle when a silent background check finds nothing", async () => {
    check.mockResolvedValue(null);

    await useUpdaterStore.getState().checkForUpdate({ silent: true });

    expect(useUpdaterStore.getState().status).toBe("idle");
  });

  it("surfaces the error message when the check fails", async () => {
    check.mockRejectedValue(new Error("network down"));

    await useUpdaterStore.getState().checkForUpdate();

    const s = useUpdaterStore.getState();
    expect(s.status).toBe("error");
    expect(s.errorMessage).toBe("network down");
  });

  it("downloads, installs and relaunches into the new build", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    relaunch.mockResolvedValue(undefined);
    useUpdaterStore.setState({
      status: "available",
      update: { downloadAndInstall } as never,
    });

    await useUpdaterStore.getState().installUpdate();

    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
  });
});
