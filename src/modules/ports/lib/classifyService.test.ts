import { describe, expect, it } from "vitest";
import { classifyService, groupByProject } from "./classifyService";
import type { PortInfo } from "./portsBridge";

const info = (over: Partial<PortInfo>): PortInfo => ({
  port: 3000,
  protocol: "tcp",
  bindAddr: "127.0.0.1",
  pid: 1,
  processName: "node",
  command: null,
  cwd: null,
  cpuUsage: 0,
  memoryBytes: 0,
  uptimeSecs: 0,
  isCurrentUser: true,
  ...over,
});

describe("classifyService — plain-English service labels", () => {
  it("names the dev servers people actually run", () => {
    expect(classifyService(info({ command: "node /x/node_modules/.bin/vite --host" })).label).toBe("Vite dev server");
    expect(classifyService(info({ command: "node /x/node_modules/next/dist/bin/next dev" })).label).toBe("Next.js dev server");
    expect(classifyService(info({ command: "bun run --bun vite" })).label).toBe("Vite dev server");
    expect(classifyService(info({ processName: "python3.12", command: "python -m http.server 8000" })).label).toBe("Python server");
    expect(classifyService(info({ processName: "com.docker.backend", command: "/Applications/Docker.app/..." })).label).toBe("Docker");
    expect(classifyService(info({ processName: "postgres", command: "postgres -D /usr/local/var" })).label).toBe("PostgreSQL");
  });

  it("falls back to the runtime, then the raw process name", () => {
    expect(classifyService(info({ processName: "node", command: "node server.js" })).label).toBe("Node.js");
    expect(classifyService(info({ processName: "weird-daemon", command: null })).label).toBe("weird-daemon");
  });

  it("matches case-insensitively and never throws on junk", () => {
    expect(classifyService(info({ command: "NODE /X/VITE" })).label).toBe("Vite dev server");
    expect(() => classifyService(info({ processName: "", command: "" }))).not.toThrow();
  });
});

describe("groupByProject — stable two-level ordering", () => {
  it("groups by the cwd basename, projects sorted by name, ports by number", () => {
    const groups = groupByProject([
      info({ port: 8080, cwd: "/w/beta" }),
      info({ port: 3000, cwd: "/w/alpha" }),
      info({ port: 3001, cwd: "/w/alpha" }),
    ]);
    expect(groups.map((g) => g.name)).toEqual(["alpha", "beta"]);
    expect(groups[0].ports.map((p) => p.port)).toEqual([3000, 3001]);
  });

  it("puts cwd-less ports into a trailing catch-all group", () => {
    const groups = groupByProject([info({ port: 631, cwd: null }), info({ port: 3000, cwd: "/w/a" })]);
    expect(groups.map((g) => g.name)).toEqual(["a", null]);
    expect(groups[1].ports[0].port).toBe(631);
  });

  it("is deterministic regardless of input order", () => {
    const a = groupByProject([info({ port: 1, cwd: "/x/p" }), info({ port: 2, cwd: null }), info({ port: 3, cwd: "/x/q" })]);
    const b = groupByProject([info({ port: 3, cwd: "/x/q" }), info({ port: 2, cwd: null }), info({ port: 1, cwd: "/x/p" })]);
    expect(a).toEqual(b);
  });
});
