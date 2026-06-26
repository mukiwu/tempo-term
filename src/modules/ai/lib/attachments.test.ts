import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_MAX_BYTES,
  buildAttachmentsBlock,
  truncateContents,
} from "./attachments";

describe("truncateContents", () => {
  it("leaves short content untouched", () => {
    expect(truncateContents("hello")).toBe("hello");
  });

  it("truncates content past the limit and marks it", () => {
    const long = "x".repeat(ATTACHMENT_MAX_BYTES + 50);
    const result = truncateContents(long);
    expect(result.startsWith("x".repeat(ATTACHMENT_MAX_BYTES))).toBe(true);
    expect(result).toContain("[truncated]");
    expect(result.length).toBeLessThan(long.length);
  });

  it("respects a custom limit", () => {
    expect(truncateContents("abcdef", 3)).toBe("abc\n…[truncated]");
  });
});

describe("buildAttachmentsBlock", () => {
  it("returns an empty string when nothing is attached", () => {
    expect(buildAttachmentsBlock([])).toBe("");
  });

  it("includes each file's path and contents", () => {
    const block = buildAttachmentsBlock([
      { path: "/a/b.ts", contents: "const x = 1" },
      { path: "/a/c.ts", contents: "const y = 2" },
    ]);
    expect(block).toContain("/a/b.ts");
    expect(block).toContain("const x = 1");
    expect(block).toContain("/a/c.ts");
    expect(block).toContain("const y = 2");
  });

  it("truncates large attached files", () => {
    const block = buildAttachmentsBlock([
      { path: "/big.txt", contents: "y".repeat(ATTACHMENT_MAX_BYTES + 100) },
    ]);
    expect(block).toContain("[truncated]");
  });

  it("redacts secrets from attached files before they reach the model", () => {
    const block = buildAttachmentsBlock([
      { path: "/app/.env", contents: "TOKEN=ghp_16C7e42F292c6912E7710c838347Ae178B4a01" },
    ]);
    expect(block).toContain("[REDACTED]");
    expect(block).not.toContain("ghp_16C7e42F292c6912");
  });
});
