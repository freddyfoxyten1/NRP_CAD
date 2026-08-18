import { Info } from 'lucide-react';
import { renderFormattedText, type ContentBlock } from '@/components/shared/ContentBlocks';

export default function DpsPageInfoLivePreview({
  sections,
}: {
  sections: ContentBlock[];
}) {
  if (sections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-[#1e2d42] bg-[#070d16] py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#4384ff]/20 bg-[#4384ff]/8">
          <Info className="h-7 w-7 text-[#4384ff]/60" />
        </div>
        <div>
          <p className="text-sm font-black text-[#526179]">No information posted</p>
          <p className="mt-1 text-xs text-[#3f5470]">Add sections on the left to preview them here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sections.map((blk, i) => {
        if (blk.type === 'divider') {
          return <hr key={i} className="my-2 border-[#1e2d42]" />;
        }
        if (blk.type === 'heading') {
          return (
            <h3 key={i} className="pt-2 text-xs font-black uppercase tracking-[0.18em] text-[#4384ff]">
              {blk.text}
            </h3>
          );
        }
        if (blk.type === 'bold_heading') {
          return (
            <h2 key={i} className="pt-2 text-base font-black text-white">
              {blk.text}
            </h2>
          );
        }
        if (blk.type === 'thumbnail') {
          return (
            <div key={i} className="overflow-hidden rounded-xl border border-[#1e2d42]">
              <img src={blk.url} alt={blk.caption || ''} className="max-h-64 w-full object-cover" />
              {blk.caption && (
                <p className="bg-[#070d16] px-4 py-2 text-[11px] italic text-[#526179]">{blk.caption}</p>
              )}
            </div>
          );
        }
        if (blk.type === 'footer') {
          return (
            <div key={i} className="pt-1">
              {renderFormattedText(blk.text, {
                className: 'whitespace-pre-wrap text-[11px] italic leading-relaxed text-[#3f5470]',
                bulletClassName: 'list-disc space-y-1 pl-5 text-[11px] italic leading-relaxed text-[#3f5470]',
              })}
            </div>
          );
        }
        return (
          <div key={i} className="rounded-2xl border border-[#1e2d42] bg-[#070d16] px-7 py-6">
            {renderFormattedText(blk.body, {
              className: 'whitespace-pre-wrap text-xs leading-relaxed text-[#8392aa]',
              bulletClassName: 'list-disc space-y-1 pl-5 text-xs leading-relaxed text-[#8392aa]',
            })}
          </div>
        );
      })}
    </div>
  );
}
