import { describe, expect, it } from "vitest";
import { createLowlight } from "lowlight";
import { bashCommandHighlight } from "./bashCommandHighlight";

interface HastNode {
  type: string;
  value?: string;
  properties?: { className?: string[] };
  children?: HastNode[];
}

const lowlight = createLowlight();
lowlight.register("bash", bashCommandHighlight);

/** Flatten lowlight output to (scope, text) pairs; scope inherits from the nearest hljs-* span. */
function tokens(code: string): Array<{ scope: string | null; text: string }> {
  const tree = lowlight.highlight("bash", code) as unknown as HastNode;
  const out: Array<{ scope: string | null; text: string }> = [];
  const walk = (node: HastNode, scope: string | null): void => {
    if (node.type === "text") {
      out.push({ scope, text: node.value ?? "" });
      return;
    }
    const className = node.properties?.className;
    const next = className && className.length > 0 ? className.join(" ") : scope;
    for (const child of node.children ?? []) {
      walk(child, next);
    }
  };
  walk(tree, null);
  return out;
}

/** Scope of the first token whose trimmed text equals `word`. */
function scopeOf(code: string, word: string): string | null {
  const match = tokens(code).find((token) => token.text.trim() === word);
  return match ? match.scope : null;
}

describe("bashCommandHighlight", () => {
  it("colors an external command at the start of a line", () => {
    expect(scopeOf("ssh alan@192.168.1.122", "ssh")).toBe("hljs-built_in");
  });

  it("colors git as a command", () => {
    expect(scopeOf("git push origin main", "git")).toBe("hljs-built_in");
  });

  it("keeps coloring known builtins", () => {
    expect(scopeOf("cd 文件/projects/", "cd")).toBe("hljs-built_in");
  });

  it("colors a custom script invocation", () => {
    expect(scopeOf("./deploy.sh --prod", "./deploy.sh")).toBe("hljs-built_in");
  });

  it("colors the command after a pipe", () => {
    expect(scopeOf("echo hi | grep h", "grep")).toBe("hljs-built_in");
  });

  it("skips env assignments and the sudo prefix", () => {
    expect(scopeOf("FOO=bar sudo docker ps", "docker")).toBe("hljs-built_in");
  });

  it("preserves string highlighting", () => {
    expect(scopeOf('echo "hi"', '"hi"')).toBe("hljs-string");
  });

  it("preserves variable highlighting", () => {
    expect(scopeOf("echo $f", "$f")).toBe("hljs-variable");
  });

  it("does not misclassify shell keywords as commands", () => {
    expect(scopeOf("if true; then echo hi; fi", "if")).toBe("hljs-keyword");
    expect(scopeOf("for f in list; do echo x; done", "for")).toBe("hljs-keyword");
    expect(scopeOf("while read l; do echo x; done", "while")).toBe("hljs-keyword");
  });
});
