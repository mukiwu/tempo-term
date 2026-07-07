import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Download, Loader2, Pin, PinOff, Play, Trash2 } from "lucide-react";
import { MarkdownView } from "@/components/MarkdownView";
import { Tooltip } from "@/components/Tooltip";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { saveFile } from "@/lib/dialog";
import { fsWriteFile } from "@/modules/explorer/lib/fsBridge";
import { sessionsGet, type TranscriptMessage } from "./lib/sessionsBridge";
import { useSessionsStore } from "./lib/sessionsStore";
import { sessionsDelete, sessionsExport } from "./lib/statsBridge";
import { gitCommitsInRange, type CommitInfo } from "@/modules/source-control/lib/gitBridge";
import { formatRelativeTime } from "./lib/relativeTime";
import { AGENT_BADGE_CLASS } from "./lib/agentBadge";
import { resumeCommand, resumeSession } from "./lib/resume";
import { slugifyTitle } from "./lib/slug";
import { DashboardView } from "./DashboardView";
import { ProjectView } from "./ProjectView";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error";
}

/**
 * One transcript entry, styled by role instead of as a chat bubble: a left
 * accent bar marks the user's own turns, the assistant's replies render as
 * markdown, a tool call collapses behind its tool name, and system notices
 * are muted italic. Mirrors how `SessionRow` in SessionsPanel keeps chrome
 * minimal — this is a transcript, not a chat UI.
 */
function TranscriptEntry({ message }: { message: TranscriptMessage }) {
  const { t } = useTranslation();
  const timestamp = message.timestamp !== null ? formatRelativeTime(message.timestamp, t) : null;

  if (message.role === "tool") {
    return (
      <details className="rounded-md border border-border bg-bg-inset px-3 py-2">
        <summary className="cursor-pointer select-none text-xs font-medium text-fg-subtle">
          {message.tool_name ?? t("sessions.roles.tool")}
        </summary>
        <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-fg-muted">
          {message.text}
        </pre>
      </details>
    );
  }

  if (message.role === "injected") {
    // A harness-generated turn (teammate report, system reminder, …):
    // collapsed by default so long injected reports never bury the real
    // conversation; the expanded body renders as markdown.
    const source = message.tool_name ?? "teammate";
    return (
      <details className="rounded-md border border-border bg-bg-inset px-3 py-2">
        <summary className="cursor-pointer select-none text-xs font-medium text-fg-subtle">
          {t(`sessions.injected.${source}`)}
        </summary>
        <MarkdownView content={message.text} className="mt-2 text-sm" />
      </details>
    );
  }

  if (message.role === "system") {
    return <p className="text-xs italic text-fg-subtle">{message.text}</p>;
  }

  const isUser = message.role === "user";

  return (
    <div className={isUser ? "border-l-2 border-accent pl-3" : ""}>
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase text-fg-subtle">
        <span>{t(`sessions.roles.${message.role}`)}</span>
        {timestamp && <span className="font-normal normal-case">{timestamp}</span>}
      </div>
      {isUser ? (
        // The user's own words are never interpreted as markup.
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">{message.text}</p>
      ) : (
        // Assistant replies render through the shared markdown component, so
        // code blocks and tables look the same as notes and AI chat.
        <MarkdownView content={message.text} className="mt-1 text-sm" />
      )}
    </div>
  );
}

/**
 * Main-area tab that shows a single indexed session's full transcript,
 * re-parsed on demand from its source file (see sessionsBridge.sessionsGet —
 * message bodies are never cached in the index). Opened as a singleton via
 * `openSessionsTab`; which session it shows follows `useSessionsStore`'s
 * `selectedId`, set by clicking a row in the sidebar SessionsPanel.
 */
