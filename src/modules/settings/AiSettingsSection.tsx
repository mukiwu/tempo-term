import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, KeyRound } from "lucide-react";
import { PROVIDERS } from "@/modules/ai/lib/providers";
import {
  secretsDeleteKey,
  secretsHasKey,
  secretsSetKey,
} from "@/modules/ai/lib/aiBridge";

function ProviderKeyRow({ id, label, needsKey }: { id: string; label: string; needsKey: boolean }) {
  const { t } = useTranslation("settings");
  const [hasKey, setHasKey] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  const refresh = () => {
    if (needsKey) {
      secretsHasKey(id).then(setHasKey).catch(() => setHasKey(false));
    }
  };

  useEffect(refresh, [id, needsKey]);

  return (
    <div className="flex items-center gap-3 border-b border-border py-3 last:border-b-0">
      <KeyRound size={15} className="shrink-0 text-fg-subtle" />
      <span className="w-32 shrink-0 text-sm text-fg">{label}</span>

      {!needsKey ? (
        <span className="text-xs text-fg-subtle">{t("aiKeys.localNoKey")}</span>
      ) : editing ? (
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!value.trim()) {
              return;
            }
            await secretsSetKey(id, value.trim());
            setValue("");
            setEditing(false);
            refresh();
          }}
        >
          <input
            type="password"
            autoFocus
            value={value}
            placeholder={t("aiKeys.placeholder")}
            onChange={(e) => setValue(e.target.value)}
            className="flex-1 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white"
          >
            {t("aiKeys.save")}
          </button>
        </form>
      ) : (
        <>
          <span
            className={`flex items-center gap-1 text-xs ${
              hasKey ? "text-success" : "text-fg-subtle"
            }`}
          >
            {hasKey && <Check size={13} />}
            {hasKey ? t("aiKeys.set") : t("aiKeys.notSet")}
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-border px-3 py-1 text-xs text-fg-muted hover:border-border-strong"
            >
              {hasKey ? t("aiKeys.save") : t("aiKeys.placeholder")}
            </button>
            {hasKey && (
              <button
                type="button"
                onClick={async () => {
                  await secretsDeleteKey(id);
                  refresh();
                }}
                className="rounded-md border border-border px-3 py-1 text-xs text-danger hover:border-danger/60"
              >
                {t("aiKeys.remove")}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function AiSettingsSection() {
  const { t } = useTranslation("settings");
  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-fg-subtle">
        {t("sections.ai")}
      </h2>
      <p className="mb-4 text-xs text-fg-muted">{t("aiKeys.description")}</p>
      <div>
        {PROVIDERS.map((provider) => (
          <ProviderKeyRow
            key={provider.id}
            id={provider.id}
            label={provider.label}
            needsKey={provider.needsKey}
          />
        ))}
      </div>
    </section>
  );
}
