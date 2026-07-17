import { beforeEach, describe, expect, it, vi } from "vitest";

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
    available: null,
    modalOpen: false,
    toast: null,
    notifiedVersions: [],
    installing: false,
    errorMessage: "",
    progress: null,
    installPhase: null,
  });
}

const FOUND = { version: "0.0.2", body: "Bug fixes" };

describe("updaterStore", () => {
  beforeEach(() => {
    check.mockReset();
    relaunch.mockReset();
    resetStore();
  });

  it("runLaunchCheck opens the modal and records the version on a hit", async () => {
    check.mockResolvedValue(FOUND);

    await useUpdaterStore.getState().runLaunchCheck();

    const s = useUpdaterStore.getState();
    expect(s.available?.version).toBe("0.0.2");
    expect(s.available?.notes).toBe("Bug fixes");
    expect(s.available?.releaseUrl).toContain("v0.0.2");
    expect(s.modalOpen).toBe(true);
    expect(s.notifiedVersions).toContain("0.0.2");
  });

  it("runLaunchCheck leaves the modal closed when nothing is newer", async () => {
    check.mockResolvedValue(null);

    await useUpdaterStore.getState().runLaunchCheck();

    expect(useUpdaterStore.getState().modalOpen).toBe(false);
    expect(useUpdaterStore.getState().available).toBeNull();
  });

  it("runPeriodicCheck toasts the first time a version is found", async () => {
    check.mockResolvedValue(FOUND);

    await useUpdaterStore.getState().runPeriodicCheck();

    const s = useUpdaterStore.getState();
    expect(s.toast).toEqual({ version: "0.0.2" });
    expect(s.modalOpen).toBe(false);
    expect(s.available?.version).toBe("0.0.2");
  });

  it("runPeriodicCheck does not toast the same version twice", async () => {
    check.mockResolvedValue(FOUND);
    await useUpdaterStore.getState().runPeriodicCheck();
    useUpdaterStore.getState().clearToast();

    await useUpdaterStore.getState().runPeriodicCheck();

    expect(useUpdaterStore.getState().toast).toBeNull();
  });

  it("runPeriodicCheck toasts again for a newer version", async () => {
    check.mockResolvedValue(FOUND);
    await useUpdaterStore.getState().runPeriodicCheck();
    useUpdaterStore.getState().clearToast();
    check.mockResolvedValue({ version: "0.0.3", body: "More" });

    await useUpdaterStore.getState().runPeriodicCheck();

    expect(useUpdaterStore.getState().toast).toEqual({ version: "0.0.3" });
  });

  it("a launch modal suppresses a later periodic toast of the same version", async () => {
    check.mockResolvedValue(FOUND);
    await useUpdaterStore.getState().runLaunchCheck();
    useUpdaterStore.getState().dismissModal();

    await useUpdaterStore.getState().runPeriodicCheck();

    expect(useUpdaterStore.getState().toast).toBeNull();
  });

  it("checkManually reports up to date when nothing newer exists", async () => {
    check.mockResolvedValue(null);

    await useUpdaterStore.getState().checkManually();

    expect(useUpdaterStore.getState().status).toBe("upToDate");
    expect(useUpdaterStore.getState().modalOpen).toBe(false);
  });

  it("checkManually opens the modal on a hit", async () => {
    check.mockResolvedValue(FOUND);

    await useUpdaterStore.getState().checkManually();

    expect(useUpdaterStore.getState().modalOpen).toBe(true);
    expect(useUpdaterStore.getState().available?.version).toBe("0.0.2");
  });

  it("checkManually surfaces the error message when the check fails", async () => {
    check.mockRejectedValue(new Error("network down"));

    await useUpdaterStore.getState().checkManually();

    const s = useUpdaterStore.getState();
    expect(s.status).toBe("error");
    expect(s.errorMessage).toBe("network down");
  });

  it("silent checks stay quiet when the check fails", async () => {
    check.mockRejectedValue(new Error("network down"));

    await useUpdaterStore.getState().runPeriodicCheck();

    const s = useUpdaterStore.getState();
    expect(s.status).toBe("idle");
    expect(s.toast).toBeNull();
  });

  it("runPeriodicCheck does nothing while an install is in progress", async () => {
    check.mockResolvedValue(FOUND);
    useUpdaterStore.setState({ installing: true });

    await useUpdaterStore.getState().runPeriodicCheck();

    expect(check).not.toHaveBeenCalled();
    expect(useUpdaterStore.getState().toast).toBeNull();
  });

  it("dismissModal keeps the available update so the indicator stays", async () => {
    check.mockResolvedValue(FOUND);
    await useUpdaterStore.getState().runLaunchCheck();

    useUpdaterStore.getState().dismissModal();

    const s = useUpdaterStore.getState();
    expect(s.modalOpen).toBe(false);
    expect(s.available?.version).toBe("0.0.2");
  });

  it("clearToast clears the toast", () => {
    useUpdaterStore.setState({ toast: { version: "0.0.2" } });

    useUpdaterStore.getState().clearToast();

    expect(useUpdaterStore.getState().toast).toBeNull();
  });

  it("installUpdate downloads, installs and relaunches into the new build", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    relaunch.mockResolvedValue(undefined);
    useUpdaterStore.setState({
      available: {
        version: "0.0.2",
        notes: "",
        releaseUrl: "",
        update: { downloadAndInstall } as never,
      },
    });

    await useUpdaterStore.getState().installUpdate();

    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("installUpdate reports download progress from updater events", async () => {
    const snapshots: Array<{
      progress: { downloaded: number; total: number | null } | null;
      installPhase: "downloading" | "installing" | null;
    }> = [];
    const snap = () => {
      const s = useUpdaterStore.getState();
      snapshots.push({ progress: s.progress, installPhase: s.installPhase });
    };
    const downloadAndInstall = vi
      .fn()
      .mockImplementation(async (onEvent: (e: unknown) => void) => {
        onEvent({ event: "Started", data: { contentLength: 100 } });
        snap();
        onEvent({ event: "Progress", data: { chunkLength: 40 } });
        snap();
        onEvent({ event: "Progress", data: { chunkLength: 60 } });
        snap();
        onEvent({ event: "Finished" });
        snap();
      });
    relaunch.mockResolvedValue(undefined);
    useUpdaterStore.setState({
      available: {
        version: "0.0.2",
        notes: "",
        releaseUrl: "",
        update: { downloadAndInstall } as never,
      },
    });

    await useUpdaterStore.getState().installUpdate();

    expect(snapshots).toEqual([
      { progress: { downloaded: 0, total: 100 }, installPhase: "downloading" },
      { progress: { downloaded: 40, total: 100 }, installPhase: "downloading" },
      { progress: { downloaded: 100, total: 100 }, installPhase: "downloading" },
      { progress: { downloaded: 100, total: 100 }, installPhase: "installing" },
    ]);
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("installUpdate tracks bytes even when the server omits the total size", async () => {
    const downloadAndInstall = vi
      .fn()
      .mockImplementation(async (onEvent: (e: unknown) => void) => {
        onEvent({ event: "Started", data: {} });
        onEvent({ event: "Progress", data: { chunkLength: 25 } });
      });
    relaunch.mockResolvedValue(undefined);
    useUpdaterStore.setState({
      available: {
        version: "0.0.2",
        notes: "",
        releaseUrl: "",
        update: { downloadAndInstall } as never,
      },
    });

    await useUpdaterStore.getState().installUpdate();

    expect(useUpdaterStore.getState().progress).toEqual({ downloaded: 25, total: null });
  });

  it("installUpdate treats a zero content length as unknown", async () => {
    const downloadAndInstall = vi
      .fn()
      .mockImplementation(async (onEvent: (e: unknown) => void) => {
        onEvent({ event: "Started", data: { contentLength: 0 } });
        onEvent({ event: "Progress", data: { chunkLength: 25 } });
      });
    relaunch.mockResolvedValue(undefined);
    useUpdaterStore.setState({
      available: {
        version: "0.0.2",
        notes: "",
        releaseUrl: "",
        update: { downloadAndInstall } as never,
      },
    });

    await useUpdaterStore.getState().installUpdate();

    expect(useUpdaterStore.getState().progress).toEqual({ downloaded: 25, total: null });
  });

  it("installUpdate clears progress state when the install fails", async () => {
    const downloadAndInstall = vi
      .fn()
      .mockImplementation(async (onEvent: (e: unknown) => void) => {
        onEvent({ event: "Started", data: { contentLength: 100 } });
        onEvent({ event: "Progress", data: { chunkLength: 40 } });
        throw new Error("connection reset");
      });
    useUpdaterStore.setState({
      available: {
        version: "0.0.2",
        notes: "",
        releaseUrl: "",
        update: { downloadAndInstall } as never,
      },
    });

    await useUpdaterStore.getState().installUpdate();

    const s = useUpdaterStore.getState();
    expect(s.installing).toBe(false);
    expect(s.progress).toBeNull();
    expect(s.installPhase).toBeNull();
    expect(s.errorMessage).toBe("connection reset");
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("installUpdate is a no-op when no update is available", async () => {
    useUpdaterStore.setState({ available: null });

    await useUpdaterStore.getState().installUpdate();

    expect(relaunch).not.toHaveBeenCalled();
  });
});
