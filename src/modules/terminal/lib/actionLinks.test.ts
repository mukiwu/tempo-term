import { describe, expect, it } from "vitest";
import {
  actionsFor,
  findActionLinks,
  isDangerousCommand,
  type ActionLinkMatch,
} from "./actionLinks";

function match(text: string, kind: ActionLinkMatch["kind"]): ActionLinkMatch {
  return { text, start: 0, end: text.length, kind };
}

describe("findActionLinks", () => {
  it("detects an IPv4 address", () => {
    const matches = findActionLinks("trying 192.168.1.1 now");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ text: "192.168.1.1", kind: "ip" });
  });

  it("detects a host:port pair", () => {
    const matches = findActionLinks("curl example.com:8080/health");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ text: "example.com:8080", kind: "host-port" });
  });

  it("does not treat key:number pairs like error:42 as host:port", () => {
    expect(findActionLinks("error:42 occurred")).toHaveLength(0);
  });

  it("treats an IP with a port as a single host:port, not a bare IP", () => {
    const matches = findActionLinks("listening on 192.168.1.1:8080");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ text: "192.168.1.1:8080", kind: "host-port" });
  });

  it("detects archive filenames", () => {
    expect(findActionLinks("got backup.tar.gz here")[0]).toMatchObject({
      text: "backup.tar.gz",
      kind: "archive",
    });
    expect(findActionLinks("data.zip")[0]).toMatchObject({ text: "data.zip", kind: "archive" });
  });

  it("keeps only the longest match when entities overlap (e.g. 1.2.3.4.zip)", () => {
    const matches = findActionLinks("downloaded 1.2.3.4.zip ok");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ text: "1.2.3.4.zip", kind: "archive" });
  });
});

describe("actionsFor", () => {
  it("offers network actions for an IP", () => {
    const cmds = actionsFor(match("10.0.0.1", "ip")).map((a) => a.command);
    expect(cmds).toContain("ping 10.0.0.1");
    expect(cmds).toContain("ssh 10.0.0.1");
  });

  it("offers connection actions for a host:port, splitting host and port for nc", () => {
    const cmds = actionsFor(match("example.com:8080", "host-port")).map((a) => a.command);
    expect(cmds).toContain("curl http://example.com:8080");
    expect(cmds).toContain("nc example.com 8080");
  });

  it("offers the right extract command per archive type, with the filename quoted", () => {
    const extract = (f: string) => actionsFor(match(f, "archive")).map((a) => a.command);
    expect(extract("data.zip")).toContain("unzip 'data.zip'");
    expect(extract("backup.tar.gz")).toContain("tar -xzf 'backup.tar.gz'");
    expect(extract("photos.tgz")).toContain("tar -xzf 'photos.tgz'");
    expect(extract("logs.tar")).toContain("tar -xf 'logs.tar'");
    expect(extract("blob.7z")).toContain("7z x 'blob.7z'");
  });

  it("offers a list-contents action for archives", () => {
    expect(actionsFor(match("data.zip", "archive")).map((a) => a.command)).toContain(
      "unzip -l 'data.zip'",
    );
    expect(actionsFor(match("backup.tar.gz", "archive")).map((a) => a.command)).toContain(
      "tar -tzf 'backup.tar.gz'",
    );
  });
});

describe("isDangerousCommand", () => {
  it("flags destructive commands", () => {
    expect(isDangerousCommand("rm -rf /")).toBe(true);
    expect(isDangerousCommand("sudo rm -rf node_modules")).toBe(true);
    expect(isDangerousCommand("dd if=/dev/zero of=/dev/sda")).toBe(true);
    expect(isDangerousCommand("mkfs.ext4 /dev/sda1")).toBe(true);
    expect(isDangerousCommand("curl http://get.example.sh | sh")).toBe(true);
    expect(isDangerousCommand("rm --recursive --force /tmp/x")).toBe(true);
  });

  it("treats the safe action commands as not dangerous", () => {
    expect(isDangerousCommand("ping 1.2.3.4")).toBe(false);
    expect(isDangerousCommand("unzip data.zip")).toBe(false);
    expect(isDangerousCommand("tar -xzf backup.tar.gz")).toBe(false);
    expect(isDangerousCommand("curl http://example.com:8080")).toBe(false);
  });
});
