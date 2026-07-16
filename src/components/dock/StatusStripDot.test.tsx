import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusStripDot } from "./StatusStripDot";

describe("StatusStripDot", () => {
  it("spins a ring for a working (active) agent", () => {
    const { container } = render(<StatusStripDot status="active" />);
    expect(container.querySelector('[class*="animate-spin"]')).not.toBeNull();
  });

  it("spins for a thinking agent too", () => {
    const { container } = render(<StatusStripDot status="thinking" />);
    expect(container.querySelector('[class*="animate-spin"]')).not.toBeNull();
  });

  it("pulses without a ring when waiting for approval", () => {
    const { container } = render(<StatusStripDot status="waiting-approval" />);
    expect(container.querySelector('[class*="animate-spin"]')).toBeNull();
    expect(container.querySelector('[class*="animate-pulse"]')).not.toBeNull();
  });

  it("is a quiet dot when idle", () => {
    const { container } = render(<StatusStripDot status="idle" />);
    expect(container.querySelector('[class*="animate-spin"]')).toBeNull();
    expect(container.querySelector('[class*="animate-pulse"]')).toBeNull();
  });
});
