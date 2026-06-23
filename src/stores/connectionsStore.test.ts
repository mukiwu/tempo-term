import { describe, expect, it, beforeEach } from "vitest";
import { useConnectionsStore } from "./connectionsStore";

const base = {
  name: "box", host: "h", port: 22, user: "muki",
  authMethod: "password" as const, rememberSecret: false,
};

describe("connectionsStore", () => {
  beforeEach(() => useConnectionsStore.setState({ connections: [] }));

  it("adds a connection and returns its id", () => {
    const id = useConnectionsStore.getState().addConnection(base);
    expect(id).toBeTruthy();
    expect(useConnectionsStore.getState().getConnection(id)?.host).toBe("h");
  });

  it("updates a connection", () => {
    const id = useConnectionsStore.getState().addConnection(base);
    useConnectionsStore.getState().updateConnection(id, { host: "h2" });
    expect(useConnectionsStore.getState().getConnection(id)?.host).toBe("h2");
  });

  it("removes a connection", () => {
    const id = useConnectionsStore.getState().addConnection(base);
    useConnectionsStore.getState().removeConnection(id);
    expect(useConnectionsStore.getState().getConnection(id)).toBeUndefined();
  });

  it("never stores a secret field", () => {
    const id = useConnectionsStore.getState().addConnection(base);
    const conn = useConnectionsStore.getState().getConnection(id)!;
    expect(Object.keys(conn)).not.toContain("password");
    expect(Object.keys(conn)).not.toContain("passphrase");
  });
});
