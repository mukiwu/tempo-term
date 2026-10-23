import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";

/** One trusted host key, as `ssh_known_hosts_list` returns it. */
interface KnownHost {
  host: string;
  keyType: string;
  fingerprint: string;
}

/**
 * The SSH hosts whose keys the user trusted at their first connection. Removing
 * one makes the next connection show the fingerprint prompt again, which is
 * how a legitimately changed server key is accepted.
 */
export function SshSettingsSection() {
  const { t } = useTranslation("settings");
  const [hosts, setHosts] = useState<KnownHost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<KnownHost | null>(null);

  function load() {
    invoke<KnownHost[]>("ssh_known_hosts_list")
      .then((list) => {
        setHosts(list);
        setError(null);
      })
      .catch((e: unknown) => setError(String(e)));
  }

  useEffect(load, []);

  async function remove(host: KnownHost) {
    try {
      await invoke("ssh_known_hosts_remove", { host: host.host });
      setRemoving(null);
      load();
    } catch (e) {
      setError(String(e));
      setRemoving(null);
    }
  }

  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-fg-subtle">
        {t("sections.ssh")}
      </h2>
      <h3 className="mb-1 text-sm font-medium text-fg">{t("ssh.knownHostsTitle")}</h3>
      <p className="mb-3 text-xs text-fg-muted">{t("ssh.knownHostsDescription")}</p>

      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      {hosts === null ? null : hosts.length === 0 ? (
        <p className="rounded-md border border-border px-3 py-3 text-xs text-fg-subtle">
          {t("ssh.knownHostsEmpty")}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {hosts.map((host) => (
            <li key={host.host} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-fg">{host.host}</div>
                <div className="truncate font-mono text-[11px] text-fg-subtle">
                  {host.keyType} {host.fingerprint}
                </div>
              </div>
              <button
                type="button"
                aria-label={t("ssh.removeHost", { host: host.host })}
                onClick={() => setRemoving(host)}
                className="rounded p-1 text-fg-subtle transition-colors hover:bg-bg-elevated hover:text-danger"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {removing && (
        <ConfirmDialog
          title={t("ssh.removeTitle")}
          message={t("ssh.removeMessage", { host: removing.host })}
          confirmLabel={t("ssh.removeConfirm")}
          cancelLabel={t("ssh.removeCancel")}
          onConfirm={() => void remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </section>
  );
}
