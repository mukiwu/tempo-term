import { describe, expect, it } from "vitest";
import { isEmptyProgress, useProgressStore } from "./progressStore";
import { emptyProgressState, reduceProgress } from "./progressState";

describe("isEmptyProgress", () => {
  it("is true for a fresh empty state", () => {
    expect(isEmptyProgress(emptyProgressState())).toBe(true);
  });

  it("is false once a tool has run, even after it finished", () => {
    let state = reduceProgress(emptyProgressState(), { kind: "tool:start", id: "t1", name: "Bash" });
    state = reduceProgress(state, { kind: "tool:end", id: "t1", name: "Bash", ok: true });

    expect(isEmptyProgress(state)).toBe(false);
  });
});

describe("sessionEpochs", () => {
  it("increments a cwd's epoch each time its session resets", () => {
    useProgressStore.setState({ sessions: {}, sessionEpochs: {} });
    useProgressStore.getState().pushLines("/a", [], true);
    expect(useProgressStore.getState().sessionEpochs["/a"]).toBe(1);
    useProgressStore.getState().pushLines("/a", [], true);
    expect(useProgressStore.getState().sessionEpochs["/a"]).toBe(2);
  });

  it("does not bump the epoch on a non-reset append", () => {
    useProgressStore.setState({ sessions: {}, sessionEpochs: { "/a": 1 } });
    useProgressStore.getState().pushLines("/a", [], false);
    expect(useProgressStore.getState().sessionEpochs["/a"]).toBe(1);
  });
});
