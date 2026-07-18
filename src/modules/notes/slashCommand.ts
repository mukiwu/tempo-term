import { Extension, ReactRenderer, type Editor, type Range } from "@tiptap/react";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import type { TFunction } from "i18next";
import {
  Code2,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Type,
  type LucideIcon,
} from "lucide-react";
import { SlashCommandList, type SlashItem, type SlashListHandle } from "./SlashCommandList";

interface SlashCommandSpec {
  key: string;
  keywords: string;
  icon: LucideIcon;
  run: (chain: BlockChain) => boolean;
}

/**
 * The node commands below come from individual TipTap extensions via module
 * augmentation. pnpm's split tiptap install means that augmentation isn't
 * visible here, so describe the slice of the chain we drive and cast once.
 */
interface BlockChain {
  focus(): BlockChain;
  deleteRange(range: Range): BlockChain;
  setTextSelection(position: number): BlockChain;
  setParagraph(): BlockChain;
  toggleHeading(attrs: { level: 1 | 2 | 3 | 4 | 5 | 6 }): BlockChain;
  toggleBulletList(): BlockChain;
  toggleOrderedList(): BlockChain;
  toggleTaskList(): BlockChain;
  toggleBlockquote(): BlockChain;
  toggleCodeBlock(): BlockChain;
  setHorizontalRule(): BlockChain;
  run(): boolean;
}

function blockChain(editor: Editor, range?: Range): BlockChain {
  const chain = (editor.chain() as unknown as BlockChain).focus();
  return range ? chain.deleteRange(range) : chain;
}

const SPECS: SlashCommandSpec[] = [
  {
    key: "text",
    keywords: "text paragraph 文字 段落",
    icon: Type,
    run: (chain) => chain.setParagraph().run(),
  },
  {
    key: "h1",
    keywords: "h1 heading title 標題",
    icon: Heading1,
    run: (chain) => chain.toggleHeading({ level: 1 }).run(),
  },
  {
    key: "h2",
    keywords: "h2 heading subtitle 標題",
    icon: Heading2,
    run: (chain) => chain.toggleHeading({ level: 2 }).run(),
  },
  {
    key: "h3",
    keywords: "h3 heading 標題",
    icon: Heading3,
    run: (chain) => chain.toggleHeading({ level: 3 }).run(),
  },
  {
    key: "bullet",
    keywords: "bullet unordered list 項目 清單",
    icon: List,
    run: (chain) => chain.toggleBulletList().run(),
  },
  {
    key: "ordered",
    keywords: "ordered numbered list 編號 清單",
    icon: ListOrdered,
    run: (chain) => chain.toggleOrderedList().run(),
  },
  {
    key: "todo",
    keywords: "todo task checkbox 待辦 清單",
    icon: ListChecks,
    run: (chain) => chain.toggleTaskList().run(),
  },
  {
    key: "quote",
    keywords: "quote blockquote 引用",
    icon: Quote,
    run: (chain) => chain.toggleBlockquote().run(),
  },
  {
    key: "code",
    keywords: "code codeblock snippet 程式碼",
    icon: Code2,
    run: (chain) => chain.toggleCodeBlock().run(),
  },
  {
    key: "divider",
    keywords: "divider hr rule separator 分隔線",
    icon: Minus,
    run: (chain) => chain.setHorizontalRule().run(),
  },
];

/** The same command set can delete a typed slash trigger or transform the
 * current selection in place. */
export function createBlockCommandItems(
  t: TFunction<"notes">,
  deleteSlashTrigger: boolean,
): SlashItem[] {
  return SPECS.map((spec) => ({
    title: t(`slash.${spec.key}`),
    keywords: spec.keywords,
    icon: spec.icon,
    run: (editor, range) => {
      let chain = blockChain(editor, deleteSlashTrigger ? range : undefined);
      // A divider inserts content rather than transforming the current block.
      // Collapse to the end of the selected textblock first so its text is
      // neither replaced nor split around the new horizontal rule.
      if (!deleteSlashTrigger && spec.key === "divider") {
        const blockEnd = editor.state.doc.resolve(range.to).end();
        chain = chain.setTextSelection(blockEnd);
      }
      return spec.run(chain);
    },
  }));
}

/** Builds the `/` slash command extension with localized labels. */
export function createSlashCommand(t: TFunction<"notes">): Extension {
  return Extension.create({
    name: "slashCommand",

    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem, SlashItem>({
          editor: this.editor,
          char: "/",
          allowSpaces: false,
          startOfLine: false,
          items: ({ query }) => {
            const q = query.toLowerCase().trim();
            return createBlockCommandItems(t, true).filter((item) => {
              if (!q) return true;
              return item.title.toLowerCase().includes(q) || item.keywords.toLowerCase().includes(q);
            });
          },
          command: ({ editor, range, props }) => {
            props.run(editor, range);
          },
          render: () => {
            let component: ReactRenderer<SlashListHandle> | null = null;
            let el: HTMLDivElement | null = null;

            const position = (props: SuggestionProps<SlashItem>) => {
              const rect = props.clientRect?.();
              if (!el || !rect) return;
              el.style.left = `${rect.left}px`;
              el.style.top = `${rect.bottom + 6}px`;
            };

            return {
              onStart: (props) => {
                component = new ReactRenderer(SlashCommandList, {
                  props: { items: props.items, command: props.command },
                  editor: props.editor,
                });
                el = document.createElement("div");
                el.style.position = "fixed";
                el.style.zIndex = "1000";
                el.appendChild(component.element);
                document.body.appendChild(el);
                position(props);
              },
              onUpdate: (props) => {
                component?.updateProps({
                  items: props.items,
                  command: props.command,
                });
                position(props);
              },
              onKeyDown: (props) => {
                if (props.event.key === "Escape") {
                  return false;
                }
                return component?.ref?.onKeyDown(props.event) ?? false;
              },
              onExit: () => {
                el?.remove();
                component?.destroy();
                el = null;
                component = null;
              },
            };
          },
        }),
      ];
    },
  });
}
