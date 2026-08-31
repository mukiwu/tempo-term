import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import "@/i18n";
import { GitGraphSettingsSection } from "./GitGraphSettingsSection";
import { useSettingsStore } from "@/stores/settingsStore";

beforeEach(() => {
  useSettingsStore.setState({
    gitGraphRefs: {
      mergeLocalRemote: true,
      hideOriginHead: true,
      collapseExtraRefs: true,
      refLimit: 3,
    },
  });
});

function checkbox(name: RegExp): HTMLInputElement {
  return screen.getByLabelText(name) as HTMLInputElement;
}

describe("GitGraphSettingsSection", () => {
  it("ships every condensing option on", () => {
    render(<GitGraphSettingsSection />);
    expect(checkbox(/Merge a branch/).checked).toBe(true);
    expect(checkbox(/Hide origin\/HEAD/).checked).toBe(true);
    expect(checkbox(/Collapse extra labels/).checked).toBe(true);
  });

  it("turns an option off in the store, so the row goes back to how it was", () => {
    render(<GitGraphSettingsSection />);
    fireEvent.click(checkbox(/Merge a branch/));
    expect(useSettingsStore.getState().gitGraphRefs.mergeLocalRemote).toBe(false);
  });

  it("keeps the +N threshold within range and disables it when collapsing is off", () => {
    render(<GitGraphSettingsSection />);
    const limit = screen.getByLabelText(/Labels shown/) as HTMLInputElement;

    fireEvent.change(limit, { target: { value: "99" } });
    expect(useSettingsStore.getState().gitGraphRefs.refLimit).toBe(10);

    fireEvent.click(checkbox(/Collapse extra labels/));
    expect((screen.getByLabelText(/Labels shown/) as HTMLInputElement).disabled).toBe(true);
  });
});
