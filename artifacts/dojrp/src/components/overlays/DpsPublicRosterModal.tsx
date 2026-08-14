import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Car, ChevronDown, ChevronRight, Package, Search, Users, X } from "lucide-react";
import { imageStyle } from "@/components/shared/ImageInput";
import {
  buildPersonnelTitleGroups,
  dedupeRosterMembersById,
  type TitleGroup,
} from "@/lib/roster-sort";

type RosterTab = "personnel" | "vehicles" | "equipment";

type RosterMember = {
  id: number;
  username: string;
  discord_username?: string | null;
  discord_id?: string | null;
  avatar_hash?: string | null;
  callsign?: string | null;
  dps_rank?: string | null;
  dph_rank?: string | null;
  rank?: string | null;
  staff_role?: string | null;
  status?: string | null;
  group_name?: string | null;
  group_sort_order?: number | null;
};

const memberRank = (m: RosterMember) =>
  (m.dps_rank ?? m.dph_rank ?? m.rank)?.trim() || "";

const memberRankName = (m: RosterMember) =>
  m.dps_rank ?? m.dph_rank ?? m.rank ?? null;

type RankMeta = {
  id: number;
  name: string;
  color_hex?: string | null;
  insignia_url?: string | null;
  group_id?: number | null;
  sort_order?: number;
};

type FleetVehicle = {
  id: number;
  name: string;
  year: string | null;
  category: string;
  category_sort: number;
  image_url: string | null;
  image_scale: number;
  image_position_x: number;
  image_position_y: number;
  who_can_drive: string[];
  liveries: string[];
  sort_order: number;
};

type EquipmentItem = {
  id: number;
  name: string;
  quantity?: string | number | null;
  category: string;
  category_sort: number;
  image_url: string | null;
  image_scale: number;
  image_position_x: number;
  image_position_y: number;
  who_can_use: string[];
  sort_order: number;
};

const parseStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return trimmed.split(",").map(s => s.trim()).filter(Boolean);
    }
  }
  return [];
};

const discordAvatarUrl = (discordId?: string | null, avatarHash?: string | null) => {
  if (discordId && avatarHash) {
    return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png?size=64`;
  }
  if (discordId) {
    try {
      const idx = Number((BigInt(discordId) >> 22n) % 6n);
      return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
    } catch {
      /* fall through */
    }
  }
  return null;
};

function DiscordAvatar({
  name,
  discordId,
  avatarHash,
}: {
  name: string;
  discordId?: string | null;
  avatarHash?: string | null;
}) {
  const [imgError, setImgError] = useState(false);
  const initial = name?.[0]?.toUpperCase() ?? "?";
  const colors = ["bg-[#5865f2]", "bg-[#3ba55c]", "bg-[#ed4245]", "bg-[#faa61a]", "bg-[#9c84ec]"];
  const color = colors[(name.charCodeAt(0) ?? 0) % colors.length];
  const src = !imgError ? discordAvatarUrl(discordId, avatarHash) : null;
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className="inline-block h-6 w-6 shrink-0 rounded-full object-cover"
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${color} text-[9px] font-black text-white`}>
      {initial}
    </span>
  );
}

