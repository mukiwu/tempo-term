import { describe, expect, it } from "vitest";
import { collectQuickBlocks, extractCodeBlocks, SHELL_LANGS } from "./codeBlocks";
import type { NotesNode } from "./notesTree";

describe("extractCodeBlocks", () => {
  it("extracts fenced blocks with their language", () => {
    const md = [
      "# Title",
      "",
      "```bash",
      "git status",
      "```",
      "",
      "some prose",
      "",
      "```",
      "You are a helpful reviewer.",
      "Review the diff below.",
      "```",
    ].join("\n");
    expect(extractCodeBlocks(md)).toEqual([
      { lang: "bash", text: "git status" },
      { lang: "", text: "You are a helpful reviewer.\nReview the diff below." },
    ]);
  });

  it("skips empty and unterminated blocks", () => {
    const md = ["```sh", "```", "", "```bash", "echo unterminated"].join("\n");
    expect(extractCodeBlocks(md)).toEqual([]);
  });

  it("does not treat indented backticks inside a block as a closing fence", () => {
    const md = ["```js", "const s = `template`;", "```"].join("\n");
    expect(extractCodeBlocks(md)).toEqual([{ lang: "js", text: "const s = `template`;" }]);
  });
});

describe("collectQuickBlocks", () => {
  const tree: NotesNode[] = [
    {
      kind: "folder",
      name: "ops",
      path: "/notes/ops",
      children: [
        {
          kind: "note",
          name: "deploy.md",
          title: "deploy",
          path: "/notes/ops/deploy.md",
          isConflict: false,
        },
      ],
    },
    { kind: "note", name: "prompts.md", title: "prompts", path: "/notes/prompts.md", isConflict: false },
    { kind: "note", name: "empty.md", title: "empty", path: "/notes/empty.md", isConflict: false },
  ];
  const contents: Record<string, string> = {
    "/notes/ops/deploy.md": "```sh\nkubectl get pods\n```",
    "/notes/prompts.md": "```\nSummarize this file.\n```",
    "/notes/empty.md": "no fences here",
  };

  it("walks folders, keeps only notes with blocks, and labels groups by folder", async () => {
    const result = await collectQuickBlocks(tree, (path) => Promise.resolve(contents[path]));
    expect(result).toEqual([
      {
        path: "/notes/ops/deploy.md",
        title: "deploy",
        group: "ops",
        blocks: [{ lang: "sh", text: "kubectl get pods" }],
      },
      {
        path: "/notes/prompts.md",
        title: "prompts",
        group: "",
        blocks: [{ lang: "", text: "Summarize this file." }],
      },
    ]);
  });

  it("drops notes whose read fails instead of failing the whole scan", async () => {
    const result = await collectQuickBlocks(tree, (path) =>
      path === "/notes/prompts.md"
        ? Promise.reject(new Error("gone"))
        : Promise.resolve(contents[path]),
    );
    expect(result.map((n) => n.title)).toEqual(["deploy"]);
  });
});

describe("SHELL_LANGS", () => {
  it("treats the language-less block as runnable, matching the note editor", () => {
    expect(SHELL_LANGS.has("")).toBe(true);
    expect(SHELL_LANGS.has("bash")).toBe(true);
    expect(SHELL_LANGS.has("python")).toBe(false);
  });
});
