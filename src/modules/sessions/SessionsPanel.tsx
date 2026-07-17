import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { History, LayoutDashboard, Pin, PinOff, Play, Search, Trash2 } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Combobox } from "@/components/Combobox";
import { useTabsStore } from "@/stores/tabsStore";
import { useSessionStatusStore } from "@/modules/claude-progress/lib/sessionStatusStore";
import { onSessionsUpdated, type SessionAgent, type SessionSummary } from "./lib/sessionsBridge";
import { useSessionsStore, visibleSessions } from "./lib/sessionsStore";
import { sessionsDelete } from "./lib/statsBridge";
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
  /** Asks the panel to open its shared, panel-level delete confirmation for
   *  this session. Deletion is handled above the virtualized rows so the modal
   *  isn't trapped by a row's `transform` (which would become the containing
   *  block for its `position: fixed`) and doesn't vanish when the row scrolls
   *  out of the render window. */
  onRequestDelete: (session: SessionSummary) => void;
}

function SessionRow({ session, selected, onRequestDelete }: SessionRowProps) {
  const { t } = useTranslation();
  const select = useSessionsStore((s) => s.select);
  const selectProject = useSessionsStore((s) => s.selectProject);
  const togglePin = useSessionsStore((s) => s.togglePin);
  const openSessionsTab = useTabsStore((s) => s.openSessionsTab);
  const pinLabel = t(session.pinned ? "sessions.unpin" : "sessions.pin");
  const resumeLabel = t("sessions.resume");
  const deleteLabel = t("sessions.delete");
  // Rows have no room to explain an unsupported agent, so the button is
  // hidden outright here — the viewer header shows it disabled-with-tooltip
  // instead, since there's space there for the explanation.
  const canResume = resumeCommand(session.agent, session.id) !== null;

  return (
    <div role="listitem" className="group">
      <div className="flex items-center">
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
              {/* Nested inside the row's own select-session button, so a click
                  here must stop propagation or it would also select the
                  session; role="button" + a keydown handler keep it reachable
                  from the keyboard despite not being a real <button> (which
                  can't nest inside another button). An empty cwd has nothing
                  to route to (selectProject("") would fall through to the
                  dashboard), so it's skipped entirely rather than rendered as
                  a no-op link. */}
              {session.project_cwd && (
                <>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (session.project_cwd) {
                        selectProject(session.project_cwd);
                        openSessionsTab();
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        if (session.project_cwd) {
                          selectProject(session.project_cwd);
                          openSessionsTab();
                        }
                      }
                    }}
                    className="hover:text-fg hover:underline"
                  >
                    {basename(session.project_cwd)}
                  </span>{" "}
                  ·{" "}
                </>
              )}
              {formatRelativeTime(session.ended_at, t)} ·{" "}
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
          <Tooltip label={deleteLabel}>
            <button
              type="button"
              aria-label={deleteLabel}
              onClick={(e) => {
                e.stopPropagation();
                onRequestDelete(session);
              }}
              className="rounded p-0.5 text-fg-subtle hover:bg-border-strong hover:text-danger"
            >
              <Trash2 size={13} />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

/** Fixed row height (px) for the virtualized history list. The two-line row
 *  (title + meta) plus its vertical padding is a constant height, so a fixed
 *  size lets the virtualizer skip per-row measurement entirely. */
const HISTORY_ROW_HEIGHT = 48;

/** The indexed history list, virtualized. The user's transcript index can hold
 *  tens of thousands of sessions; rendering every row into the DOM froze the
 *  whole app for seconds on open (huge style-recalc + layout). This renders
 *  only the rows in view. It shares the panel's single scroll container (passed
 *  in as `scrollEl`) rather than owning its own, so the Live and pinned
 *  sections above it scroll together with the history; `scrollMargin` accounts
 *  for their height so item offsets line up. */
function HistoryList({
  sessions,
  selectedId,
  scrollEl,
  contentEl,
  onRequestDelete,
}: {
  sessions: SessionSummary[];
  selectedId: string | null;
  scrollEl: HTMLDivElement | null;
  /** The scroll container's inner content wrapper (Live + pinned + this list).
   *  Observed for resize so `scrollMargin` re-measures when the sections above
   *  change height — e.g. a Live session starts/ends. Those sections are
   *  sibling subtrees that re-render on their own store updates without
   *  re-rendering this component, so a plain layout effect would miss the
   *  shift and only self-correct on the next scroll. */
  contentEl: HTMLElement | null;
  onRequestDelete: (session: SessionSummary) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  // The list starts below the Live and pinned sections, so its offset from the
  // scroll container's top is the virtualizer's scrollMargin. A ref's offsetTop
  // can't be read during render, so measure it in a layout effect (on mount and
  // whenever the content wrapper resizes), guarded to only set state on a real
  // change.
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const top = listRef.current?.offsetTop ?? 0;
      setScrollMargin((prev) => (prev === top ? prev : top));
    };
    measure();
    if (!contentEl) {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(contentEl);
    return () => observer.disconnect();
  }, [contentEl]);
  const virtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => HISTORY_ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => sessions[index].id,
    scrollMargin,
  });

  const items = virtualizer.getVirtualItems();

  return (
    <div
      ref={listRef}
      role="list"
      style={{ height: virtualizer.getTotalSize(), position: "relative" }}
    >
      {items.map((item) => {
        const session = sessions[item.index];
        return (
          <div
            key={item.key}
            data-index={item.index}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: HISTORY_ROW_HEIGHT,
              transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
            }}
          >
            <SessionRow
              session={session}
              selected={session.id === selectedId}
              onRequestDelete={onRequestDelete}
            />
          </div>
        );
      })}
    </div>
  );
}

