import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Guard the release notes before a release starts.
 *
 * release.sh only checked that CHANGELOG-NEXT.md exists, never that it says
 * anything. An empty `###` section is not a cosmetic problem: the same file
 * becomes both the GitHub release body and the updater manifest's `notes`,
 * which the in-app "更新內容" prompt renders, so a forgotten heading ships to
 * every user. HTML comments cannot be used to leave a reminder in the template
 * either — react-markdown surfaces them as visible text in that prompt.
 *
 * @param {string} markdown
 * @returns {string[]} names of headings with no content under them
 */
export function findEmptySections(markdown) {
  // Strip HTML comments first: a comment is not content. Writing
  // `<!-- none this release -->` under an unused heading is the obvious instinct,
  // and it is exactly the thing that ships as visible text — so a section left
  // holding only a comment still counts as empty.
  const lines = markdown.replace(/<!--[\s\S]*?-->/g, "").split("\n");
  const empty = [];
  let current = null;
  let filled = false;

  const close = () => {
    if (current && !filled) {
      empty.push(current);
    }
  };

  for (const line of lines) {
    if (line.startsWith("### ")) {
      close();
      current = line.slice(4).trim();
      filled = false;
      continue;
    }
    // A top-level heading ends the section it follows without opening one.
    if (line.startsWith("## ")) {
      close();
      current = null;
      filled = false;
      continue;
    }
    if (current && line.trim()) {
      filled = true;
    }
  }
  close();
  return empty;
}

// CLI: node scripts/checkChangelog.mjs <changelogPath>
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [path] = process.argv.slice(2);
  if (!path) {
    process.stderr.write("usage: checkChangelog.mjs <changelogPath>\n");
    process.exit(1);
  }

  const empty = findEmptySections(readFileSync(path, "utf8"));
  if (empty.length > 0) {
    process.stderr.write(
      `✗ ${path} has empty sections: ${empty.join(", ")}\n` +
        "  Fill them in, or delete the heading — an empty one ships to the GitHub\n" +
        "  release body and the in-app update prompt as a stray title.\n",
    );
    process.exit(1);
  }
}
