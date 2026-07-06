import { useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Combobox } from "@/components/Combobox";
import { parseSshCommand } from "@/modules/ssh/lib/parseSshCommand";
import { useConnectionsStore, type SshConnection, type PortForward } from "@/stores/connectionsStore";
import { useTabsStore } from "@/stores/tabsStore";
import type { SshAuthMethod } from "@/modules/ssh/lib/parseSshCommand";
import { pickFile } from "@/lib/dialog";
import { useOverlayGuard } from "@/lib/overlayGuard";
import { OSC7_SNIPPET } from "./lib/osc7Snippet";

interface ConnectionFormProps {
  /** When provided, the form is in edit mode pre-filled from this connection. */
  connection?: SshConnection;
  onClose: () => void;
}

interface FormState {
  name: string;
  host: string;
  port: string;
  user: string;
  authMethod: SshAuthMethod;
  keyPath: string;
  secret: string;
  remember: boolean;
  portForwards: PortForward[];
}

function blankForm(): FormState {
  return {
    name: "",
    host: "",
    port: "22",
    user: "",
    authMethod: "password",
    keyPath: "",
    secret: "",
    remember: false,
    portForwards: [],
  };
}

function fromConnection(conn: SshConnection): FormState {
  return {
    name: conn.name,
    host: conn.host,
    port: String(conn.port),
    user: conn.user,
    authMethod: conn.authMethod,
    keyPath: conn.keyPath ?? "",
    secret: "",
    remember: conn.rememberSecret,
    portForwards: conn.portForwards ?? [],
  };
}

/** Persist the connection to the store and return its id. */
async function persistConnection(
  form: FormState,
  existingId: string | undefined,
  addConnection: (input: Omit<SshConnection, "id">) => string,
  updateConnection: (id: string, patch: Partial<Omit<SshConnection, "id">>) => void,
): Promise<string> {
  const profile: Omit<SshConnection, "id"> = {
    name: form.name.trim() || form.host.trim(),
    host: form.host.trim(),
    port: parseInt(form.port, 10) || 22,
    user: form.user.trim(),
    authMethod: form.authMethod,
    keyPath: form.authMethod === "keyFile" ? form.keyPath.trim() || undefined : undefined,
    rememberSecret: form.remember,
    portForwards: form.portForwards,
  };

  if (existingId) {
    updateConnection(existingId, profile);
    return existingId;
  }
  return addConnection(profile);
}

/** Write the secret to keyring only when the user opted in. Never logs the secret. */
async function maybeStoreSecret(
  connectionId: string,
  secret: string,
  remember: boolean,
  authMethod: SshAuthMethod,
): Promise<void> {
  if (!remember || !secret || authMethod === "agent") {
    return;
  }
  await invoke("ssh_secret_set", { connectionId, secret });
}

/** Delete the keyring entry (best-effort; silently ignored on failure). */
async function maybeDeleteSecret(connectionId: string): Promise<void> {
  try {
    await invoke("ssh_secret_delete", { connectionId });
  } catch {
    // not stored — ignore
  }
}

const AUTH_METHOD_OPTIONS: SshAuthMethod[] = ["password", "keyFile", "agent"];