export function SessionsPanel() {
  const { t } = useTranslation();
  const sessions = useSessionsStore((s) => s.sessions);
  const loaded = useSessionsStore((s) => s.loaded);
  const query = useSessionsStore((s) => s.query);
  const agentFilter = useSessionsStore((s) => s.agentFilter);
  const modelFilter = useSessionsStore((s) => s.modelFilter);
  const selectedId = useSessionsStore((s) => s.selectedId);
  const setQuery = useSessionsStore((s) => s.setQuery);
  const setAgentFilter = useSessionsStore((s) => s.setAgentFilter);
  const setModelFilter = useSessionsStore((s) => s.setModelFilter);
  const select = useSessionsStore((s) => s.select);
  const openSessionsTab = useTabsStore((s) => s.openSessionsTab);
  // The virtualized history list reads its viewport from this scroll
  // container. It lives in state (not a ref) so setting it on mount triggers a
  // re-render, which is what lets the virtualizer pick up the element and
  // compute its first visible range.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  // The scroll container's inner content wrapper, handed to HistoryList so it
  // can observe height changes above the list. In state (not a ref) so the
  // observer effect re-runs once the element mounts.
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  // Delete confirmation is owned here, above the virtualized rows, rather than
  // inside each row: a row's `transform` would trap the modal's `position:
  // fixed`, and the row can unmount mid-dialog as it scrolls out of the render
  // window. `deleteFailed` keeps the dialog open with an inline error.
  const [pendingDelete, setPendingDelete] = useState<SessionSummary | null>(null);
  const [deleteFailed, setDeleteFailed] = useState(false);

  const requestDelete = (session: SessionSummary) => {
    setDeleteFailed(false);
    setPendingDelete(session);
  };

  async function confirmDelete() {
    const target = pendingDelete;
    if (!target) {
      return;
    }
    try {
      await sessionsDelete(target.id);
    } catch {
      setDeleteFailed(true);
      return;
    }
    setPendingDelete(null);
    if (selectedId === target.id) {
      select(null);
    }
  }

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
    })
      .catch(() => {
        // No listener, so the panel stops live-updating and shows what it
        // loaded. `void` on the chain started it without catching, which turned
        // a failed subscribe into an unhandled rejection.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Distinct non-null models seen across the loaded sessions, "all" first.
  // The dropdown is only worth showing once there's actually a choice to make.
  const modelOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) if (s.model) set.add(s.model);
    return ["all", ...[...set].sort()];
  }, [sessions]);

  // A selected model can drop out of the option list (its only session got
  // deleted or a refresh reshuffled the data). Once that happens the dropdown
  // that would let the user pick "all" again is hidden too (see the
  // `modelOptions.length > 1` gate below), so the list would otherwise be
  // stranded empty with no on-screen way back. Reset instead of leaving it
  // dangling.
  useEffect(() => {
    if (modelFilter !== "all" && !modelOptions.includes(modelFilter)) {
      setModelFilter("all");
    }
  }, [modelOptions, modelFilter, setModelFilter]);

  // Combobox takes a flat string list where the option string doubles as its
  // own label (see GitGraphToolbar's branch picker for the same pattern), so
  // "all" is displayed as its translated label and mapped back on change.
  const modelFilterAllLabel = t("sessions.modelFilterAll");
  const modelComboboxOptions = modelOptions.map((m) => (m === "all" ? modelFilterAllLabel : m));
  const modelComboboxValue = modelFilter === "all" ? modelFilterAllLabel : modelFilter;

  const { pinned, history } = visibleSessions(sessions, query, agentFilter, modelFilter);
  const isEmpty = pinned.length === 0 && history.length === 0;

  return (
    <div className="flex h-full flex-col bg-bg-inset">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          {t("nav.sessions")}
        </span>
        {/* Opens the sessions tab with nothing selected, i.e. the dashboard.
            Selecting a row also opens that tab but on the transcript viewer;
            this is the only way to reach the dashboard as the home screen.
            Shown as a labelled icon (not a hover-only tooltip) so it's a
            discoverable button. */}
        <button
          type="button"
          aria-label={t("sessions.dashboard.open")}
          onClick={() => {
            select(null);
            openSessionsTab();
          }}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-fg-subtle hover:bg-bg-elevated hover:text-fg"
        >
          <LayoutDashboard size={13} />
          {t("sessions.dashboard.open")}
        </button>
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
          {modelOptions.length > 1 && (
            <Combobox
              value={modelComboboxValue}
              options={modelComboboxOptions}
              onChange={(v) => setModelFilter(v === modelFilterAllLabel ? "all" : v)}
              ariaLabel={t("sessions.modelFilterLabel")}
              size="sm"
              className="ml-auto w-32"
            />
          )}
        </div>
      </div>

      <div ref={setScrollEl} className="relative min-h-0 flex-1 overflow-y-auto py-1">
        <div ref={setContentEl}>
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
                  <div role="list">
                    {pinned.map((session) => (
                      <SessionRow
                        key={session.id}
                        session={session}
                        selected={session.id === selectedId}
                        onRequestDelete={requestDelete}
                      />
                    ))}
                  </div>
                </div>
              )}
              <HistoryList
                sessions={history}
                selectedId={selectedId}
                scrollEl={scrollEl}
                contentEl={contentEl}
                onRequestDelete={requestDelete}
              />
            </>
          )}
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={t("sessions.delete")}
          message={t("sessions.deleteConfirm")}
          confirmLabel={t("sessions.delete")}
          cancelLabel={t("actions.cancel")}
          error={deleteFailed ? t("sessions.deleteError") : undefined}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
