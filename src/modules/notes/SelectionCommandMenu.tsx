import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  CodeXml,
  Italic,
  Link as LinkIcon,
  Strikethrough,
  Unlink,
  type LucideIcon,
} from "lucide-react";
import { SlashCommandList, type SlashListHandle } from "./SlashCommandList";
import { createBlockCommandItems } from "./slashCommand";

interface SelectionCommandMenuProps {
  editor: Editor;
}

interface MenuAnchor {
  left: number;
  top: number;
  selectionKey: string;
}

const MENU_WIDTH = 256;
const MENU_MAX_HEIGHT = 288;
const VIEWPORT_MARGIN = 8;

interface FormatButtonProps {
  label: string;
  active: boolean;
  icon: LucideIcon;
  onClick: () => void;
}

function FormatButton({ label, active, icon: Icon, onClick }: FormatButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`rounded p-1.5 ${
        active ? "bg-bg text-fg" : "text-fg-muted hover:bg-bg hover:text-fg"
      }`}
    >
      <Icon size={15} />
    </button>
  );
}

/** Reuses the slash-command panel to transform selected blocks in place. */
export function SelectionCommandMenu({ editor }: SelectionCommandMenuProps) {
  const { t } = useTranslation("notes");
  const items = useMemo(() => createBlockCommandItems(t, false), [t]);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [linkEditing, setLinkEditing] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const dismissedSelection = useRef<string | null>(null);
  const listRef = useRef<SlashListHandle>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const blurTimeoutRef = useRef<number | null>(null);
  const hide = useCallback(() => setAnchor(null), []);
  const handleEditorBlur = useCallback(() => {
    if (blurTimeoutRef.current !== null) {
      window.clearTimeout(blurTimeoutRef.current);
    }
    blurTimeoutRef.current = window.setTimeout(() => {
      blurTimeoutRef.current = null;
      const activeElement = document.activeElement as HTMLElement | null;
      if (!activeElement?.closest("[data-selection-command-menu]")) {
        hide();
      }
    }, 0);
  }, [hide]);

  const update = useCallback(() => {
    const { selection } = editor.state;
    if (selection.empty || editor.isActive("codeBlock")) {
      dismissedSelection.current = null;
      setAnchor(null);
      return;
    }

    const selectionKey = `${selection.from}:${selection.to}`;
    if (dismissedSelection.current === selectionKey) {
      setAnchor(null);
      return;
    }

    let left = VIEWPORT_MARGIN;
    let top = VIEWPORT_MARGIN;
    try {
      const start = editor.view.coordsAtPos(selection.from);
      const end = editor.view.coordsAtPos(selection.to);
      left = Math.min(start.left, end.left);
      top = Math.max(start.bottom, end.bottom) + 6;
      if (top + MENU_MAX_HEIGHT > window.innerHeight - VIEWPORT_MARGIN) {
        top = Math.max(
          VIEWPORT_MARGIN,
          Math.min(start.top, end.top) - MENU_MAX_HEIGHT - 6,
        );
      }
    } catch {
      // jsdom has no text layout. Keeping a deterministic fallback makes the
      // selection behavior testable; real webviews use ProseMirror geometry.
    }
    left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(left, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN),
    );
    setAnchor({ left, top, selectionKey });
  }, [editor]);

  useEffect(() => {
    let animationFrameId: number | null = null;
    const scheduleUpdate = () => {
      if (animationFrameId !== null) {
        return;
      }
      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        update();
      });
    };

    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    editor.on("focus", update);
    editor.on("blur", handleEditorBlur);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    update();
    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      if (blurTimeoutRef.current !== null) {
        window.clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
      editor.off("focus", update);
      editor.off("blur", handleEditorBlur);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
    };
  }, [editor, handleEditorBlur, update]);

  useEffect(() => {
    if (linkEditing) {
      linkInputRef.current?.focus();
    }
  }, [linkEditing]);

  useEffect(() => {
    if (!anchor) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        editor.commands.setTextSelection(editor.state.selection.to);
      } else if (listRef.current?.onKeyDown(event)) {
        event.preventDefault();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [anchor, editor]);

  if (!anchor) {
    return null;
  }

  return createPortal(
    <div
      data-selection-command-menu
      className="fixed z-[1000]"
      style={{ left: anchor.left, top: anchor.top }}
    >
      <SlashCommandList
        ref={listRef}
        items={items}
        header={
          <div className="border-b border-border px-2 pb-1">
            <div className="flex items-center gap-1">
              <FormatButton
                label={t("format.bold")}
                active={editor.isActive("bold")}
                icon={Bold}
                onClick={() => editor.chain().focus().toggleBold().run()}
              />
              <FormatButton
                label={t("format.italic")}
                active={editor.isActive("italic")}
                icon={Italic}
                onClick={() => editor.chain().focus().toggleItalic().run()}
              />
              <FormatButton
                label={t("format.strike")}
                active={editor.isActive("strike")}
                icon={Strikethrough}
                onClick={() => editor.chain().focus().toggleStrike().run()}
              />
              <FormatButton
                label={t("format.code")}
                active={editor.isActive("code")}
                icon={CodeXml}
                onClick={() => editor.chain().focus().toggleCode().run()}
              />
              <FormatButton
                label={t("format.link")}
                active={editor.isActive("link")}
                icon={LinkIcon}
                onClick={() => {
                  setLinkUrl((editor.getAttributes("link").href as string | undefined) ?? "");
                  setLinkEditing(true);
                }}
              />
            </div>
            {linkEditing && (
              <div className="mt-1">
                <input
                  ref={linkInputRef}
                  type="url"
                  value={linkUrl}
                  aria-label={t("format.linkUrl")}
                  placeholder={t("format.linkPlaceholder")}
                  onChange={(event) => setLinkUrl(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") {
                      event.preventDefault();
                      const href = linkUrl.trim();
                      const chain = editor.chain().focus();
                      if (href) {
                        chain.setLink({ href }).run();
                      } else {
                        chain.unsetLink().run();
                      }
                      setLinkEditing(false);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      setLinkEditing(false);
                    }
                  }}
                  className="w-full rounded border border-border-strong bg-bg px-2 py-1 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
                />
                {editor.isActive("link") && (
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      editor.chain().focus().extendMarkRange("link").unsetLink().run();
                      setLinkEditing(false);
                    }}
                    className="mt-1 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-danger hover:bg-bg"
                  >
                    <Unlink size={14} />
                    {t("format.removeLink")}
                  </button>
                )}
              </div>
            )}
          </div>
        }
        command={(item) => {
          dismissedSelection.current = anchor.selectionKey;
          setAnchor(null);
          const { from, to } = editor.state.selection;
          item.run(editor, { from, to });
          editor.commands.setTextSelection(editor.state.selection.to);
        }}
      />
    </div>,
    document.body,
  );
}
