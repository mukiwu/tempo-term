import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, ClipboardPaste, Scissors, TextSelect } from "lucide-react";
import type { LucideProps } from "lucide-react";
import type { ComponentType } from "react";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { terminalClipboardText } from "@/modules/terminal/lib/terminalClipboard";
import {
  isPlainTextField,
  isRichEditable,
  isEditorSurface,
  readFieldContext,
  inputMenuSpecs,
  replaceRange,
  getSelectionRange,
  isDevBuild,
  type EditableField,
  type FieldContext,
  type InputMenuAction,
} from "@/components/inputMenuItems";

interface MenuState {
  x: number;
  y: number;
  field: EditableField;
  /** Selection captured at right-click time; restored before each action runs. */
  start: number;
  end: number;
  ctx: FieldContext;
}

const ICONS: Record<InputMenuAction, ComponentType<LucideProps>> = {
  cut: Scissors,
  copy: Copy,
  paste: ClipboardPaste,
  selectAll: TextSelect,
};

/**
 * App-styled replacement for the browser context menu on plain text fields
 * (`<input>` / `<textarea>`), and a blanket suppressor of the browser menu
 * everywhere else (skipped in dev builds so Inspect Element stays reachable).
 * Mounted once near the app root and active on every platform; it started as
 * a Windows-only fix because WebView2's native paste takes ~5s.
 *
 * Actions restore the field's focus and act on the selection captured at
 * right-click time. Cut/paste edit through `replaceRange`, which dispatches an
 * `input` event so React's controlled inputs stay in sync. Paste reads via the
 * fast Tauri clipboard path rather than the slow WebView2 one.
 */
export function InputContextMenu() {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<MenuState | null>(null);
  // The element with an active IME composition, if any. Tracked so a
  // right-click during composition keeps the native menu (which commits the
  // composition correctly) instead of ours — replaceRange rewriting the value
  // mid-composition would corrupt the composed text.
  const composingRef = useRef<EventTarget | null>(null);

  useEffect(() => {
    function onCompositionStart(e: CompositionEvent) {
      composingRef.current = e.target;
    }
    function onCompositionEnd(e: CompositionEvent) {
      if (composingRef.current === e.target) {
        composingRef.current = null;
      }
    }
    function onContextMenu(e: MouseEvent) {
      // A component already showed its own menu (tab bar, file tree, git graph,
      // Monaco, the terminal's menu, …) — leave it be.
      if (e.defaultPrevented) {
        return;
      }
      const target = e.target;
      // Mid-IME-composition: keep the native menu (no preventDefault), matching
      // the pre-unification behavior. See composingRef above.
      if (composingRef.current !== null && target === composingRef.current) {
        return;
      }
      if (isPlainTextField(target)) {
        e.preventDefault();
        const { start, end } = getSelectionRange(target);
        setMenu({
          x: e.clientX,
          y: e.clientY,
          field: target,
          start,
          end,
          ctx: readFieldContext(target),
        });
        return;
      }
      // contentEditable (Tiptap notes) and editor surfaces (CodeMirror diff
      // view, Monaco): keep the native menu — its spellcheck and copy/paste
      // beat a custom one, and driving it would fight the editor. The surface
      // check catches read-only CodeMirror, whose content is not contentEditable.
      if (isRichEditable(target) || isEditorSurface(target)) {
        return;
      }
      // Everywhere else: kill the browser menu (Reload / Save as / Inspect …).
      // Dev builds keep it so right-click → Inspect Element still works.
      if (isDevBuild()) {
        return;
      }
      e.preventDefault();
    }
    // Capture phase so composition state is tracked even if an editor stops
    // propagation of these events in the bubble phase.
    window.addEventListener("compositionstart", onCompositionStart, true);
    window.addEventListener("compositionend", onCompositionEnd, true);
    window.addEventListener("contextmenu", onContextMenu);
    return () => {
      window.removeEventListener("compositionstart", onCompositionStart, true);
      window.removeEventListener("compositionend", onCompositionEnd, true);
      window.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);

  const runAction = useCallback(
    async (action: InputMenuAction, field: EditableField, start: number, end: number) => {
      switch (action) {
        case "copy": {
          const selected = field.value.slice(start, end);
          if (selected) {
            void navigator.clipboard.writeText(selected).catch(() => {});
          }
          break;
        }
        case "cut": {
          const selected = field.value.slice(start, end);
          if (selected) {
            // Delete only after the clipboard write resolves — otherwise a
            // rejected write (WebView2 focus/permission) would drop the text
            // with nothing left on the clipboard to paste back.
            try {
              await navigator.clipboard.writeText(selected);
              field.focus();
              replaceRange(field, start, end, "");
            } catch {
              // Keep the selection intact; nothing was copied.
            }
          }
          break;
        }
        case "paste": {
          let text = "";
          try {
            text = await terminalClipboardText();
          } catch {
            // Fast Tauri path failed — fall back to the (slower) web clipboard
            // so paste still works rather than silently doing nothing.
            try {
              text = await navigator.clipboard.readText();
            } catch {
              text = "";
            }
          }
          // On Linux the Rust command is a stub that RESOLVES with "" (no
          // native clipboard backend there), so the catch above never runs.
          // Retry the web clipboard whenever the fast path came back empty.
          if (!text) {
            text = await navigator.clipboard.readText().catch(() => "");
          }
          if (text) {
            field.focus();
            replaceRange(field, start, end, text);
          }
          break;
        }
        case "selectAll": {
          field.focus();
          field.select();
          break;
        }
      }
    },
    [],
  );

  if (!menu) {
    return null;
  }

  const items: ContextMenuItem[] = inputMenuSpecs(menu.ctx).map((spec) => ({
    id: spec.action,
    label: t(`actions.${spec.action}`),
    icon: ICONS[spec.action],
    disabled: !spec.enabled,
    // Select All sits in its own group, divided from the edit actions
    // (cut/copy/paste) above — the standard OS/browser text-menu layout.
    group: spec.action === "selectAll" ? 1 : 0,
    onSelect: () => {
      void runAction(spec.action, menu.field, menu.start, menu.end);
    },
  }));

  return <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />;
}
