import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { History, Pin, PinOff, Play, Search } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import { useTabsStore } from "@/stores/tabsStore";
import { useSessionStatusStore } from "@/modules/claude-progress/lib/sessionStatusStore";
import { onSessionsUpdated, type SessionAgent, type SessionSummary } from "./lib/sessionsBridge";
import { useSessionsStore, visibleSessions } from "./lib/sessionsStore";
import { formatRelativeTime } from "./lib/relativeTime";
import { deriveLiveSessions, type LiveSession } from "./lib/liveSessions";
import { AGENT_BADGE_CLASS, agentBadgeClass } from "./lib/agentBadge";
import { resumeCommand, resumeSession } from "./lib/resume";

/** Filter chip order, "all" first. */
const AGENT_FILTERS: Array<SessionAgent | "all"> = ["all", "claude", "codex", "antigravity"];

/** Status dot color, same semantic tokens as WorkspacePanel's `STATUS_STYLE`
 *  badge (`src/modules/workspace/WorkspacePanel.tsx`) so a session reads the
 *  same way whether it's seen from the workspace cards or this sidebar. */
const STATUS_DOT_CLASS: Record<string, string> = {
  active: "bg-accent",
  thinking: "bg-fg-muted",
  "waiting-approval": "bg-danger",
  idle: "bg-warning",
};

/** The last path segment of a cwd, for the row's secondary line. Split on
 *  both separators so a Windows path (C:\...) basenames correctly too. */
function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** One running session pinned in the Live section: status dot, agent badge
 *  (when the pane's agent is already classified), and the tab it lives in.
 *  Clicking jumps straight to that pane. */
function LiveRow({ session }: { session: LiveSession }) {
  const { t } = useTranslation();
  const setActive = useTabsStore((s) => s.setActive);
  const setActiveLeaf = useTabsStore((s) => s.setActiveLeaf);

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          setActive(session.tabId);
          setActiveLeaf(session.tabId, session.leafId);
        }}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-elevated"
      >
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT_CLASS[session.status] ?? "bg-fg-subtle"}`}
        />
        {session.agent && (
          <span className={`shrink-0 text-[10px] font-medium uppercase ${agentBadgeClass(session.agent)}`}>
            {t(`sessions.agents.${session.agent}`)}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">{session.tabTitle}</span>
      </button>
    </li>
  );
}

/** Running agent sessions, pinned above the indexed history so jumping back
 *  to one in progress never waits for it to end and get indexed. Hidden
 *  entirely when nothing is currently running. */
function LiveSection() {
  const { t } = useTranslation();
  const tabs = useTabsStore((s) => s.tabs);
  const statuses = useSessionStatusStore((s) => s.statuses);
  const agents = useSessionStatusStore((s) => s.agents);
  const liveSessions = useMemo(
    () => deriveLiveSessions(tabs, statuses, agents),
    [tabs, statuses, agents],
  );

  if (liveSessions.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="px-3 py-1 text-[11px] font-semibold uppercase text-fg-subtle">
        {t("sessions.live")}
      </div>
      <ul>
        {liveSessions.map((session) => (
          <LiveRow key={session.leafId} session={session} />
        ))}
      </ul>
    </div>
  );
}

interface SessionRowProps {
  session: SessionSummary;
  selected: boolean;
}

function SessionRow({ session, selected }: SessionRowProps) {
  const { t } = useTranslation();
  const select = useSessionsStore((s) => s.select);
  const togglePin = useSessionsStore((s) => s.togglePin);
  const openSessionsTab = useTabsStore((s) => s.openSessionsTab);
  const pinLabel = t(session.pinned ? "sessions.unpin" : "sessions.pin");
  const resumeLabel = t("sessions.resume");
  // Rows have no room to explain an unsupported agent, so the button is
  // hidden outright here — the viewer header shows it disabled-with-tooltip
  // instead, since there's space there for the explanation.
  const canResume = resumeCommand(session.agent, session.id) !== null;

  return (
    <li className="group flex items-center">
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => {
          select(session.id);
          openSessionsTab();
        }}
        className={`flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left ${
          selected ? "bg-bg-elevated" : "hover:bg-bg-elevated"
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-sm text-fg-muted group-hover:text-fg">
              {session.title}
            </span>
            <span
              className={`shrink-0 text-[10px] font-medium uppercase ${AGENT_BADGE_CLASS[session.agent]}`}
            >
              {t(`sessions.agents.${session.agent}`)}
            </span>
          </div>
          <div className="truncate text-xs text-fg-subtle">
            {basename(session.project_cwd)} · {formatRelativeTime(session.ended_at, t)} ·{" "}
            {t("sessions.messages", { count: session.message_count })}
          </div>
        </div>
      </button>
      <div className="flex shrink-0 items-center opacity-0 pr-2 group-hover:opacity-100">
        {canResume && (
          <Tooltip label={resumeLabel}>
            <button
              type="button"
              aria-label={resumeLabel}
              onClick={(e) => {
                e.stopPropagation();
                resumeSession(session);
              }}
              className="rounded p-0.5 text-fg-subtle hover:bg-border-strong hover:text-fg"
            >
              <Play size={13} />
            </button>
          </Tooltip>
        )}
        <Tooltip label={pinLabel}>
          <button
            type="button"
            aria-label={pinLabel}
            onClick={(e) => {
              e.stopPropagation();
              void togglePin(session.id);
            }}
            className="rounded p-0.5 text-fg-subtle hover:bg-border-strong hover:text-fg"
          >
            {session.pinned ? <PinOff size={13} /> : <Pin size={13} />}
          </button>
        </Tooltip>
      </div>
    </li>
  );
}

