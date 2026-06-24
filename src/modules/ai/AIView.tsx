import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, KeyRound, Paperclip, SendHorizontal, SquareTerminal, Trash2, X } from "lucide-react";
import { useChatStore } from "./store/chatStore";
import { providerById, PROVIDERS } from "./lib/providers";
import { secretsHasKey, secretsSetKey } from "./lib/aiBridge";
import { buildAttachmentsBlock, type AttachedFile } from "./lib/attachments";
import { buildActiveFileBlock, buildTerminalBlock } from "./lib/context";
import { extractCommand, sanitizeForInsertion } from "./lib/command";
import { ChatMarkdown } from "./ChatMarkdown";
import { Combobox } from "@/components/Combobox";
import { fsReadFile } from "@/modules/explorer/lib/fsBridge";
import { basename } from "@/modules/explorer/lib/paths";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useEditorStore } from "@/modules/editor/store/editorStore";
import {
  insertIntoActiveTerminal,
  readActiveTerminalBuffer,
} from "@/modules/terminal/lib/terminalBus";

function buildSystemPrompt(
  rootPath: string | null,
  activeFile: string | null,
  activeFileBlock: string,
  terminalBlock: string,
  attachments: string,
): string {
  const parts = [
    "You are TempoTerm's built-in coding assistant. Be concise and practical.",
  ];
  if (rootPath) {
    parts.push(`Current workspace folder: ${rootPath}`);
  }
  if (activeFile) {
    parts.push(`The user is currently looking at: ${activeFile}`);
  }
  if (activeFileBlock) {
    parts.push(activeFileBlock);
  }
  if (terminalBlock) {
    parts.push(terminalBlock);
  }
  if (attachments) {
    parts.push(attachments);
  }
  return parts.join("\n");
}

/**
 * Read every attached file and assemble the context block. Files that cannot be
 * read (deleted, binary, permission denied) are skipped rather than failing the
 * whole send.
 */
async function buildAttachmentsContext(paths: string[]): Promise<string> {
  if (paths.length === 0) {
    return "";
  }
  const files: AttachedFile[] = [];
  for (const path of paths) {
    try {
      files.push({ path, contents: await fsReadFile(path) });
    } catch {
      // Skip unreadable files.
    }
  }
  return buildAttachmentsBlock(files);
}

