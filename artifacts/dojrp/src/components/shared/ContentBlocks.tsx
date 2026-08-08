import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Bold, GripVertical, Info, List, Plus, Underline, X } from 'lucide-react';

export type ContentBlock =
  | { type: 'text'; body: string }
  | { type: 'heading'; text: string }
  | { type: 'bold_heading'; text: string }
  | { type: 'divider' }
  | { type: 'thumbnail'; url: string; caption: string }
  | { type: 'footer'; text: string };

/** Parse **bold** and __underline__ markers into React nodes. */
export function renderInlineFormatted(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={key++} className="font-bold text-[#c5d4e8]">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('__') && token.endsWith('__')) {
      nodes.push(
        <span key={key++} className="underline decoration-[#8392aa] underline-offset-2">
          {token.slice(2, -2)}
        </span>,
      );
    } else {
      nodes.push(token);
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function isBulletLine(line: string): boolean {
  return /^\s*[-*•]\s+/.test(line);
}

function stripBulletPrefix(line: string): string {
  return line.replace(/^\s*[-*•]\s+/, '');
}

/** Render text with bold, underline, and bullet lists. */
export function renderFormattedText(
  text: string,
  opts?: { className?: string; bulletClassName?: string },
) {
  const className = opts?.className ?? 'whitespace-pre-wrap text-sm leading-relaxed text-[#a8b7cd]';
  const bulletClassName = opts?.bulletClassName ?? 'list-disc space-y-1 pl-5 text-sm leading-relaxed text-[#a8b7cd]';
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    if (isBulletLine(lines[i])) {
      const items: string[] = [];
      while (i < lines.length && isBulletLine(lines[i])) {
        items.push(stripBulletPrefix(lines[i]));
        i += 1;
      }
      blocks.push(
        <ul key={key++} className={bulletClassName}>
          {items.map((item, j) => (
            <li key={j}>{renderInlineFormatted(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && !isBulletLine(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    const joined = para.join('\n');
    if (joined.length > 0) {
      blocks.push(
        <p key={key++} className={className}>
          {renderInlineFormatted(joined)}
        </p>,
      );
    }
  }

  if (blocks.length === 0) {
    return <p className={className}>{renderInlineFormatted(text)}</p>;
  }
  if (blocks.length === 1) return blocks[0];
  return <div className="space-y-2">{blocks}</div>;
}

export function renderContentBlocks(
  sections: ContentBlock[],
  opts?: { emptyTitle?: string; emptyHint?: string; accent?: string },
) {
  const accent = opts?.accent ?? '#4384ff';
  if (!sections.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-2xl border"
          style={{ borderColor: `${accent}33`, backgroundColor: `${accent}14` }}
        >
          <Info className="h-7 w-7 opacity-60" style={{ color: accent }} />
        </div>
        <div>
          <p className="text-sm font-black text-[#526179]">
            {opts?.emptyTitle ?? 'No information posted'}
          </p>
          <p className="mt-1 text-xs text-[#3f5470]">
            {opts?.emptyHint ?? 'Content for this page has not been published yet.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sections.map((blk, i) => {
        if (blk.type === 'divider') return <hr key={i} className="my-2 border-[#1e2d42]" />;
        if (blk.type === 'heading') {
          return (
            <h3 key={i} className="pt-2 text-xs font-black uppercase tracking-[0.18em]" style={{ color: accent }}>
              {renderInlineFormatted(blk.text)}
            </h3>
          );
        }
        if (blk.type === 'bold_heading') {
          return (
            <h2 key={i} className="pt-2 text-base font-black text-white">
              {renderInlineFormatted(blk.text)}
            </h2>
          );
        }
        if (blk.type === 'thumbnail') {
          return (
            <div key={i} className="overflow-hidden rounded-xl border border-[#1e2d42]">
              <img src={blk.url} alt={blk.caption || ''} className="max-h-64 w-full object-cover" />
              {blk.caption ? (
                <p className="bg-[#0d1422] px-4 py-2 text-[11px] italic text-[#526179]">
                  {renderInlineFormatted(blk.caption)}
                </p>
              ) : null}
            </div>
          );
        }
        if (blk.type === 'footer') {
          return (
            <div key={i} className="pt-2 text-[11px] italic text-[#526179]">
              {renderFormattedText(blk.text, {
                className: 'whitespace-pre-wrap text-[11px] italic leading-relaxed text-[#526179]',
                bulletClassName: 'list-disc space-y-1 pl-5 text-[11px] italic leading-relaxed text-[#526179]',
              })}
            </div>
          );
        }
        return (
          <div key={i}>
            {renderFormattedText(blk.body)}
          </div>
        );
      })}
    </div>
  );
}

function reorderBlocks<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function wrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
  placeholder: string,
): { next: string; selStart: number; selEnd: number } {
  const selected = value.slice(start, end);
  const inner = selected.length > 0 ? selected : placeholder;
  const next = value.slice(0, start) + before + inner + after + value.slice(end);
  const selStart = start + before.length;
  const selEnd = selStart + inner.length;
  return { next, selStart, selEnd };
}

function toggleBulletLines(value: string, start: number, end: number): { next: string; selStart: number; selEnd: number } {
  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  let lineEnd = value.indexOf('\n', end);
  if (lineEnd < 0) lineEnd = value.length;
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const allBulleted = lines.every(l => isBulletLine(l) || l.trim() === '');
  const nextLines = lines.map(line => {
    if (line.trim() === '') return line;
    if (allBulleted) return stripBulletPrefix(line);
    if (isBulletLine(line)) return line;
    return `- ${line}`;
  });
  const replaced = nextLines.join('\n');
  const next = value.slice(0, lineStart) + replaced + value.slice(lineEnd);
  return { next, selStart: lineStart, selEnd: lineStart + replaced.length };
}

function FormatToolbar({
  accent,
  onBold,
  onUnderline,
  onBullet,
}: {
  accent: string;
  onBold: () => void;
  onUnderline: () => void;
  onBullet: () => void;
}) {
  const btn =
    'inline-flex items-center gap-1 rounded border border-[#1f3050] bg-[#0a1520] px-2 py-1 text-[9px] font-black uppercase tracking-widest text-[#7b91ad] transition-colors hover:border-[#2f70ff]/40 hover:text-white';
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      <button type="button" onClick={onBold} className={btn} title="Bold (**text**)" style={{ borderColor: `${accent}33` }}>
        <Bold className="h-3 w-3" /> Bold
      </button>
      <button type="button" onClick={onUnderline} className={btn} title="Underline (__text__)">
        <Underline className="h-3 w-3" /> Underline
      </button>
      <button type="button" onClick={onBullet} className={btn} title="Bullet list">
        <List className="h-3 w-3" /> Bullets
      </button>
    </div>
  );
}

export function ContentBlocksEditor({
  sections,
  onChange,
  accent = '#ff7070',
}: {
  sections: ContentBlock[];
  onChange: (next: ContentBlock[]) => void;
  accent?: string;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const textRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});
  const footerRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});

  const setBlock = (i: number, next: ContentBlock) =>
    onChange(sections.map((b, j) => (j === i ? next : b)));

  const applyToField = (
    i: number,
    type: 'text' | 'footer',
    transform: (value: string, start: number, end: number) => { next: string; selStart: number; selEnd: number },
  ) => {
    const el = (type === 'text' ? textRefs : footerRefs).current[i];
    const blk = sections[i];
    const value = type === 'text' && blk.type === 'text'
      ? blk.body
      : blk.type === 'footer'
        ? blk.text
        : '';
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const { next, selStart, selEnd } = transform(value, start, end);
    if (type === 'text') setBlock(i, { type: 'text', body: next });
    else setBlock(i, { type: 'footer', text: next });
    requestAnimationFrame(() => {
      const target = (type === 'text' ? textRefs : footerRefs).current[i];
      if (!target) return;
      target.focus();
      target.setSelectionRange(selStart, selEnd);
    });
  };

  const handleDragStart = (e: DragEvent, i: number) => {
    setDragIdx(i);
    e.dataTransfer.effectAllowed = 'move';
    const ghost = document.createElement('div');
    ghost.style.position = 'absolute';
    ghost.style.top = '-9999px';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => document.body.removeChild(ghost), 0);
  };

  const handleDragOver = (e: DragEvent, i: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (overIdx !== i) setOverIdx(i);
  };

  const handleDrop = (e: DragEvent, i: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === i) {
      setDragIdx(null);
      setOverIdx(null);
      return;
    }
    onChange(reorderBlocks(sections, dragIdx, i));
    setDragIdx(null);
    setOverIdx(null);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setOverIdx(null);
  };

  return (
    <div className="space-y-4">
      {sections.map((blk, i) => {
        const isDragging = dragIdx === i;
        const isTarget = overIdx === i && dragIdx !== null && dragIdx !== i;
        return (
          <div
            key={i}
            onDragOver={e => handleDragOver(e, i)}
            onDrop={e => handleDrop(e, i)}
            className={`relative rounded-lg border bg-[#07111f] p-4 pl-10 transition-all ${
              isDragging
                ? 'border-dashed opacity-40'
                : isTarget
                  ? 'border-solid'
                  : 'border-[#1f3050]'
            }`}
            style={
              isTarget
                ? { borderColor: `${accent}99`, boxShadow: `0 0 0 1px ${accent}55` }
                : isDragging
                  ? { borderColor: `${accent}66` }
                  : undefined
            }
          >
            <button
              type="button"
              draggable
              title="Drag to reorder"
              onDragStart={e => handleDragStart(e, i)}
              onDragEnd={handleDragEnd}
              className="absolute left-2 top-3 cursor-grab rounded p-0.5 text-[#526179] transition-colors hover:text-white active:cursor-grabbing"
              aria-label="Drag to reorder block"
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onChange(sections.filter((_, j) => j !== i))}
              className="absolute right-3 top-3 rounded p-0.5 text-[#526179] transition-colors hover:text-red-400"
            >
              <X className="h-3 w-3" />
            </button>
            <div className="mb-3 flex flex-wrap gap-1.5 pr-6">
              {(['text', 'heading', 'bold_heading', 'divider', 'thumbnail', 'footer'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    const prev = blk as Record<string, string>;
                    let next: ContentBlock;
                    switch (t) {
                      case 'divider': next = { type: 'divider' }; break;
                      case 'text': next = { type: 'text', body: prev.body ?? prev.text ?? '' }; break;
                      case 'heading': next = { type: 'heading', text: prev.text ?? prev.body ?? '' }; break;
                      case 'bold_heading': next = { type: 'bold_heading', text: prev.text ?? prev.body ?? '' }; break;
                      case 'thumbnail': next = { type: 'thumbnail', url: prev.url ?? '', caption: prev.caption ?? '' }; break;
                      case 'footer': next = { type: 'footer', text: prev.text ?? prev.body ?? '' }; break;
                      default: next = blk;
                    }
                    setBlock(i, next);
                  }}
                  className={`rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest transition-colors ${
                    blk.type === t
                      ? 'border text-white'
                      : 'border border-[#1f3050] text-[#3f5470] hover:text-[#526179]'
                  }`}
                  style={blk.type === t ? {
                    borderColor: `${accent}66`,
                    backgroundColor: `${accent}26`,
                    color: accent,
                  } : undefined}
                >
                  {t === 'bold_heading' ? 'Bold Hdg' : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            {blk.type === 'text' && (
              <div>
                <FormatToolbar
                  accent={accent}
                  onBold={() => applyToField(i, 'text', (v, s, e) => wrapSelection(v, s, e, '**', '**', 'bold'))}
                  onUnderline={() => applyToField(i, 'text', (v, s, e) => wrapSelection(v, s, e, '__', '__', 'underline'))}
                  onBullet={() => applyToField(i, 'text', toggleBulletLines)}
                />
                <textarea
                  ref={el => { textRefs.current[i] = el; }}
                  value={blk.body}
                  rows={5}
                  placeholder="Paragraph text… Use Bold / Underline / Bullets, or type **bold**, __underline__, and - bullets"
                  onChange={e => setBlock(i, { type: 'text', body: e.target.value })}
                  className="w-full resize-none rounded border border-[#1f3050] bg-[#0a1520] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]"
                />
              </div>
            )}
            {blk.type === 'heading' && (
              <input
                type="text"
                value={blk.text}
                placeholder="Section heading…"
                onChange={e => setBlock(i, { type: 'heading', text: e.target.value })}
                className="w-full rounded border border-[#1f3050] bg-[#0a1520] px-3 py-2 text-xs font-black text-[#4384ff] placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]"
              />
            )}
            {blk.type === 'bold_heading' && (
              <input
                type="text"
                value={blk.text}
                placeholder="Bold heading…"
                onChange={e => setBlock(i, { type: 'bold_heading', text: e.target.value })}
                className="w-full rounded border border-[#1f3050] bg-[#0a1520] px-3 py-2 text-sm font-black text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]"
              />
            )}
            {blk.type === 'divider' && (
              <div className="flex items-center gap-3 py-1.5">
                <div className="h-px flex-1 bg-[#1f3050]" />
                <span className="text-[9px] font-black uppercase tracking-widest text-[#3f5470]">Horizontal Rule</span>
                <div className="h-px flex-1 bg-[#1f3050]" />
              </div>
            )}
            {blk.type === 'thumbnail' && (
              <div className="space-y-2">
                <input
                  type="text"
                  value={blk.url}
                  placeholder="Image URL (https://…)"
                  onChange={e => setBlock(i, { type: 'thumbnail', url: e.target.value, caption: blk.caption })}
                  className="w-full rounded border border-[#1f3050] bg-[#0a1520] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]"
                />
                {blk.url ? (
                  <img
                    src={blk.url}
                    alt="preview"
                    className="max-h-28 rounded-md object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : null}
                <input
                  type="text"
                  value={blk.caption}
                  placeholder="Caption (optional)"
                  onChange={e => setBlock(i, { type: 'thumbnail', url: blk.url, caption: e.target.value })}
                  className="w-full rounded border border-[#1f3050] bg-[#0a1520] px-3 py-1.5 text-[11px] text-[#8392aa] placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]"
                />
              </div>
            )}
            {blk.type === 'footer' && (
              <div>
                <FormatToolbar
                  accent={accent}
                  onBold={() => applyToField(i, 'footer', (v, s, e) => wrapSelection(v, s, e, '**', '**', 'bold'))}
                  onUnderline={() => applyToField(i, 'footer', (v, s, e) => wrapSelection(v, s, e, '__', '__', 'underline'))}
                  onBullet={() => applyToField(i, 'footer', toggleBulletLines)}
                />
                <textarea
                  ref={el => { footerRefs.current[i] = el; }}
                  value={blk.text}
                  rows={2}
                  placeholder="Footer text…"
                  onChange={e => setBlock(i, { type: 'footer', text: e.target.value })}
                  className="w-full resize-none rounded border border-[#1f3050] bg-[#0a1520] px-3 py-2 text-[11px] italic text-[#526179] placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]"
                />
              </div>
            )}
          </div>
        );
      })}

      <div className="rounded-lg border border-dashed border-[#1f3050] p-3">
        <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-[#3f5470]">Add Block</p>
        <div className="flex flex-wrap gap-1.5">
          {([
            { label: 'Text', init: { type: 'text', body: '' } as ContentBlock },
            { label: 'Bullets', init: { type: 'text', body: '- ' } as ContentBlock },
            { label: 'Heading', init: { type: 'heading', text: '' } as ContentBlock },
            { label: 'Bold Heading', init: { type: 'bold_heading', text: '' } as ContentBlock },
            { label: 'Divider', init: { type: 'divider' } as ContentBlock },
            { label: 'Thumbnail', init: { type: 'thumbnail', url: '', caption: '' } as ContentBlock },
            { label: 'Footer', init: { type: 'footer', text: '' } as ContentBlock },
          ]).map(({ label, init }) => (
            <button
              key={label}
              type="button"
              onClick={() => onChange([...sections, init])}
              className="flex items-center gap-1 rounded-full border border-[#1f3050] px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-[#526179] transition-colors hover:border-[#2f70ff]/40 hover:text-[#4384ff]"
            >
              <Plus className="h-2.5 w-2.5" />{label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
