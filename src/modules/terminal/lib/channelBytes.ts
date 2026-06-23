/**
 * Normalise whatever shape the channel delivers (ArrayBuffer, a typed array,
 * or a plain number array) into a Uint8Array, so terminal output renders
 * regardless of how Tauri serialises the binary payload.
 */
export function toBytes(message: unknown): Uint8Array {
  if (message instanceof Uint8Array) {
    return message;
  }
  if (message instanceof ArrayBuffer) {
    return new Uint8Array(message);
  }
  if (Array.isArray(message)) {
    return Uint8Array.from(message as number[]);
  }
  if (message && typeof message === "object" && "data" in message) {
    const data = (message as { data: unknown }).data;
    if (Array.isArray(data)) {
      return Uint8Array.from(data as number[]);
    }
    if (data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    }
  }
  return new Uint8Array();
}
