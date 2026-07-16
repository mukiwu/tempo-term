import type { SessionStatus } from "@/modules/claude-progress/lib/sessionStatus";

/** Dot color per status — the same semantic tokens the WorkspacePanel badge and
 *  the SessionsPanel dot use, so a status reads the same everywhere. */
const DOT_CLASS: Record<SessionStatus, string> = {
  active: "bg-accent",
  thinking: "bg-fg-muted",
  "waiting-approval": "bg-danger",
  idle: "bg-warning",
};

const RING_CLASS: Record<"active" | "thinking", string> = {
  active: "border-accent",
  thinking: "border-fg-muted",
};

/**
 * A small status badge pinned to the top-right of a dock strip icon, aggregating
 * agent activity for that panel. A working agent (active / thinking) spins a
 * ring; one waiting for the user (waiting-approval) pulses; idle is a quiet dot.
 * The parent must be `relative`.
 */
export function StatusStripDot({ status }: { status: SessionStatus }) {
  const working = status === "active" || status === "thinking";
  return (
    <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-2 w-2 items-center justify-center">
      {working && (
        <span
          className={`absolute inset-[-2.5px] rounded-full border ${RING_CLASS[status]} border-r-transparent motion-safe:animate-spin`}
        />
      )}
      <span
        className={`h-2 w-2 rounded-full ${DOT_CLASS[status]} ${
          status === "waiting-approval" ? "motion-safe:animate-pulse" : ""
        } ring-2 ring-bg-inset`}
      />
    </span>
  );
}