function KeyForm({ providerId, onSaved }: { providerId: string; onSaved: () => void }) {
  const { t } = useTranslation("ai");
  const [value, setValue] = useState("");
  return (
    <form
      className="flex items-center gap-2 border-b border-border bg-bg-inset px-3 py-2"
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
      <KeyRound size={14} className="shrink-0 text-fg-subtle" />
      <input
        type="password"
        value={value}
        placeholder={t("keyPlaceholder")}
        aria-label={t("setKey")}
        onChange={(e) => setValue(e.target.value)}
        className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
      />
      <button
        type="submit"
        className="shrink-0 rounded-md bg-accent px-3 py-1 text-xs font-medium text-white"
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
  const attachedPaths = useChatStore((s) => s.attachedPaths);
  const removeAttached = useChatStore((s) => s.removeAttached);
  const terminalContext = useChatStore((s) => s.terminalContext);
  const setTerminalContext = useChatStore((s) => s.setTerminalContext);

  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const activeFile = useWorkspaceStore((s) => s.activeFile);

  const provider = providerById(providerId);
  const [hasKey, setHasKey] = useState(true);
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  // IME composition tracking so the Enter that confirms a candidate never sends.
  const composingRef = useRef(false);
  const lastCompositionEndRef = useRef(0);

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

  function grabTerminal() {
    const raw = readActiveTerminalBuffer();
    setTerminalContext(raw ? buildTerminalBlock(raw) || null : null);
  }

  function submit() {
    if (!input.trim() || sending) {
      return;
    }
    const text = input;
    setInput("");
    const activeFileBlock = activeFile
      ? buildActiveFileBlock(activeFile, useEditorStore.getState().contentOf(activeFile))
      : "";
    void buildAttachmentsContext(attachedPaths).then((attachments) =>
      send(
        text,
        buildSystemPrompt(rootPath, activeFile, activeFileBlock, terminalContext ?? "", attachments),
      ),
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      {/* Header: provider + model + clear. The dropdowns flex-shrink so they
          never overflow (and get clipped) when the sidebar is made narrow. */}
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border bg-bg-inset px-2">
        <Bot size={16} className="shrink-0 text-accent" />
        <Combobox
          value={provider.label}
          options={PROVIDERS.map((p) => p.label)}
          onChange={(label) => {
            const next = PROVIDERS.find((p) => p.label === label);
            if (next) setProvider(next.id);
          }}
          ariaLabel={t("provider")}
          className="min-w-0 flex-1"
        />
        <Combobox
          value={model}
          options={provider.models}
          onChange={setModel}
          ariaLabel={t("model")}
          editable
          placeholder={t("modelPlaceholder")}
          className="min-w-0 flex-1"
        />
        <button
          type="button"
          aria-label={t("clear")}
          title={t("clear")}
          onClick={clear}
          className="shrink-0 rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
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
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-fg-subtle">
            <Bot size={40} strokeWidth={1} />
            <p className="text-sm font-medium text-fg-muted">{t("emptyTitle")}</p>
            <p className="text-xs">{t("emptyHint")}</p>
            <p className="mt-2 max-w-xs text-[11px]">{t("contextHint")}</p>
          </div>
        ) : (
          messages.map((message, index) => {
            const command =
              message.role === "assistant" ? extractCommand(message.content) : null;
            return (
              <div
                key={index}
                className={
                  message.role === "user"
                    ? "flex justify-end"
                    : "flex flex-col items-start gap-1"
                }
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    message.role === "user"
                      ? "whitespace-pre-wrap bg-accent text-white"
                      : "bg-bg-elevated text-fg"
                  }`}
                >
                  {message.role === "assistant" ? (
                    <ChatMarkdown content={message.content} />
                  ) : (
                    message.content
                  )}
                </div>
                {command && (
                  <button
                    type="button"
                    title={t("insertCommand")}
                    onClick={() => insertIntoActiveTerminal(sanitizeForInsertion(command))}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg"
                  >
                    <SquareTerminal size={12} className="shrink-0 text-accent" />
                    {t("insertCommand")}
                  </button>
                )}
              </div>
            );
          })
        )}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-bg-elevated px-3 py-2 text-sm text-fg-muted">
              {t("thinking")}
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-border bg-bg-inset p-3">
        {(attachedPaths.length > 0 || terminalContext) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {terminalContext && (
              <span
                title={t("terminalContextTitle")}
                className="inline-flex max-w-[200px] items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-xs text-fg-muted"
              >
                <SquareTerminal size={11} className="shrink-0 text-accent" />
                <span className="truncate">{t("terminalContextChip")}</span>
                <button
                  type="button"
                  aria-label={t("removeTerminalContext")}
                  title={t("removeTerminalContext")}
                  onClick={() => setTerminalContext(null)}
                  className="shrink-0 rounded text-fg-subtle hover:text-fg"
                >
                  <X size={12} />
                </button>
              </span>
            )}
            {attachedPaths.map((path) => (
              <span
                key={path}
                title={path}
                className="inline-flex max-w-[180px] items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg-muted"
              >
                <Paperclip size={11} className="shrink-0 text-fg-subtle" />
                <span className="truncate">{basename(path)}</span>
                <button
                  type="button"
                  aria-label={t("removeAttachment")}
                  title={t("removeAttachment")}
                  onClick={() => removeAttached(path)}
                  className="shrink-0 rounded text-fg-subtle hover:text-fg"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <button
            type="button"
            aria-pressed={Boolean(terminalContext)}
            aria-label={terminalContext ? t("grabTerminalActive") : t("grabTerminal")}
            title={terminalContext ? t("grabTerminalActive") : t("grabTerminal")}
            onClick={grabTerminal}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors ${
              terminalContext
                ? "border-accent bg-accent/10 text-accent hover:bg-accent/15"
                : "border-border text-fg-muted hover:bg-bg-elevated hover:text-fg"
            }`}
          >
            <SquareTerminal size={16} />
          </button>
          <textarea
            value={input}
            rows={2}
            placeholder={t("placeholder")}
            onChange={(e) => setInput(e.target.value)}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
              lastCompositionEndRef.current = Date.now();
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey) {
                return;
              }
              // The Enter that confirms an IME candidate must never send.
              // Blink flags it via isComposing/keyCode 229; WebKit (macOS
              // WebView) fires compositionend *before* this keydown, so also
              // guard on our own ref and a short window right after it ended.
              const justComposed = Date.now() - lastCompositionEndRef.current < 120;
              if (
                composingRef.current ||
                e.nativeEvent.isComposing ||
                e.keyCode === 229 ||
                justComposed
              ) {
                return;
              }
              e.preventDefault();
              submit();
            }}
            className="min-h-0 w-full resize-none rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
          />
          <button
            type="button"
            aria-label={t("send")}
            disabled={sending || !input.trim()}
            onClick={submit}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            <SendHorizontal size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
