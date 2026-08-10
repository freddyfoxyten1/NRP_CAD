// ----
// pages/PublicView.tsx   -   Public-facing community page  (/public)
//
// No authentication required. Displays live stats, announcements, gallery,
// and press/news items for the DOJRP community.
// ----
import { useCallback, useEffect, useRef, useState, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays, Gamepad2, Users, Megaphone, Image as ImageIcon,
  Newspaper, ChevronLeft, ExternalLink, Calendar, User,
  Radio, Shield, Wifi, Building2, Flame,
  BookOpen, FileText, X, ShoppingBag, ChevronDown, ChevronRight,
} from "lucide-react";
import DojrpLogo from "@/components/shared/DojrpLogo";
import { PageLoadingScreen } from "@/components/shared/LoadingProgress";
import StoreProductCard, { type StoreProduct } from "@/components/shared/StoreProductCard";
import LoginModal from "@/components/overlays/LoginModal";
import DpsPublicRosterModal from "@/components/overlays/DpsPublicRosterModal";
import DocumentEditor from "@/components/editor/DocumentEditor";
import PdfViewer from "@/components/shared/PdfViewer";
import { getCadSession } from "@/lib/cad-session";

// -- Types ----
interface Stats {
  erlc_players: number;
  erlc_max_players: number;
  discord_members: number;
  discord_online: number;
}

interface Announcement {
  id: number;
  title: string;
  message: string;
  posted_by: string;
  created_at: string;
}

interface GalleryImage {
  id: number;
  title: string;
  caption: string;
  image_url: string;
  created_at: string;
}

interface PressItem {
  id: number;
  title: string;
  content: string;
  author: string;
  source_url: string;
  image_url: string;
  created_at: string;
}

// -- Helpers ----
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `${d}d ago`;
  return formatDate(iso);
}

async function fetchJsonArray<T>(url: string): Promise<T[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data: unknown = await res.json();
    return Array.isArray(data) ? (data as T[]) : [];
  } catch {
    return [];
  }
}
// -- Stat card ----
function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: number | string;
  sub?: string; color: string;
}) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border bg-[#070d16] px-3 py-3 sm:gap-4 sm:px-5 sm:py-4 ${color}`}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-current/10 sm:h-10 sm:w-10">
        <Icon className="h-4 w-4 sm:h-5 sm:w-5" style={{ color: "inherit" }} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[9px] font-black uppercase tracking-[0.12em] text-[#526179] sm:text-xs sm:tracking-[0.2em]">{label}</p>
        <p className="mt-0.5 text-lg font-black tabular-nums text-white sm:text-2xl">{value}</p>
        {sub && <p className="hidden text-[10px] text-[#3f5470] sm:block">{sub}</p>}
      </div>
    </div>
  );
}

// -- Section heading ----
function SectionHeading({ icon: Icon, title, count }: {
  icon: React.ElementType; title: string; count?: number;
}) {
  return (
    <div className="mb-5 flex items-center gap-3 sm:mb-6">
      <Icon className="h-4 w-4 text-[#4384ff]" />
      <h2 className="text-sm font-black uppercase tracking-[0.22em] text-white">{title}</h2>
      {count !== undefined && (
        <span className="rounded-full bg-[#0f1b28] px-2 py-0.5 text-[9px] font-black text-[#526179]">{count}</span>
      )}
      <div className="ml-3 h-px flex-1 bg-[#131f30]" />
    </div>
  );
}

type Tab = "home" | "events" | "departments" | "announcements" | "gallery" | "press" | "staff" | "store";

interface StaffMember {
  id: number;
  username: string;
  discord_username: string;
  discord_id: string;
  avatar_hash: string | null;
  staff_rank: string | null;
  staff_role: string | null;
  status: string;
  staff_appointed_date?: string | null;
}

interface StaffGroup {
  id: number;
  name: string;
  sort_order: number;
}

interface StaffRank {
  id: number;
  name: string;
  group_id: number | null;
  sort_order: number;
  color_hex: string | null;
}

const SERVER_STORE_URL_FALLBACK = (import.meta.env.VITE_SERVER_STORE_URL as string | undefined)?.trim() || "";

const VALID_TABS = new Set<Tab>(["home", "events", "departments", "announcements", "gallery", "press", "staff", "store"]);

function tabFromSearch(): Tab {
  try {
    const raw = new URLSearchParams(window.location.search).get("tab")?.trim().toLowerCase();
    if (raw && VALID_TABS.has(raw as Tab)) return raw as Tab;
  } catch { /* ignore */ }
  return "home";
}

