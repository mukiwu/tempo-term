import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "./workspaceStore";

function reset() {
  useWorkspaceStore.setState({
    rootPath: null,
    openFiles: [],
    activeFile: null,
  });
}

describe("workspaceStore", () => {
  beforeEach(reset);

  it("sets the workspace root", () => {
    useWorkspaceStore.getState().setRoot("/Users/muki/project");
    expect(useWorkspaceStore.getState().rootPath).toBe("/Users/muki/project");
  });

  it("opens a file and makes it active", () => {
    useWorkspaceStore.getState().openFile("/a/b.ts");
    expect(useWorkspaceStore.getState().openFiles).toEqual(["/a/b.ts"]);
    expect(useWorkspaceStore.getState().activeFile).toBe("/a/b.ts");
  });

  it("does not open the same file twice but re-activates it", () => {
    const store = useWorkspaceStore.getState();
    store.openFile("/a/b.ts");
    store.openFile("/a/c.ts");
    store.openFile("/a/b.ts");
    expect(useWorkspaceStore.getState().openFiles).toEqual(["/a/b.ts", "/a/c.ts"]);
    expect(useWorkspaceStore.getState().activeFile).toBe("/a/b.ts");
  });

  it("activates a neighbour when the active file is closed", () => {
    const store = useWorkspaceStore.getState();
    store.openFile("/a/b.ts");
    store.openFile("/a/c.ts");
    store.closeFile("/a/c.ts");
    expect(useWorkspaceStore.getState().activeFile).toBe("/a/b.ts");
    expect(useWorkspaceStore.getState().openFiles).toEqual(["/a/b.ts"]);
  });

  it("clears the active file when the last file closes", () => {
    const store = useWorkspaceStore.getState();
    store.openFile("/a/b.ts");
    store.closeFile("/a/b.ts");
    expect(useWorkspaceStore.getState().activeFile).toBeNull();
  });
});
