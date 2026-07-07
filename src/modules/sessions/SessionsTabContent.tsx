import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { History, Loader2, Pin, PinOff, Play } from "lucide-react";
import { MarkdownView } from "@/components/MarkdownView";
import { Tooltip } from "@/components/Tooltip";
import { sessionsGet, type TranscriptMessage } from "./lib/sessionsBridge";
import { useSessionsStore } from "./lib/sessionsStore";
import { formatRelativeTime } from "./lib/relativeTime";
import { AGENT_BADGE_CLASS } from "./lib/agentBadge";
import { resumeCommand, resumeSession } from "./lib/resume";

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
  const togglePin = useSessionsStore((s) => s.togglePin);

  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId) {
      setTranscript([]);
      setError(null);
      setLoading(false);
      return;
    }
    // `cancelled` scopes this fetch to the selectedId that triggered it: a
    // later selection change (or unmount) flips it before a stale resolution
    // can land, so it never overwrites state for a session the user has
    // already navigated away from.
    let cancelled = false;
    setLoading(true);
    setError(null);
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

  if (!selectedId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-bg-inset text-center text-fg-subtle">
        <History size={32} strokeWidth={1} />
        <p className="text-sm">{t("sessions.selectPrompt")}</p>
        <p className="text-xs">{t("sessions.totalCount", { count: sessions.length })}</p>
      </div>
    );
  }

  const session = sessions.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="flex h-full flex-col bg-bg">
      {session && (
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
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
          </div>
        </div>
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
        <div className="flex flex-col gap-3">
          {transcript.map((message, index) => (
            <TranscriptEntry key={index} message={message} />
          ))}
        </div>
      </div>
    </div>
  );
}
