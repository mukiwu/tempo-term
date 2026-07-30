import { describe, expect, it } from "vitest";

// @ts-expect-error - plain .mjs release helper, no type declarations
import { findEmptySections } from "./checkChangelog.mjs";

const TEMPLATE = `## 正體中文

### feat

### fix

### 貢獻者

## English

### feat

### fix

### Contributors
`;

describe("findEmptySections", () => {
  it("reports every heading in the untouched template", () => {
    expect(findEmptySections(TEMPLATE)).toEqual([
      "feat",
      "fix",
      "貢獻者",
      "feat",
      "fix",
      "Contributors",
    ]);
  });

  it("passes a fully filled changelog", () => {
    const filled = TEMPLATE.replace(/(### (?:feat|fix|貢獻者|Contributors))\n/g, "$1\n\n- entry\n");
    expect(findEmptySections(filled)).toEqual([]);
  });

  // The common real shape: a release with no external contributors deletes that
  // heading rather than leaving it blank.
  it("passes when an unused section is deleted instead of left blank", () => {
    const noContributors = `## 正體中文

### fix

- 修好一個東西 (#1)

## English

### fix

- Fix a thing (#1)
`;
    expect(findEmptySections(noContributors)).toEqual([]);
  });

  it("names only the empty heading when its siblings are filled", () => {
    const oneBlank = `## 正體中文

### feat

- 新東西 (#2)

### 貢獻者

## English

### feat

- A thing (#2)
`;
    expect(findEmptySections(oneBlank)).toEqual(["貢獻者"]);
  });

  it("does not treat a following top-level heading as content", () => {
    expect(findEmptySections("### fix\n\n## English\n")).toEqual(["fix"]);
  });
});
