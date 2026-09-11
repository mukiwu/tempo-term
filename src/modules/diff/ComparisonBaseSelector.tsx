import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  gitComparisonBases,
  gitResolveRev,
  gitTags,
  type ComparisonBase,
} from "@/modules/source-control/lib/gitBridge";
import { gitBranches } from "@/modules/git-graph/lib/gitGraphBridge";
import {
  baseFor,
  useComparisonBaseStore,
  WORKTREE,
  type ComparisonBaseValue,
} from "./lib/comparisonBaseStore";

/**
 * Refs shown before the filter box has been used; the footer says how many are
 * behind it.
 *
 * Six, not more. The ones that are always offered come first and count towards
 * it -- a fork checkout spends three on them (two remote defaults and the
 * tracking branch) -- so six leaves three recent branches, and the list stands
 * at seven rows with the working tree. That is a dropdown; ten is a page. What
 * makes the small number safe is that typing lifts the cap entirely.
 */
const SHOWN = 6;

interface Row {
  name: string;
  /** Why the row is here: a role for the ones always offered, a date for the
   * rest. One column, one question — what is this doing on the list. */
  role?: string;
  when?: number;
}

/**
 * Renders `lastCommitAt` as "3 days ago" at the granularity a reader cares
 * about. Anything older than a year is just the year.
 */
function ago(seconds: number, t: (k: string, v?: Record<string, unknown>) => string): string {
  if (!seconds) {
    return "";
  }
  const mins = Math.max(0, Math.round((Date.now() / 1000 - seconds) / 60));
  if (mins < 60) {
    return t("agoMinutes", { count: mins });
  }
  if (mins < 60 * 24) {
    return t("agoHours", { count: Math.round(mins / 60) });
  }
  if (mins < 60 * 24 * 30) {
    return t("agoDays", { count: Math.round(mins / (60 * 24)) });
  }
  return t("agoMonths", { count: Math.round(mins / (60 * 24 * 30)) });
}

/** How a base reads in the bar and on its row. */
export function baseLabel(base: ComparisonBaseValue, worktree: string): string {
  switch (base.kind) {
    case "worktree":
      return worktree;
    case "ref":
      return base.name;
    // Written the way git writes it, so the notation itself says which
    // comparison this is -- two dots between two points, three when a branch
    // is being read against the line it left.
    case "range":
      return `${base.from}..${base.to}`;
  }
}

/**
 * `a..b` typed or pasted into the box. Three dots are rejected rather than
 * quietly treated as two: they mean something different, and a range picked
 * out of the graph is two points compared literally.
 */
export function parseRange(text: string): ComparisonBaseValue | null {
  const at = text.indexOf("..");
  if (at < 0 || text.includes("...")) {
    return null;
  }
  const from = text.slice(0, at).trim();
  const to = text.slice(at + 2).trim();
  return from && to ? { kind: "range", from, to } : null;
}

/**
 * The all-changes page's comparison base: a trigger showing what is being
 * compared, opening one list of everything it could be.
 *
 * One level, not two. An earlier shape had a short menu of the obvious bases
 * and a "more…" picker behind it, until it turned out both were listing the
 * same thing — the picker's unfiltered view is the short menu plus the rest.
 * So the filter box is at the top of the only list there is, and typing works
 * without a click first.
 *
 * No group headings either. The right-hand column already answers the only
 * question a heading would: why is this row here. The handful that are always
 * offered say what they are (a remote's default, this branch's tracking
 * branch); the rest say how long ago they moved. Headings would cost two rows
 * to repeat that, and in a repo with one remote — most of them — the "default
 * branch" group would have a single member.
 */
