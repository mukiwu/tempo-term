import { useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Pencil, Plus, Server, Trash2 } from "lucide-react";
import { useConnectionsStore, type SshConnection } from "@/stores/connectionsStore";
import { useTabsStore } from "@/stores/tabsStore";
import { ConnectionForm } from "@/modules/ssh/ConnectionForm";

interface ConnectionRowProps {
  connection: SshConnection;
  onEdit: (conn: SshConnection) => void;
  onDelete: (conn: SshConnection) => void;
}

function ConnectionRow({ connection, onEdit, onDelete }: ConnectionRowProps) {
  const { t } = useTranslation("common");
  const openSshTab = useTabsStore((s) => s.openSshTab);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function handleRowClick() {
    openSshTab(connection.id, connection.name);
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

  return (
    <li className="group flex items-center">
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
    </li>
  );
}

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
