import { useEffect, useState, type ReactNode } from "react";
import { Bold, Heading1, Heading2, Heading3, List, Minus, Underline as UnderlineIcon } from "lucide-react";
import { Mark, mergeAttributes } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";

const ALLOWED_TAGS = new Set(["P", "H1", "H2", "H3", "STRONG", "B", "EM", "I", "U", "UL", "OL", "LI", "BR", "HR", "SPAN"]);

/** Shared header styles — all deliberately smaller than the product card heading (text-xl). */
const HEADER_DISPLAY_CLASSES = [
  "[&_h1]:mb-1.5 [&_h1]:mt-3 [&_h1:first-child]:mt-0 [&_h1]:text-base [&_h1]:font-black [&_h1]:leading-snug [&_h1]:tracking-tight [&_h1]:text-white",
  "[&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2:first-child]:mt-0 [&_h2]:text-sm [&_h2]:font-black [&_h2]:leading-snug [&_h2]:tracking-tight [&_h2]:text-white",
  "[&_h3]:mb-1.5 [&_h3]:mt-3 [&_h3:first-child]:mt-0 [&_h3]:text-xs [&_h3]:font-black [&_h3]:leading-snug [&_h3]:tracking-tight [&_h3]:text-white",
].join(" ");

const HEADER_EDITOR_CLASSES =
  "[&_h1]:my-2 [&_h1]:text-base [&_h1]:font-black [&_h1]:leading-snug [&_h1]:tracking-tight [&_h1]:text-white " +
  "[&_h2]:my-2 [&_h2]:text-sm [&_h2]:font-black [&_h2]:leading-snug [&_h2]:tracking-tight [&_h2]:text-white " +
  "[&_h3]:my-2 [&_h3]:text-xs [&_h3]:font-black [&_h3]:leading-snug [&_h3]:tracking-tight [&_h3]:text-white ";

const Thin = Mark.create({
  name: "thin",
  inclusive: true,
  parseHTML() {
    return [
      { tag: "span[data-thin]" },
      {
        style: "font-weight",
        getAttrs: (value) => {
          const v = String(value).trim().toLowerCase();
          return v === "300" || v === "200" || v === "100" || v === "lighter" ? null : false;
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-thin": "",
        style: "font-weight: 300",
      }),
      0,
    ];
  },
  addCommands() {
    return {
      toggleThin:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    thin: {
      toggleThin: () => ReturnType;
    };
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isAllowedSpanStyle(style: string): boolean {
  return /^font-weight:\s*(300|200|100|lighter)\s*;?$/i.test(style.trim());
}

function scrubElementAttributes(el: HTMLElement) {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value;

    if (el.tagName === "SPAN") {
      if (name === "data-thin") continue;
      if (name === "style" && isAllowedSpanStyle(value)) continue;
    }

    el.removeAttribute(attr.name);
  }
}

/** Strip anything except a small allowlist used by store descriptions. */
export function sanitizeStoreDescriptionHtml(input: string): string {
  const raw = (input ?? "").trim();
  if (!raw) return "";

  if (typeof document === "undefined") {
    return raw
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
      .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, "");
  }

  const template = document.createElement("template");
  template.innerHTML = raw;

  const walk = (node: Node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (!ALLOWED_TAGS.has(el.tagName)) {
          const frag = document.createDocumentFragment();
          while (el.firstChild) frag.appendChild(el.firstChild);
          el.replaceWith(frag);
          walk(node);
          return;
        }
        scrubElementAttributes(el);
        if (el.tagName !== "HR") walk(el);
      } else if (child.nodeType === Node.COMMENT_NODE) {
        child.parentNode?.removeChild(child);
      }
    }
  };

  walk(template.content);
  return template.innerHTML.trim();
}

/** Convert legacy plain text (or HTML) into safe display HTML. */
export function storeDescriptionToHtml(raw: string): string {
  const text = (raw ?? "").trim();
  if (!text) return "";
  if (/<[a-z][\s\S]*>/i.test(text)) {
    return sanitizeStoreDescriptionHtml(text);
  }
  const paragraphs = text
    .split(/\n\n+/)
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return sanitizeStoreDescriptionHtml(paragraphs);
}

