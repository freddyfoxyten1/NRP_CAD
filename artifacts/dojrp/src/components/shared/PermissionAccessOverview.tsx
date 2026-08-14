import React, { useMemo, useState } from 'react';
import { Lock, Search, Shield } from 'lucide-react';
import type { PermissionBadge } from '@/lib/permission-access';

export type PermissionAccessOverviewRow = {
  id: number;
  username: string;
  subtitle?: string | null;
  rankLabel: string;
  rankColor?: string | null;
  permissions: PermissionBadge[];
};

type PermissionAccessOverviewProps = {
  title: string;
  description: string;
  accentTextClass: string;
  accentBorderClass: string;
  rows: PermissionAccessOverviewRow[];
  emptyMessage?: string;
};

export function PermissionAccessOverview({
  title,
  description,
  accentTextClass,
  accentBorderClass,
  rows,
  emptyMessage = 'No members with permission grants match your filters.',
}: PermissionAccessOverviewProps) {
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(row => {
      if (!showAll && row.permissions.length === 0) return false;
      if (!q) return true;
      return (
        row.username.toLowerCase().includes(q)
        || row.rankLabel.toLowerCase().includes(q)
        || (row.subtitle ?? '').toLowerCase().includes(q)
        || row.permissions.some(p => p.label.toLowerCase().includes(q))
      );
    });
  }, [rows, search, showAll]);

  const grantedCount = rows.filter(r => r.permissions.length > 0).length;

  return (
    <div className={`rounded-xl border ${accentBorderClass} bg-[#070d16] shadow-[0_22px_55px_rgba(0,0,0,0.22)] overflow-hidden`}>
      <div className="flex flex-wrap items-center gap-3 border-b border-[#131f30] px-6 py-4">
        <Shield className={`h-4 w-4 shrink-0 ${accentTextClass}`} />
        <div className="min-w-0 flex-1">
          <h3 className={`text-sm font-black uppercase tracking-[0.2em] ${accentTextClass}`}>{title}</h3>
          <p className="mt-0.5 text-[10px] text-[#526179]">{description}</p>
        </div>
        <span className="rounded-full border border-[#1f3050] bg-[#0a1525] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-[#8392aa]">
          {grantedCount} with access
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-[#131f30] px-6 py-3">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#526179]" />
          <input
            type="text"
            placeholder="Search members or permissions…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-9 w-full rounded-lg border border-[#1f3050] bg-[#07111f] pl-9 pr-4 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[10px] font-bold text-[#8392aa]">
          <input
            type="checkbox"
            checked={showAll}
            onChange={e => setShowAll(e.target.checked)}
            className="rounded border-[#1f3050] bg-[#07111f]"
          />
          Show members without grants
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 px-6 py-8">
          <Lock className="h-7 w-7 text-[#1e2e42]" />
          <p className="text-center text-sm font-bold text-[#3f5470]">{emptyMessage}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#131f30]">
                <th className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Member</th>
                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Rank</th>
                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Permissions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.id} className="border-b border-[#0f1b28] hover:bg-[#081422] transition-colors align-top">
                  <td className="px-5 py-3.5">
                    <p className="font-black text-white">{row.username}</p>
                    {row.subtitle && (
                      <p className="text-[10px] text-[#526179]">@{row.subtitle}</p>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="text-[10px] font-black" style={{ color: row.rankColor ?? '#a8b7cd' }}>
                      {row.rankLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    {row.permissions.length === 0 ? (
                      <span className="text-[10px] text-[#3f5470]">No grants</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {row.permissions.map(badge => (
                          <span
                            key={badge.key}
                            className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