function discordAvatarUrl(discordId?: string | null, avatarHash?: string | null, size = 64): string | null {
  if (!discordId) return null;
  const hash = avatarHash?.trim();
  if (hash) {
    const ext = hash.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${discordId}/${hash}.${ext}?size=${size}`;
  }
  try {
    const idx = Number(BigInt(discordId) >> 22n) % 6;
    return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
  } catch {
    return "https://cdn.discordapp.com/embed/avatars/0.png";
  }
}

function StaffAvatar({ name, discordId, avatarHash }: {
  name: string; discordId?: string; avatarHash?: string | null;
}) {
  const [imgError, setImgError] = useState(false);
  const src = !imgError ? discordAvatarUrl(discordId, avatarHash) : null;
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className="h-8 w-8 shrink-0 rounded-full object-cover"
        onError={() => setImgError(true)}
      />
    );
  }
  const initial = name?.[0]?.toUpperCase() ?? "?";
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1a2638] text-[10px] font-black text-[#8392aa]">
      {initial}
    </div>
  );
}

interface DpsEvent {
  id: number;
  title: string;
  event_date: string;
  event_time: string | null;
  location: string | null;
  purpose: string | null;
  hosted_by?: string | null;
  hosting_department?: string | null;
  source?: "dps" | "dph" | "staff";
  is_staff_event?: boolean;
}

interface IndexInfoContent {
  description: string;
  divisions: string[];
  sub_departments: { name: string; description: string }[];
}

type PublicDivision = {
  id: number;
  name: string;
  sort_order: number;
  unit_key?: string | null;
};

type DpsResource = {
  id: number;
  title: string;
  type: "document" | "pdf";
  logo_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  division_id?: number | null;
  division_only?: boolean;
  personnel_only?: boolean;
  allowed_ranks?: string[];
  allowed_dps_ranks?: string[];
  allowed_dph_ranks?: string[];
};

const isPublicDepartmentResource = (r: DpsResource) =>
  r.division_id == null
  && !r.division_only
  && !r.personnel_only
  && !(Array.isArray(r.allowed_ranks) && r.allowed_ranks.length > 0)
  && !(Array.isArray(r.allowed_dps_ranks) && r.allowed_dps_ranks.length > 0)
  && !(Array.isArray(r.allowed_dph_ranks) && r.allowed_dph_ranks.length > 0);

// -- Main component ----
const PublicView = () => {
  const navigate = useNavigate();

  const [isLoginOpen,   setIsLoginOpen]   = useState(false);
  const [tab,           setTab]           = useState<Tab>(() => tabFromSearch());
  const [serverStoreUrl, setServerStoreUrl] = useState(SERVER_STORE_URL_FALLBACK);
  const [storeProducts, setStoreProducts] = useState<StoreProduct[]>([]);
  const [storeProductsLoading, setStoreProductsLoading] = useState(false);

  const handleSignIn = () => {
    if (getCadSession()) {
      navigate("/portal");
    } else {
      setIsLoginOpen(true);
    }
  };
  const [stats,         setStats]         = useState<Stats | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [gallery,       setGallery]       = useState<GalleryImage[]>([]);
  const [press,         setPress]         = useState<PressItem[]>([]);
  const [lightbox,      setLightbox]      = useState<GalleryImage | null>(null);
  const galleryTrackRef = useRef<HTMLDivElement | null>(null);
  const galleryFirstCopyRef = useRef<HTMLDivElement | null>(null);
  const galleryPausedRef = useRef(false);
  const [galleryTrackEl, setGalleryTrackEl] = useState<HTMLDivElement | null>(null);
  const setGalleryTrackNode = useCallback((node: HTMLDivElement | null) => {
    galleryTrackRef.current = node;
    setGalleryTrackEl(node);
  }, []);
  const [statsLoading,  setStatsLoading]  = useState(true);
  const [events,        setEvents]        = useState<DpsEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [indexInfo,     setIndexInfo]     = useState<IndexInfoContent | null>(null);
  const [dphIndexInfo,  setDphIndexInfo]  = useState<IndexInfoContent | null>(null);
  const [dpsDivisions,  setDpsDivisions]  = useState<PublicDivision[]>([]);
  const [dphDivisions,  setDphDivisions]  = useState<PublicDivision[]>([]);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [dphResourcesOpen, setDphResourcesOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [dphRosterOpen, setDphRosterOpen] = useState(false);
  const [dpsResources,  setDpsResources]  = useState<DpsResource[]>([]);
  const [dphResources,  setDphResources]  = useState<DpsResource[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [dphResourcesLoading, setDphResourcesLoading] = useState(false);
  const [openPdf,       setOpenPdf]       = useState<DpsResource | null>(null);
  const [openDocId,     setOpenDocId]     = useState<number | null>(null);
  const [resourceApiBase, setResourceApiBase] = useState("/api/resources");
  const [staffMembers,  setStaffMembers]  = useState<StaffMember[]>([]);
  const [staffGroups,   setStaffGroups]   = useState<StaffGroup[]>([]);
  const [staffRanks,    setStaffRanks]    = useState<StaffRank[]>([]);
  const [staffLoading,  setStaffLoading]  = useState(false);
  const [staffCollapsed, setStaffCollapsed] = useState<Record<string, boolean>>({});
  const [staffSearch,   setStaffSearch]   = useState("");

  // Live-refresh stats every 60 s
  useEffect(() => {
    const load = () => {
      setStatsLoading(true);
      fetch("/api/public/stats")
        .then(r => r.json()).then(setStats).catch(() => setStats(null))
        .finally(() => setStatsLoading(false));
    };
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  // Home Gallery: slow continuous left auto-scroll (starts when track mounts)
  useEffect(() => {
    const track = galleryTrackEl;
    const firstCopy = galleryFirstCopyRef.current;
    if (!track || !firstCopy || gallery.length === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let offset = 0;
    let last = performance.now();
    const speedPxPerSec = 28;

    const tick = (now: number) => {
      const dt = Math.min(now - last, 64);
      last = now;
      if (!galleryPausedRef.current && !document.hidden) {
        const loopAt = firstCopy.offsetWidth;
        if (loopAt > 0) {
          offset += (speedPxPerSec * dt) / 1000;
          if (offset >= loopAt) offset -= loopAt;
          track.style.transform = `translate3d(${-offset}px, 0, 0)`;
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      track.style.transform = "";
    };
  }, [galleryTrackEl, gallery.length]);

  useEffect(() => {
    void fetchJsonArray<Announcement>("/api/announcements").then(setAnnouncements);
    void fetchJsonArray<GalleryImage>("/api/public/gallery").then(setGallery);
    void fetchJsonArray<PressItem>("/api/public/press").then(setPress);
    fetch("/api/roster/content/index_info").then(r => r.json())
      .then((d: IndexInfoContent) => { if (d.description) setIndexInfo(d); }).catch(() => {});
    fetch("/api/dph/content/index_info").then(r => r.json())
      .then((d: IndexInfoContent) => { if (d.description || d.divisions?.length || d.sub_departments?.length) setDphIndexInfo(d); }).catch(() => {});
    void fetchJsonArray<PublicDivision>("/api/roster/divisions")
      .then(rows => setDpsDivisions(
        [...rows].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      ))
      .catch(() => setDpsDivisions([]));
    void fetchJsonArray<PublicDivision>("/api/dph/divisions")
      .then(rows => setDphDivisions(
        [...rows].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      ))
      .catch(() => setDphDivisions([]));
  }, []);

  useEffect(() => {
    if (tab !== "departments") return;
    void fetchJsonArray<PublicDivision>("/api/roster/divisions")
      .then(rows => setDpsDivisions(
        [...rows].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      ))
      .catch(() => setDpsDivisions([]));
    void fetchJsonArray<PublicDivision>("/api/dph/divisions")
      .then(rows => setDphDivisions(
        [...rows].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      ))
      .catch(() => setDphDivisions([]));
  }, [tab]);

  useEffect(() => {
    if (tab !== "events") return;
    setEventsLoading(true);
    void fetchJsonArray<DpsEvent>("/api/public/events").then(setEvents)
      .finally(() => setEventsLoading(false));
  }, [tab]);

  useEffect(() => {
    fetch("/api/settings/server-store")
      .then(r => r.json())
      .then((d: { url?: string }) => {
        const url = (d.url ?? "").trim();
        setServerStoreUrl(url || SERVER_STORE_URL_FALLBACK);
      })
      .catch(() => setServerStoreUrl(SERVER_STORE_URL_FALLBACK));
  }, []);

  useEffect(() => {
    if (tab !== "store") return;
    setStoreProductsLoading(true);
    fetch("/api/public/store-products")
      .then(r => r.json())
      .then((rows: StoreProduct[]) => setStoreProducts(Array.isArray(rows) ? rows : []))
      .catch(() => setStoreProducts([]))
      .finally(() => setStoreProductsLoading(false));
  }, [tab]);

  useEffect(() => {
    if (tab !== "staff") return;
    setStaffLoading(true);
    Promise.all([
      fetchJsonArray<StaffMember>("/api/staff/roster?all=1"),
      fetchJsonArray<StaffGroup>("/api/staff/groups"),
      fetchJsonArray<StaffRank>("/api/staff/ranks"),
    ])
      .then(([members, groups, ranks]) => {
        setStaffMembers(members);
        setStaffGroups(groups);
        setStaffRanks(ranks);
      })
      .finally(() => setStaffLoading(false));
  }, [tab]);

  useEffect(() => {
    if (!resourcesOpen) return;
    setResourcesLoading(true);
    void fetchJsonArray<DpsResource>("/api/resources?public=true")
      .then(rows => setDpsResources(rows.filter(isPublicDepartmentResource)))
      .finally(() => setResourcesLoading(false));
  }, [resourcesOpen]);

  useEffect(() => {
    if (!dphResourcesOpen) return;
    setDphResourcesLoading(true);
    void fetchJsonArray<DpsResource>("/api/dph/resources?public=true")
      .then(rows => setDphResources(rows.filter(isPublicDepartmentResource)))
      .finally(() => setDphResourcesLoading(false));
  }, [dphResourcesOpen]);

  const openResource = (r: DpsResource, apiBase = "/api/resources") => {
    setResourcesOpen(false);
    setDphResourcesOpen(false);
    setResourceApiBase(apiBase);
    if (r.type === "pdf") setOpenPdf(r);
    else setOpenDocId(r.id);
  };

  // Home content is mostly static — don't block the whole page on Discord/ERLC stats.
  const pageLoading =
    (tab === "events" && eventsLoading)
    || (tab === "staff" && staffLoading)
    || (tab === "store" && storeProductsLoading);

  return (
    <div className="min-h-screen bg-[#02060b] text-white">
      {/* Top border */}
      <div className="h-px bg-[#1b2738]" />

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-[#131f30] bg-[#02060b]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3.5 sm:px-8">
          <div className="flex items-center gap-2.5">
            <img src={`${import.meta.env.BASE_URL}dojrp-shield.png`} alt="" className="h-7 w-7" />
            <DojrpLogo />
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* Live ERLC badge */}
            <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 sm:px-3 ${
              statsLoading ? "border-[#1b2738] bg-[#070d16]" : "border-[#173053] bg-[#071120]"
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${statsLoading ? "bg-[#2a3a50]" : "animate-pulse bg-[#3ecf8e]"}`} />
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#4384ff]">
                {statsLoading
                  ? " - "
                  : <>
                      {stats?.erlc_players ?? 0}/{stats?.erlc_max_players && stats.erlc_max_players > 0 ? stats.erlc_max_players : " - "}
                      <span className="hidden sm:inline"> In-Game</span>
                    </>
                }
              </span>
            </div>
            <button
              type="button"
              onClick={handleSignIn}
              className="rounded-full px-3 py-1.5 text-xs font-bold text-[#526179] transition-colors hover:bg-white/5 hover:text-white"
            >
              Sign in
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-[#0f1b28]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(20,45,90,0.30)_0,rgba(2,6,11,0)_55%)]" />
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-8 sm:py-20">
          <div className="flex flex-col items-center text-center">
            <img
              src={`${import.meta.env.BASE_URL}dojrp-shield.png`}
              alt=""
              className="mb-6 h-20 w-20 opacity-90 drop-shadow-[0_0_30px_rgba(47,112,255,0.4)]"
            />
            <h1 className="text-[38px] font-black leading-[0.95] tracking-[-0.05em] sm:text-[58px]">
              <DojrpLogo />
            </h1>
            <p className="mt-3 max-w-lg px-2 text-xs font-semibold text-[#526179] sm:mt-4 sm:px-0 sm:text-sm">
              We are one of the largest ER:LC Roleplay Community's, giving you: "A roleplay experience beyond your imagination."
            </p>

            {/* Live stats strip */}
            <div className="mt-6 grid w-full max-w-2xl grid-cols-3 gap-2 sm:mt-8 sm:gap-3">
              <StatCard
                icon={Gamepad2}
                label="In-Game"
                value={statsLoading ? " - " : `${stats?.erlc_players ?? 0}/${stats?.erlc_max_players && stats.erlc_max_players > 0 ? stats.erlc_max_players : " - "}`}
                sub="ERLC players"
                color="border-[#1b3320] text-[#3ecf8e]"
              />
              <StatCard
                icon={Users}
                label="Members"
                value={statsLoading ? " - " : (stats?.discord_members ?? 0).toLocaleString()}
                sub="Discord server"
                color="border-[#1b2a40] text-[#4384ff]"
              />
              <StatCard
                icon={Wifi}
                label="Online"
                value={statsLoading ? " - " : (stats?.discord_online ?? 0).toLocaleString()}
                sub="Discord online"
                color="border-[#2a1b20] text-[#ff7070]"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Tab bar */}
      <div className="border-b border-[#0f1b28] bg-[#02060b]">
        <div className="mx-auto flex max-w-6xl overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden px-4 sm:px-8">
          {([
            { id: "home",          label: "Home",          shortLabel: "Home",    icon: Shield },
            { id: "departments",   label: "Departments",   shortLabel: "Depts",   icon: Building2 },
            { id: "staff",         label: "Staff Team",    shortLabel: "Staff",   icon: Users },
            { id: "events",        label: "Public Events", shortLabel: "Events",  icon: CalendarDays },
            { id: "announcements", label: "Announcements", shortLabel: "News",    icon: Megaphone },
            { id: "gallery",       label: "In-game Gallery", shortLabel: "In-game", icon: ImageIcon },
            { id: "store",         label: "Server Store",  shortLabel: "Store",   icon: ShoppingBag },
            { id: "press",         label: "Press & News",  shortLabel: "Press",   icon: Newspaper },
          ] as { id: Tab; label: string; shortLabel: string; icon: React.ElementType }[]).map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-[10px] font-black uppercase tracking-[0.14em] transition-colors sm:gap-2 sm:px-4 sm:py-3.5 sm:text-[11px] sm:tracking-[0.18em] ${
                tab === t.id
                  ? "border-[#4384ff] text-white"
                  : "border-transparent text-[#526179] hover:text-[#8392aa]"
              }`}
            >
              <t.icon className="h-3.5 w-3.5 shrink-0" />
              <span className="sm:hidden">{t.shortLabel}</span>
              <span className="hidden sm:inline">{t.label}</span>
              {t.id === "announcements" && announcements.length > 0 && (
                <span className="rounded-full bg-[#0f1b28] px-1.5 py-0.5 text-[9px] text-[#526179]">{announcements.length}</span>
              )}
              {t.id === "gallery" && gallery.length > 0 && (
                <span className="rounded-full bg-[#0f1b28] px-1.5 py-0.5 text-[9px] text-[#526179]">{gallery.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <main className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:space-y-14 sm:px-8 sm:py-12">
        {pageLoading ? (
          <PageLoadingScreen loading />
        ) : (
        <>

        {/* -- Home tab: About + Gallery ---- */}
        {tab === "home" && (
          <>
            <section>
              <SectionHeading icon={Shield} title="About DOJRP" />
              <div className="mb-6 rounded-xl border border-[#131f30] bg-[#070d16] px-6 py-7 sm:px-8 sm:py-8">
                <p className="text-sm leading-relaxed text-[#a8b7cd]">
                  DOJ:RP is one of the largest ER:LC servers out there. With multiple departments including DPS and DPH and sub-divisions like SWAT, Hazmat, SRU and many more. We aim to ensure that the server is fun for everyone who joins us here in DOJ. We always aim for everyone to have a great time with the amazing staff team, great roleplays and fun events.
                </p>
                <p className="mt-4 text-sm leading-relaxed text-[#a8b7cd]">
                  Whether you want to patrol as a cop, or save peoples lives in fires or accidents, or have fun roleplaying as a civilian getting up to all sorts of crime, there's always a place here for you at DOJ.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  { icon: Radio,    title: "Live Roster",              body: "This has a roster live updates for all departments  -  containing department personnel, vehicle restrictions, policies, and more." },
                  { icon: Shield,   title: "Realistic Operations",    body: "Structured rank system, callsign management, and professional standards that mirror real law enforcement procedure." },
                  { icon: Users,    title: "Active Community",        body: "A growing community of dedicated roleplayers committed to immersive, realistic law enforcement and civilian roleplay." },
                ].map(c => (
                  <div key={c.title} className="rounded-xl border border-[#131f30] bg-[#070d16] px-6 py-7 transition-all hover:border-[#2f70ff]/40">
                    <c.icon className="h-6 w-6 text-[#4384ff]" strokeWidth={2.25} />
                    <h3 className="mt-4 text-sm font-black text-white">{c.title}</h3>
                    <p className="mt-2 text-xs leading-relaxed text-[#526179]">{c.body}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Recent Announcements preview */}
            {announcements.length > 0 && (
              <section>
                <div className="mb-5 flex items-center gap-3 sm:mb-6">
                  <Megaphone className="h-4 w-4 text-[#4384ff]" />
                  <h2 className="text-sm font-black uppercase tracking-[0.22em] text-white">Recent Announcements</h2>
                  <span className="rounded-full bg-[#0f1b28] px-2 py-0.5 text-[9px] font-black text-[#526179]">{announcements.length}</span>
                  <div className="ml-3 h-px flex-1 bg-[#131f30]" />
                  <button
                    type="button"
                    onClick={() => setTab("announcements")}
                    className="flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.15em] text-[#4384ff] transition-colors hover:text-white"
                  >
                    View all <ChevronLeft className="h-3 w-3 rotate-180" />
                  </button>
                </div>
                <div className="space-y-3">
                  {announcements.slice(0, 3).map(a => (
                    <div key={a.id} className="rounded-xl border border-[#131f30] bg-[#070d16] px-4 py-4 sm:px-6 sm:py-5">
                      <div className="flex items-start justify-between gap-4">
                        <h3 className="text-sm font-black text-white">{a.title}</h3>
                        <span className="shrink-0 text-[10px] text-[#3f5470]">{formatRelative(a.created_at)}</span>
                      </div>
                      <p className="mt-2 line-clamp-3 text-xs leading-relaxed whitespace-pre-wrap text-[#8392aa]">{a.message}</p>
                      <div className="mt-3 flex items-center gap-1.5">
                        <User className="h-3 w-3 text-[#3f5470]" />
                        <span className="text-[10px] font-bold text-[#3f5470]">{a.posted_by}</span>
                        <span className="text-[10px] text-[#2a3a50]"> · </span>
                        <Calendar className="h-3 w-3 text-[#2a3a50]" />
                        <span className="text-[10px] text-[#2a3a50]">{formatDate(a.created_at)}</span>
                      </div>
                    </div>
                  ))}
                  {announcements.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setTab("announcements")}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#131f30] py-3 text-[11px] font-black uppercase tracking-[0.15em] text-[#526179] transition-colors hover:border-[#2f70ff]/40 hover:text-white"
                    >
                      <Megaphone className="h-3.5 w-3.5" />
                      {announcements.length - 3} more announcement{announcements.length - 3 !== 1 ? "s" : ""}
                    </button>
                  )}
                </div>
              </section>
            )}

            <section>
              <div className="mb-5 flex items-center gap-3 sm:mb-6">
                <ImageIcon className="h-4 w-4 text-[#4384ff]" />
                <h2 className="text-sm font-black uppercase tracking-[0.22em] text-white">In-game Gallery</h2>
                <span className="rounded-full bg-[#0f1b28] px-2 py-0.5 text-[9px] font-black text-[#526179]">{gallery.length}</span>
                <div className="ml-3 h-px flex-1 bg-[#131f30]" />
                <button
                  type="button"
                  onClick={() => setTab("gallery")}
                  className="flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.15em] text-[#4384ff] transition-colors hover:text-white"
                >
                  View all <ChevronLeft className="h-3 w-3 rotate-180" />
                </button>
              </div>
              {gallery.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-[#0f1b28] py-12 text-center">
                  <ImageIcon className="h-7 w-7 text-[#1e2e42]" />
                  <p className="text-sm font-bold text-[#2a3a50]">No gallery images yet.</p>
                </div>
              ) : (
                <div
                  className="home-gallery-scroller -mx-1 overflow-hidden px-1 pb-2"
                  onMouseEnter={() => { galleryPausedRef.current = true; }}
                  onMouseLeave={() => { galleryPausedRef.current = false; }}
                  onFocusCapture={() => { galleryPausedRef.current = true; }}
                  onBlurCapture={() => { galleryPausedRef.current = false; }}
                >
                  <div
                    ref={setGalleryTrackNode}
                    className="flex w-max will-change-transform"
                  >
                    {[0, 1].map(copy => (
                      <div
                        key={copy}
                        ref={copy === 0 ? galleryFirstCopyRef : undefined}
                        className="flex gap-3 pr-3"
                        aria-hidden={copy === 1 ? true : undefined}
                      >
                        {gallery.map(img => (
                          <button
                            key={`${copy}-${img.id}`}
                            type="button"
                            tabIndex={copy === 1 ? -1 : undefined}
                            onClick={() => setLightbox(img)}
                            className="group relative aspect-video w-[min(78vw,280px)] shrink-0 overflow-hidden rounded-xl border border-[#131f30] bg-[#070d16] text-left transition-all hover:border-[#2f70ff]/50 hover:shadow-[0_0_30px_rgba(47,112,255,0.10)] sm:w-[300px]"
                          >
                            <img
                              src={img.image_url}
                              alt={img.title || "Gallery image"}
                              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                            {(img.title || img.caption) && (
                              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 py-3">
                                {img.title && <p className="text-xs font-black text-white">{img.title}</p>}
                                {img.caption && <p className="mt-0.5 text-[10px] text-[#a8b7cd]">{img.caption}</p>}
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        {/* -- Announcements tab ---- */}
        {tab === "announcements" && (
          <section>
            <SectionHeading icon={Megaphone} title="Announcements" count={announcements.length} />
            {announcements.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-[#0f1b28] py-12 text-center">
                <Megaphone className="h-7 w-7 text-[#1e2e42]" />
                <p className="text-sm font-bold text-[#2a3a50]">No announcements yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {announcements.map(a => (
                  <div key={a.id} className="rounded-xl border border-[#131f30] bg-[#070d16] px-4 py-4 sm:px-6 sm:py-5">
                    <div className="flex items-start justify-between gap-4">
                      <h3 className="text-sm font-black text-white">{a.title}</h3>
                      <span className="shrink-0 text-[10px] text-[#3f5470]">{formatRelative(a.created_at)}</span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed whitespace-pre-wrap text-[#8392aa]">{a.message}</p>
                    <div className="mt-3 flex items-center gap-1.5">
                      <User className="h-3 w-3 text-[#3f5470]" />
                      <span className="text-[10px] font-bold text-[#3f5470]">{a.posted_by}</span>
                      <span className="text-[10px] text-[#2a3a50]"> · </span>
                      <Calendar className="h-3 w-3 text-[#2a3a50]" />
                      <span className="text-[10px] text-[#2a3a50]">{formatDate(a.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* -- Gallery tab ---- */}
        {tab === "gallery" && (
          <section>
            <SectionHeading icon={ImageIcon} title="In-game Gallery" count={gallery.length} />
            {gallery.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-[#0f1b28] py-12 text-center">
                <ImageIcon className="h-7 w-7 text-[#1e2e42]" />
                <p className="text-sm font-bold text-[#2a3a50]">No gallery images yet.</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {gallery.map(img => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => setLightbox(img)}
                    className="group relative overflow-hidden rounded-xl border border-[#131f30] bg-[#070d16] aspect-video text-left transition-all hover:border-[#2f70ff]/50 hover:shadow-[0_0_30px_rgba(47,112,255,0.10)]"
                  >
                    <img
                      src={img.image_url}
                      alt={img.title || "Gallery image"}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    {(img.title || img.caption) && (
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 py-3">
                        {img.title && <p className="text-xs font-black text-white">{img.title}</p>}
                        {img.caption && <p className="mt-0.5 text-[10px] text-[#a8b7cd]">{img.caption}</p>}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* -- Staff Team tab ---- */}
        {tab === "staff" && (() => {
          const q = staffSearch.toLowerCase().trim();
          const filtered = staffMembers.filter(m => {
            if (!q) return true;
            return (
              m.username.toLowerCase().includes(q)
              || (m.staff_rank ?? "").toLowerCase().includes(q)
              || (m.staff_role ?? "").toLowerCase().includes(q)
              || (m.discord_username ?? "").toLowerCase().includes(q)
              || (m.discord_id ?? "").includes(q)
            );
          });

          const getRankMeta = (rankName: string | null | undefined) =>
            rankName
              ? (staffRanks.find(r => r.name.toLowerCase() === rankName.toLowerCase().trim()) ?? null)
              : null;

          const byRankThenName = (a: StaffMember, b: StaffMember) => {
            const rA = getRankMeta(a.staff_rank)?.sort_order ?? 999999;
            const rB = getRankMeta(b.staff_rank)?.sort_order ?? 999999;
            if (rA !== rB) return rA - rB;
            return (a.username || "").localeCompare(b.username || "");
          };

          const memberBelongsToGroup = (m: StaffMember, group: StaffGroup) => {
            const rankMeta = getRankMeta(m.staff_rank);
            if (rankMeta?.group_id != null) return rankMeta.group_id === group.id;
            return (m.staff_role ?? "").toLowerCase().trim() === group.name.toLowerCase().trim();
          };

          const sortedGroups = [...staffGroups]
            .filter(g => g.name.trim().toLowerCase() !== "community members")
            .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

          const assignedIds = new Set<number>();
          const grouped = sortedGroups.map(g => {
            const members = filtered.filter(m => memberBelongsToGroup(m, g)).sort(byRankThenName);
            members.forEach(m => assignedIds.add(m.id));
            return { key: `g${g.id}`, label: g.name, members };
          });

          const orphans = filtered.filter(m => !assignedIds.has(m.id)).sort(byRankThenName);
          if (orphans.length > 0) {
            grouped.push({ key: "other", label: "Other Staff", members: orphans });
          }

          // Show every title; when searching, hide titles with no matches
          const visibleGroups = q
            ? grouped.filter(g => g.members.length > 0)
            : grouped;

          const toggleStaffGroup = (key: string) =>
            setStaffCollapsed(p => ({ ...p, [key]: !p[key] }));

          return (
            <section>
              <div className="mb-5 flex flex-wrap items-center gap-3 sm:mb-6">
                <Users className="h-4 w-4 text-[#4384ff]" />
                <h2 className="text-sm font-black uppercase tracking-[0.22em] text-white">Staff Team</h2>
                <span className="rounded-full bg-[#0f1b28] px-2 py-0.5 text-[9px] font-black text-[#526179]">
                  {filtered.length}
                </span>
                <div className="ml-3 h-px flex-1 bg-[#131f30]" />
                <div className="relative w-full max-w-xs sm:w-56">
                  <input
                    type="text"
                    placeholder="Search staff…"
                    value={staffSearch}
                    onChange={e => setStaffSearch(e.target.value)}
                    className="h-9 w-full rounded-lg border border-[#1f3050] bg-[#070d16] px-3 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]"
                  />
                </div>
              </div>

              {visibleGroups.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-[#0f1b28] py-12 text-center">
                  <Users className="h-7 w-7 text-[#1e2e42]" />
                  <p className="text-sm font-bold text-[#2a3a50]">
                    {staffSearch
                      ? "No staff members match your search."
                      : staffGroups.length === 0
                        ? "No staff titles configured yet."
                        : "No staff members listed yet."}
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-[#131f30] bg-[#070d16]">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#131f30]">
                          <th className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Name</th>
                          <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Rank</th>
                          <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Status</th>
                          <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Appointed</th>
                          <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Discord ID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleGroups.map(group => (
                          <Fragment key={group.key}>
                            <tr
                              className="cursor-pointer border-b border-t border-[#172235] bg-[#0a1525] hover:bg-[#0c1830] transition-colors"
                              onClick={() => toggleStaffGroup(group.key)}
                            >
                              <td colSpan={5} className="px-5 py-2.5">
                                <div className="flex items-center gap-2">
                                  {staffCollapsed[group.key]
                                    ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#4384ff]" />
                                    : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#4384ff]" />}
                                  <span className="text-xs font-black text-white">{group.label}</span>
                                  <span className="rounded-full bg-[#172235] px-2 py-0.5 text-[9px] font-black text-[#526179]">
                                    {group.members.length}
                                  </span>
                                </div>
                              </td>
                            </tr>
                            {!staffCollapsed[group.key] && (
                              group.members.length === 0 ? (
                                <tr className="border-b border-[#0f1b28]">
                                  <td colSpan={5} className="px-5 py-3 text-[11px] text-[#3f5470]">
                                    No members in this title.
                                  </td>
                                </tr>
                              ) : (
                                group.members.map(m => {
                                  const rankMeta = getRankMeta(m.staff_rank);
                                  const active = (m.status ?? "").toLowerCase() === "active";
                                  return (
                                    <tr key={m.id} className="border-b border-[#0f1b28] hover:bg-[#081422] transition-colors">
                                      <td className="px-5 py-3.5">
                                        <div className="flex items-center gap-2">
                                          <StaffAvatar
                                            name={m.discord_username || m.username}
                                            discordId={m.discord_id}
                                            avatarHash={m.avatar_hash}
                                          />
                                          <div className="min-w-0">
                                            <span className="block truncate text-xs font-black text-white">{m.username || "—"}</span>
                                            {m.discord_username && (
                                              <span className="block truncate text-[10px] text-[#526179]">@{m.discord_username}</span>
                                            )}
                                          </div>
                                        </div>
                                      </td>
                                      <td className="px-4 py-3.5">
                                        <span
                                          className="text-[10px] font-black"
                                          style={{ color: rankMeta?.color_hex ?? "#a8b7cd" }}
                                        >
                                          {m.staff_rank || "—"}
                                        </span>
                                      </td>
                                      <td className="px-4 py-3.5">
                                        <span className={`inline-flex items-center rounded px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] ${
                                          active ? "bg-emerald-500 text-white" : "bg-[#1a2638] text-[#526179]"
                                        }`}>
                                          {m.status || "Active"}
                                        </span>
                                      </td>
                                      <td className="px-4 py-3.5 text-[11px] text-[#8392aa]">
                                        {m.staff_appointed_date ? formatDate(m.staff_appointed_date) : "—"}
                                      </td>
                                      <td className="px-4 py-3.5">
                                        <span className="font-mono text-[11px] text-[#526179]">{m.discord_id || "—"}</span>
                                      </td>
                                    </tr>
                                  );
                                })
                              )
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          );
        })()}

        {/* -- Server Store tab ---- */}
        {tab === "store" && (
          <section>
            <SectionHeading icon={ShoppingBag} title="Server Store" count={storeProducts.length || undefined} />
            {storeProducts.length === 0 ? (
              <div className="rounded-2xl border border-[#131f30] bg-[#070d16] px-6 py-10 text-center sm:px-10 sm:py-14">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[#4384ff]/25 bg-[#4384ff]/10">
                  <ShoppingBag className="h-7 w-7 text-[#4384ff]" />
                </div>
                <h3 className="mt-5 text-lg font-black text-white">DOJ:RP Server Store</h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[#526179]">
                  Support the community and unlock store packages, cosmetics, and server perks.
                </p>
                {serverStoreUrl ? (
                  <a
                    href={serverStoreUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#2f66ee] px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-white transition-colors hover:bg-[#3977ff]"
                  >
                    Open Store
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  <p className="mt-6 text-xs font-bold text-[#3f5470]">
                    Store products coming soon.
                  </p>
                )}
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {storeProducts.map((p, i) => (
                  <StoreProductCard
                    key={p.id ?? `${p.heading}-${i}`}
                    product={p}
                    fallbackBuyUrl={serverStoreUrl}
                    collapsibleDescription
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* -- Press & News tab ---- */}
        {tab === "press" && (
          <section>
            <SectionHeading icon={Newspaper} title="Press & News" />
            <div className="flex flex-col items-center gap-3 rounded-xl border border-[#0f1b28] py-16 text-center">
              <Newspaper className="h-8 w-8 text-[#1e2e42]" />
              <p className="text-sm font-black uppercase tracking-[0.18em] text-[#526179]">Coming Soon</p>
            </div>
          </section>
        )}

        {/* -- Public Events tab ---- */}
        {tab === "events" && (
          <section>
            <SectionHeading icon={CalendarDays} title="Public Events" />
            {events.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-[#0f1b28] py-16 text-center">
                <CalendarDays className="h-8 w-8 text-[#1e2e42]" />
                <p className="text-sm font-bold text-[#2a3a50]">No upcoming events scheduled.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {events.map(ev => {
                  const dateObj = new Date(ev.event_date + 'T12:00:00');
                  const isPast = dateObj < new Date();
                  const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
                  const timeStr = ev.event_time
                    ? new Date(`1970-01-01T${ev.event_time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                    : null;
                  const hostLine = ev.is_staff_event || ev.source === 'staff'
                    ? 'Server event hosted by DOJ Staff'
                    : [
                        ev.hosted_by ? `Hosted by ${ev.hosted_by}` : null,
                        ev.hosting_department || null,
                      ].filter(Boolean).join(' · ');
                  return (
                    <div key={`${ev.source ?? 'dps'}-${ev.id}`} className={`flex items-start gap-3 rounded-xl border px-4 py-4 transition-all sm:gap-5 sm:px-6 sm:py-5 ${isPast ? 'border-[#0f1b28] bg-[#04080e] opacity-60' : 'border-[#1b2738] bg-[#070d16] hover:border-[#2f66ee]/40'}`}>
                      {/* Date badge */}
                      <div className={`flex w-14 shrink-0 flex-col items-center justify-center rounded-xl border py-2 text-center ${isPast ? 'border-[#131f30] bg-[#070d16]' : 'border-[#1b3060] bg-[#071120]'}`}>
                        <span className={`text-[9px] font-black uppercase tracking-widest ${isPast ? 'text-[#526179]' : 'text-[#4384ff]'}`}>
                          {dateObj.toLocaleDateString('en-US', { month: 'short' })}
                        </span>
                        <span className="text-xl font-black leading-none text-white">{dateObj.getDate()}</span>
                        <span className={`text-[9px] font-bold ${isPast ? 'text-[#3f5470]' : 'text-[#526179]'}`}>
                          {dateObj.getFullYear()}
                        </span>
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-black text-white">{ev.title}</p>
                          {isPast && <span className="rounded-full bg-[#0f1b28] px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-[#3f5470]">Past</span>}
                        </div>
                        <p className="mt-1 text-xs text-[#526179]">
                          {dateStr}{timeStr ? `  ·  ${timeStr}` : ''}
                        </p>
                        {hostLine && (
                          <p className="mt-1 text-xs font-semibold text-[#8392aa]">{hostLine}</p>
                        )}
                        {ev.location && (
                          <p className="mt-1 flex items-center gap-1.5 text-xs text-[#3f5470]">
                            <Building2 className="h-3 w-3 shrink-0" />
                            {ev.location}
                          </p>
                        )}
                        {ev.purpose && (
                          <p className="mt-2 text-xs leading-relaxed text-[#526179]">{ev.purpose}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* -- Departments tab ---- */}
        {tab === "departments" && (
          <div className="space-y-10">

            {/* -- Department of Public Safety ---- */}
            <section className="rounded-2xl border border-[#1b2738] bg-[#070d16] overflow-hidden">
              <div className="flex items-center gap-3 border-b border-[#131f30] bg-[#0b1422] px-4 py-4 sm:px-7 sm:py-5">
                <Shield className="h-5 w-5 text-[#4384ff]" />
                <h2 className="text-sm font-black uppercase tracking-[0.2em] text-white">Department of Public Safety</h2>
              </div>
              <div className="space-y-5 px-4 py-5 text-xs leading-relaxed text-[#8392aa] sm:space-y-6 sm:px-7 sm:py-6">
                {/* Description */}
                <p>
                  {indexInfo?.description ?? "The Liberty State Department of Public Safety (DPS) is responsible for law enforcement, emergency response, and public security within the county. It oversees Patrol Operations, Special Operations, and Administrative Operations to ensure public safety and uphold the law."}
                </p>

                {/* Divisions — live from Division Roster */}
                {(() => {
                  const liveNames = dpsDivisions.map(d => {
                    const key = (d.unit_key ?? "").trim().toUpperCase();
                    return key ? `${d.name} (${key})` : d.name;
                  });
                  const fallback = indexInfo?.divisions ?? [];
                  const list = liveNames.length > 0 ? liveNames : fallback;
                  if (list.length === 0) return null;
                  return (
                    <div>
                      <p className="mb-2 text-[11px] font-black uppercase tracking-[0.15em] text-white">Department Divisions</p>
                      <ul className="space-y-1 pl-4">
                        {list.map(d => (
                          <li key={d} className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-[#4384ff]" />{d}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}

                {/* Sub-departments */}
                {(indexInfo?.sub_departments?.length
                  ? indexInfo.sub_departments
                  : [{ name: "Internal Affairs", description: "This is a sub department led by the agent in charge to oversee professional standards for the department and for other law enforcement agencies in the state." }]
                ).map((sd, i) => (
                  <div key={i}>
                    <p className="mb-2 text-[11px] font-black uppercase tracking-[0.15em] text-white">{sd.name} <span className="text-[#526179] normal-case tracking-normal font-semibold">(Sub-Department)</span></p>
                    <p>{sd.description}</p>
                  </div>
                ))}

                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (getCadSession()) {
                        navigate("/dps?tab=information");
                      } else {
                        sessionStorage.setItem("post_login_redirect", "/dps?tab=information");
                        setIsLoginOpen(true);
                      }
                    }}
                    className="flex items-center justify-center gap-2 rounded-xl bg-[#2f66ee] px-5 py-2.5 text-xs font-black text-white shadow-[0_6px_20px_rgba(47,102,238,0.28)] transition-all hover:-translate-y-0.5 hover:bg-[#3977ff] sm:justify-start"
                  >
                    <Shield className="h-3.5 w-3.5" />
                    Open DPS Page
                  </button>
                  <button
                    type="button"
                    onClick={() => setResourcesOpen(true)}
                    className="flex items-center justify-center gap-2 rounded-xl border border-[#2f66ee]/40 bg-[#2f66ee]/10 px-5 py-2.5 text-xs font-black text-[#4384ff] transition-all hover:-translate-y-0.5 hover:bg-[#2f66ee]/20 sm:justify-start"
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    Resources
                  </button>
                  <button
                    type="button"
                    onClick={() => setRosterOpen(true)}
                    className="flex items-center justify-center gap-2 rounded-xl border border-[#2f66ee]/40 bg-[#2f66ee]/10 px-5 py-2.5 text-xs font-black text-[#4384ff] transition-all hover:-translate-y-0.5 hover:bg-[#2f66ee]/20 sm:justify-start"
                  >
                    <Users className="h-3.5 w-3.5" />
                    Roster
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (getCadSession()) {
                        navigate("/dps?tab=event-calendar");
                      } else {
                        sessionStorage.setItem("post_login_redirect", "/dps?tab=event-calendar");
                        setIsLoginOpen(true);
                      }
                    }}
                    className="flex items-center justify-center gap-2 rounded-xl border border-[#2f66ee]/40 bg-[#2f66ee]/10 px-5 py-2.5 text-xs font-black text-[#4384ff] transition-all hover:-translate-y-0.5 hover:bg-[#2f66ee]/20 sm:justify-start"
                  >
                    <CalendarDays className="h-3.5 w-3.5" />
                    Department Public Events
                  </button>
                </div>
              </div>
            </section>

            {/* -- Department of Public Health ---- */}
            <section className="rounded-2xl border border-[#1b2738] bg-[#070d16] overflow-hidden">
              <div className="flex items-center gap-3 border-b border-[#131f30] bg-[#0b1422] px-4 py-4 sm:px-7 sm:py-5">
                <Flame className="h-5 w-5 text-[#f87171]" />
                <h2 className="text-sm font-black uppercase tracking-[0.2em] text-white">Department of Public Health</h2>
              </div>
              <div className="space-y-5 px-4 py-5 text-xs leading-relaxed text-[#8392aa] sm:space-y-6 sm:px-7 sm:py-6">
                {/* Description */}
                <p>
                  {dphIndexInfo?.description ?? "The Liberty State Department of Public Health (DPH) is the state's primary agency responsible for protecting and promoting the health, safety, and well-being of the community throughout the county. The Department works to prevent disease, support public health initiatives, coordinate health emergency preparedness, and ensure access to essential health services while maintaining public trust and community engagement."}
                </p>

                {/* Divisions — live from DPH Division Roster */}
                {(() => {
                  const liveNames = dphDivisions.map(d => {
                    const key = (d.unit_key ?? "").trim().toUpperCase();
                    return key ? `${d.name} (${key})` : d.name;
                  });
                  const fallback = dphIndexInfo?.divisions?.length
                    ? dphIndexInfo.divisions
                    : ["Recruitment and Training", "Urban Search and Rescue", "Wildland Subdivision", "Water Rescue"];
                  const list = liveNames.length > 0 ? liveNames : fallback;
                  if (list.length === 0) return null;
                  return (
                    <div>
                      <p className="mb-2 text-[11px] font-black uppercase tracking-[0.15em] text-white">Department Divisions</p>
                      <ul className="space-y-1 pl-4">
                        {list.map(d => (
                          <li key={d} className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-[#ef4444]" />{d}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}

                {/* Sub-departments */}
                {(dphIndexInfo?.sub_departments?.length
                  ? dphIndexInfo.sub_departments
                  : [
                      { name: "Liberty County Fire Rescue (LCFR)", description: "Fire suppression, rescue operations, and emergency response across Liberty County." },
                      { name: "Liberty County Medical Services (LCMS)", description: "Emergency medical services and public health medical support for the community." },
                      { name: "Internal Affairs", description: "This is a sub department led by the agent in charge to oversee professional standards for the Department of Public Health." },
                    ]
                ).map((sd, i) => (
                  <div key={i}>
                    <p className="mb-2 text-[11px] font-black uppercase tracking-[0.15em] text-white">{sd.name} <span className="text-[#526179] normal-case tracking-normal font-semibold">(Sub-Department)</span></p>
                    <p>{sd.description}</p>
                  </div>
                ))}

                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (getCadSession()) {
                        navigate("/dph?tab=information");
                      } else {
                        sessionStorage.setItem("post_login_redirect", "/dph?tab=information");
                        setIsLoginOpen(true);
                      }
                    }}
                    className="flex items-center justify-center gap-2 rounded-xl bg-[#dc2626] px-5 py-2.5 text-xs font-black text-white shadow-[0_6px_20px_rgba(220,38,38,0.28)] transition-all hover:-translate-y-0.5 hover:bg-[#ef4444] sm:justify-start"
                  >
                    <Flame className="h-3.5 w-3.5" />
                    Open DPH Page
                  </button>
                  <button
                    type="button"
                    onClick={() => setDphResourcesOpen(true)}
                    className="flex items-center justify-center gap-2 rounded-xl border border-[#dc2626]/40 bg-[#dc2626]/10 px-5 py-2.5 text-xs font-black text-[#f87171] transition-all hover:-translate-y-0.5 hover:bg-[#dc2626]/20 sm:justify-start"
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    Resources
                  </button>
                  <button
                    type="button"
                    onClick={() => setDphRosterOpen(true)}
                    className="flex items-center justify-center gap-2 rounded-xl border border-[#dc2626]/40 bg-[#dc2626]/10 px-5 py-2.5 text-xs font-black text-[#f87171] transition-all hover:-translate-y-0.5 hover:bg-[#dc2626]/20 sm:justify-start"
                  >
                    <Users className="h-3.5 w-3.5" />
                    Roster
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (getCadSession()) {
                        navigate("/dph?tab=event-calendar");
                      } else {
                        sessionStorage.setItem("post_login_redirect", "/dph?tab=event-calendar");
                        setIsLoginOpen(true);
                      }
                    }}
                    className="flex items-center justify-center gap-2 rounded-xl border border-[#dc2626]/40 bg-[#dc2626]/10 px-5 py-2.5 text-xs font-black text-[#f87171] transition-all hover:-translate-y-0.5 hover:bg-[#dc2626]/20 sm:justify-start"
                  >
                    <CalendarDays className="h-3.5 w-3.5" />
                    Department Public Events
                  </button>
                </div>
              </div>
            </section>

          </div>
        )}

        </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#0f1b28] py-8 text-center">
        <p className="text-[9px] font-black uppercase tracking-[0.3em] text-[#1e2e42]">
          For roleplay use only  ·  Not affiliated with any real agency
        </p>
      </footer>

      <LoginModal isOpen={isLoginOpen} onClose={() => setIsLoginOpen(false)} />

      <DpsPublicRosterModal open={rosterOpen} onClose={() => setRosterOpen(false)} />
      <DpsPublicRosterModal
        open={dphRosterOpen}
        onClose={() => setDphRosterOpen(false)}
        apiBase="/api/dph"
        title="DPH Roster"
        accent="red"
      />

      {/* DPS Resources popup */}
      {resourcesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-8">
          <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#1b2738] bg-[#0d1422] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#131f30] px-5 py-4 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#2f66ee]/25 bg-[#2f66ee]/10">
                  <BookOpen className="h-4 w-4 text-[#4384ff]" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white">DPS Resources</h3>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#526179]">
                    Public department guides &amp; reference materials
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setResourcesOpen(false)}
                className="rounded-full p-1.5 text-[#4a5568] transition-colors hover:bg-white/5 hover:text-white"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-5 sm:px-6">
              {resourcesLoading ? (
                <div className="flex min-h-[160px] items-center justify-center text-sm font-bold text-[#8ea1bb]">Loading resources…</div>
              ) : dpsResources.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                  <FileText className="h-8 w-8 text-[#3f5470]" />
                  <p className="text-sm font-black text-[#526179]">No resources available</p>
                  <p className="text-xs text-[#3f5470]">Guides and department materials will appear here.</p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {dpsResources.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => openResource(r, "/api/resources")}
                      className="flex flex-col gap-2 rounded-xl border border-[#1e2d42] bg-[#070d16] p-4 text-left transition-all hover:border-[#2f66ee]/40 hover:bg-[#0a1525]"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#2f66ee]/20 bg-[#2f66ee]/8">
                        <FileText className="h-4 w-4 text-[#4384ff]" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-white">{r.title}</p>
                        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-[#526179]">
                          {r.type === "pdf" ? "PDF" : "Document"}
                        </p>
                      </div>
                      <p className="text-[10px] text-[#3f5470]">
                        {new Date(r.updated_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* DPH Resources popup */}
      {dphResourcesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-8">
          <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#1b2738] bg-[#0d1422] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#131f30] px-5 py-4 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#ef4444]/25 bg-[#ef4444]/10">
                  <BookOpen className="h-4 w-4 text-[#f87171]" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white">DPH Resources</h3>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#526179]">
                    Public department guides &amp; reference materials
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDphResourcesOpen(false)}
                className="rounded-full p-1.5 text-[#4a5568] transition-colors hover:bg-white/5 hover:text-white"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-5 sm:px-6">
              {dphResourcesLoading ? (
                <div className="flex min-h-[160px] items-center justify-center text-sm font-bold text-[#8ea1bb]">Loading resources…</div>
              ) : dphResources.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                  <FileText className="h-8 w-8 text-[#3f5470]" />
                  <p className="text-sm font-black text-[#526179]">No resources available</p>
                  <p className="text-xs text-[#3f5470]">Guides and department materials will appear here.</p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {dphResources.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => openResource(r, "/api/dph/resources")}
                      className="flex flex-col gap-2 rounded-xl border border-[#1e2d42] bg-[#070d16] p-4 text-left transition-all hover:border-[#ef4444]/40 hover:bg-[#140a0a]"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#ef4444]/20 bg-[#ef4444]/8">
                        <FileText className="h-4 w-4 text-[#f87171]" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-white">{r.title}</p>
                        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-[#526179]">
                          {r.type === "pdf" ? "PDF" : "Document"}
                        </p>
                      </div>
                      <p className="text-[10px] text-[#3f5470]">
                        {new Date(r.updated_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {openDocId !== null && (
        <DocumentEditor
          key={`${resourceApiBase}-${openDocId}`}
          resourceId={openDocId}
          canEdit={false}
          apiBase={resourceApiBase}
          onClose={() => setOpenDocId(null)}
        />
      )}

      {openPdf !== null && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-[#02060b]">
          <div className="flex shrink-0 items-center justify-between border-b border-[#131f30] px-4 py-3">
            <p className="truncate text-sm font-black text-white">{openPdf.title}</p>
            <button
              type="button"
              onClick={() => setOpenPdf(null)}
              className="rounded-full p-1.5 text-[#4a5568] hover:bg-white/5 hover:text-white"
              aria-label="Close PDF"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <PdfViewer
            fileUrl={`${resourceApiBase}/${openPdf.id}/file`}
            downloadName={`${openPdf.title}.pdf`}
          />
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 px-3 py-6 sm:px-4"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-h-[90vh] max-w-4xl w-full" onClick={e => e.stopPropagation()}>
            <img
              src={lightbox.image_url}
              alt={lightbox.title || "Gallery image"}
              className="max-h-[80vh] w-full rounded-xl object-contain shadow-2xl"
            />
            {(lightbox.title || lightbox.caption) && (
              <div className="mt-3 text-center">
                {lightbox.title && <p className="text-sm font-black text-white">{lightbox.title}</p>}
                {lightbox.caption && <p className="mt-1 text-xs text-[#526179]">{lightbox.caption}</p>}
              </div>
            )}
            <button
              type="button"
              onClick={() => setLightbox(null)}
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border border-[#2a3a50] bg-[#070d16]/90 text-[#a8b7cd] hover:text-white"
            >
              âœ•
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PublicView;
