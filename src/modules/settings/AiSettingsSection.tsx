import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, KeyRound } from "lucide-react";
import {
  CHAT_PROVIDERS,
  PROVIDERS,
  providerById,
  CUSTOM_PROVIDER_ID,
  type ProviderPreset,
} from "@/modules/ai/lib/providers";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { Combobox } from "@/components/Combobox";
import {
  aiAppleAvailable,
  secretsDeleteKey,
  secretsHasKey,
  secretsSetKey,
} from "@/modules/ai/lib/aiBridge";

/**
 * Providers the settings page offers: Apple Intelligence appears only where
 * the on-device model actually answers (macOS 26+, Apple Intelligence on);
 * elsewhere — Windows included — the option simply does not exist.
 */
function useAppleAvailability() {
  const [appleOk, setAppleOk] = useState(false);
  useEffect(() => {
    let live = true;
    aiAppleAvailable()
      .then((ok) => {
        if (live) setAppleOk(ok);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return appleOk;
}

interface ModelRowProps {
  label: string;
  description: string;
  providers: ProviderPreset[];
  providerId: string;
  model: string;
  onProviderChange: (id: string) => void;
  onModelChange: (model: string) => void;
  providerAriaLabel: string;
  modelAriaLabel: string;
}

function ModelRow({
  label,
  description,
  providers,
  providerId,
  model,
  onProviderChange,
  onModelChange,
  providerAriaLabel,
  modelAriaLabel,
}: ModelRowProps) {
  const { t } = useTranslation("settings");
  const provider = providerById(providerId);

  return (
    <div className="mb-6">
      <label className="mb-1 block text-sm font-medium text-fg">{label}</label>
      <p className="mb-2 text-xs text-fg-muted">{description}</p>
      <div className="flex flex-wrap gap-2">
        <Combobox
          value={provider.label}
          options={providers.map((p) => p.label)}
          onChange={(label) => {
            const next = providers.find((p) => p.label === label);
            if (next) onProviderChange(next.id);
          }}
          ariaLabel={providerAriaLabel}
          className="w-48"
        />
        <Combobox
          value={model}
          options={provider.models}
          onChange={onModelChange}
          ariaLabel={modelAriaLabel}
          editable
          placeholder={t("aiModel.customPlaceholder")}
          className="w-56"
        />
      </div>
    </div>
  );
}

function CustomEndpointRow() {
  const { t } = useTranslation("settings");
  const customBaseUrl = useChatStore((s) => s.customBaseUrl);
  const setCustomBaseUrl = useChatStore((s) => s.setCustomBaseUrl);
  return (
    <div className="-mt-4 mb-6">
      <label
        className="mb-1 block text-xs font-medium text-fg-muted"
        htmlFor="ai-custom-base-url"
      >
        {t("aiModel.baseUrl")}
      </label>
      <input
        id="ai-custom-base-url"
        type="text"
        value={customBaseUrl}
        onChange={(e) => setCustomBaseUrl(e.target.value)}
        placeholder="http://localhost:1234/v1"
        spellCheck={false}
        className="w-full max-w-md rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg outline-none focus:border-accent"
      />
      <p className="mt-1 text-xs text-fg-muted">{t("aiModel.baseUrlHint")}</p>
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

  // The custom provider is keyless for local servers but may point at a remote
  // OpenAI-compatible endpoint (OpenRouter, DeepInfra, an authed self-host), so
  // it allows an optional key even though it does not require one.
  const allowsKey = needsKey || id === CUSTOM_PROVIDER_ID;

  const refresh = () => {
    if (allowsKey) {
      secretsHasKey(id).then(setHasKey).catch(() => setHasKey(false));
    }
  };

  useEffect(refresh, [id, allowsKey]);

  return (
    <div className="flex items-center gap-3 border-b border-border py-3 last:border-b-0">
      <KeyRound size={15} className="shrink-0 text-fg-subtle" />
      <span className="w-32 shrink-0 text-sm text-fg">{label}</span>

      {!allowsKey ? (
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
  const appleOk = useAppleAvailability();
  const quickProviders = PROVIDERS.filter((p) => p.id !== "apple" || appleOk);
  const { t } = useTranslation("settings");
  const providerId = useChatStore((s) => s.providerId);
  const model = useChatStore((s) => s.model);
  const chatProviderId = useChatStore((s) => s.chatProviderId);
  const chatModel = useChatStore((s) => s.chatModel);
  const setProvider = useChatStore((s) => s.setProvider);
  const setModel = useChatStore((s) => s.setModel);
  const setChatProvider = useChatStore((s) => s.setChatProvider);
  const setChatModel = useChatStore((s) => s.setChatModel);
  const effectiveChatProviderId =
    chatProviderId ?? (providerId === "apple" ? "openai" : providerId);
  const effectiveChatProvider = providerById(effectiveChatProviderId);
  const effectiveChatModel =
    chatModel ?? (providerId === "apple" ? effectiveChatProvider.models[0] ?? "" : model);
  const customSelected =
    providerId === CUSTOM_PROVIDER_ID || effectiveChatProviderId === CUSTOM_PROVIDER_ID;

  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-fg-subtle">
        {t("sections.ai")}
      </h2>

      <ModelRow
        label={t("aiModel.quickLabel")}
        description={t("aiModel.quickDescription")}
        providers={quickProviders}
        providerId={providerId}
        model={model}
        onProviderChange={setProvider}
        onModelChange={setModel}
        providerAriaLabel={t("aiModel.quickProvider")}
        modelAriaLabel={t("aiModel.quickModel")}
      />

      <ModelRow
        label={t("aiModel.chatLabel")}
        description={t("aiModel.chatDescription")}
        providers={CHAT_PROVIDERS}
        providerId={effectiveChatProviderId}
        model={effectiveChatModel}
        onProviderChange={setChatProvider}
        onModelChange={setChatModel}
        providerAriaLabel={t("aiModel.chatProvider")}
        modelAriaLabel={t("aiModel.chatModel")}
      />

      {appleOk && (
        <p className="-mt-4 mb-6 text-xs text-fg-subtle">{t("aiModel.appleScope")}</p>
      )}

      {customSelected && <CustomEndpointRow />}

      <InlineCompletionRow />

      <label className="mb-1 block text-sm font-medium text-fg">{t("aiKeys.title")}</label>
      <p className="mb-2 text-xs text-fg-muted">{t("aiKeys.description")}</p>
      <div>
        {quickProviders.map((provider) => (
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
