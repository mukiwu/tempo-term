import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComparisonBaseSelector, baseLabel, parseRange } from "./ComparisonBaseSelector";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (vars && "count" in vars) {
        return `${key}:${String(vars.count)}`;
      }
      if (vars && "name" in vars) {
        return `${key}:${String(vars.name)}`;
      }
      return key;
    },
  }),
  // The comparison base store reaches tabsStore, which transitively pulls in
  // the real i18n init and registers this plugin object as it loads.
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/modules/source-control/lib/gitBridge", () => ({
  gitComparisonBases: vi.fn(),
  gitResolveRev: vi.fn(),
  gitTags: vi.fn(),
}));

vi.mock("@/modules/git-graph/lib/gitGraphBridge", () => ({
  gitBranches: vi.fn(),
}));

import {
  gitComparisonBases,
  gitResolveRev,
  gitTags,
} from "@/modules/source-control/lib/gitBridge";
import { gitBranches } from "@/modules/git-graph/lib/gitGraphBridge";
import { useComparisonBaseStore, baseFor } from "./lib/comparisonBaseStore";

/** Recent enough that the "how long ago" column has something to say. */
const hoursAgo = (hours: number) => Math.round(Date.now() / 1000) - hours * 3600;

/** Every row of the open list, in order, by its label column. */
const labels = () =>
  screen.getAllByRole("option").map((row) => row.children[1]?.textContent ?? "");

/** The right-hand column of each row: why it is on the list. */
const hints = () => screen.getAllByRole("option").map((row) => row.children[2]?.textContent ?? "");

/** The runs each row picked out as matching the search. */
const marks = () =>
  screen
    .getAllByRole("option")
    .flatMap((row) => [...(row.children[1]?.querySelectorAll(".text-accent") ?? [])])
    .map((mark) => mark.textContent);

function openList() {
  fireEvent.click(screen.getAllByRole("button", { name: "baseSelector" })[0]);
  return screen.getByPlaceholderText("baseFilterPlaceholder");
}

const base = () => baseFor(useComparisonBaseStore.getState().byRepo, "/repo");

describe("baseLabel", () => {
  it("writes a range the way git writes it", () => {
    // The notation is the explanation: two dots between two points.
    expect(baseLabel({ kind: "range", from: "936578d", to: "2db2298" }, "x")).toBe(
      "936578d..2db2298",
    );
    expect(baseLabel({ kind: "ref", name: "upstream/main" }, "x")).toBe("upstream/main");
    // The working tree has no name of its own, so the caller supplies one.
    expect(baseLabel({ kind: "worktree" }, "uncommitted")).toBe("uncommitted");
  });
});

describe("parseRange", () => {
  it("reads a two-dot range, trimming what was typed around it", () => {
    expect(parseRange("936578d..2db2298")).toEqual({
      kind: "range",
      from: "936578d",
      to: "2db2298",
    });
    expect(parseRange("  a .. b  ")).toEqual({ kind: "range", from: "a", to: "b" });
    expect(parseRange("52ccbba^..52ccbba")).toEqual({
      kind: "range",
      from: "52ccbba^",
      to: "52ccbba",
    });
  });

  it("refuses three dots rather than quietly reading them as two", () => {
    // They mean something else -- from where the two diverged -- and a range
    // is compared literally. Reading one as the other would answer a
    // different question under the label of this one.
    expect(parseRange("master...HEAD")).toBeNull();
  });

  it("refuses a range with an end missing", () => {
    expect(parseRange("a..")).toBeNull();
    expect(parseRange("..b")).toBeNull();
    expect(parseRange("just-a-branch")).toBeNull();
  });
});

