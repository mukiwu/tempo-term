import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  EditorContent,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type Editor,
  type NodeViewProps,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Link from "@tiptap/extension-link";
import { Markdown } from "tiptap-markdown";
import { common, createLowlight } from "lowlight";
import { exitCode } from "@tiptap/pm/commands";
import { Check, Copy, SquareTerminal } from "lucide-react";
import { useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { runCommandInTerminal } from "@/modules/terminal/lib/terminalBus";
import { isWebUrl } from "@/lib/url";
import { createSlashCommand } from "./slashCommand";
import { registerNoteInserter, unregisterNoteInserter } from "./lib/noteBus";
import { bashCommandHighlight } from "./lib/bashCommandHighlight";
import { NoteSearchHighlight } from "./noteSearchHighlight";
import { Combobox } from "@/components/Combobox";
import { Tooltip } from "@/components/Tooltip";
import { SelectionCommandMenu } from "./SelectionCommandMenu";

const lowlight = createLowlight(common);
// Override the stock bash grammar so leading command names (ssh, git, custom
// scripts) get colored too, not only highlight.js's built-in whitelist.
lowlight.register("bash", bashCommandHighlight);
const SHELL_LANGS = new Set(["", "sh", "bash", "zsh", "shell", "console", "terminal"]);

const CODE_LANGS = [
  "text",
  "bash",
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "json",
  "python",
  "rust",
  "go",
  "css",
  "html",
  "yaml",
  "sql",
  "markdown",
  "toml",
  "diff",
];

/** Code block with a language label, copy and run-in-terminal actions. */
function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  const { t } = useTranslation("notes");
  const [copied, setCopied] = useState(false);
  const lang = (node.attrs.language as string) || "";
  const runnable = SHELL_LANGS.has(lang.toLowerCase());

  return (
    <NodeViewWrapper className="my-3 rounded-lg border border-border bg-bg-inset">
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-relaxed">
        <NodeViewContent as="code" className={lang ? `language-${lang}` : undefined} />
      </pre>
      <div
        contentEditable={false}
        className="flex items-center justify-between border-t border-border/60 px-3 py-1.5"
      >
        <Combobox
          value={lang || "text"}
          options={CODE_LANGS}
          onChange={(value) =>
            updateAttributes({ language: value === "text" ? null : value })
          }
          ariaLabel={t("language")}
          size="sm"
          className="font-mono"
        />
        <div className="flex items-center gap-2">
          <span className="select-none text-[11px] text-fg-subtle">{t("exitHint")}</span>
          <Tooltip label={t("copy")}>
            <button
              type="button"
              aria-label={t("copy")}
              onClick={() => {
                void navigator.clipboard.writeText(node.textContent).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                });
              }}
              className="rounded p-1 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
            >
              {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
            </button>
          </Tooltip>
          {runnable && (
            <Tooltip label={t("run")}>
              <button
                type="button"
                aria-label={t("run")}
                onClick={() => runCommandInTerminal(node.textContent)}
                className="rounded p-1 text-fg-subtle hover:bg-bg-elevated hover:text-accent"
              >
                <SquareTerminal size={14} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // Cmd/Ctrl+Enter leaves the code block into a fresh paragraph below
      // (works even when the block is the last node in the document).
      "Mod-Enter": () =>
        this.editor.commands.command(({ state, dispatch }) => exitCode(state, dispatch)),
    };
  },
}).configure({ lowlight, exitOnArrowDown: true, exitOnTripleEnter: true });

interface NoteEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  /** When set, dropped explorer entries can insert a link into this note. */
  noteId?: string;
  /** Surfaces the live editor instance to the parent (the TOC button reads
   *  headings from it); called with null when the editor goes away. */
  onEditorReady?: (editor: Editor | null) => void;
}

export function NoteEditor({ content, onChange, noteId, onEditorReady }: NoteEditorProps) {
  const { t } = useTranslation("notes");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slashCommand = useMemo(() => createSlashCommand(t), [t]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlock,
      slashCommand,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { "data-link-hint": t("linkHint") },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: t("contentPlaceholder") }),
      NoteSearchHighlight,
      // tiptap-markdown's bundled types lag the installed TipTap core; the
      // runtime is fine, so cast past the version-skew type mismatch.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Markdown.configure({ html: false, transformPastedText: true }) as any,
    ],
    content,
    editorProps: {
      attributes: { class: "note-md tiptap focus:outline-none" },
      // Cmd/Ctrl+click a link opens it in the system browser; a plain click
      // still places the cursor for editing. preventDefault stops the webview
      // from navigating to the URL itself on a plain click.
      handleClick(_view, _pos, event) {
        const target = event.target as HTMLElement | null;
        const href = target?.closest("a")?.getAttribute("href");
        if (!href || !isWebUrl(href)) {
          return false;
        }
        event.preventDefault();
        if (event.metaKey || event.ctrlKey) {
          void openUrl(href);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => {
        const storage = editor.storage as { markdown: { getMarkdown: () => string } };
        onChange(storage.markdown.getMarkdown());
      }, 400);
    },
  });

  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, []);

  useEffect(() => {
    onEditorReady?.(editor);
    return () => onEditorReady?.(null);
  }, [editor, onEditorReady]);

  // Let a dropped explorer entry insert a Markdown link at the cursor.
  useEffect(() => {
    if (!editor || !noteId) {
      return;
    }
    registerNoteInserter(noteId, (name, path) => {
      editor
        .chain()
        .focus()
        .insertContent([
          { type: "text", text: name, marks: [{ type: "link", attrs: { href: path } }] },
          { type: "text", text: " " },
        ])
        .run();
    });
    return () => unregisterNoteInserter(noteId);
  }, [editor, noteId]);

  return (
    <>
      {editor && <SelectionCommandMenu editor={editor} />}
      <EditorContent editor={editor} className="h-full" />
    </>
  );
}