export function SessionsPanel() {
  const { t } = useTranslation();
  const sessions = useSessionsStore((s) => s.sessions);
  const loaded = useSessionsStore((s) => s.loaded);
  const query = useSessionsStore((s) => s.query);
  const agentFilter = useSessionsStore((s) => s.agentFilter);
  const selectedId = useSessionsStore((s) => s.selectedId);
  const setQuery = useSessionsStore((s) => s.setQuery);
  const setAgentFilter = useSessionsStore((s) => s.setAgentFilter);

  useEffect(() => {
    void useSessionsStore.getState().start();

    // The subscription resolves asynchronously. If the panel unmounts before
    // it lands (fast sidebar-tab switching — the panel is conditionally
    // rendered), release the listener the moment it arrives instead of
    // leaking it for the rest of the app's lifetime.
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onSessionsUpdated(() => {
      void useSessionsStore.getState().refresh();
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const { pinned, history } = visibleSessions(sessions, query, agentFilter);
  const isEmpty = pinned.length === 0 && history.length === 0;

  return (
    <div className="flex h-full flex-col bg-bg-inset">
      <div className="flex h-9 shrink-0 items-center border-b border-border px-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          {t("nav.sessions")}
        </span>
      </div>

      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-2 py-1">
          <Search size={13} className="shrink-0 text-fg-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("sessions.searchPlaceholder")}
            aria-label={t("sessions.searchPlaceholder")}
            className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {AGENT_FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={agentFilter === key}
              onClick={() => setAgentFilter(key)}
              className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                agentFilter === key ? "bg-bg-elevated text-fg" : "text-fg-subtle hover:text-fg"
              }`}
            >
              {key === "all" ? t("sessions.all") : t(`sessions.agents.${key}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        <LiveSection />

        {!loaded ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <History size={28} className="text-fg-subtle" />
            <p className="text-xs text-fg-subtle">{t("sessions.indexing")}</p>
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <History size={28} className="text-fg-subtle" />
            <p className="text-xs text-fg-subtle">{t("sessions.empty")}</p>
          </div>
        ) : (
          <>
            {pinned.length > 0 && (
              <div>
                <div className="px-3 py-1 text-[11px] font-semibold uppercase text-fg-subtle">
                  {t("sessions.pinned")}
                </div>
                <ul>
                  {pinned.map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      selected={session.id === selectedId}
                    />
                  ))}
                </ul>
              </div>
            )}
            <ul>
              {history.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  selected={session.id === selectedId}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
