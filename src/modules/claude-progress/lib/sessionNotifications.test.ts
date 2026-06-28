import { describe, it, expect } from "vitest";
import { notificationForTransition } from "./sessionNotifications";

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
