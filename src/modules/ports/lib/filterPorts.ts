import { classifyService } from "./classifyService";
import type { PortInfo } from "./portsBridge";

/** Search every stable identity/detail field visible in a port row. */
export function filterPorts(ports: PortInfo[], query: string): PortInfo[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return ports;

  return ports.filter((port) => {
    const service = classifyService(port);
    const searchable = [
      String(port.port),
      `:${port.port}`,
      port.protocol,
      port.bindAddr,
      `${port.bindAddr}:${port.port}`,
      String(port.pid),
      service.label,
      port.processName,
      port.command,
      port.cwd,
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n")
      .toLocaleLowerCase();

    return searchable.includes(needle);
  });
}
