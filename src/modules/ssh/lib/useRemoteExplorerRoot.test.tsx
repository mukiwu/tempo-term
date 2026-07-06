import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ensure = vi.fn();
vi.mock("./sftpSessionStore", () => ({
  sftpSessionStore: { getState: () => ({ ensure }) },
}));
const sftpHome = vi.fn();
vi.mock("./sftp-bridge", () => ({ sftpHome: (...a: unknown[]) => sftpHome(...a) }));

const setRoot = vi.fn();
vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: { getState: () => ({ setRoot }) },
}));

import { useRemoteExplorerRoot } from "./useRemoteExplorerRoot";
import { remoteCwdStore } from "./remoteCwdStore";

function Probe({ id }: { id: string | null }) {
  useRemoteExplorerRoot(id);
  return null;
}

beforeEach(() => {
  ensure.mockReset();
  sftpHome.mockReset();
  setRoot.mockReset();
  remoteCwdStore.setState({ cwds: {} });
});

describe("useRemoteExplorerRoot", () => {
  it("sets the explorer root to the remote home for an active ssh connection", async () => {
    ensure.mockResolvedValue(7);
    sftpHome.mockResolvedValue("/home/me");
    render(<Probe id="c1" />);
    await vi.waitFor(() => expect(setRoot).toHaveBeenCalledWith("ssh://c1/home/me"));
    expect(ensure).toHaveBeenCalledWith("c1");
  });

  it("does nothing when there is no active ssh connection", async () => {
    render(<Probe id={null} />);
    await Promise.resolve();
    expect(ensure).not.toHaveBeenCalled();
    expect(setRoot).not.toHaveBeenCalled();
  });

  it("roots at the last OSC 7 cwd instead of home when one is known", async () => {
    remoteCwdStore.getState().report("c1", "/home/me/proj");
    render(<Probe id="c1" />);
    await vi.waitFor(() => expect(setRoot).toHaveBeenCalledWith("ssh://c1/home/me/proj"));
    expect(sftpHome).not.toHaveBeenCalled();
  });

  it("drops the home result when an OSC 7 report raced it", async () => {
    ensure.mockResolvedValue(7);
    let resolveHome: (v: string) => void = () => {};
    sftpHome.mockReturnValue(new Promise((r) => { resolveHome = r; }));
    render(<Probe id="c1" />);
    await vi.waitFor(() => expect(sftpHome).toHaveBeenCalled());
    remoteCwdStore.getState().report("c1", "/home/me/proj");
    resolveHome("/home/me");
    await Promise.resolve();
    expect(setRoot).not.toHaveBeenCalledWith("ssh://c1/home/me");
  });
});
