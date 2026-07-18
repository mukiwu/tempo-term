import { waitFor } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";

const { isFocused, notifyDesktop } = vi.hoisted(() => ({
  isFocused: vi.fn(),
  notifyDesktop: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isFocused }),
}));
vi.mock("./notify", () => ({ notifyDesktop }));

import {
  installSessionNotifications,
  notificationForTransition,
  resolvePaneLabel,
} from "./sessionNotifications";
import { useSessionStatusStore } from "./sessionStatusStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabsStore } from "@/stores/tabsStore";
import { leaf } from "@/modules/terminal/lib/terminalLayout";
import { titleKey, useTitlesStore } from "@/modules/workspace/lib/titlesStore";

beforeEach(() => {
  isFocused.mockReset();
  isFocused.mockResolvedValue(false);
  notifyDesktop.mockReset();
  notifyDesktop.mockResolvedValue(undefined);
  useSessionStatusStore.setState({
    statuses: {},
    agents: {},
    sessionIds: {},
    statusEpochs: {},
  });
  useTitlesStore.setState({ titles: {}, fetchedFingerprints: {}, inFlight: {} });
});

describe("resolvePaneLabel", () => {
  it("uses the tab's own title when the user renamed it, even with a cwd", () => {
    const label = resolvePaneLabel(
      { renamed: true, title: "My Group" },
      "/Users/me/projects/api",
      undefined,
    );
    expect(label).toBe("My Group");
  });

  it("prefers the transcript title over the cwd when the tab is not renamed", () => {
    const label = resolvePaneLabel(
      { renamed: false, title: "api" },
      "/Users/me/projects/api",
      "Fix auth bug",
    );
    expect(label).toBe("Fix auth bug");
  });

  it("falls back to the cwd basename when no transcript title is known", () => {
    const label = resolvePaneLabel(
      { renamed: false, title: "Terminal" },
      "/Users/me/projects/api",
      undefined,
    );
    expect(label).toBe("api");
  });

  it("uses the tab title when there is no cwd and no transcript title", () => {
    const label = resolvePaneLabel({ renamed: false, title: "Scratch" }, null, undefined);
    expect(label).toBe("Scratch");
  });
});

describe("notificationForTransition", () => {
  it("notifies on entering waiting-approval from any prior state", () => {
    expect(notificationForTransition(undefined, "waiting-approval")).toBe("approval");
    expect(notificationForTransition("active", "waiting-approval")).toBe("approval");
    expect(notificationForTransition("thinking", "waiting-approval")).toBe("approval");
    expect(notificationForTransition("idle", "waiting-approval")).toBe("approval");
  });

  it("does not re-notify while already waiting-approval", () => {
    expect(notificationForTransition("waiting-approval", "waiting-approval")).toBeNull();
  });

  it("notifies done when active work returns to idle", () => {
    expect(notificationForTransition("active", "idle")).toBe("done");
    expect(notificationForTransition("thinking", "idle")).toBe("done");
  });

  it("stays quiet on the SessionStart idle (no prior work)", () => {
    expect(notificationForTransition(undefined, "idle")).toBeNull();
    expect(notificationForTransition("idle", "idle")).toBeNull();
  });

  it("does not notify on resuming work or approval clearing to idle", () => {
    expect(notificationForTransition("thinking", "active")).toBeNull();
    expect(notificationForTransition("waiting-approval", "active")).toBeNull();
    expect(notificationForTransition("waiting-approval", "idle")).toBeNull();
  });

  it("treats a cleared status (next undefined) as no notification", () => {
    expect(notificationForTransition("active", undefined)).toBeNull();
    expect(notificationForTransition("waiting-approval", undefined)).toBeNull();
  });
});

describe("session notification labels", () => {
  it("uses the exact session title when the leaf has a Claude session id", async () => {
    useSettingsStore.setState({ claudeNotifications: true });
    useTabsStore.setState({
      tabs: [
        {
          id: "tab-1",
          spaceId: "space-1",
          title: "shared",
          kind: "terminal",
          paneTree: leaf("leaf-1", { kind: "terminal", cwd: "/shared" }),
          activeLeafId: "leaf-1",
          paneOrder: ["leaf-1"],
        },
      ],
    });
    const store = useSessionStatusStore.getState();
    store.setAgent("leaf-1", "claude");
    store.setSessionId("leaf-1", "session-a");
    useTitlesStore.setState({
      titles: {
        [titleKey({ cwd: "/shared", agent: "claude", sessionId: "session-a" })]:
          "Session A title",
        [titleKey({ cwd: "/shared", agent: "claude", sessionId: "session-b" })]:
          "Session B title",
      },
    });

    const uninstall = installSessionNotifications();
    try {
      store.setStatus("leaf-1", "waiting-approval");
      await waitFor(() =>
        expect(notifyDesktop).toHaveBeenCalledWith(expect.any(String), "Session A title"),
      );
    } finally {
      uninstall();
    }
  });
});
