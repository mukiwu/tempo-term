/**
 * Release notes ship as one bilingual block: a "## 正體中文" section followed by
 * a "## English" section (see the release-notes conventions), each with its own
 * "### feat"/"### fix" sub-sections. Rendered as-is the two languages run
 * straight into each other, so insert a horizontal rule before every top-level
 * (level-2) section except the first. Sub-sections and the first section are
 * left untouched.
 */
export function separateLanguageSections(notes: string): string {
  // Level-2 only: "## English" matches, "### feat" does not (the char after the
  // two hashes is "#", not whitespace).
  const isLanguageHeading = (line: string): boolean => /^##\s+\S/.test(line);

  const out: string[] = [];
  let seenFirst = false;

  for (const line of notes.split("\n")) {
    if (isLanguageHeading(line)) {
      if (seenFirst) {
        if (out.length > 0 && out[out.length - 1] !== "") {
          out.push("");
        }
        out.push("---", "");
      }
      seenFirst = true;
    }
    out.push(line);
  }

  return out.join("\n");
}