function StatusBadge({ status }: { status?: string | null }) {
  const value = (status ?? "Active").trim() || "Active";
  const lower = value.toLowerCase();
  const tone =
    lower === "active" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
    : lower === "leave" || lower.includes("loa") ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
    : "border-[#1f3050] bg-[#0a1525] text-[#8392aa]";
  return (
    <span className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${tone}`}>
      {value}
    </span>
  );
}

function groupByCategory<T extends { category: string; category_sort: number; sort_order: number }>(items: T[]) {
  const catMap = new Map<string, T[]>();
  items.forEach(item => {
    if (!catMap.has(item.category)) catMap.set(item.category, []);
    catMap.get(item.category)!.push(item);
  });
  return [...catMap.entries()].sort((a, b) => {
    const sa = a[1][0]?.category_sort ?? 0;
    const sb = b[1][0]?.category_sort ?? 0;
    return sa !== sb ? sa - sb : a[0].localeCompare(b[0]);
  });
}

type Props = {
  open: boolean;
  onClose: () => void;
  /** API root for roster endpoints. DPS: `/api/roster`, DPH: `/api/dph`. */
  apiBase?: string;
  title?: string;
  /** Visual accent — blue for DPS, red for DPH/FD. */
  accent?: "blue" | "red";
};

const ACCENT = {
  blue: {
    iconBorder: "border-[#2f66ee]/25 bg-[#2f66ee]/10",
    iconText: "text-[#4384ff]",
    tabActive: "border-[#2f66ee]/50 bg-[#2f66ee]/15 text-white",
    tabIdle: "border-[#1f3050] bg-[#070d16] text-[#8392aa] hover:border-[#2f66ee]/30 hover:text-white",
    focus: "focus:border-[#2f70ff]",
    callsign: "border-[#1b2d44] bg-[#070d16] text-[#4384ff]",
    bar: "bg-[#4384ff]",
    chip: "border-[#4384ff]/30 bg-[#4384ff]/10 text-[#6fa3ff]",
    chevron: "text-[#4384ff]",
  },
  red: {
    iconBorder: "border-[#ef4444]/25 bg-[#ef4444]/10",
    iconText: "text-[#f87171]",
    tabActive: "border-[#ef4444]/50 bg-[#ef4444]/15 text-white",
    tabIdle: "border-[#1f3050] bg-[#070d16] text-[#8392aa] hover:border-[#ef4444]/30 hover:text-white",
    focus: "focus:border-[#ef4444]",
    callsign: "border-[#3a1b1b] bg-[#120808] text-[#f87171]",
    bar: "bg-[#ef4444]",
    chip: "border-[#ef4444]/30 bg-[#ef4444]/10 text-[#fca5a5]",
    chevron: "text-[#f87171]",
  },
} as const;

export default function DpsPublicRosterModal({
  open,
  onClose,
  apiBase = "/api/roster",
  title = "DPS Roster",
  accent = "blue",
}: Props) {
  const theme = ACCENT[accent];
  const [tab, setTab] = useState<RosterTab>("personnel");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const [members, setMembers] = useState<RosterMember[]>([]);
  const [groups, setGroups] = useState<TitleGroup[]>([]);
  const [ranks, setRanks] = useState<RankMeta[]>([]);
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);

  useEffect(() => {
    if (!open) return;
    setTab("personnel");
    setSearch("");
    setCollapsed({});
    setLoading(true);

    let cancelled = false;
    Promise.all([
      fetch(apiBase, { headers: { accept: "application/json" } }).then(r => r.ok ? r.json() : []),
      fetch(`${apiBase}/groups`, { headers: { accept: "application/json" } }).then(r => r.ok ? r.json() : []),
      fetch(`${apiBase}/ranks`, { headers: { accept: "application/json" } }).then(r => r.ok ? r.json() : []),
      fetch(`${apiBase}/vehicles`, { headers: { accept: "application/json" } }).then(r => r.ok ? r.json() : []),
      fetch(`${apiBase}/equipment`, { headers: { accept: "application/json" } }).then(r => r.ok ? r.json() : []),
    ])
      .then(([rosterRows, groupRows, rankRows, vehicleRows, equipmentRows]) => {
        if (cancelled) return;
        setMembers(
          Array.isArray(rosterRows)
            ? dedupeRosterMembersById(rosterRows as RosterMember[])
            : [],
        );
        setGroups(
          (Array.isArray(groupRows) ? groupRows : []).map((row: Record<string, unknown>) => ({
            id: Number(row.id),
            name: String(row.name ?? ""),
            sort_order: Number(row.sort_order ?? 999),
          })),
        );
        setRanks(Array.isArray(rankRows) ? rankRows as RankMeta[] : []);
        setVehicles(
          (Array.isArray(vehicleRows) ? vehicleRows : []).map((row: Record<string, unknown>) => ({
            id: Number(row.id),
            name: String(row.name ?? ""),
            year: row.year == null ? null : String(row.year),
            category: String(row.category ?? "General"),
            category_sort: Number(row.category_sort ?? 0),
            image_url: row.image_url == null ? null : String(row.image_url),
            image_scale: Number(row.image_scale ?? 1),
            image_position_x: Number(row.image_position_x ?? 50),
            image_position_y: Number(row.image_position_y ?? 50),
            who_can_drive: parseStringArray(row.who_can_drive),
            liveries: parseStringArray(row.liveries),
            sort_order: Number(row.sort_order ?? 0),
          }))
        );
        setEquipment(
          (Array.isArray(equipmentRows) ? equipmentRows : []).map((row: Record<string, unknown>) => ({
            id: Number(row.id),
            name: String(row.name ?? ""),
            quantity: row.quantity as string | number | null | undefined,
            category: String(row.category ?? "General"),
            category_sort: Number(row.category_sort ?? 0),
            image_url: row.image_url == null ? null : String(row.image_url),
            image_scale: Number(row.image_scale ?? 1),
            image_position_x: Number(row.image_position_x ?? 50),
            image_position_y: Number(row.image_position_y ?? 50),
            who_can_use: parseStringArray(row.who_can_use),
            sort_order: Number(row.sort_order ?? 0),
          }))
        );
      })
      .catch(() => {
        if (cancelled) return;
        setMembers([]);
        setGroups([]);
        setRanks([]);
        setVehicles([]);
        setEquipment([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [open, apiBase]);

  const rankMetaByName = useMemo(() => {
    const map = new Map<string, RankMeta>();
    ranks.forEach(r => map.set(r.name.trim().toLowerCase(), r));
    return map;
  }, [ranks]);

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter(m =>
      [m.username, m.discord_username, memberRank(m), m.callsign, m.group_name, m.staff_role]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q))
    );
  }, [members, search]);

  const groupedMembers = useMemo(() => {
    const grouped = buildPersonnelTitleGroups(
      filteredMembers,
      groups,
      ranks,
      memberRankName,
    );
    return grouped.filter(g => g.members.length > 0);
  }, [filteredMembers, groups, ranks, search]);

  const visibleMemberCount = useMemo(
    () => groupedMembers.reduce((sum, g) => sum + g.members.length, 0),
    [groupedMembers],
  );

  const filteredVehicles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vehicles;
    return vehicles.filter(v =>
      [v.name, v.category, v.year, ...v.who_can_drive, ...v.liveries]
        .filter(Boolean)
        .some(v2 => String(v2).toLowerCase().includes(q))
    );
  }, [vehicles, search]);

  const filteredEquipment = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return equipment;
    return equipment.filter(item =>
      [item.name, item.category, item.quantity, ...item.who_can_use]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q))
    );
  }, [equipment, search]);

  if (!open) return null;

  const tabs: { id: RosterTab; label: string; icon: typeof Users; count: number }[] = [
    { id: "personnel", label: "Personnel", icon: Users, count: visibleMemberCount || members.length },
    { id: "vehicles", label: "Vehicles", icon: Car, count: vehicles.length },
    { id: "equipment", label: "Equipment", icon: Package, count: equipment.length },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-8">
      <div className="relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[#1b2738] bg-[#0d1422] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#131f30] px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className={`flex h-9 w-9 items-center justify-center rounded-xl border ${theme.iconBorder}`}>
              <Users className={`h-4 w-4 ${theme.iconText}`} />
            </div>
            <div>
              <h3 className="text-sm font-black text-white">{title}</h3>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#526179]">
                Personnel · Vehicles · Equipment
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-[#4a5568] transition-colors hover:bg-white/5 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-[#131f30] px-5 py-3 sm:px-6">
          {tabs.map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              type="button"
              onClick={() => { setTab(id); setSearch(""); }}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] transition-colors ${
                tab === id ? theme.tabActive : theme.tabIdle
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              <span className="rounded-full bg-black/25 px-1.5 py-0.5 text-[9px] text-[#6f7f99]">{count}</span>
            </button>
          ))}
          <div className="relative ml-auto w-full min-w-[180px] sm:w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#526179]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={
                tab === "personnel" ? "Search personnel…"
                : tab === "vehicles" ? "Search vehicles…"
                : "Search equipment…"
              }
              className={`h-9 w-full rounded-lg border border-[#1f3050] bg-[#07111f] pl-9 pr-3 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none ${theme.focus}`}
            />
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-5 sm:px-6">
          {loading ? (
            <div className="flex min-h-[220px] items-center justify-center text-sm font-bold text-[#8ea1bb]">
              Loading roster…
            </div>
          ) : tab === "personnel" ? (
            visibleMemberCount === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <Users className="h-8 w-8 text-[#3f5470]" />
                <p className="text-sm font-black text-[#526179]">
                  {search ? "No members match your search." : "No personnel on the roster yet."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[#172235]">
                <table className="w-full min-w-[640px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#131f30] bg-[#070d16]">
                      <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">Name</th>
                      <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">Rank</th>
                      <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">Callsign</th>
                      <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedMembers.map(group => (
                      <FragmentGroup
                        key={group.label}
                        label={group.label}
                        count={group.members.length}
                        collapsed={Boolean(collapsed[group.label])}
                        chevronClass={theme.chevron}
                        onToggle={() => setCollapsed(prev => ({ ...prev, [group.label]: !prev[group.label] }))}
                      >
                        {!collapsed[group.label] && group.members.map(m => {
                          const rankName = memberRank(m);
                          const meta = rankMetaByName.get(rankName.toLowerCase());
                          return (
                            <tr key={m.id} className="border-b border-[#0f1b28] hover:bg-[#081422]">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <DiscordAvatar
                                    name={m.discord_username || m.username}
                                    discordId={m.discord_id}
                                    avatarHash={m.avatar_hash}
                                  />
                                  <span className="font-black text-white">{m.username || "—"}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1.5">
                                  {meta?.insignia_url && (
                                    <img
                                      src={meta.insignia_url}
                                      alt=""
                                      className="h-4 w-4 shrink-0 object-contain"
                                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                                    />
                                  )}
                                  <span className="text-[10px] font-black" style={{ color: meta?.color_hex ?? "#a8b7cd" }}>
                                    {rankName || "—"}
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex rounded border px-2 py-0.5 font-mono text-[10px] font-black ${theme.callsign}`}>
                                  {m.callsign || "—"}
                                </span>
                              </td>
                              <td className="px-4 py-3"><StatusBadge status={m.status} /></td>
                            </tr>
                          );
                        })}
                      </FragmentGroup>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : tab === "vehicles" ? (
            filteredVehicles.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <Car className="h-8 w-8 text-[#3f5470]" />
                <p className="text-sm font-black text-[#526179]">
                  {search ? "No vehicles match your search." : "No vehicles in the roster yet."}
                </p>
              </div>
            ) : (
              <div className="space-y-8">
                {groupByCategory(filteredVehicles).map(([cat, items]) => (
                  <section key={cat}>
                    <div className="mb-4 flex items-center gap-3">
                      <div className={`h-5 w-1 rounded-full ${theme.bar}`} />
                      <h4 className="text-sm font-black text-white">{cat}</h4>
                      <span className="rounded-full bg-[#0f1b28] px-2 py-0.5 text-[10px] font-black text-[#526179]">{items.length}</span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {[...items].sort((a, b) => a.sort_order - b.sort_order).map(v => (
                        <div key={v.id} className="overflow-hidden rounded-xl border border-[#172235] bg-[#070d16]">
                          <div className="relative flex h-[120px] items-center justify-center bg-[#050a12]">
                            {v.image_url ? (
                              <img
                                src={v.image_url}
                                alt={v.name}
                                className="h-full w-full"
                                style={imageStyle(v.image_scale, v.image_position_x, v.image_position_y)}
                                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                              />
                            ) : (
                              <Car className="h-8 w-8 text-[#1e2e42]" />
                            )}
                          </div>
                          <div className="space-y-2 p-4">
                            <div>
                              <p className="text-sm font-black text-white">{v.name}</p>
                              {v.year && <p className="mt-0.5 text-[10px] font-semibold text-[#526179]">{v.year}</p>}
                            </div>
                            {v.who_can_drive.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {v.who_can_drive.map(r => (
                                  <span key={r} className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold ${theme.chip}`}>
                                    {r}
                                  </span>
                                ))}
                              </div>
                            )}
                            {v.liveries.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {v.liveries.map(l => (
                                  <span key={l} className="rounded border border-[#1f3050] bg-[#0a1525] px-1.5 py-0.5 text-[9px] font-semibold text-[#7b8ca7]">
                                    {l}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )
          ) : filteredEquipment.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <Package className="h-8 w-8 text-[#3f5470]" />
              <p className="text-sm font-black text-[#526179]">
                {search ? "No equipment matches your search." : "No equipment in the roster yet."}
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {groupByCategory(filteredEquipment).map(([cat, items]) => (
                <section key={cat}>
                  <div className="mb-4 flex items-center gap-3">
                    <div className="h-5 w-1 rounded-full bg-[#14b8a6]" />
                    <h4 className="text-sm font-black text-white">{cat}</h4>
                    <span className="rounded-full bg-[#0f1b28] px-2 py-0.5 text-[10px] font-black text-[#526179]">{items.length}</span>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {[...items].sort((a, b) => a.sort_order - b.sort_order).map(item => (
                      <div key={item.id} className="overflow-hidden rounded-xl border border-[#172235] bg-[#070d16]">
                        <div className="relative flex h-[120px] items-center justify-center bg-[#050a12]">
                          {item.image_url ? (
                            <img
                              src={item.image_url}
                              alt={item.name}
                              className="h-full w-full"
                              style={imageStyle(item.image_scale, item.image_position_x, item.image_position_y)}
                              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                          ) : (
                            <Package className="h-8 w-8 text-[#1e2e42]" />
                          )}
                        </div>
                        <div className="space-y-2 p-4">
                          <div>
                            <p className="text-sm font-black text-white">{item.name}</p>
                            {item.quantity != null && String(item.quantity).trim() !== "" && (
                              <p className="mt-0.5 text-[10px] font-semibold text-[#526179]">Qty: {item.quantity}</p>
                            )}
                          </div>
                          {item.who_can_use.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {item.who_can_use.map(r => (
                                <span key={r} className="rounded border border-[#14b8a6]/30 bg-[#14b8a6]/10 px-1.5 py-0.5 text-[9px] font-semibold text-[#5eead4]">
                                  {r}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FragmentGroup({
  label,
  count,
  collapsed,
  chevronClass,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  chevronClass: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-b border-t border-[#172235] bg-[#0a1525] transition-colors hover:bg-[#0c1830]"
        onClick={onToggle}
      >
        <td colSpan={4} className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            {collapsed
              ? <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${chevronClass}`} />
              : <ChevronDown className={`h-3.5 w-3.5 shrink-0 ${chevronClass}`} />}
            <span className="text-xs font-black text-white">{label}</span>
            <span className="rounded-full bg-[#172235] px-2 py-0.5 text-[9px] font-black text-[#526179]">{count}</span>
          </div>
        </td>
      </tr>
      {children}
    </>
  );
}

