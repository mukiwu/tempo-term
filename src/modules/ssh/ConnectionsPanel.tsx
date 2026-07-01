import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Columns2, Pencil, Plus, Server, SquarePlus, Trash2 } from "lucide-react";
import { useConnectionsStore, type SshConnection, type PortForward } from "@/stores/connectionsStore";
import { useTabsStore } from "@/stores/tabsStore";
import { ConnectionForm } from "@/modules/ssh/ConnectionForm";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { InfoDialog } from "@/components/InfoDialog";
import { useLiveSessionsStore } from "@/modules/ssh/lib/liveSessionsStore";
import { useForwardStatusStore } from "@/modules/ssh/lib/forwardStatusStore";
import { startForward, stopForward } from "@/modules/ssh/lib/ssh-bridge";
import { beginSshDrag, consumeSshDragClick, useSshDragStore } from "@/modules/ssh/lib/sshDrag";

// ─── Status dot ───────────────────────────────────────────────────────────────

type DotColor = "green" | "red" | "grey";

interface StatusDotProps {
  color: DotColor;
  title?: string;
}

function StatusDot({ color, title }: StatusDotProps) {
  const colorClass =
    color === "green"
      ? "bg-green-500"
      : color === "red"
        ? "bg-red-500"
        : "bg-fg-subtle";
  return (
    <span
      title={title}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${colorClass}`}
    />
  );
}

// ─── Single forward row ────────────────────────────────────────────────────────

interface ForwardRowProps {
  sessionId: number;
  forward: PortForward;
}

function ForwardRow({ sessionId, forward }: ForwardRowProps) {
  const { t } = useTranslation("common");
  const status = useForwardStatusStore((s) => s.getStatus(sessionId, forward.id));

  const isActive = status?.state === "active";
  const isFailed = status?.state === "failed";
  const dotColor: DotColor = isActive ? "green" : isFailed ? "red" : "grey";
  const dotTitle = isFailed
    ? `${t("connectionsPanel.forwards.statusFailed")}: ${status?.error ?? ""}`
    : isActive
      ? t("connectionsPanel.forwards.statusActive")
      : t("connectionsPanel.forwards.statusStopped");

  async function handleToggle() {
    if (isActive) {
      await stopForward(sessionId, forward.id);
    } else {
      await startForward(sessionId, {
        id: forward.id,
        bindHost: forward.bindHost,
        localPort: forward.localPort,
        destHost: forward.destHost,
        destPort: forward.destPort,
      });
    }
  }

  return (
    <li className="flex items-center gap-2 py-0.5 pl-8 pr-2 text-xs text-fg-subtle">
      <StatusDot color={dotColor} title={dotTitle} />
      <span className="min-w-0 flex-1 truncate font-mono">
        {forward.localPort} → {forward.destHost}:{forward.destPort}
      </span>
      <button
        type="button"
        title={isActive ? t("connectionsPanel.forwards.toggleOff") : t("connectionsPanel.forwards.toggleOn")}
        aria-label={isActive ? t("connectionsPanel.forwards.toggleOff") : t("connectionsPanel.forwards.toggleOn")}
        onClick={() => void handleToggle()}
        className="shrink-0 rounded px-1 py-0.5 hover:bg-border-strong hover:text-fg"
      >
        {isActive ? "■" : "▶"}
      </button>
    </li>
  );
}

// ─── Forwards grouped under one session ───────────────────────────────────────

interface SessionForwardsProps {
  sessionId: number;
  forwards: PortForward[];
  /** Show a "Session N" label when there are multiple live sessions. */
  showSessionLabel: boolean;
}

function SessionForwards({ sessionId, forwards, showSessionLabel }: SessionForwardsProps) {
  const { t } = useTranslation("common");

  if (forwards.length === 0) {
    return null;
  }

  return (
    <ul>
      {showSessionLabel && (
        <li className="py-0.5 pl-6 pr-2 text-xs text-fg-subtle opacity-60">
          {t("connectionsPanel.forwards.session", { id: sessionId })}
        </li>
      )}
      {forwards.map((fwd) => (
        <ForwardRow key={fwd.id} sessionId={sessionId} forward={fwd} />
      ))}
    </ul>
  );
}

// Stable empty array — returned by the selector when a connection has no live
// sessions, so zustand's Object.is check doesn't see a new [] on every render.
const EMPTY_SESSIONS: number[] = [];

// ─── Connection row ────────────────────────────────────────────────────────────

interface ConnectionRowProps {
  connection: SshConnection;
  onEdit: (conn: SshConnection) => void;
  onDelete: (conn: SshConnection) => void;
}

function ConnectionRow({ connection, onEdit, onDelete }: ConnectionRowProps) {
  const { t } = useTranslation("common");
  const openFromSidebar = useTabsStore((s) => s.openFromSidebar);
  const openInNewTab = useTabsStore((s) => s.openInNewTab);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [dialog, setDialog] = useState<"none" | "already-connected" | "at-capacity">("none");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // Subscribe to live sessions for this connection. Use a direct field lookup
  // with a stable EMPTY_SESSIONS fallback so the selector returns the same
  // reference when unchanged, avoiding spurious re-renders on every store update.
  const sessionIds = useLiveSessionsStore((s) => s.sessions[connection.id] ?? EMPTY_SESSIONS);
  const hasLiveSessions = sessionIds.length > 0;
  const hasForwards = (connection.portForwards?.length ?? 0) > 0;
  const showForwards = hasLiveSessions && hasForwards;
  const showSessionLabels = sessionIds.length > 1;

  // A boolean selector, not the raw id, so only the row that actually
  // matches re-renders when a drag is blocked or cleared — every other row
  // would otherwise re-render on every change to this shared store field.
  const isBlocked = useSshDragStore((s) => s.blockedConnectionId === connection.id);
  useEffect(() => {
    if (isBlocked) {
      setDialog("already-connected");
      useSshDragStore.getState().clearBlockedConnectionId();
    }
  }, [isBlocked]);

  function handleRowClick() {
    if (consumeSshDragClick()) {
      return;
    }
    const result = openFromSidebar(
      { kind: "terminal", ssh: { connectionId: connection.id } },
      connection.name,
    );
    if (result.status === "already-connected") {
      setDialog("already-connected");
    } else if (result.status === "at-capacity") {
      setDialog("at-capacity");
    }
  }

  function handleDeleteClick(e: React.MouseEvent) {
    e.stopPropagation();
    setConfirmingDelete(true);
  }

  function handleConfirmDelete(e: React.MouseEvent) {
    e.stopPropagation();
    onDelete(connection);
    setConfirmingDelete(false);
  }

  function handleCancelDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setConfirmingDelete(false);
  }

  function handleEditClick(e: React.MouseEvent) {
    e.stopPropagation();
    onEdit(connection);
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  function handleOpenInNewTab() {
    const result = openInNewTab(
      { kind: "terminal", ssh: { connectionId: connection.id } },
      connection.name,
    );
    if (result.status === "already-connected") {
      setDialog("already-connected");
    }
  }

  return (
    <li
      onContextMenu={handleContextMenu}
      onPointerDown={(e) => beginSshDrag(connection.id, connection.name, e)}
    >
      <div className="group flex items-center">
        <button
          type="button"
          onClick={handleRowClick}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-elevated"
        >
          <Server size={14} className="shrink-0 text-fg-subtle" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-fg-muted group-hover:text-fg">
              {connection.name}
            </div>
            <div className="truncate text-xs text-fg-subtle">
              {connection.user ? `${connection.user}@${connection.host}` : connection.host}
              {connection.port !== 22 ? `:${connection.port}` : ""}
            </div>
          </div>
        </button>

        {confirmingDelete ? (
          <div className="flex shrink-0 items-center gap-1 pr-2">
            <button
              type="button"
              onClick={handleConfirmDelete}
              className="rounded px-1.5 py-0.5 text-xs font-medium text-danger hover:bg-border-strong"
            >
              {t("connectionsPanel.confirmDelete")}
            </button>
            <button
              type="button"
              onClick={handleCancelDelete}
              className="rounded px-1.5 py-0.5 text-xs text-fg-muted hover:bg-border-strong hover:text-fg"
            >
              {t("connectionsPanel.cancelDelete")}
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 pr-2">
            <button
              type="button"
              aria-label={t("connectionsPanel.edit")}
              title={t("connectionsPanel.edit")}
              onClick={handleEditClick}
              className="rounded p-0.5 text-fg-subtle hover:bg-border-strong hover:text-fg"
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              aria-label={t("connectionsPanel.delete")}
              title={t("connectionsPanel.delete")}
              onClick={handleDeleteClick}
              className="rounded p-0.5 text-fg-subtle hover:bg-border-strong hover:text-danger"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>

      {showForwards && (
        <div>
          {sessionIds.map((sessionId) => (
            <SessionForwards
              key={sessionId}
              sessionId={sessionId}
              forwards={connection.portForwards ?? []}
              showSessionLabel={showSessionLabels}
            />
          ))}
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              id: "open",
              label: t("connectionsPanel.open"),
              icon: Columns2,
              group: 0,
              onSelect: handleRowClick,
            } satisfies ContextMenuItem,
            {
              id: "openInNewTab",
              label: t("connectionsPanel.openInNewTab"),
              icon: SquarePlus,
              group: 0,
              onSelect: handleOpenInNewTab,
            } satisfies ContextMenuItem,
          ]}
        />
      )}

      {dialog === "already-connected" && (
        <InfoDialog
          title={t("connectionsPanel.title")}
          message={t("connectionsPanel.alreadyOpenAlert", { name: connection.name })}
          confirmLabel={t("actions.confirm")}
          onConfirm={() => setDialog("none")}
        />
      )}
      {dialog === "at-capacity" && (
        <InfoDialog
          title={t("connectionsPanel.title")}
          message={t("paneCapacityAlert")}
          confirmLabel={t("actions.confirm")}
          onConfirm={() => setDialog("none")}
        />
      )}
    </li>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function ConnectionsPanel() {
  const { t } = useTranslation("common");
  const connections = useConnectionsStore((s) => s.connections);
  const removeConnection = useConnectionsStore((s) => s.removeConnection);

  const [formOpen, setFormOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<SshConnection | undefined>(undefined);

  function openNewForm() {
    setEditingConnection(undefined);
    setFormOpen(true);
  }

  function openEditForm(conn: SshConnection) {
    setEditingConnection(conn);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingConnection(undefined);
  }

  async function handleDelete(conn: SshConnection) {
    removeConnection(conn.id);
    try {
      await invoke("ssh_secret_delete", { connectionId: conn.id });
    } catch {
      // Not stored in keyring — ignore
    }
  }

  return (
    <div className="flex h-full flex-col bg-bg-inset">
      {/* Header */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          {t("connectionsPanel.title")}
        </span>
        <button
          type="button"
          aria-label={t("connectionsPanel.newConnection")}
          title={t("connectionsPanel.newConnection")}
          onClick={openNewForm}
          className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
        >
          <Plus size={15} />
        </button>
      </div>

      {/* List or empty state */}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {connections.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <Server size={28} className="text-fg-subtle" />
            <div>
              <p className="text-sm font-medium text-fg-muted">
                {t("connectionsPanel.emptyTitle")}
              </p>
              <p className="mt-1 text-xs text-fg-subtle">
                {t("connectionsPanel.emptyHint")}
              </p>
            </div>
            <button
              type="button"
              onClick={openNewForm}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-fg-muted hover:bg-bg-elevated hover:text-fg"
            >
              <Plus size={13} />
              {t("connectionsPanel.newConnection")}
            </button>
          </div>
        ) : (
          <ul>
            {connections.map((conn) => (
              <ConnectionRow
                key={conn.id}
                connection={conn}
                onEdit={openEditForm}
                onDelete={(c) => void handleDelete(c)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Connection form modal */}
      {formOpen && (
        <ConnectionForm connection={editingConnection} onClose={closeForm} />
      )}
    </div>
  );
}
