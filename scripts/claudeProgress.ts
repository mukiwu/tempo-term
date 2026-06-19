/**
 * Demo runner for the Claude Code progress interceptor.
 *
 * Reads one session transcript (JSONL), feeds each line through the normalizer,
 * and prints the resulting progress events in a human-readable form. This is the
 * "see the data flow" tracer for the feature; the real UI will consume the same
 * normalized events.
 *
 *   npx vite-node scripts/claudeProgress.ts <path-to-session.jsonl>
 */
import { readFileSync } from "node:fs";
import {
  createNormalizer,
  type ProgressEvent,
} from "../src/modules/claude-progress/lib/normalize.ts";

function formatEvent(event: ProgressEvent): string {
  switch (event.kind) {
    case "tool:start":
      return `  ▶ tool   ${event.name}`;
    case "tool:end":
      return `  ${event.ok ? "✓" : "✗"} tool   ${event.name}`;
    case "subagent:start":
      return `⤷ subagent ${event.agentType}  「${event.description}」`;
    case "subagent:end": {
      const secs = (event.durationMs / 1000).toFixed(1);
      return `${event.ok ? "✓" : "✗"} subagent ${event.agentType}  ${secs}s  ${event.tokens} tok  ${event.toolUseCount} tools`;
    }
    case "todo": {
      const done = event.items.filter((item) => item.status === "completed").length;
      return `☑ todo     ${done}/${event.items.length} done`;
    }
    case "idle":
      return `… idle     (waiting for input)`;
  }
}

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: vite-node scripts/claudeProgress.ts <path-to-session.jsonl>");
    process.exit(1);
  }

  const normalizer = createNormalizer();
  const lines = readFileSync(path, "utf8").split("\n");
  let count = 0;
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    for (const event of normalizer.push(line)) {
      console.log(formatEvent(event));
      count += 1;
    }
  }
  console.error(`\n(${count} progress events from ${lines.length} transcript lines)`);
}

main();
