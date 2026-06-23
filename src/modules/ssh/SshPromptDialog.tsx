import { useState } from "react";
import { AlertTriangle, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSshPrompts } from "./lib/useSshPrompts";

/**
 * Renders one SSH prompt at a time from the global queue.
 * Handles four kinds:
 *   hostKeyUnknown  — new server; ask user to trust.
 *   hostKeyChanged  — fingerprint mismatch; strong MITM warning.
 *   password        — password auth; secret input + remember checkbox.
 *   passphrase      — private-key passphrase; secret input + remember checkbox.
 *
 * Mount once near the app root. It renders nothing when the queue is empty.
 */
export function SshPromptDialog() {
  const { t } = useTranslation("common");
  const { current, reply } = useSshPrompts();
  const [secret, setSecret] = useState("");
  const [remember, setRemember] = useState(false);

  if (!current) {
    return null;
  }

  function handleCancel() {
    if (!current) return;
    reply(current.id, { approved: false, secret: null, remember: false });
    setSecret("");
    setRemember(false);
  }

  function handleHostKeyTrust() {
    if (!current) return;
    reply(current.id, { approved: true, secret: null, remember: false });
  }

  function handleHostKeyReplace() {
    if (!current) return;
    reply(current.id, { approved: true, secret: null, remember: false });
  }

  function handleSecretSubmit() {
    if (!current) return;
    reply(current.id, { approved: true, secret, remember });
    setSecret("");
    setRemember(false);
  }

  const { kind, message } = current;

  return (
    <>
      <div className="fixed inset-0 z-[95] bg-black/60" onClick={handleCancel} />
      <div className="fixed left-1/2 top-1/2 z-[100] w-[480px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-elevated shadow-2xl">

        {/* hostKeyUnknown */}
        {kind === "hostKeyUnknown" && (
          <>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Lock size={16} className="shrink-0 text-fg-muted" />
              <span className="text-sm font-semibold text-fg">
                {t("sshPrompt.hostKeyUnknown.title")}
              </span>
            </div>
            <div className="px-4 py-4">
              <p className="mb-2 text-sm text-fg-muted">{t("sshPrompt.hostKeyUnknown.body")}</p>
              <code className="block rounded border border-border bg-bg-inset px-3 py-2 text-xs font-mono text-fg break-all">
                {message}
              </code>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-md px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
              >
                {t("sshPrompt.hostKeyUnknown.cancel")}
              </button>
              <button
                type="button"
                onClick={handleHostKeyTrust}
                className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white"
              >
                {t("sshPrompt.hostKeyUnknown.trust")}
              </button>
            </div>
          </>
        )}

        {/* hostKeyChanged — strong MITM warning */}
        {kind === "hostKeyChanged" && (
          <>
            <div className="flex items-center gap-2 border-b border-red-500/40 bg-red-500/10 px-4 py-3 rounded-t-xl">
              <AlertTriangle size={16} className="shrink-0 text-red-500" />
              <span className="text-sm font-semibold text-red-500">
                {t("sshPrompt.hostKeyChanged.title")}
              </span>
            </div>
            <div className="px-4 py-4">
              <p className="mb-3 text-sm text-red-400">
                {t("sshPrompt.hostKeyChanged.warning")}
              </p>
              <p className="mb-2 text-sm text-fg-muted">{t("sshPrompt.hostKeyChanged.body")}</p>
              <code className="block rounded border border-border bg-bg-inset px-3 py-2 text-xs font-mono text-fg break-all">
                {message}
              </code>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-md px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
              >
                {t("sshPrompt.hostKeyChanged.cancel")}
              </button>
              <button
                type="button"
                onClick={handleHostKeyReplace}
                className="rounded-md bg-red-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-600"
              >
                {t("sshPrompt.hostKeyChanged.replace")}
              </button>
            </div>
          </>
        )}

        {/* password */}
        {kind === "password" && (
          <>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Lock size={16} className="shrink-0 text-fg-muted" />
              <span className="text-sm font-semibold text-fg">
                {t("sshPrompt.password.title")}
              </span>
            </div>
            <div className="px-4 py-4">
              {message && (
                <p className="mb-3 text-xs text-fg-muted">{message}</p>
              )}
              <label className="mb-1 block text-xs font-medium text-fg-muted">
                {t("sshPrompt.password.label")}
              </label>
              <input
                type="password"
                autoFocus
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSecretSubmit(); }}
                className="w-full rounded border border-border bg-bg-inset px-3 py-1.5 text-sm text-fg outline-none focus:border-accent"
              />
              <label className="mt-3 flex items-center gap-2 text-xs text-fg-muted select-none cursor-pointer">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="accent-accent"
                />
                {t("sshPrompt.password.remember")}
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-md px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
              >
                {t("sshPrompt.password.cancel")}
              </button>
              <button
                type="button"
                onClick={handleSecretSubmit}
                className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white"
              >
                {t("sshPrompt.password.connect")}
              </button>
            </div>
          </>
        )}

        {/* passphrase */}
        {kind === "passphrase" && (
          <>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Lock size={16} className="shrink-0 text-fg-muted" />
              <span className="text-sm font-semibold text-fg">
                {t("sshPrompt.passphrase.title")}
              </span>
            </div>
            <div className="px-4 py-4">
              {message && (
                <p className="mb-3 text-xs text-fg-muted">{message}</p>
              )}
              <label className="mb-1 block text-xs font-medium text-fg-muted">
                {t("sshPrompt.passphrase.label")}
              </label>
              <input
                type="password"
                autoFocus
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSecretSubmit(); }}
                className="w-full rounded border border-border bg-bg-inset px-3 py-1.5 text-sm text-fg outline-none focus:border-accent"
              />
              <label className="mt-3 flex items-center gap-2 text-xs text-fg-muted select-none cursor-pointer">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="accent-accent"
                />
                {t("sshPrompt.passphrase.remember")}
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-md px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
              >
                {t("sshPrompt.passphrase.cancel")}
              </button>
              <button
                type="button"
                onClick={handleSecretSubmit}
                className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white"
              >
                {t("sshPrompt.passphrase.ok")}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
