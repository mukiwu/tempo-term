import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MediaTabContent } from "./MediaTabContent";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("MediaTabContent", () => {
  it("renders the image through the asset url with the filename in the header", () => {
    render(<MediaTabContent path="/pics/shot.png" showClose={false} />);
    // convertFileSrc is mocked to identity in the test setup.
    expect(screen.getByRole("img", { name: "shot.png" })).toHaveAttribute(
      "src",
      "/pics/shot.png",
    );
    expect(screen.getByText("shot.png")).toBeInTheDocument();
  });

  it("shows a load error instead of a blank pane when the file cannot render", () => {
    render(<MediaTabContent path="/pics/broken.png" showClose={false} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText("mediaLoadError")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("folds the pane close button into the header row", () => {
    const onClose = vi.fn();
    render(<MediaTabContent path="/pics/shot.png" showClose onClose={onClose} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