export function ComparisonBaseSelector({ repo, narrow }: { repo: string | null; narrow: boolean }) {
  const { t } = useTranslation("sourceControl");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Which row the arrow keys are on. Zero rather than -1: the list always
  // has the working tree first, so there is always something to take.
  const [active, setActive] = useState(0);
  /** A typed rev that git does not know; the list stays open and says so. */
  const [unresolved, setUnresolved] = useState<string | null>(null);
  const [bases, setBases] = useState<ComparisonBase[]>([]);
  const [branches, setBranches] = useState<Row[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const byRepo = useComparisonBaseStore((s) => s.byRepo);
  const setBase = useComparisonBaseStore((s) => s.setBase);
  const base = baseFor(byRepo, repo);

  // Read on open rather than on mount: the list is only worth a git call when
  // someone is about to look at it, and it is fresher for having waited.
  useEffect(() => {
    if (!open || !repo) {
      return;
    }
    let cancelled = false;
    void Promise.all([gitComparisonBases(repo), gitBranches(repo), gitTags(repo)])
      .then(([offered, all, tagged]) => {
        if (cancelled) {
          return;
        }
        setBases(offered.bases);
        // Branches and tags in one list, sorted together: they are both names
        // you might be looking for, and which kind a thing is is not how
        // anyone remembers it. The current branch is dropped -- comparing it
        // against itself has nothing to show.
        setBranches(
          [
            ...all.filter((b) => !b.isCurrent).map((b) => ({ name: b.name, when: b.lastCommitAt })),
            ...tagged.map((tag) => ({ name: tag.name, when: tag.lastCommitAt })),
          ].sort((a, b) => (b.when ?? 0) - (a.when ?? 0)),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setBases([]);
          setBranches([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, repo]);

  useEffect(() => {
    if (!open) {
      return;
    }
    inputRef.current?.focus();
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const roles: Record<ComparisonBase["kind"], string> = {
    remoteDefault: t("baseDefaultBranch"),
    upstream: t("baseTrackingBranch"),
    localDefault: t("baseDefaultBranch"),
  };

  // The always-offered ones lead, then everything else by recency. A ref that
  // is both keeps its role and its place: `upstream/main` must not fall off the
  // list for having been quiet a month, which is the whole reason the two
  // groups are ordered rather than merged.
  const rows = useMemo<Row[]>(() => {
    const offered: Row[] = bases.map((b) => ({ name: b.name, role: roles[b.kind] }));
    const seen = new Set(offered.map((r) => r.name));
    return [...offered, ...branches.filter((b) => !seen.has(b.name))];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `roles` is rebuilt
    // every render off `t`; rebuilding the list on it would defeat the memo.
  }, [bases, branches]);

  // A new query is a new list; leaving the cursor where it was would put it
  // on a row that has nothing to do with what was typed.
  useEffect(() => {
    setActive(0);
    setUnresolved(null);
  }, [query, open]);

  /**
   * Half of a range typed in: `a..` and the caret after it.
   *
   * Once the dots are there the left side is settled, and what is being typed
   * is the far end -- so that is what the filter matches on. Matching the
   * whole box instead was why `a..HEA` found nothing: no branch is called
   * "a..HEA". Three dots are not a range this control carries, so they are
   * left alone rather than split.
   */
  const dots = query.includes("...") ? -1 : query.indexOf("..");
  const rangeHead = dots >= 0 ? query.slice(0, dots).trim() : null;
  const typing = rangeHead !== null ? query.slice(dots + 2) : query;

  const needle = typing.trim().toLowerCase();
  const matched = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
  const shown = needle ? matched : matched.slice(0, SHOWN);
  const hidden = matched.length - shown.length;

  // `..` or `...` is a range between two points, which this does not carry
  // yet: the page compares one base against the working tree.

  /**
   * Every row as one list, so the arrow keys and the rendering read from the
   * same thing. Keeping them apart is how the highlight ends up one row off
   * from what Enter takes.
   */
  const worktreeLabel = t("baseWorktree");
  type Option = {
    value: ComparisonBaseValue;
    label: string;
    hint: string;
    mono: boolean;
    /** Typed or pasted rather than picked off the list, so nothing has said
     * whether git knows it. */
    typed?: boolean;
  };
  let options: Option[];

  if (rangeHead !== null) {
    /**
     * Building a range: the left side is settled, so every row is a whole
     * range rather than a bare name. Seeing `a..HEAD` before picking it is
     * the point -- half of it is already typed and out of sight above the
     * caret, and a list of bare names would leave you assembling it in your
     * head.
     *
     * HEAD leads because the far end almost always is HEAD; it is offered
     * whether or not it was typed towards, since nothing in the branch list
     * is called that.
     */
    const far = [
      ...(!needle || "head".includes(needle) ? ["HEAD"] : []),
      ...shown.map((row) => row.name),
    ];
    options = far.map((name) => ({
      value: { kind: "range", from: rangeHead, to: name } as ComparisonBaseValue,
      label: `${rangeHead}..${name}`,
      hint: name === "HEAD" ? t("baseHeadHint") : t("baseRange"),
      mono: true,
    }));
    // What is typed outright, when it is already a whole range: `a..b` with
    // the far end spelled out matches no list and is still what was asked for.
    //
    // Last, behind whatever matched. It led the list until it turned out that
    // half a name is also a whole range: with `a..fea` in the box, `a..fea`
    // itself sat above `a..feat/one`, so Tab completed the text to what was
    // already there and Enter took a rev that does not exist. Behind the
    // matches it is still a row -- arrowable, clickable, and the only row
    // there when nothing matched, which is the case it exists for.
    const whole = parseRange(query.trim());
    if (whole && !options.some((o) => o.label === baseLabel(whole, ""))) {
      options.push({
        value: whole,
        label: baseLabel(whole, ""),
        hint: t("baseRange"),
        mono: true,
        typed: true,
      });
    }
  } else {
    options = [
      // A range is never on any list -- it came from the graph or was typed --
      // so while the page is on one it is pinned here, or there would be no
      // way back from it except to leave and come again.
      ...(base.kind === "range" && !needle
        ? [
            {
              value: base,
              label: baseLabel(base, ""),
              hint: t("baseRange"),
              mono: true,
            },
          ]
        : []),
      // Filtered like everything else. Leaving it pinned through a search was
      // how typing a hash ended up selecting the working tree: it sat at the
      // top as the row the cursor was on, and Enter took it.
      ...(!needle || worktreeLabel.toLowerCase().includes(needle)
        ? [
            {
              value: WORKTREE,
              label: worktreeLabel,
              hint: t("baseWorktreeHint"),
              mono: false,
            },
          ]
        : []),
      ...shown.map((row) => ({
        value: { kind: "ref", name: row.name } as ComparisonBaseValue,
        label: row.name,
        hint: row.role ?? ago(row.when ?? 0, t),
        mono: true,
      })),
    ];
    // A hash pasted from a pull request or a CI log is a perfectly good base
    // and will never be on any list, so what was typed becomes a row of its
    // own -- visible, arrowable, clickable, rather than a special case hidden
    // inside the Enter handler where nothing showed it was there.
    if (needle && options.length === 0) {
      options.push({
        value: { kind: "ref", name: query.trim() },
        label: query.trim(),
        hint: t("baseUseTyped"),
        mono: true,
        typed: true,
      });
    }
  }

  /**
   * Enter takes the first match, the way any filtered list does. With nothing
   * matched it takes the text at its word instead -- a hash pasted from a pull
   * request or a CI log is a perfectly good base and will never be on the
   * list, and the command resolves it and refuses what it cannot.
   */
  function submit() {
    const chosen = options[active];
    if (chosen) {
      void take(chosen);
    }
  }

  /**
   * Takes a row, resolving it first when it was typed rather than picked.
   *
   * A pasted hash is the one thing the list cannot vouch for -- truncated, from
   * another repo, rebased away since -- and acting on a bad one costs more than
   * the error it produces: the page switches, and the base that was being read
   * is gone. So the question is asked before the page moves, and a rev git does
   * not know leaves the list open saying so.
   */
  async function take(option: Option) {
    if (!option.typed || !repo) {
      pick(option.value);
      return;
    }
    const revs =
      option.value.kind === "range"
        ? [option.value.from, option.value.to]
        : option.value.kind === "ref"
          ? [option.value.name]
          : [];
    for (const rev of revs) {
      if (!(await gitResolveRev(repo, rev).catch(() => null))) {
        setUnresolved(rev);
        return;
      }
    }
    pick(option.value);
  }

  function pick(value: ComparisonBaseValue) {
    if (repo) {
      setBase(repo, value);
    }
    setOpen(false);
  }

  const label = baseLabel(base, t("baseWorktree"));

  return (
    <div ref={wrapRef} className={`relative shrink-0 ${narrow ? "w-40" : "w-64"}`}>
      {/* The shell Combobox wears in its dense size, so this reads as the
          app's combobox and not a third kind of dropdown. `select-none`
          because a click that drags a pixel would otherwise leave the
          webview's own selection box sitting on the label. */}
      <div
        className={`flex select-none items-center rounded-lg border bg-bg ${
          // Accent while the list is open, not just on focus-within: opening
          // moves focus into the popup, which is not inside this box, so
          // Combobox's own rule never fires here and the trigger would sit
          // there looking shut with a list hanging off it.
          open ? "border-accent" : "border-border focus-within:border-accent"
        }`}
      >
        <button
          type="button"
          aria-label={t("baseSelector")}
          aria-expanded={open}
          onClick={() => {
            setOpen((o) => {
              if (!o) {
                setQuery("");
              }
              return !o;
            });
          }}
          className="flex min-w-0 flex-1 items-center px-2 py-0.5 text-left text-xs text-fg-muted"
        >
          <span className="truncate font-mono">{label}</span>
        </button>
        <button
          type="button"
          aria-label={t("baseSelector")}
          tabIndex={-1}
          onClick={() => setOpen((o) => !o)}
          className="shrink-0 px-1 py-0.5 text-fg-subtle hover:text-fg"
        >
          <ChevronDown
            size={12}
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-full select-none rounded-lg border border-border-strong bg-bg-elevated shadow-xl">
          <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
            <Search size={13} className="shrink-0 text-fg-subtle" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setOpen(false);
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                  return;
                }
                if (e.key === "Tab" && !e.shiftKey) {
                  // Completes rather than commits: the text becomes the row the
                  // cursor is on and the list stays open, so a name can be
                  // filled in and then built on. Enter is what takes it.
                  const chosen = options[active];
                  if (!chosen) {
                    return;
                  }
                  e.preventDefault();
                  // Only the segment being typed. With `a..` in the box the
                  // left side is settled and replacing the whole thing would
                  // throw it away, so what lands is `a..<far end>`.
                  if (chosen.value.kind === "range") {
                    setQuery(`${chosen.value.from}..${chosen.value.to}`);
                  } else if (chosen.value.kind === "ref") {
                    setQuery(chosen.value.name);
                  }
                  return;
                }
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => {
                    const next = i + (e.key === "ArrowDown" ? 1 : -1);
                    // Stops at the ends rather than wrapping: with the working
                    // tree pinned first, wrapping from the last branch back to
                    // it reads as having lost your place.
                    return Math.min(Math.max(next, 0), Math.max(options.length - 1, 0));
                  });
                }
              }}
              placeholder={t("baseFilterPlaceholder")}
              spellCheck={false}
              // The popup is select-none so a click never leaves a selection box on a
              // row label; the field you type into has to opt back in.
              className="min-w-0 flex-1 select-text bg-transparent text-xs text-fg outline-none placeholder:text-fg-subtle"
            />
          </div>
          {/* Tall enough for the whole unfiltered list -- the working tree plus
              the six refs and the rule between them -- so the scrollbar never
              appears on open. It is still a cap: typing drops the six-row
              limit, because a search that found forty things should show
              forty, and that is when scrolling is the right answer. */}
          <ul className="max-h-56 space-y-0.5 overflow-y-auto p-1" role="listbox">
            {options.map((option, i) => (
              <BaseRow
                key={baseLabel(option.value, "@worktree")}
                label={option.label}
                hint={option.hint}
                mono={option.mono}
                needle={needle}
                checked={baseLabel(option.value, "@") === baseLabel(base, "@")}
                active={i === active}
                onSelect={() => void take(option)}
                onHover={() => setActive(i)}
                separated={i > 0 && options[i - 1].value.kind === "worktree"}
              />
            ))}
          </ul>
          {/* Says out loud that the list is cut, rather than letting it read as
              everything the repo has. A real repo has hundreds of branches, so
              the list must have a limit; what matters is that the limit is
              visible and that typing gets past it. */}
          {unresolved && (
            <div className="border-t border-border px-3 py-1.5 text-[11px] text-danger">
              {t("baseUnknownRev", { name: unresolved })}
            </div>
          )}
          {hidden > 0 && (
            <div className="border-t border-border px-3 py-1.5 text-[11px] text-fg-subtle">
              {t("baseMoreHidden", { count: hidden })}
            </div>
          )}

        </div>
      )}
    </div>
  );
}

/**
 * The label with every run that matched the search picked out. Answers "why is
 * this row in my results", which on a list of paths is not always obvious --
 * `origin/feat/all-changes-tab` matches "ang" somewhere in the middle and
 * without the marking you are left scanning for it.
 *
 * Case-insensitive to match the filter, and it walks the whole string rather
 * than marking only the first hit: a path can match in the branch name and in
 * the remote both.
 */
function Marked({ text, needle }: { text: string; needle: string }) {
  if (!needle) {
    return <>{text}</>;
  }
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let at = 0;
  for (;;) {
    const hit = lower.indexOf(needle, at);
    if (hit < 0) {
      parts.push(text.slice(at));
      break;
    }
    if (hit > at) {
      parts.push(text.slice(at, hit));
    }
    parts.push(
      <span key={hit} className="text-accent">
        {text.slice(hit, hit + needle.length)}
      </span>,
    );
    at = hit + needle.length;
  }
  return <>{parts}</>;
}

function BaseRow({
  label,
  hint,
  mono,
  needle,
  checked,
  active,
  separated,
  onSelect,
  onHover,
}: {
  label: string;
  hint?: string;
  mono: boolean;
  /** The search, lowercased, so the row can mark what matched. */
  needle: string;
  /** This is the base the page is on: the row carries the tick. */
  checked: boolean;
  /** This is the row the arrow keys are on, which is a different thing: it is
   * where Enter would land, not where the page already is. */
  active: boolean;
  /** A rule above it, separating the working tree from the refs. */
  separated?: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  // Arrowing past the bottom of a scrolled list has to bring the row with it,
  // or the cursor is somewhere the reader cannot see.
  useEffect(() => {
    if (active) {
      ref.current?.scrollIntoView({ block: "nearest" });
    }
  }, [active]);

  return (
    <>
      {separated && <li className="my-1 border-t border-border" aria-hidden="true" />}
      <li>
        <button
          ref={ref}
          type="button"
          role="option"
          aria-selected={checked}
          onClick={onSelect}
          onMouseMove={onHover}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs ${
            active ? "bg-bg text-fg" : "text-fg-muted"
          }`}
        >
          <span className="flex w-3 shrink-0 justify-center text-accent">
            {checked && <Check size={11} />}
          </span>
          <span className={`min-w-0 flex-1 truncate ${mono ? "font-mono" : ""}`}>
            <Marked text={label} needle={needle} />
          </span>
          {hint && <span className="shrink-0 pl-2 text-[10.5px] text-fg-subtle">{hint}</span>}
        </button>
      </li>
    </>
  );
}
