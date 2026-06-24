import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "./workspaceStore";

function reset() {
  useWorkspaceStore.setState({ rootPath: null });
}

describe("workspaceStore", () => {
  beforeEach(reset);

  it("sets the workspace root", () => {
    useWorkspaceStore.getState().setRoot("/Users/muki/project");
    expect(useWorkspaceStore.getState().rootPath).toBe("/Users/muki/project");
  });
});
