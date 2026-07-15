import { getCurrentWindow } from "@tauri-apps/api/window";
import { isMainWindow } from "@/lib/window";
import { IS_WINDOWS } from "@/lib/platform";
import { closeLocalSessions } from "@/modules/terminal/lib/pty-bridge";

/**
 * In a secondary window, intercept the close: shut down this window's PTY
 * sessions, then destroy the window. The main window keeps its default close
 * behavior (its sessions die with the process on quit). Returns an unlisten
 * function, or null when nothing was registered.
 */
export async function registerSecondaryWindowCleanup(): Promise<(() => void) | null> {
  if (isMainWindow()) {
    return null;
  }
  const win = getCurrentWindow();
  let cleaning = false;
  return win.onCloseRequested(async (event) => {
    if (cleaning) {
      // A second request (double Cmd+W, rapid clicks) while the first cleanup is
      // in flight must also be prevented, or Tauri's default close races the
      // in-progress closeLocalSessions and orphans its PTYs.
      event.preventDefault();
      return;
    }
    cleaning = true;
    event.preventDefault();
    try {
      // Session cleanup is best-effort: the close is already prevented, so a
      // closeLocalSessions failure must not skip destroy or the window is
      // stranded open with no way to close it.
      try {
        await closeLocalSessions();
      } catch {
        // fall through to destroy
      }
      await win.destroy();
    } catch (error) {
      // destroy failed: reset so the user can try closing again instead of being
      // stuck with a permanently un-closeable window.
      cleaning = false;
      throw error;
    }
  });
}

/**
 * On Windows, WebView2 does not restore DOM focus to the previously-focused
 * element when the OS window regains focus, so keystrokes go nowhere until the
 * user clicks (issue #205). WKWebView on macOS restores it natively, so this is
 * a no-op there — and skipping macOS also avoids fighting its native handling.
 *
 * We track the last-focused element via a `focusin` listener rather than reading
 * `document.activeElement` at window-blur time: WebView2 may drop DOM focus
 * before the blur event reaches us, so the active element is unreliable by then.
 * On re-focus we restore it — but only if (a) this webview actually holds focus
 * (`onFocusChanged` fires for the whole OS window, so a sibling child webview
 * like the native preview regaining focus would otherwise steal it back into the
 * main webview), (b) focus was genuinely lost, and (c) the element is still in
 * the DOM — so we never yank focus from a dialog that opened meanwhile or a tab
 * that closed while we were away. Restoring the element (not just calling
 * webview.set_focus in Rust) is required because set_focus only focuses the
 * webview container, not the DOM node.
 */
export async function restoreFocusOnWindowRefocus(): Promise<(() => void) | null> {
  if (!IS_WINDOWS) {
    return null;
  }
  const win = getCurrentWindow();
  let lastFocused: HTMLElement | null = null;
  const track = (event: FocusEvent) => {
    const el = event.target;
    if (el instanceof HTMLElement && el !== document.body) {
      lastFocused = el;
    }
  };
  document.addEventListener("focusin", track);
  try {
    const unlisten = await win.onFocusChanged(({ payload: focused }) => {
      if (!focused) {
        return;
      }
      const active = document.activeElement;
      const focusWasLost = active === null || active === document.body;
      if (document.hasFocus() && focusWasLost && lastFocused?.isConnected) {
        lastFocused.focus({ preventScroll: true });
      }
    });
    return () => {
      document.removeEventListener("focusin", track);
      unlisten();
    };
  } catch (error) {
    // Registration failed: drop the listener we already attached so it can't
    // leak, since we never hand back a cleanup function.
    document.removeEventListener("focusin", track);
    throw error;
  }
}
