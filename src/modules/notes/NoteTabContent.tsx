import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, Eye, Pencil, SquareTerminal } from "lucide-react";
import { useNotesStore } from "@/stores/notesStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getTheme } from "@/themes/themes";
import { runCommandInTerminal } from "@/modules/terminal/lib/terminalBus";
import { CodeHighlight } from "./CodeHighlight";

const SHELL_LANGS = new Set(["", "sh", "bash", "zsh", "shell", "console", "terminal"]);

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const { t } = useTranslation("notes");
  const [copied, setCopied] = useState(false);
  const dark = useSettingsStore((s) => getTheme(s.themeId).appearance === "dark");
  const runnable = SHELL_LANGS.has(lang.toLowerCase());

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable
    }
  }

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border bg-bg-inset">
      <div className="overflow-x-auto">
        <CodeHighlight lang={lang} code={code} dark={dark} />
      </div>
      <div className="flex items-center justify-between border-t border-border/60 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-fg-subtle">
          {lang || "text"}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title={t("copy")}
            aria-label={t("copy")}
            onClick={() => void copy()}
            className="rounded p-1 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
          >
            {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
          </button>
          {runnable && (
            <button
              type="button"
              title={t("run")}
              aria-label={t("run")}
              onClick={() => runCommandInTerminal(code)}
              className="rounded p-1 text-fg-subtle hover:bg-bg-elevated hover:text-accent"
            >
              <SquareTerminal size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function NoteTabContent({ noteId, tabId }: { noteId: string; tabId: string }) {
  const { t } = useTranslation("notes");
  const note = useNotesStore((s) => s.notes.find((n) => n.id === noteId));
  const updateNote = useNotesStore((s) => s.updateNote);
  const setTabTitle = useTabsStore((s) => s.setTabTitle);
  const [editing, setEditing] = useState(() => !note || note.content.trim() === "");

  const markdownComponents = useMemo(
    () => ({
      pre: ({ children }: { children?: ReactNode }) => <>{children}</>,
      code: ({ className, children }: { className?: string; children?: ReactNode }) => {
        const text = String(children ?? "");
        const match = /language-(\w+)/.exec(className ?? "");
        const isBlock = Boolean(match) || text.includes("\n");
        if (!isBlock) {
          return (
            <code className="rounded bg-bg-elevated px-1.5 py-0.5 font-mono text-[0.85em] text-accent">
              {children}
            </code>
          );
        }
        return <CodeBlock lang={match?.[1] ?? ""} code={text.replace(/\n$/, "")} />;
      },
    }),
    [],
  );

  if (!note) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-fg-subtle">
        {t("notFound")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3">
        <input
          value={note.title}
          placeholder={t("titlePlaceholder")}
          aria-label={t("titlePlaceholder")}
          onChange={(e) => {
            updateNote(noteId, { title: e.target.value });
            setTabTitle(tabId, e.target.value || "Untitled");
          }}
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-fg outline-none placeholder:text-fg-subtle"
        />
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted hover:border-border-strong hover:text-fg"
        >
          {editing ? <Eye size={13} /> : <Pencil size={13} />}
          {editing ? t("preview") : t("edit")}
        </button>
      </div>

      {editing ? (
        <textarea
          value={note.content}
          placeholder={t("contentPlaceholder")}
          onChange={(e) => updateNote(noteId, { content: e.target.value })}
          className="min-h-0 flex-1 resize-none bg-transparent px-5 py-4 font-mono text-sm leading-relaxed text-fg outline-none placeholder:text-fg-subtle"
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="note-md">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {note.content || ""}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
