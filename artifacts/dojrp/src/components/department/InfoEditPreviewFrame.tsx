import type { ReactNode } from 'react';
import { Eye } from 'lucide-react';

export default function InfoEditPreviewFrame({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#1f3050] bg-[#050b14]">
      <div className="flex items-start gap-3 border-b border-[#131f30] bg-[#0a1525] px-5 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#22d3ee]/25 bg-[#22d3ee]/10">
          <Eye className="h-4 w-4 text-[#22d3ee]" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-white">{title}</p>
          {hint && <p className="mt-1 text-[10px] leading-relaxed text-[#526179]">{hint}</p>}
        </div>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}
