import { describe, expect, it } from "vitest";
import { buildRemoteUri, isRemoteUri, parseRemoteUri } from "./remotePath";

describe("remotePath", () => {
  it("builds a uri with a leading slash on the path", () => {
    expect(buildRemoteUri("c1", "/home/me")).toBe("ssh://c1/home/me");
    expect(buildRemoteUri("c1", "home/me")).toBe("ssh://c1/home/me");
  });

  it("detects remote uris and rejects local paths", () => {
    expect(isRemoteUri("ssh://c1/home/me")).toBe(true);
    expect(isRemoteUri("/home/me")).toBe(false);
    expect(isRemoteUri("C:\\Users\\me")).toBe(false);
  });

  it("parses a uri back into its parts and round-trips", () => {
    expect(parseRemoteUri("ssh://c1/home/me/file.txt")).toEqual({
      connectionId: "c1",
      path: "/home/me/file.txt",
    });
    const uri = buildRemoteUri("conn_42", "/var/log");
    expect(parseRemoteUri(uri)).toEqual({ connectionId: "conn_42", path: "/var/log" });
  });

  it("returns null for a local path and root for a bare connection", () => {
    expect(parseRemoteUri("/home/me")).toBeNull();
    expect(parseRemoteUri("ssh://c1")).toEqual({ connectionId: "c1", path: "/" });
  });
});
