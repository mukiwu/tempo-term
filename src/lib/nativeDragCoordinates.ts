/**
 * Tauri reports native drag coordinates in physical pixels on some platforms
 * and logical pixels on others. Accept either representation so drop targets
 * stay accurate on Retina and scaled Windows displays.
 */
export function nativePointInElement(
  element: Element,
  x: number,
  y: number,
  devicePixelRatio = window.devicePixelRatio || 1,
): boolean {
  const rect = element.getBoundingClientRect();
  const points =
    devicePixelRatio === 1
      ? [[x, y]]
      : [
          [x, y],
          [x / devicePixelRatio, y / devicePixelRatio],
        ];

  return points.some(
    ([clientX, clientY]) =>
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom,
  );
}
