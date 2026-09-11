import { describe, expect, it } from "vitest";
import { filterPorts } from "./filterPorts";
import type { PortInfo } from "./portsBridge";

const port: PortInfo = {
  port: 5173,
  protocol: "tcp",
  bindAddr: "127.0.0.1",
  pid: 42,
  processName: "node",
  command: "node /work/tempo/node_modules/vite/bin/vite.js",
  cwd: "/work/tempo",
  cpuUsage: 1,
  memoryBytes: 2048,
  uptimeSecs: 90,
  isCurrentUser: true,
};

describe("filterPorts", () => {
  it.each(["5173", ":5173", "127.0.0.1", "42", "VITE DEV", "node", "/WORK/TEMPO", "tcp"])(
    "matches %s across visible identity and detail fields",
    (query) => expect(filterPorts([port], query)).toEqual([port]),
  );

  it("trims the query and returns the original list for an empty query", () => {
    const ports = [port];
    expect(filterPorts(ports, "  tempo  ")).toEqual(ports);
    expect(filterPorts(ports, "   ")).toBe(ports);
  });

  it("returns no rows when no field matches", () => {
    expect(filterPorts([port], "postgres")).toEqual([]);
  });
});
