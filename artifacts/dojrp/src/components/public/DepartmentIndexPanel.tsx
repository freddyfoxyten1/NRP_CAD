import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  ExternalLink,
  Flame,
  LayoutDashboard,
  Shield,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { imageStyle } from '@/components/shared/ImageInput';
import { INDEX_PREVIEW_SKIN, ix, skin } from '@/pages/public-index-skin';
import type { IndexInfoContent } from '@/lib/index-info-content';
import { withoutInternalAffairsSubs } from '@/lib/index-info-content';

type PublicDivision = {
  id: number;
  name: string;
  sort_order: number;
  unit_key?: string | null;
};

export type DepartmentIndexPanelProps = {
  department: 'dps' | 'dph';
  title: string;
  sealUrl: string;
  info: IndexInfoContent | null;
  liveDivisions: PublicDivision[];
  fallbackDescription: string;
  fallbackDivisions: string[];
  fallbackSubDepartments: { name: string; description: string }[];
  fallbackHeroUrl?: string;
  accent: string;
  accentMuted: string;
  primaryBtnClass: string;
  outlineBtnClass: string;
  divisionDotClass: string;
  onOpenPage: () => void;
  onResources: () => void;
  onRoster: () => void;
  onEvents: () => void;
};

function divisionNames(divisions: PublicDivision[]): string[] {
  return divisions.map(d => {
    const key = (d.unit_key ?? '').trim().toUpperCase();
    return key ? `${d.name} (${key})` : d.name;
  });
}