describe("ComparisonBaseSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useComparisonBaseStore.setState({ byRepo: {}, includeUncommitted: true });
    vi.mocked(gitComparisonBases).mockResolvedValue({
      suggested: "upstream/main",
      bases: [
        { name: "upstream/main", kind: "upstream", lastCommitAt: hoursAgo(700) },
        { name: "origin/main", kind: "remoteDefault", lastCommitAt: hoursAgo(700) },
      ],
    });
    vi.mocked(gitBranches).mockResolvedValue([
      { name: "master", isCurrent: true, isRemote: false, lastCommitAt: hoursAgo(1) },
      { name: "feat/one", isCurrent: false, isRemote: false, lastCommitAt: hoursAgo(2) },
      { name: "feat/two", isCurrent: false, isRemote: false, lastCommitAt: hoursAgo(3) },
      { name: "feat/three", isCurrent: false, isRemote: false, lastCommitAt: hoursAgo(4) },
      { name: "chore/lint", isCurrent: false, isRemote: false, lastCommitAt: hoursAgo(5) },
      { name: "old/thing", isCurrent: false, isRemote: false, lastCommitAt: hoursAgo(900) },
    ]);
    vi.mocked(gitTags).mockResolvedValue([{ name: "v1.2.0", lastCommitAt: hoursAgo(6) }]);
    vi.mocked(gitResolveRev).mockResolvedValue("1111111111111111111111111111111111111111");
  });

  it("shows what the page is comparing against", () => {
    const { rerender } = render(<ComparisonBaseSelector repo="/repo" narrow={false} />);
    expect(screen.getAllByRole("button", { name: "baseSelector" })[0]).toHaveTextContent(
      "baseWorktree",
    );

    useComparisonBaseStore.getState().setBase("/repo", { kind: "range", from: "a", to: "b" });
    rerender(<ComparisonBaseSelector repo="/repo" narrow={false} />);

    expect(screen.getAllByRole("button", { name: "baseSelector" })[0]).toHaveTextContent("a..b");
  });

  it("reads the lists when it is opened, not when it is mounted", async () => {
    render(<ComparisonBaseSelector repo="/repo" narrow={false} />);
    // A control nobody has clicked is not worth three git calls, and the
    // list is fresher for having waited.
    expect(gitComparisonBases).not.toHaveBeenCalled();

    openList();

    await waitFor(() => expect(gitComparisonBases).toHaveBeenCalledWith("/repo"));
    expect(gitBranches).toHaveBeenCalledWith("/repo");
    expect(gitTags).toHaveBeenCalledWith("/repo");
  });

  it("leads with the refs always worth offering, then everything by recency", async () => {
    render(<ComparisonBaseSelector repo="/repo" narrow={false} />);
    openList();

    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(1));
    // The working tree first, then the two offered refs keeping their place
    // whatever their dates -- upstream/main must not fall off the list for
    // having been quiet a month -- then branches and tags together, newest
    // first. Six refs, so `old/thing` and the tag are behind the footer.
    expect(labels()).toEqual([
      "baseWorktree",
      "upstream/main",
      "origin/main",
      "feat/one",
      "feat/two",
      "feat/three",
      "chore/lint",
    ]);
    // The current branch is not on it: comparing it against itself shows
    // nothing.
    expect(labels()).not.toContain("master");
    // One column, one question: why is this row here.
    expect(hints().slice(0, 3)).toEqual([
      "baseWorktreeHint",
      "baseTrackingBranch",
      "baseDefaultBranch",
    ]);
    // And the list says out loud that it is cut, rather than reading as
    // everything the repo has.
    expect(screen.getByText("baseMoreHidden:2")).toBeInTheDocument();
  });

  it("lifts the cap when something is typed, and marks what matched", async () => {
    const { container } = render(<ComparisonBaseSelector repo="/repo" narrow={false} />);
    const input = openList();
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(7));

    fireEvent.change(input, { target: { value: "eat" } });

    // A search that found three things shows three, with no footer left
    // claiming anything is hidden.
    expect(labels()).toEqual(["feat/one", "feat/two", "feat/three"]);
    expect(screen.queryByText(/^baseMoreHidden/)).not.toBeInTheDocument();
    // Every row picks out what matched -- on a list of paths, "why is this in
    // my results" is not always obvious.
    expect(marks()).toEqual(["eat", "eat", "eat"]);
    expect(container.querySelectorAll("[role=option]").length).toBe(3);

    // A tag is on the same list as the branches: which kind of name a thing
    // is is not how anyone remembers it.
    fireEvent.change(input, { target: { value: "v1.2" } });
    expect(labels()).toEqual(["v1.2.0"]);
  });

  it("moves the row Enter takes, and stops at the ends", async () => {
    render(<ComparisonBaseSelector repo="/repo" narrow={false} />);
    const input = openList();
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(7));

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    // Up once more than down would wrap round to the last branch, which reads
    // as having lost your place.
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(base()).toEqual({ kind: "ref", name: "origin/main" }));
    // Picked, so nothing needed vouching for.
    expect(gitResolveRev).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("takes a hash that was typed, once git has vouched for it", async () => {
    render(<ComparisonBaseSelector repo="/repo" narrow={false} />);
    const input = openList();
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(7));

    // A hash pasted from a pull request or a CI log will never be on any
    // list, so it becomes a row of its own -- visible and arrowable, rather
    // than a special case hidden inside the Enter handler.
    fireEvent.change(input, { target: { value: "9a5b197" } });
    expect(labels()).toEqual(["9a5b197"]);
    expect(hints()).toEqual(["baseUseTyped"]);

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(base()).toEqual({ kind: "ref", name: "9a5b197" }));
    expect(gitResolveRev).toHaveBeenCalledWith("/repo", "9a5b197");
  });

  it("keeps the list open and says so when git does not know the rev", async () => {
    vi.mocked(gitResolveRev).mockResolvedValue(null);
    render(<ComparisonBaseSelector repo="/repo" narrow={false} />);
    const input = openList();
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(7));

    fireEvent.change(input, { target: { value: "deadbee" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Asked before the page moves, not after: switching to a base that turns
    // out not to exist costs more than the error it produces, because the
    // comparison being read is gone by then.
    await waitFor(() => expect(screen.getByText("baseUnknownRev:deadbee")).toBeInTheDocument());
    expect(base()).toEqual({ kind: "worktree" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("builds a range from the far end once the dots are typed", async () => {
    render(<ComparisonBaseSelector repo="/repo" narrow={false} />);
    const input = openList();
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(7));

    fireEvent.change(input, { target: { value: "35119e5^.." } });

    // The left side is settled, so every row is a whole range: half of it is
    // already typed and out of sight above the caret, and a list of bare
    // names would leave you assembling it in your head. HEAD leads because
    // the far end almost always is HEAD.
    expect(labels().slice(0, 3)).toEqual([
      "35119e5^..HEAD",
      "35119e5^..upstream/main",
      "35119e5^..origin/main",
    ]);
    expect(hints()[0]).toBe("baseHeadHint");

    // Tab completes rather than commits, so a name can be filled in and then
    // built on; Enter is what takes it.
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input).toHaveValue("35119e5^..HEAD");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(base()).toEqual({ kind: "worktree" });

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(base()).toEqual({ kind: "range", from: "35119e5^", to: "HEAD" }),
    );
  });

  it("matches the far end being typed, not the whole box", async () => {
    render(<ComparisonBaseSelector repo="/repo" narrow={false} />);
    const input = openList();
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(7));

    // Matching the whole box is why `a..fea` found nothing: no branch is
    // called "35119e5^..fea". Half a name is also a whole range, so what was
    // typed is on the list too -- but behind the matches, or Tab would
    // complete the text to itself and Enter would take a rev that does not
    // exist.
    fireEvent.change(input, { target: { value: "35119e5^..fea" } });
    expect(labels()).toEqual([
      "35119e5^..feat/one",
      "35119e5^..feat/two",
      "35119e5^..feat/three",
      "35119e5^..fea",
    ]);
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input).toHaveValue("35119e5^..feat/one");

    // A far end spelled out matches no list and is still what was asked for.
    fireEvent.change(input, { target: { value: "35119e5^..35119e5" } });
    expect(labels()).toEqual(["35119e5^..35119e5"]);

    fireEvent.keyDown(input, { key: "Enter" });

    // Typed outright, so both ends are asked about before the page moves.
    await waitFor(() =>
      expect(base()).toEqual({ kind: "range", from: "35119e5^", to: "35119e5" }),
    );
    expect(gitResolveRev).toHaveBeenCalledWith("/repo", "35119e5^");
    expect(gitResolveRev).toHaveBeenCalledWith("/repo", "35119e5");
  });

  it("keeps the range the page is on, on the list", async () => {
    useComparisonBaseStore
      .getState()
      .setBase("/repo", { kind: "range", from: "936578d", to: "2db2298" });
    render(<ComparisonBaseSelector repo="/repo" narrow={false} />);
    openList();
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(8));

    // A range came from the graph or was typed, so it is on no list; pinned
    // here, or there is no way back to it except to leave and come again.
    expect(labels()[0]).toBe("936578d..2db2298");
    // And it carries the tick, which is a different thing from the row the
    // arrow keys are on.
    expect(within(screen.getAllByRole("option")[0]).getByText("936578d..2db2298")).toBeTruthy();
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("says nothing to git when there is no repo", () => {
    render(<ComparisonBaseSelector repo={null} narrow={false} />);
    openList();

    expect(gitComparisonBases).not.toHaveBeenCalled();
    // The box still opens and still says what it is comparing: an empty list
    // is a better answer than a control that does not respond.
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(labels()).toEqual(["baseWorktree"]);
  });
});
