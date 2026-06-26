import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

/** Cached once granted, so repeat sends skip the permission IPC round-trip. */
let permissionGranted = false;

/**
 * Ask the OS for notification permission if we don't already have it. Safe to
 * call repeatedly; returns whether notifications may now be sent. Swallows
 * errors (e.g. no backend in tests/web preview) and reports no permission.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (permissionGranted) {
    return true;
  }
  try {
    if (await isPermissionGranted()) {
      permissionGranted = true;
      return true;
    }
    permissionGranted = (await requestPermission()) === "granted";
    return permissionGranted;
  } catch {
    return false;
  }
}

/**
 * Fire one OS desktop notification, requesting permission first if needed. A
 * thin wrapper over the Tauri plugin so callers stay testable and never throw.
 */
export async function notifyDesktop(title: string, body: string): Promise<void> {
  try {
    if (!(await ensureNotificationPermission())) {
      return;
    }
    sendNotification({ title, body });
  } catch {
    // Notifications are best-effort; never let a failure bubble into the app.
  }
}
