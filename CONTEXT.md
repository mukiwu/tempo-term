# TempoTerm

A pane-centric terminal workspace: tabs hold a split tree of panes, and each pane shows one kind of content. This glossary pins down the words the UI and code share.

## Language

**Pane**:
One leaf of a tab's split tree, showing exactly one kind of content (terminal, editor, note, preview, git-graph, diff, sessions, launcher).
_Avoid_: panel, split, view

**Pane header**:
The unified h-7 strip at the top of a pane. Full headers (terminal, editor, preview, diff) carry that pane's identity and actions plus the close button; minimal headers (launcher, git-graph, note, sessions) carry only the close button and render only while the tab is split.
_Avoid_: toolbar (reserved for rows of actions inside content, like GitGraphToolbar)

**Breadcrumb**:
The location trail on the left of a terminal or editor pane header, always home-relative (absolute outside home). Clicking a segment opens its menu — the segment itself plus its subdirectories for a terminal (directories expand in place), the files sharing the folder for an editor — and choosing an entry switches what this pane shows; it never opens a new tab.
_Avoid_: path bar, address bar (that is the preview pane's URL row)