export function StoreDescriptionHtml({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  const html = storeDescriptionToHtml(value);
  if (!html) return null;
  return (
    <div
      className={[
        "store-description text-sm leading-relaxed text-[#a8b7cd]",
        "[&_p]:mb-2 [&_p:last-child]:mb-0",
        HEADER_DISPLAY_CLASSES,
        "[&_strong]:font-black [&_strong]:text-white [&_b]:font-black [&_b]:text-white",
        "[&_span[data-thin]]:font-light [&_span[data-thin]]:text-[#8ea1bb]",
        "[&_u]:underline [&_u]:underline-offset-2",
        "[&_hr]:my-3 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-[#243247]",
        "[&_ul]:mb-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_ul:last-child]:mb-0",
        "[&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5",
        "[&_li]:text-[#a8b7cd]",
        className,
      ].filter(Boolean).join(" ")}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

type EditorProps = {
  value: string;
  onChange: (html: string) => void;
  /** Remount key when switching products so TipTap picks up new content. */
  resetKey?: string | number | null;
};

type ToolBtnProps = {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
};

function ToolBtn({ title, active, onClick, children }: ToolBtnProps) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 transition-colors ${
        active
          ? "bg-[#2f66ee]/25 text-[#4384ff]"
          : "text-[#7b8ca7] hover:bg-white/5 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

/** Lightweight TipTap editor: paragraphs, bold/thin, underline, bullets, divider. */
export default function StoreDescriptionEditor({ value, onChange, resetKey }: EditorProps) {
  const [, setToolbarTick] = useState(0);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        blockquote: false,
        code: false,
        strike: false,
        orderedList: false,
      }),
      Underline,
      Thin,
    ],
    content: storeDescriptionToHtml(value) || "<p></p>",
    editorProps: {
      attributes: {
        class:
          "min-h-[160px] px-3 py-2.5 text-sm font-normal leading-relaxed text-white outline-none " +
          "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5 " +
          "[&_p]:my-1 [&_strong]:font-black [&_b]:font-black " +
          HEADER_EDITOR_CLASSES +
          "[&_span[data-thin]]:font-light [&_span[data-thin]]:text-[#8ea1bb] " +
          "[&_u]:underline [&_hr]:my-3 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-[#2a3a50]",
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.isEmpty ? "" : ed.getHTML();
      onChange(html === "<p></p>" ? "" : html);
    },
    onSelectionUpdate: () => setToolbarTick(t => t + 1),
    onTransaction: () => setToolbarTick(t => t + 1),
  }, [resetKey]);

  useEffect(() => {
    if (!editor) return;
    const bump = () => setToolbarTick(t => t + 1);
    editor.on("selectionUpdate", bump);
    editor.on("transaction", bump);
    return () => {
      editor.off("selectionUpdate", bump);
      editor.off("transaction", bump);
    };
  }, [editor]);

  if (!editor) {
    return (
      <div className="min-h-[160px] rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2.5 text-sm text-[#3f5470]">
        Loading editor…
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[#1f3050] bg-[#07111f] focus-within:border-[#2f70ff]">
      <div className="flex flex-wrap items-center gap-1 border-b border-[#1f3050] px-2 py-1.5">
        <ToolBtn
          title="Small header"
          active={editor.isActive("heading", { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          <Heading3 className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn
          title="Medium header"
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn
          title="Large header"
          active={editor.isActive("heading", { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          <Heading1 className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn
          title="Bold"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().unsetMark("thin").toggleBold().run()}
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn
          title="Thin text"
          active={editor.isActive("thin")}
          onClick={() => editor.chain().focus().unsetBold().toggleThin().run()}
        >
          <span className="text-[11px] font-light tracking-wide">Thin</span>
        </ToolBtn>
        <ToolBtn
          title="Underline"
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn
          title="Bullet list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn
          title="Insert divider"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <Minus className="h-3.5 w-3.5" />
        </ToolBtn>
        <p className="ml-2 text-[10px] font-semibold text-[#3f5470]">
          Headers S / M / L · Bold / Thin · Underline · Bullets · Divider
        </p>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
