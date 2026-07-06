import { beforeEach, describe, expect, it } from "vitest";
import { remoteCwdStore } from "./remoteCwdStore";

beforeEach(() => {
  remoteCwdStore.setState({ cwds: {} });
});

describe("remoteCwdStore", () => {
  it("records the latest reported cwd per connection", () => {
    remoteCwdStore.getState().report("c1", "/home/me");
    remoteCwdStore.getState().report("c1", "/home/me/proj");
    remoteCwdStore.getState().report("c2", "/srv");
    expect(remoteCwdStore.getState().cwds).toEqual({ c1: "/home/me/proj", c2: "/srv" });
  });
});
