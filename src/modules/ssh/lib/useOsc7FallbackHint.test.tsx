import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { remoteCwdStore } from "./remoteCwdStore";
import { useConnectionsStore } from "@/stores/connectionsStore";
import {
  OSC7_HINT_TIMEOUT_MS,
  resetShownThisSession,
  useOsc7FallbackHint,
} from "./useOsc7FallbackHint";

let lastHint: string | null = null;
let lastDismiss: () => void = () => {};

function Probe({ id }: { id: string | null }) {
  const { hintConnectionId, dismissHint } = useOsc7FallbackHint(id);
  lastHint = hintConnectionId;
  lastDismiss = dismissHint;
  return null;
}

function seedConnection(id: string, osc7HintDismissed?: boolean) {
  useConnectionsStore.setState({
    connections: [
      {
        id,
        name: id,
        host: "h",
        port: 22,
        user: "u",
        authMethod: "password",
        rememberSecret: false,
        osc7HintDismissed,
      },
    ],
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  remoteCwdStore.setState({ cwds: {} });
  resetShownThisSession();
  lastHint = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useOsc7FallbackHint", () => {
  it("fires once after the timeout when no OSC 7 report arrives", () => {
    seedConnection("c1");
    render(<Probe id="c1" />);
    act(() => vi.advanceTimersByTime(OSC7_HINT_TIMEOUT_MS));
    expect(lastHint).toBe("c1");
  });

  it("stays quiet when a report arrives before the timeout", () => {
    seedConnection("c1");
    render(<Probe id="c1" />);
    act(() => {
      remoteCwdStore.getState().report("c1", "/home/me");
      vi.advanceTimersByTime(OSC7_HINT_TIMEOUT_MS);
    });
    expect(lastHint).toBeNull();
  });

  it("never fires for a dismissed connection, and dismiss persists the flag", () => {
    seedConnection("c1");
    render(<Probe id="c1" />);
    act(() => vi.advanceTimersByTime(OSC7_HINT_TIMEOUT_MS));
    act(() => lastDismiss());
    expect(lastHint).toBeNull();
    expect(useConnectionsStore.getState().getConnection("c1")?.osc7HintDismissed).toBe(true);

    seedConnection("c2", true);
    render(<Probe id="c2" />);
    act(() => vi.advanceTimersByTime(OSC7_HINT_TIMEOUT_MS));
    expect(lastHint).toBeNull();
  });
});
