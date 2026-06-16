import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, KeyRound, SendHorizontal, Trash2 } from "lucide-react";
import { useChatStore } from "./store/chatStore";
import { providerById, PROVIDERS } from "./lib/providers";
import { secretsHasKey, secretsSetKey } from "./lib/aiBridge";
import { useWorkspaceStore } from "@/stores/workspaceStore";

function buildSystemPrompt(rootPath: string | null, activeFile: string | null): string {
  const parts = [
    "You are TempoTerm's built-in coding assistant. Be concise and practical.",
  ];
  if (rootPath) {
    parts.push(`Current workspace folder: ${rootPath}`);
  }
  if (activeFile) {
    parts.push(`The user is currently looking at: ${activeFile}`);
  }
  return parts.join("\n");
}

function KeyForm({ providerId, onSaved }: { providerId: string; onSaved: () => void }) {
  const { t } = useTranslation("ai");
  const [value, setValue] = useState("");
  return (
    <form
      className="flex items-center gap-2 border-b border-[--color-border] bg-[--color-bg-inset] px-3 py-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!value.trim()) {
          return;
        }
        await secretsSetKey(providerId, value.trim());
        setValue("");
        onSaved();
      }}
    >
      <KeyRound size={14} className="shrink-0 text-[--color-fg-subtle]" />
      <input
        type="password"
        value={value}
        placeholder={t("keyPlaceholder")}
        aria-label={t("setKey")}
        onChange={(e) => setValue(e.target.value)}
        className="w-full bg-transparent text-sm text-[--color-fg] outline-none placeholder:text-[--color-fg-subtle]"
      />
      <button
        type="submit"
        className="shrink-0 rounded-md bg-[--color-accent] px-3 py-1 text-xs font-medium text-white"
      >
        {t("saveKey")}
      </button>
    </form>
  );
}

export function AIView() {
  const { t } = useTranslation("ai");
  const providerId = useChatStore((s) => s.providerId);
  const model = useChatStore((s) => s.model);
  const messages = useChatStore((s) => s.messages);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const setProvider = useChatStore((s) => s.setProvider);
  const setModel = useChatStore((s) => s.setModel);
  const send = useChatStore((s) => s.send);
  const clear = useChatStore((s) => s.clear);

  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const activeFile = useWorkspaceStore((s) => s.activeFile);

  const provider = providerById(providerId);
  const [hasKey, setHasKey] = useState(true);
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!provider.needsKey) {
      setHasKey(true);
      return;
    }
    secretsHasKey(provider.id)
      .then(setHasKey)
      .catch(() => setHasKey(false));
  }, [provider.id, provider.needsKey]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, sending]);

  function submit() {
    if (!input.trim() || sending) {
      return;
    }
    const text = input;
    setInput("");
    void send(text, buildSystemPrompt(rootPath, activeFile));
  }

  return (
    <div className="flex h-full flex-col bg-[--color-bg]">
      {/* Header: provider + model + clear */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[--color-border] bg-[--color-bg-inset] px-3">
        <Bot size={16} className="text-[--color-accent]" />
        <select
          value={providerId}
          aria-label={t("provider")}
          onChange={(e) => setProvider(e.target.value)}
          className="rounded-md border border-[--color-border] bg-[--color-bg] px-2 py-1 text-xs text-[--color-fg] outline-none"
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          value={model}
          aria-label={t("model")}
          onChange={(e) => setModel(e.target.value)}
          className="rounded-md border border-[--color-border] bg-[--color-bg] px-2 py-1 text-xs text-[--color-fg] outline-none"
        >
          {provider.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label={t("clear")}
          title={t("clear")}
          onClick={clear}
          className="ml-auto rounded p-1 text-[--color-fg-muted] hover:bg-[--color-bg-elevated] hover:text-[--color-fg]"
        >
          <Trash2 size={15} />
        </button>
      </div>

      {provider.needsKey && !hasKey && (
        <KeyForm providerId={provider.id} onSaved={() => setHasKey(true)} />
      )}

      {/* Messages */}
      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-[--color-fg-subtle]">
            <Bot size={40} strokeWidth={1} />
            <p className="text-sm font-medium text-[--color-fg-muted]">{t("emptyTitle")}</p>
            <p className="text-xs">{t("emptyHint")}</p>
            <p className="mt-2 max-w-xs text-[11px]">{t("contextHint")}</p>
          </div>
        ) : (
          messages.map((message, index) => (
            <div
              key={index}
              className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                  message.role === "user"
                    ? "bg-[--color-accent] text-white"
                    : "bg-[--color-bg-elevated] text-[--color-fg]"
                }`}
              >
                {message.content}
              </div>
            </div>
          ))
        )}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-[--color-bg-elevated] px-3 py-2 text-sm text-[--color-fg-muted]">
              {t("thinking")}
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-[--color-danger]/40 bg-[--color-danger]/10 px-3 py-2 text-xs text-[--color-danger]">
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-[--color-border] bg-[--color-bg-inset] p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            rows={2}
            placeholder={t("placeholder")}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            className="min-h-0 w-full resize-none rounded-md border border-[--color-border] bg-[--color-bg] px-3 py-2 text-sm text-[--color-fg] outline-none focus:border-[--color-accent]"
          />
          <button
            type="button"
            aria-label={t("send")}
            disabled={sending || !input.trim()}
            onClick={submit}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[--color-accent] text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            <SendHorizontal size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
