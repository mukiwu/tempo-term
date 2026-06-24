import { describe, expect, it } from "vitest";
import { extractCommand, sanitizeForInsertion } from "./command";

describe("extractCommand", () => {
  it("pulls the command from a bash fenced block", () => {
    expect(extractCommand("Run this:\n```bash\nnpm test\n```")).toBe("npm test");
  });

  it("treats a fenced block with no language as a shell command", () => {
    expect(extractCommand("```\nls -la\n```")).toBe("ls -la");
  });

  it("ignores non-shell fenced blocks", () => {
    expect(extractCommand('```json\n{"a":1}\n```')).toBeNull();
  });

  it("returns null when there is no fenced block", () => {
    expect(extractCommand("just prose, no code here")).toBeNull();
  });

  it("returns the first shell block when there are several", () => {
    const md = "First:\n```sh\necho one\n```\nThen:\n```bash\necho two\n```";
    expect(extractCommand(md)).toBe("echo one");
  });
});

describe("sanitizeForInsertion", () => {
  it("strips trailing newlines so the command does not auto-run", () => {
    expect(sanitizeForInsertion("npm test\n")).toBe("npm test");
    expect(sanitizeForInsertion("ls  \n\n")).toBe("ls");
  });

  it("strips a leading shell prompt marker", () => {
    expect(sanitizeForInsertion("$ npm test")).toBe("npm test");
    expect(sanitizeForInsertion("% pwd")).toBe("pwd");
  });
});
