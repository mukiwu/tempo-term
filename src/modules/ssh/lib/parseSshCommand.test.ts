import { describe, expect, it } from "vitest";
import { parseSshCommand } from "./parseSshCommand";

describe("parseSshCommand", () => {
  it("parses user@host", () => {
    const r = parseSshCommand("ssh muki@example.com");
    expect(r.draft).toMatchObject({ user: "muki", host: "example.com", port: 22 });
  });

  it("parses -p port", () => {
    expect(parseSshCommand("ssh -p 2222 muki@h").draft.port).toBe(2222);
  });

  it("parses -i key as keyFile auth", () => {
    const r = parseSshCommand("ssh -i ~/.ssh/id_ed25519 muki@h");
    expect(r.draft.authMethod).toBe("keyFile");
    expect(r.draft.keyPath).toBe("~/.ssh/id_ed25519");
  });

  it("parses -l user", () => {
    expect(parseSshCommand("ssh -l muki h").draft.user).toBe("muki");
  });

  it("reports deferred flags as ignored", () => {
    const r = parseSshCommand("ssh -L 8080:localhost:80 -J b muki@h");
    expect(r.ignored.join(" ")).toMatch(/-L/);
    expect(r.ignored.join(" ")).toMatch(/-J/);
  });

  it("defaults name to host when absent", () => {
    expect(parseSshCommand("ssh muki@example.com").draft.name).toBe("example.com");
  });

  it("returns empty draft for a non-ssh string", () => {
    expect(parseSshCommand("hello world").draft).toEqual({});
    expect(parseSshCommand("hello world").warnings.length).toBeGreaterThan(0);
  });
});
