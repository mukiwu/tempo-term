import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, KeyRound } from "lucide-react";
import { PROVIDERS, providerById } from "@/modules/ai/lib/providers";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { Combobox } from "@/components/Combobox";
import {
  secretsDeleteKey,
  secretsHasKey,
  secretsSetKey,
} from "@/modules/ai/lib/aiBridge";

function DefaultModelRow() {
  const { t } = useTranslation("settings");
  const providerId = useChatStore((s) => s.providerId);
  const model = useChatStore((s) => s.model);
  const setProvider = useChatStore((s) => s.setProvider);
  const setModel = useChatStore((s) => s.setModel);
  const provider = providerById(providerId);

  return (
    <div className="mb-6">
      <label className="mb-1 block text-sm font-medium text-fg">{t("aiModel.label")}</label>
      <p className="mb-2 text-xs text-fg-muted">{t("aiModel.description")}</p>
      <div className="flex flex-wrap gap-2">
        <Combobox
          value={provider.label}
          options={PROVIDERS.map((p) => p.label)}
          onChange={(label) => {
            const next = PROVIDERS.find((p) => p.label === label);
            if (next) setProvider(next.id);
          }}
          ariaLabel={t("aiModel.provider")}
          className="w-48"
        />
        <Combobox
          value={model}
          options={provider.models}
          onChange={setModel}
          ariaLabel={t("aiModel.model")}
          editable
          placeholder={t("aiModel.customPlaceholder")}
          className="w-56"
        />
      </div>
    </div>
  );
}

function InlineCompletionRow() {
  const { t } = useTranslation("settings");
  const enabled = useSettingsStore((s) => s.aiInlineCompletion);
  const setEnabled = useSettingsStore((s) => s.setAiInlineCompletion);

  return (
    <div className="mb-6">
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-fg">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="accent-accent"
        />
        {t("aiInline.label")}
      </label>
      <p className="mt-1 text-xs text-fg-muted">{t("aiInline.description")}</p>
    </div>
  );
}

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
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-fg-subtle">
        {t("sections.ai")}
      </h2>

      <DefaultModelRow />

      <InlineCompletionRow />

      <label className="mb-1 block text-sm font-medium text-fg">{t("aiKeys.title")}</label>
      <p className="mb-2 text-xs text-fg-muted">{t("aiKeys.description")}</p>
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