export function ConnectionForm({ connection, onClose }: ConnectionFormProps) {
  const { t } = useTranslation("common");

  // Mounted only while open, so guard unconditionally to hide the preview webview.
  useOverlayGuard(true);

  const addConnection = useConnectionsStore((s) => s.addConnection);
  const updateConnection = useConnectionsStore((s) => s.updateConnection);
  const openSshTab = useTabsStore((s) => s.openSshTab);

  const [form, setForm] = useState<FormState>(
    connection ? fromConnection(connection) : blankForm(),
  );
  const [pasteInput, setPasteInput] = useState("");
  const [pasteIgnored, setPasteIgnored] = useState<string[]>([]);
  const [pasteWarnings, setPasteWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [showOsc7, setShowOsc7] = useState(false);
  const [osc7Copied, setOsc7Copied] = useState(false);

  const isEdit = !!connection;

  function handlePasteChange(value: string) {
    setPasteInput(value);
    if (!value.trim()) {
      setPasteIgnored([]);
      setPasteWarnings([]);
      return;
    }
    try {
      const { draft, ignored, warnings } = parseSshCommand(value);
      setPasteIgnored(ignored);
      setPasteWarnings(warnings);
      // Merge draft into form — only overwrite fields the draft provides
      setForm((prev) => ({
        ...prev,
        ...(draft.name !== undefined ? { name: draft.name } : {}),
        ...(draft.host !== undefined ? { host: draft.host } : {}),
        ...(draft.port !== undefined ? { port: String(draft.port) } : {}),
        ...(draft.user !== undefined ? { user: draft.user } : {}),
        ...(draft.authMethod !== undefined ? { authMethod: draft.authMethod } : {}),
        ...(draft.keyPath !== undefined ? { keyPath: draft.keyPath } : {}),
      }));
    } catch {
      // Ignore parse errors — garbage input should not crash the form
    }
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const id = await persistConnection(form, connection?.id, addConnection, updateConnection);
      await maybeStoreSecret(id, form.secret, form.remember, form.authMethod);
      // In edit mode, if remember is unchecked and previously was checked, clear keyring
      if (isEdit && !form.remember) {
        await maybeDeleteSecret(id);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleConnect() {
    if (saving) return;
    setSaving(true);
    try {
      const id = await persistConnection(form, connection?.id, addConnection, updateConnection);
      await maybeStoreSecret(id, form.secret, form.remember, form.authMethod);
      // In edit mode, if remember is unchecked and previously was checked, clear keyring
      if (isEdit && !form.remember) {
        await maybeDeleteSecret(id);
      }
      const name = form.name.trim() || form.host.trim();
      openSshTab(id, name);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const showSecret = form.authMethod !== "agent";
  const secretLabel =
    form.authMethod === "keyFile"
      ? t("connectionForm.fields.passphrase")
      : t("connectionForm.fields.secret");
  const rememberLabel =
    form.authMethod === "keyFile"
      ? t("connectionForm.fields.rememberPassphrase")
      : t("connectionForm.fields.remember");

  const authMethodDisplayOptions = AUTH_METHOD_OPTIONS.map(
    (m) => t(`connectionForm.authMethod.${m}`),
  );
  const authMethodDisplay = t(`connectionForm.authMethod.${form.authMethod}`);

  function handleAuthMethodChange(display: string) {
    const idx = authMethodDisplayOptions.indexOf(display);
    if (idx !== -1) {
      setField("authMethod", AUTH_METHOD_OPTIONS[idx]);
    }
  }

  function addForward() {
    const newForward: PortForward = {
      id: crypto.randomUUID(),
      mode: "local",
      bindHost: "127.0.0.1",
      localPort: 0,
      destHost: "",
      destPort: 0,
      enabled: true,
    };
    setForm((prev) => ({ ...prev, portForwards: [...prev.portForwards, newForward] }));
  }

  function removeForward(id: string) {
    setForm((prev) => ({
      ...prev,
      portForwards: prev.portForwards.filter((pf) => pf.id !== id),
    }));
  }

  function updateForward<K extends keyof PortForward>(id: string, key: K, value: PortForward[K]) {
    setForm((prev) => ({
      ...prev,
      portForwards: prev.portForwards.map((pf) =>
        pf.id === id ? { ...pf, [key]: value } : pf,
      ),
    }));
  }

  const hasPasteNotes = pasteIgnored.length > 0 || pasteWarnings.length > 0;

  return (
    <>
      <div className="fixed inset-0 z-[95] bg-black/60" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[100] w-[520px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-elevated shadow-2xl">

        {/* Header */}
        <div className="flex items-center border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-fg">
            {isEdit ? t("connectionForm.titleEdit") : t("connectionForm.titleCreate")}
          </span>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto px-4 py-4 space-y-4">

          {/* Paste box */}
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">
              {t("connectionForm.pasteLabel")}
            </label>
            <input
              type="text"
              value={pasteInput}
              onChange={(e) => handlePasteChange(e.target.value)}
              placeholder={t("connectionForm.pastePlaceholder")}
              className="w-full rounded border border-border bg-bg-inset px-3 py-1.5 text-sm text-fg outline-none focus:border-accent font-mono"
            />
            <p className="mt-1 text-xs text-fg-subtle">{t("connectionForm.pasteHint")}</p>
            {hasPasteNotes && (
              <ul className="mt-2 space-y-0.5">
                {pasteIgnored.map((msg) => (
                  <li key={msg} className="text-xs text-fg-muted">
                    <span className="font-medium">{t("connectionForm.ignoredPrefix")}</span>{" "}
                    {msg}
                  </li>
                ))}
                {pasteWarnings.map((msg) => (
                  <li key={msg} className="text-xs text-yellow-500">
                    {msg}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-border" />

          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">
              {t("connectionForm.fields.name")}
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder={form.host || "my-server"}
              className="w-full rounded border border-border bg-bg-inset px-3 py-1.5 text-sm text-fg outline-none focus:border-accent"
            />
          </div>

          {/* Host + Port */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-fg-muted">
                {t("connectionForm.fields.host")}
              </label>
              <input
                type="text"
                value={form.host}
                onChange={(e) => setField("host", e.target.value)}
                placeholder="example.com"
                className="w-full rounded border border-border bg-bg-inset px-3 py-1.5 text-sm text-fg outline-none focus:border-accent"
              />
            </div>
            <div className="w-24">
              <label className="mb-1 block text-xs font-medium text-fg-muted">
                {t("connectionForm.fields.port")}
              </label>
              <input
                type="number"
                value={form.port}
                onChange={(e) => setField("port", e.target.value)}
                min={1}
                max={65535}
                className="w-full rounded border border-border bg-bg-inset px-3 py-1.5 text-sm text-fg outline-none focus:border-accent"
              />
            </div>
          </div>

          {/* User */}
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">
              {t("connectionForm.fields.user")}
            </label>
            <input
              type="text"
              value={form.user}
              onChange={(e) => setField("user", e.target.value)}
              placeholder="root"
              className="w-full rounded border border-border bg-bg-inset px-3 py-1.5 text-sm text-fg outline-none focus:border-accent"
            />
          </div>

          {/* Auth method */}
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">
              {t("connectionForm.fields.authMethod")}
            </label>
            <Combobox
              value={authMethodDisplay}
              options={authMethodDisplayOptions}
              onChange={handleAuthMethodChange}
              ariaLabel={t("connectionForm.fields.authMethod")}
            />
          </div>

          {/* Key path — only when authMethod = keyFile */}
          {form.authMethod === "keyFile" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">
                {t("connectionForm.fields.keyPath")}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={form.keyPath}
                  onChange={(e) => setField("keyPath", e.target.value)}
                  placeholder="~/.ssh/id_ed25519"
                  className="min-w-0 flex-1 rounded border border-border bg-bg-inset px-3 py-1.5 text-sm text-fg outline-none focus:border-accent font-mono"
                />
                <button
                  type="button"
                  onClick={() => {
                    void pickFile().then((file) => {
                      if (file) setField("keyPath", file);
                    });
                  }}
                  className="shrink-0 rounded border border-border px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-inset hover:text-fg"
                >
                  {t("connectionForm.browse")}
                </button>
              </div>
            </div>
          )}

          {/* Secret input — hidden for agent */}
          {showSecret && (
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">
                {secretLabel}
              </label>
              <input
                type="password"
                value={form.secret}
                onChange={(e) => setField("secret", e.target.value)}
                className="w-full rounded border border-border bg-bg-inset px-3 py-1.5 text-sm text-fg outline-none focus:border-accent"
              />
              <label className="mt-2 flex items-center gap-2 text-xs text-fg-muted select-none cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.remember}
                  onChange={(e) => setField("remember", e.target.checked)}
                  className="accent-accent"
                />
                {rememberLabel}
              </label>
            </div>
          )}

          <div className="border-t border-border" />

          {/* Port forwarding */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-fg-muted">
                {t("connectionForm.portForwards.sectionLabel")}
              </span>
              <button
                type="button"
                onClick={addForward}
                className="rounded border border-border px-2 py-1 text-xs text-fg-muted hover:bg-bg-inset hover:text-fg"
              >
                {t("connectionForm.portForwards.addButton")}
              </button>
            </div>

            {form.portForwards.length > 0 && (
              <div className="space-y-2">
                {form.portForwards.map((pf) => (
                  <div
                    key={pf.id}
                    className="rounded border border-border bg-bg-inset p-2 space-y-2"
                  >
                    {/* Row 1: bindHost + localPort */}
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="mb-1 block text-xs text-fg-subtle">
                          {t("connectionForm.portForwards.bindHost")}
                        </label>
                        <input
                          type="text"
                          value={pf.bindHost}
                          onChange={(e) => updateForward(pf.id, "bindHost", e.target.value)}
                          className="w-full rounded border border-border bg-bg px-2 py-1 text-xs text-fg outline-none focus:border-accent font-mono"
                        />
                      </div>
                      <div className="w-24">
                        <label className="mb-1 block text-xs text-fg-subtle">
                          {t("connectionForm.portForwards.localPort")}
                        </label>
                        <input
                          type="number"
                          value={pf.localPort}
                          min={0}
                          max={65535}
                          onChange={(e) =>
                            updateForward(pf.id, "localPort", parseInt(e.target.value, 10) || 0)
                          }
                          className="w-full rounded border border-border bg-bg px-2 py-1 text-xs text-fg outline-none focus:border-accent"
                        />
                      </div>
                    </div>

                    {/* Row 2: destHost + destPort */}
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="mb-1 block text-xs text-fg-subtle">
                          {t("connectionForm.portForwards.destHost")}
                        </label>
                        <input
                          type="text"
                          value={pf.destHost}
                          onChange={(e) => updateForward(pf.id, "destHost", e.target.value)}
                          className="w-full rounded border border-border bg-bg px-2 py-1 text-xs text-fg outline-none focus:border-accent font-mono"
                        />
                      </div>
                      <div className="w-24">
                        <label className="mb-1 block text-xs text-fg-subtle">
                          {t("connectionForm.portForwards.destPort")}
                        </label>
                        <input
                          type="number"
                          value={pf.destPort}
                          min={0}
                          max={65535}
                          onChange={(e) =>
                            updateForward(pf.id, "destPort", parseInt(e.target.value, 10) || 0)
                          }
                          className="w-full rounded border border-border bg-bg px-2 py-1 text-xs text-fg outline-none focus:border-accent"
                        />
                      </div>
                    </div>

                    {/* Row 3: enabled + remove */}
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-xs text-fg-muted select-none cursor-pointer">
                        <input
                          type="checkbox"
                          checked={pf.enabled}
                          onChange={(e) => updateForward(pf.id, "enabled", e.target.checked)}
                          className="accent-accent"
                        />
                        {t("connectionForm.portForwards.enabled")}
                      </label>
                      <button
                        type="button"
                        onClick={() => removeForward(pf.id)}
                        className="rounded px-2 py-0.5 text-xs text-fg-muted hover:bg-bg hover:text-fg"
                      >
                        {t("connectionForm.portForwards.removeButton")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border" />

          {/* OSC 7 / follow remote cd */}
          <div>
            <button
              type="button"
              onClick={() => setShowOsc7((v) => !v)}
              className="text-xs font-medium text-fg-muted hover:text-fg"
            >
              {showOsc7 ? "▾" : "▸"} {t("connectionForm.osc7.toggle")}
            </button>
            {showOsc7 && (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-fg-subtle">
                  {t("connectionForm.osc7.explanation")}
                </p>
                <pre className="overflow-x-auto rounded border border-border bg-bg-inset p-2 text-[11px] leading-relaxed text-fg-muted font-mono">
                  {OSC7_SNIPPET}
                </pre>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(OSC7_SNIPPET);
                    setOsc7Copied(true);
                  }}
                  className="rounded border border-border px-2 py-1 text-xs text-fg-muted hover:bg-bg-inset hover:text-fg"
                >
                  {osc7Copied
                    ? t("connectionForm.osc7.copied")
                    : t("connectionForm.osc7.copy")}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
          >
            {t("connectionForm.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-md border border-border px-4 py-1.5 text-xs font-medium text-fg hover:bg-bg-inset disabled:opacity-50"
          >
            {t("connectionForm.save")}
          </button>
          <button
            type="button"
            onClick={() => void handleConnect()}
            disabled={saving}
            className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {t("connectionForm.connect")}
          </button>
        </div>
      </div>
    </>
  );
}