function LinkRow({
  icon: Icon,
  label,
  onClick,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  accent: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-fit max-w-full items-center gap-2.5 text-left text-sm font-semibold text-white transition hover:text-[#c5d4e8]"
    >
      <Icon className="h-4 w-4 shrink-0 transition group-hover:translate-x-0.5" style={{ color: accent }} />
      <span className="truncate">{label}</span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#4a6080] opacity-0 transition group-hover:opacity-100" />
    </button>
  );
}

export default function DepartmentIndexPanel({
  department,
  title,
  sealUrl,
  info,
  liveDivisions,
  fallbackDescription,
  fallbackDivisions,
  fallbackSubDepartments,
  fallbackHeroUrl,
  accent,
  accentMuted,
  primaryBtnClass,
  outlineBtnClass,
  divisionDotClass,
  onOpenPage,
  onResources,
  onRoster,
  onEvents,
}: DepartmentIndexPanelProps) {
  const Icon: LucideIcon = department === 'dps' ? Shield : Flame;
  const short = department === 'dps' ? 'DPS' : 'DPH';

  const description = info?.description?.trim() || fallbackDescription;
  const tagline = info?.tagline?.trim();
  const discordUrl = info?.discord_join_url?.trim();
  const heroUrl = info?.hero_image_url?.trim() || fallbackHeroUrl?.trim();

  const liveNames = divisionNames(liveDivisions);
  const divisionList = liveNames.length > 0
    ? liveNames
    : (info?.divisions?.length ? info.divisions : fallbackDivisions);

  const apiSubs = withoutInternalAffairsSubs(info?.sub_departments);
  const subDepartments = apiSubs.length > 0 ? apiSubs : fallbackSubDepartments;

  const primaryBtn = INDEX_PREVIEW_SKIN
    ? 'inline-flex w-fit items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-xs font-black text-[#0a1018] transition hover:bg-[#e4eaf2]'
    : `inline-flex w-fit items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-black text-white transition hover:-translate-y-0.5 ${primaryBtnClass}`;

  const ghostBtn = ix(
    'inline-flex w-fit items-center gap-2 rounded-lg border border-[#3a5068] bg-transparent px-4 py-2.5 text-xs font-black text-white transition hover:border-[#5a7090] hover:bg-white/5',
    'inline-flex w-fit items-center gap-2 rounded-lg border border-[#2a4060] bg-transparent px-4 py-2.5 text-xs font-black text-white transition hover:border-[#4a6080] hover:bg-white/5',
  );

  return (
    <section className={`overflow-hidden ${skin.panel}`}>
      {/* Split card — image left, content right (reference layout) */}
      <div className="flex flex-col md:flex-row">
        {/* Left — hero image */}
        <div className="relative w-full shrink-0 md:w-[52%] lg:w-[50%]">
          <div className="relative aspect-[4/3] w-full overflow-hidden md:aspect-auto md:min-h-[280px] md:h-full lg:min-h-[320px]">
            {heroUrl ? (
              <img
                src={heroUrl}
                alt=""
                className="h-full w-full object-cover"
                style={imageStyle(
                  info?.hero_image_scale,
                  info?.hero_image_position_x,
                  info?.hero_image_position_y,
                )}
              />
            ) : (
              <div
                className="flex h-full min-h-[220px] w-full items-center justify-center bg-gradient-to-br from-[#0d1a30] via-[#0a1424] to-[#060c14] md:min-h-full"
              >
                {INDEX_PREVIEW_SKIN ? (
                  <img src={sealUrl} alt="" className="h-24 w-24 object-contain opacity-90 drop-shadow-2xl sm:h-28 sm:w-28" />
                ) : (
                  <Icon className="h-20 w-20 opacity-40" style={{ color: accent }} />
                )}
              </div>
            )}

          </div>
        </div>

        {/* Right — title, about, links, actions */}
        <div className="flex flex-1 flex-col justify-between gap-6 p-5 sm:p-6 md:p-7 lg:p-8">
          <div className="space-y-5">
            <div>
              <h2 className="flex flex-wrap items-center gap-2.5 text-xl font-black leading-tight tracking-tight text-white sm:text-2xl">
                <span>{title}</span>
                {INDEX_PREVIEW_SKIN ? (
                  <img
                    src={sealUrl}
                    alt=""
                    className="h-8 w-8 shrink-0 object-contain sm:h-9 sm:w-9"
                  />
                ) : (
                  <span
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#1a2d45] bg-[#0a1525]/80 sm:h-9 sm:w-9"
                    style={{ color: accent }}
                  >
                    <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                  </span>
                )}
              </h2>
              {tagline && (
                <p className="mt-1.5 text-xs font-semibold sm:text-sm" style={{ color: accentMuted }}>
                  {tagline}
                </p>
              )}
              <p className={`mt-3 text-sm leading-relaxed ${ix('text-[#a8b7cd]', 'text-[#8fa3bc]')}`}>
                {description}
              </p>
            </div>

            <nav className="flex flex-col gap-2.5" aria-label={`${short} quick navigation`}>
              <LinkRow icon={BookOpen} label="Department Resources" onClick={onResources} accent={accent} />
              <LinkRow icon={Users} label="Public Roster" onClick={onRoster} accent={accent} />
              <LinkRow icon={CalendarDays} label="Department Public Events" onClick={onEvents} accent={accent} />
              {discordUrl && (
                <a
                  href={discordUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex w-fit max-w-full items-center gap-2.5 text-sm font-semibold text-white transition hover:text-[#c5d4e8]"
                >
                  <ExternalLink className="h-4 w-4 shrink-0 text-[#7289da]" />
                  <span>Department Discord</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#4a6080] opacity-0 transition group-hover:opacity-100" />
                </a>
              )}
            </nav>

            {divisionList.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-[#4a6080]">Divisions</p>
                <div className="flex flex-wrap gap-1.5">
                  {divisionList.map(d => (
                    <span
                      key={d}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#1a2d45] bg-[#0a1525]/80 px-2.5 py-1 text-[10px] font-bold text-[#9eb4cc]"
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${divisionDotClass}`} />
                      {d}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={onOpenPage} className={primaryBtn}>
              <LayoutDashboard className="h-3.5 w-3.5" />
              Open {short} Page
            </button>
            {discordUrl && (
              <a href={discordUrl} target="_blank" rel="noopener noreferrer" className={ghostBtn}>
                <ExternalLink className="h-3.5 w-3.5" />
                Join Discord
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Departments below the split card */}
      {subDepartments.length > 0 && (
        <div className="border-t border-[#132033]/80 px-5 py-5 sm:px-7 sm:py-6">
          <p className="mb-3 text-[10px] font-black uppercase tracking-[0.22em] text-[#4a6080]">Departments</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {subDepartments.map((sd, i) => (
              <article
                key={`${sd.name}-${i}`}
                className="rounded-xl border border-[#1a2d45] bg-[#0a1525]/60 px-4 py-3"
              >
                <p className="text-xs font-black text-white sm:text-sm">{sd.name}</p>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
