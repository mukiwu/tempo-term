import { useEffect } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";
import i18n from "@/i18n";
import { IS_MAC } from "@/lib/platform";
import { buildMenus, executeMenuAction, getMenuContext } from "@/components/menuBarMenus";
import { findItemById, serializeNativeMenu } from "@/lib/nativeMenu";
import { isWindowMaximized, onWindowResized } from "@/lib/window";
import { useTabsStore } from "@/stores/tabsStore";
import { useUiStore } from "@/stores/uiStore";

/**
 * macOS only: mirrors the frontend menu tree into the native menu bar.
 * Pushes a serialized model to `set_native_menu` whenever anything the menu
 * depends on changes (language, tab/pane state, sidebar order, maximize state)
 * and only while this window is focused, since the macOS menu bar is app-global
 * and must always reflect the focused window. Also routes `native-menu-click`
 * (emitted by Rust to the focused window) back into executeMenuAction.
 */
export function useMacNativeMenu(): void {
  useEffect(() => {
    if (!IS_MAC || !isTauri()) return;

    let disposed = false;
    let lastPushed: string | null = null;
    // Start pessimistic: pushing is gated until isFocused() confirms this
    // window really is focused, so a background window opening never
    // overwrites the app-global menu the focused window already pushed.
    let focused = false;
    let maximized = false;
    let pending = false;

    const translate = (key: string) => i18n.t(key);

    const push = () => {
      if (disposed || !focused) return;
      const model = serializeNativeMenu(translate, getMenuContext(maximized));
      const json = JSON.stringify(model);
      if (json === lastPushed) return;
      lastPushed = json;
      void invoke("set_native_menu", { model }).catch((error: unknown) => {
        // Keep the previous native menu; retry on the next relevant change.
        lastPushed = null;
        console.error("set_native_menu failed", error);
      });
    };

    const schedule = () => {
      if (pending || disposed) return;
      pending = true;
      queueMicrotask(() => {
        pending = false;
        push();
      });
    };

    const cleanups: Array<() => void> = [];
    cleanups.push(useTabsStore.subscribe(schedule));
    cleanups.push(useUiStore.subscribe(schedule));
    i18n.on("languageChanged", schedule);
    cleanups.push(() => i18n.off("languageChanged", schedule));

    const win = getCurrentWindow();
    void win
      .isFocused()
      .then((value) => {
        focused = value;
        schedule();
      })
      .catch((error: unknown) => console.error("isFocused failed", error));
    void isWindowMaximized()
      .then((value) => {
        maximized = value;
        schedule();
      })
      .catch((error: unknown) => console.error("isMaximized failed", error));

    const unlistenPromises: Array<Promise<UnlistenFn>> = [
      win.onFocusChanged(({ payload }) => {
        focused = payload;
        if (payload) {
          // Another window may have pushed its own model meanwhile; force a
          // re-push even when this window's model is byte-identical.
          lastPushed = null;
          schedule();
        }
      }),
      onWindowResized(() => {
        void isWindowMaximized()
          .then((value) => {
            if (value !== maximized) {
              maximized = value;
              schedule();
            }
          })
          .catch((error: unknown) => console.error("isMaximized failed", error));
      }),
      getCurrentWebview().listen<string>("native-menu-click", ({ payload }) => {
        // The async unlisten may not have resolved yet after cleanup; a click
        // draining in that window must not act on a torn-down component.
        if (disposed) return;
        const ctx = getMenuContext(maximized);
        const item = findItemById(buildMenus(ctx), payload);
        // Re-check disabled: the native menu state may lag a store change by
        // one push, and a disabled action must never run.
        if (item?.action && !(item.disabled?.(ctx) ?? false)) {
          executeMenuAction(item.action);
        }
      }),
    ];

    return () => {
      disposed = true;
      for (const cleanup of cleanups) cleanup();
      for (const promise of unlistenPromises) {
        void promise.then((unlisten) => unlisten()).catch(() => {});
      }
    };
  }, []);
}
