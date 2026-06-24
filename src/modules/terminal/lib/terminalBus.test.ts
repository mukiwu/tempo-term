import { describe, expect, it } from "vitest";
import {
  readTerminalBuffer,
  registerTerminalReader,
  unregisterTerminalReader,
} from "./terminalBus";

describe("terminal buffer readers", () => {
  it("returns null when no reader is registered for a leaf", () => {
    expect(readTerminalBuffer("missing")).toBeNull();
  });

  it("returns the registered reader's current output", () => {
    registerTerminalReader("leaf-1", () => "hello from shell");
    expect(readTerminalBuffer("leaf-1")).toBe("hello from shell");
    unregisterTerminalReader("leaf-1");
  });

  it("stops returning output after the reader is unregistered", () => {
    registerTerminalReader("leaf-2", () => "bye");
    unregisterTerminalReader("leaf-2");
    expect(readTerminalBuffer("leaf-2")).toBeNull();
  });
});
