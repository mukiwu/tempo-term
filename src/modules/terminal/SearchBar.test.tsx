import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ISearchOptions } from "@xterm/addon-search";
import { SearchBar } from "./SearchBar";
import "../../i18n";

function makeController() {
  return {
    findNext: vi.fn((_query: string, _options?: ISearchOptions) => true),
    findPrevious: vi.fn((_query: string, _options?: ISearchOptions) => true),
    clearDecorations: vi.fn(),
  };
}

describe("SearchBar", () => {
  it("searches forward when the user types a query and presses Enter", () => {
    const search = makeController();
    render(<SearchBar search={search} onClose={() => {}} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "needle" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(search.findNext).toHaveBeenCalledWith(
      "needle",
      expect.objectContaining({ decorations: expect.anything() }),
    );
  });

  it("highlights matches with a visible decoration background", () => {
    const search = makeController();
    render(<SearchBar search={search} onClose={() => {}} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "needle" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const options = search.findNext.mock.calls[0]?.[1];
    expect(options?.decorations?.matchBackground).toBeTruthy();
    expect(options?.decorations?.activeMatchBackground).toBeTruthy();
  });

  it("searches backward when the user presses Shift+Enter", () => {
    const search = makeController();
    render(<SearchBar search={search} onClose={() => {}} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "needle" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(search.findPrevious).toHaveBeenCalledWith(
      "needle",
      expect.objectContaining({ decorations: expect.anything() }),
    );
    expect(search.findNext).not.toHaveBeenCalled();
  });

  it("closes when the user presses Escape", () => {
    const search = makeController();
    const onClose = vi.fn();
    render(<SearchBar search={search} onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  it("clears the highlight as soon as the query is emptied", () => {
    const search = makeController();
    render(<SearchBar search={search} onClose={() => {}} />);
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "needle" } });
    search.clearDecorations.mockClear();
    fireEvent.change(input, { target: { value: "" } });

    expect(search.clearDecorations).toHaveBeenCalled();
  });

  it("clears the search highlight when it unmounts", () => {
    const search = makeController();
    const { unmount } = render(<SearchBar search={search} onClose={() => {}} />);

    unmount();

    expect(search.clearDecorations).toHaveBeenCalled();
  });

  it("searches forward and backward from the next/previous buttons", () => {
    const search = makeController();
    render(<SearchBar search={search} onClose={() => {}} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "needle" } });
    fireEvent.click(screen.getByLabelText("Find next"));
    fireEvent.click(screen.getByLabelText("Find previous"));

    expect(search.findNext).toHaveBeenCalledWith("needle", expect.anything());
    expect(search.findPrevious).toHaveBeenCalledWith("needle", expect.anything());
  });
});