export function SessionsTabContent() {
  const { t } = useTranslation();
  const sessions = useSessionsStore((s) => s.sessions);
  const selectedId = useSessionsStore((s) => s.selectedId);
  const selectedProject = useSessionsStore((s) => s.selectedProject);
  const togglePin = useSessionsStore((s) => s.togglePin);
  const select = useSessionsStore((s) => s.select);

  const session = sessions.find((s) => s.id === selectedId) ?? null;

  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Delete is destructive (even if recoverable from the Trash), so a failure
  // must never pass silently: this renders an error line in the transcript
  // area, same style as `error` above, until the selection changes or a new
  // delete attempt replaces it.
  const [deleteError, setDeleteError] = useState(false);
  // Same treatment for export: a failed render or a failed disk write both
  // surface here rather than silently doing nothing.
  const [exportError, setExportError] = useState(false);
  // Commits made during the session's time window, for the correlation
  // section below the transcript. Empty (and hidden) when the cwd isn't a
  // git repo, or the fetch fails — same "quietly show nothing" contract as
  // `git_commits_in_range` itself.
  const [commits, setCommits] = useState<CommitInfo[]>([]);

  useEffect(() => {
    if (!selectedId) {
      setTranscript([]);
      setError(null);
      setLoading(false);
      setDeleteError(false);
      setExportError(false);
      return;
    }
    // `cancelled` scopes this fetch to the selectedId that triggered it: a
    // later selection change (or unmount) flips it before a stale resolution
    // can land, so it never overwrites state for a session the user has
    // already navigated away from.
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDeleteError(false);
    setExportError(false);
    sessionsGet(selectedId)
      .then((messages) => {
        if (cancelled) {
          return;
        }
        setTranscript(messages);
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        // Leave `transcript` untouched — keep showing whatever was already
        // loaded instead of blanking a transcript the user was reading.
        setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    let cancelled = false;
    if (!session) {
      setCommits([]);
      return;
    }
    gitCommitsInRange(session.project_cwd, session.started_at, session.ended_at)
      .then((c) => {
        if (!cancelled) {
          setCommits(c);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCommits([]);
        }
      });
    return () => {
      cancelled = true;
    };
    // Re-fetch when any input to the query changes, not just the session id:
    // an active session's `ended_at` grows as new messages arrive, so the
    // commit window must widen with it to pick up commits made mid-session.
  }, [session?.id, session?.project_cwd, session?.started_at, session?.ended_at]);

  if (selectedProject) {
    return <ProjectView />;
  }
  if (!selectedId) {
    return <DashboardView />;
  }

  // The header only ever shows the currently selected session, so a
  // successful delete always clears the selection and falls back to the
  // dashboard — unlike the sidebar row, which only clears it conditionally.
  async function handleDelete() {
    if (!session) {
      return;
    }
    setConfirmingDelete(false);
    try {
      await sessionsDelete(session.id);
    } catch {
      setDeleteError(true);
      return;
    }
    select(null);
  }

  // Renders the transcript to Markdown first, then asks where to save it —
  // a cancelled save dialog is a no-op, not an error, so nothing is written
  // and `exportError` stays clear.
  async function handleExport() {
    if (!session) {
      return;
    }
    setExportError(false);
    try {
      const markdown = await sessionsExport(session.id);
      const path = await saveFile(`${slugifyTitle(session.title)}.md`);
      if (path === null) {
        return;
      }
      await fsWriteFile(path, markdown);
    } catch {
      setExportError(true);
    }
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      {session && (
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
          <Tooltip label={t("sessions.dashboard.back")}>
            <button
              type="button"
              aria-label={t("sessions.dashboard.back")}
              onClick={() => select(null)}
              className="shrink-0 rounded p-1 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
            >
              <ArrowLeft size={14} />
            </button>
          </Tooltip>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-medium text-fg">{session.title}</h2>
              <span
                className={`shrink-0 text-[10px] font-medium uppercase ${AGENT_BADGE_CLASS[session.agent]}`}
              >
                {t(`sessions.agents.${session.agent}`)}
              </span>
            </div>
            <p className="truncate text-xs text-fg-subtle">{session.project_cwd}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/* Header keeps Resume visible-but-disabled for antigravity
                (tooltip explains why) instead of hiding it — rows hide it
                outright, since there's no room there for an explanation. */}
            <Tooltip
              label={
                resumeCommand(session.agent, session.id) === null
                  ? t("sessions.resumeUnavailable")
                  : t("sessions.resume")
              }
            >
              <button
                type="button"
                aria-label={t("sessions.resume")}
                disabled={resumeCommand(session.agent, session.id) === null}
                onClick={() => resumeSession(session)}
                className="rounded p-1 text-fg-subtle hover:bg-bg-elevated hover:text-fg disabled:pointer-events-none disabled:opacity-40"
              >
                <Play size={14} />
              </button>
            </Tooltip>
            <Tooltip label={t(session.pinned ? "sessions.unpin" : "sessions.pin")}>
              <button
                type="button"
                aria-label={t(session.pinned ? "sessions.unpin" : "sessions.pin")}
                onClick={() => void togglePin(session.id)}
                className="rounded p-1 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
              >
                {session.pinned ? <PinOff size={14} /> : <Pin size={14} />}
              </button>
            </Tooltip>
            <Tooltip label={t("sessions.export")}>
              <button
                type="button"
                aria-label={t("sessions.export")}
                onClick={() => void handleExport()}
                className="rounded p-1 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
              >
                <Download size={14} />
              </button>
            </Tooltip>
            <Tooltip label={t("sessions.delete")}>
              <button
                type="button"
                aria-label={t("sessions.delete")}
                onClick={() => {
                  // A fresh attempt supersedes any stale error from the last one.
                  setDeleteError(false);
                  setConfirmingDelete(true);
                }}
                className="rounded p-1 text-fg-subtle hover:bg-bg-elevated hover:text-danger"
              >
                <Trash2 size={14} />
              </button>
            </Tooltip>
          </div>
        </div>
      )}

      {confirmingDelete && session && (
        <ConfirmDialog
          title={t("sessions.delete")}
          message={t("sessions.deleteConfirm")}
          confirmLabel={t("sessions.delete")}
          cancelLabel={t("actions.cancel")}
          onConfirm={() => void handleDelete()}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading && (
          <div className="mb-3 flex items-center gap-2 text-xs text-fg-subtle">
            <Loader2 size={12} className="animate-spin" />
            <span>{t("sessions.loading")}</span>
          </div>
        )}
        {error && (
          <p className="mb-3 text-xs text-danger/80">
            {t("sessions.loadError")}: {error}
          </p>
        )}
        {deleteError && (
          <p className="mb-3 text-xs text-danger/80">{t("sessions.deleteError")}</p>
        )}
        {exportError && (
          <p className="mb-3 text-xs text-danger/80">{t("sessions.exportError")}</p>
        )}
        <div className="flex flex-col gap-3">
          {transcript.map((message, index) => (
            <TranscriptEntry key={index} message={message} />
          ))}
        </div>
        {commits.length > 0 && (
          <section className="mt-4 border-t border-border pt-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
              {t("sessions.commits.title")}
            </h2>
            <ul className="mt-2 flex flex-col gap-1">
              {commits.map((c) => (
                <li key={c.id} className="flex items-baseline gap-2 text-xs">
                  <span className="shrink-0 font-mono text-fg-subtle">{c.id}</span>
                  <span className="min-w-0 flex-1 truncate text-fg">{c.summary}</span>
                  <span className="shrink-0 text-fg-subtle">{c.author}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
