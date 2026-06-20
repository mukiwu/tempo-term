import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePrStore } from "./prStore";
import { ghAvailable, prViaApi, prViaGh, type PrInfo } from "./prBridge";

vi.mock("./prBridge", () => ({
  ghAvailable: vi.fn(),
  prViaGh: vi.fn(),
  prViaApi: vi.fn(),
}));

const pr: PrInfo = { number: 42, state: "open", url: "u", title: null };

beforeEach(() => {
  usePrStore.setState({ prs: {}, fetchedAt: {} });
  vi.mocked(ghAvailable).mockReset();
  vi.mocked(prViaGh).mockReset();
  vi.mocked(prViaApi).mockReset();
});

describe("prStore", () => {
  it("caches the PR by cwd using gh when the source is gh", async () => {
    vi.mocked(prViaGh).mockResolvedValue(pr);
    await usePrStore.getState().refresh("/a", "main", "gh");
    expect(usePrStore.getState().prs["/a"]).toEqual(pr);
    expect(prViaGh).toHaveBeenCalledWith("/a", "main");
  });

  it("falls back to the API in auto mode when gh is absent", async () => {
    vi.mocked(ghAvailable).mockResolvedValue(false);
    vi.mocked(prViaApi).mockResolvedValue(pr);
    await usePrStore.getState().refresh("/a", "main", "auto");
    expect(prViaApi).toHaveBeenCalledWith("/a", "main");
    expect(usePrStore.getState().prs["/a"]).toEqual(pr);
  });

  it("does nothing when the source is off", async () => {
    await usePrStore.getState().refresh("/a", "main", "off");
    expect(prViaGh).not.toHaveBeenCalled();
    expect(prViaApi).not.toHaveBeenCalled();
    expect(usePrStore.getState().prs["/a"]).toBeUndefined();
  });

  it("leaves the cache untouched when a fetch throws", async () => {
    usePrStore.setState({ prs: { "/a": pr }, fetchedAt: {} });
    vi.mocked(prViaGh).mockRejectedValue(new Error("boom"));
    await usePrStore.getState().refresh("/a", "main", "gh");
    expect(usePrStore.getState().prs["/a"]).toEqual(pr);
  });

  it("records a fetch timestamp even when the fetch fails, to avoid retry storms", async () => {
    vi.mocked(prViaGh).mockRejectedValue(new Error("boom"));
    await usePrStore.getState().refresh("/a", "main", "gh");
    expect(usePrStore.getState().fetchedAt["/a"]).toBeTypeOf("number");
  });
});
