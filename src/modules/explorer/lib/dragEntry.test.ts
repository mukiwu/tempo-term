import { describe, expect, it } from "vitest";
import { fileUrl, markdownLink, shellQuotePath } from "./dragEntry";

describe("shellQuotePath", () => {
  it("leaves simple paths unquoted", () => {
    expect(shellQuotePath("/Users/me/proj/App.tsx")).toBe("/Users/me/proj/App.tsx");
  });

  it("quotes paths containing spaces", () => {
    expect(shellQuotePath("/Users/me/My Project/a.md")).toBe(
      "'/Users/me/My Project/a.md'",
    );
  });

  it("escapes embedded single quotes", () => {
    expect(shellQuotePath("/a/it's/b")).toBe("'/a/it'\\''s/b'");
  });
});

describe("markdownLink", () => {
  it("builds a markdown link", () => {
    expect(markdownLink("App.tsx", "/x/App.tsx")).toBe("[App.tsx](/x/App.tsx)");
  });
});

describe("fileUrl", () => {
  it("prefixes file://", () => {
    expect(fileUrl("/x/index.html")).toBe("file:///x/index.html");
  });
});
