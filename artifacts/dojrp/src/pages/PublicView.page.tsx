// ----
// pages/PublicView.tsx   -   Public-facing community page  (/public)
//
// No authentication required. Displays live stats, announcements, gallery,
// and press/news items for the DOJRP community.
// ----
import { useCallback, useEffect, useMemo, useRef, useState, Fragment, lazy, Suspense } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { sectionFromPathname } from "@/hooks/usePortalSection";
import {
  CalendarDays, Gamepad2, Users, Megaphone, Image as ImageIcon,
  Newspaper, ChevronLeft, ExternalLink, Calendar, User,
  Radio, Shield, Wifi, Building2, Flame,
  BookOpen, FileText, X, ShoppingBag, ChevronDown, ChevronRight, Sparkles,
} from "lucide-react";
import DojrpLogo from "@/components/shared/DojrpLogo";
import DojrpShield from "@/components/shared/DojrpShield";
import {
  DPS_SEAL_URL,
  DPH_SEAL_URL,
  DPS_INDEX_BANNER_URL,
  DPH_INDEX_BANNER_URL,
  INDEX_PREVIEW_SKIN,
  ix,
  skin,
} from "./public-index-skin";
import { PageLoadingScreen } from "@/components/shared/LoadingProgress";
import StoreProductCard, { type StoreProduct } from "@/components/shared/StoreProductCard";
import LoginModal from "@/components/overlays/LoginModal";
import { googleFileIdFromResource, isPdfLikeResource, resourceFileUrl, resourceTypeLabel } from "@/lib/resource-type";
import {
  departmentResourcePath,
  findResourceByLinkSlug,
  parseResourcePathname,
} from "@/lib/resource-url";
import { SimpleLoading } from "@/components/shared/LoadingProgress";

const DpsPublicRosterModal = lazy(() => import("@/components/overlays/DpsPublicRosterModal"));
const DocumentEditor = lazy(() => import("@/components/editor/DocumentEditor"));
const PdfViewer = lazy(() => import("@/components/shared/PdfViewer"));
import { getCadSession } from "@/lib/cad-session";
import { sortByRankThenUsername } from "@/lib/roster-sort";
import { formatInGameCount } from "@/lib/in-game-count";
import { fetchPublicLiveStats, publicLiveStatsOrEmpty, type PublicLiveStats } from "@/lib/live-stats";
import DepartmentIndexPanel from "@/components/public/DepartmentIndexPanel";
import type { IndexInfoContent } from "@/lib/index-info-content";
import { indexInfoHasContent, normalizeIndexInfo } from "@/lib/index-info-content";
import { useDiscordPresence } from "@/hooks/useDiscordPresence";
import { DiscordStatusBadge } from "@/components/shared/DiscordStatusBadge";

// -- Types ----
interface Stats extends PublicLiveStats {}

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
// -- Hero stat card (classic horizontal layout) ----
function StatCard({ icon: Icon, label, value, sub, tone, iconColor, color }: {
  icon: React.ElementType; label: string; value: number | string;
  sub?: string; tone?: string; iconColor?: string; color?: string;
}) {
  const preview = INDEX_PREVIEW_SKIN && tone && iconColor;

  return (
    <div
      className={
        preview
          ? `flex h-full min-h-[4.75rem] items-center gap-3 rounded-xl border border-[#1a2d45] bg-gradient-to-br ${tone} px-3 py-3 transition hover:border-[#2a4060] sm:min-h-[5.25rem] sm:gap-4 sm:rounded-2xl sm:px-5 sm:py-4`
          : `flex h-full min-h-[4.75rem] items-center gap-3 ${skin.card} px-3 py-3 sm:min-h-[5.25rem] sm:gap-4 sm:px-5 sm:py-4 ${color ?? ""}`
      }
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-10 sm:w-10 ${preview ? "rounded-xl border" : "bg-current/10"}`}
        style={preview ? {
          backgroundColor: `${iconColor}18`,
          borderColor: `${iconColor}30`,
          color: iconColor,
        } : undefined}
      >
        <Icon className="h-4 w-4 sm:h-5 sm:w-5" style={preview ? undefined : { color: "inherit" }} />
      </div>
      <div className="min-w-0">
        <p className={`truncate text-[9px] font-black uppercase tracking-[0.12em] sm:text-[10px] sm:tracking-[0.2em] ${preview ? "text-[#5a7090]" : skin.mutedText}`}>
          {label}
        </p>
        <p className="mt-0.5 text-lg font-black tabular-nums text-white sm:text-2xl">{value}</p>
        {sub && <p className="mt-0.5 text-[10px] text-[#3f5470]">{sub}</p>}
      </div>
    </div>
  );
}

// -- Section heading ----
function SectionHeading({ icon: Icon, title, count }: {
  icon: React.ElementType; title: string; count?: number;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 sm:mb-6">
      <Icon className="h-4 w-4 shrink-0 text-[#4384ff]" />
      <h2 className="min-w-0 text-sm font-black uppercase tracking-[0.14em] text-white sm:tracking-[0.22em]">{title}</h2>
      {count !== undefined && (
        <span className={skin.countBadge}>{count}</span>
      )}
      <div className={`ml-0 h-px min-w-[2rem] flex-1 sm:ml-3 ${skin.divider}`} />
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

/** Public events tab filters — synced to `?events=` in the URL. */
type PublicEventFilter = "all" | "staff" | "departments" | "dps" | "dph";

const VALID_EVENT_FILTERS = new Set<PublicEventFilter>(["all", "staff", "departments", "dps", "dph"]);

const EVENT_FILTER_PARAM = "events";

const PRIMARY_EVENT_FILTERS: { id: "all" | "staff" | "departments"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "staff", label: "Staff Events" },
  { id: "departments", label: "Department Events" },
];

const DEPARTMENT_EVENT_FILTERS: { id: "departments" | "dps" | "dph"; label: string }[] = [
  { id: "departments", label: "All Departments" },
  { id: "dps", label: "DPS" },
  { id: "dph", label: "DPH" },
];

function eventFilterFromSearch(search: string): PublicEventFilter {
  try {
    const raw = new URLSearchParams(search).get(EVENT_FILTER_PARAM)?.trim().toLowerCase();
    if (raw && VALID_EVENT_FILTERS.has(raw as PublicEventFilter)) {
      return raw as PublicEventFilter;
    }
  } catch { /* ignore */ }
  return "all";
}

function isDepartmentEventScope(filter: PublicEventFilter): boolean {
  return filter === "departments" || filter === "dps" || filter === "dph";
}

function matchesPublicEventFilter(ev: DpsEvent, filter: PublicEventFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "staff":
      return ev.is_staff_event === true || ev.source === "staff";
    case "departments":
      return ev.source === "dps" || ev.source === "dph";
    case "dps":
      return ev.source === "dps";
    case "dph":
      return ev.source === "dph";
    default:
      return true;
  }
}

function publicEventsPath(filter: PublicEventFilter): string {
  if (filter === "all") return publicSectionPath("events");
  return `${publicSectionPath("events")}?${EVENT_FILTER_PARAM}=${filter}`;
}

function eventFilterEmptyLabel(filter: PublicEventFilter): string {
  switch (filter) {
    case "staff":
      return "No upcoming staff events scheduled.";
    case "dps":
      return "No upcoming DPS events scheduled.";
    case "dph":
      return "No upcoming DPH events scheduled.";
    case "departments":
      return "No upcoming department events scheduled.";
    default:
      return "No upcoming events scheduled.";
  }
}

function eventSourceBadge(ev: DpsEvent): { label: string; className: string } | null {
  if (ev.is_staff_event || ev.source === "staff") {
    return { label: "Staff", className: "border-[#a78bfa]/30 bg-[#a78bfa]/10 text-[#a78bfa]" };
  }
  if (ev.source === "dps") {
    return { label: "DPS", className: "border-[#4384ff]/30 bg-[#4384ff]/10 text-[#4384ff]" };
  }
  if (ev.source === "dph") {
    return { label: "DPH", className: ix("border-[#f87171]/30 bg-[#f87171]/10 text-[#f87171]", "border-[#34d399]/30 bg-[#34d399]/10 text-[#34d399]") };
  }
  return null;
}

/** Home is `/`; other public sections use `/public_<section>` (e.g. `/public_store`). */
function publicSectionPath(tab: Tab): string {
  return tab === "home" ? "/" : `/public_${tab}`;
}

function tabFromRoute(section: string | undefined, search: string): Tab {
  const fromPath = section?.trim().toLowerCase();
  if (fromPath && VALID_TABS.has(fromPath as Tab)) return fromPath as Tab;
  try {
    const raw = new URLSearchParams(search).get("tab")?.trim().toLowerCase();
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


type PublicDivision = {
  id: number;
  name: string;
  sort_order: number;
  unit_key?: string | null;
};

type DpsResource = {
  id: number;
  title: string;
  type: "document" | "pdf" | "google_doc";
  logo_url: string | null;
  google_file_id?: string | null;
  header_config?: unknown;
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
  const location = useLocation();
  const pathSection = sectionFromPathname(location.pathname, "public");
  const sectionParam =
    location.pathname === "/" || location.pathname === ""
      ? "home"
      : pathSection === "home"
        ? "home"
        : pathSection;
  const [searchParams] = useSearchParams();

  const [isLoginOpen,   setIsLoginOpen]   = useState(false);
  const [tab,           setTabState]      = useState<Tab>(() =>
    tabFromRoute(sectionParam, typeof window !== "undefined" ? window.location.search : ""),
  );
  const [serverStoreUrl, setServerStoreUrl] = useState(SERVER_STORE_URL_FALLBACK);
  const [storeProducts, setStoreProducts] = useState<StoreProduct[]>([]);
  const [storeProductsLoading, setStoreProductsLoading] = useState(false);
  const [events, setEvents] = useState<DpsEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventFilter, setEventFilter] = useState<PublicEventFilter>(() =>
    eventFilterFromSearch(typeof window !== "undefined" ? window.location.search : ""),
  );

  useEffect(() => {
    const next = tabFromRoute(sectionParam, location.search);
    setTabState(next);
    const legacy = searchParams.get("tab")?.trim().toLowerCase();
    if (legacy && VALID_TABS.has(legacy as Tab)) {
      navigate(publicSectionPath(legacy as Tab), { replace: true });
      return;
    }
    // Normalize legacy `/public_home` bookmarks (route also redirects).
    if (location.pathname === "/public_home") {
      navigate("/", { replace: true });
    }
  }, [sectionParam, location.pathname, location.search, searchParams, navigate]);

  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    navigate(publicSectionPath(next));
  }, [navigate]);

  const openPublicEvents = useCallback((filter: PublicEventFilter) => {
    setEventFilter(filter);
    navigate(publicEventsPath(filter));
  }, [navigate]);

  const setEventFilterAndUrl = useCallback((filter: PublicEventFilter) => {
    setEventFilter(filter);
    navigate(publicEventsPath(filter));
  }, [navigate]);

  useEffect(() => {
    if (tab !== "events") return;
    setEventFilter(eventFilterFromSearch(location.search));
  }, [tab, location.search]);

  const filteredEvents = useMemo(
    () => events.filter(ev => matchesPublicEventFilter(ev, eventFilter)),
    [events, eventFilter],
  );

  const handleSignIn = () => {
    if (getCadSession()) {
      navigate("/portal_dashboard");
    } else {
      setIsLoginOpen(true);
    }
  };
  const [stats,         setStats]         = useState<Stats | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [gallery,       setGallery]       = useState<GalleryImage[]>([]);
  const [press,         setPress]         = useState<PressItem[]>([]);
  const [lightbox,      setLightbox]      = useState<GalleryImage | null>(null);
  const galleryPausedRef = useRef(false);
  const galleryResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const galleryIgnoreScrollRef = useRef(false);
  const [galleryScrollerEl, setGalleryScrollerEl] = useState<HTMLDivElement | null>(null);
  const setGalleryScrollerNode = useCallback((node: HTMLDivElement | null) => {
    setGalleryScrollerEl(node);
  }, []);
  const pauseGalleryAutoScroll = useCallback(() => {
    galleryPausedRef.current = true;
    if (galleryResumeTimerRef.current) clearTimeout(galleryResumeTimerRef.current);
    galleryResumeTimerRef.current = setTimeout(() => {
      galleryPausedRef.current = false;
      galleryResumeTimerRef.current = null;
    }, 20_000);
  }, []);
  const tabScrollRef = useRef<HTMLDivElement | null>(null);
  const [statsLoading,  setStatsLoading]  = useState(true);
  const liveStats = publicLiveStatsOrEmpty(stats);
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

  const staffDiscordIds = useMemo(
    () => staffMembers.map(m => m.discord_id),
    [staffMembers],
  );
  const staffDiscordPresence = useDiscordPresence(staffDiscordIds);

  // Live-refresh stats every 60 s — defer first fetch so the page paints first.
  useEffect(() => {
    let hasLoaded = false;
    const load = (initial: boolean) => {
      if (initial) setStatsLoading(true);
      void fetchPublicLiveStats()
        .then((next) => {
          if (next) setStats(next);
          else if (!hasLoaded) setStats(null);
        })
        .finally(() => {
          hasLoaded = true;
          setStatsLoading(false);
        });
    };
    const startId = window.setTimeout(() => load(true), 0);
    const id = setInterval(() => load(false), 60_000);
    return () => {
      window.clearTimeout(startId);
      clearInterval(id);
    };
  }, []);

  // Home Gallery ONLY: auto-scroll with scrollbar; pause on interaction, resume after 20s idle
  useEffect(() => {
    if (tab !== "home") return;
    const el = galleryScrollerEl;
    if (!el || gallery.length === 0) return;

    let raf = 0;
    let last = performance.now();
    const speedPxPerSec = 32;
    let running = true;

    const maxScrollLeft = () => Math.max(0, el.scrollWidth - el.clientWidth);

    const markProgrammaticScroll = () => {
      galleryIgnoreScrollRef.current = true;
      requestAnimationFrame(() => {
        galleryIgnoreScrollRef.current = false;
      });
    };

    const onUserActivity = () => {
      pauseGalleryAutoScroll();
    };

    const onScroll = () => {
      if (galleryIgnoreScrollRef.current) return;
      pauseGalleryAutoScroll();
    };

    const tick = (now: number) => {
      if (!running) return;
      const dt = Math.min(now - last, 64);
      last = now;
      if (!galleryPausedRef.current && !document.hidden) {
        const end = maxScrollLeft();
        if (end > 0) {
          markProgrammaticScroll();
          if (el.scrollLeft >= end - 1) {
            el.scrollLeft = 0;
          } else {
            el.scrollLeft += (speedPxPerSec * dt) / 1000;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onUserActivity, { passive: true });
    el.addEventListener("pointerdown", onUserActivity);
    el.addEventListener("touchstart", onUserActivity, { passive: true });

    raf = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onUserActivity);
      el.removeEventListener("pointerdown", onUserActivity);
      el.removeEventListener("touchstart", onUserActivity);
      if (galleryResumeTimerRef.current) {
        clearTimeout(galleryResumeTimerRef.current);
        galleryResumeTimerRef.current = null;
      }
      galleryPausedRef.current = false;
    };
  }, [tab, galleryScrollerEl, gallery.length, pauseGalleryAutoScroll]);

  // Tab bar: map mouse wheel to horizontal scroll so Store / Press stay reachable
  useEffect(() => {
    const el = tabScrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      const max = el.scrollWidth - el.clientWidth;
      const next = Math.max(0, Math.min(max, el.scrollLeft + delta));
      if (next === el.scrollLeft) return;
      e.preventDefault();
      el.scrollLeft = next;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Gallery lightbox: Escape closes (no close control overlaid on the photo)
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  useEffect(() => {
    void fetchJsonArray<Announcement>("/api/announcements").then(setAnnouncements);
    void fetchJsonArray<GalleryImage>("/api/public/gallery").then(setGallery);
    void fetchJsonArray<PressItem>("/api/public/press").then(setPress);
    fetch("/api/roster/content/index_info").then(r => r.json())
      .then((d: IndexInfoContent) => { if (indexInfoHasContent(d)) setIndexInfo(normalizeIndexInfo(d)); }).catch(() => {});
    fetch("/api/dph/content/index_info").then(r => r.json())
      .then((d: IndexInfoContent) => { if (indexInfoHasContent(d)) setDphIndexInfo(normalizeIndexInfo(d)); }).catch(() => {});
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

  const resourceDeepLink = useMemo(() => parseResourcePathname(location.pathname), [location.pathname]);

  useEffect(() => {
    if (!resourceDeepLink || resourceDeepLink.mode !== "public") return;
    const department = resourceDeepLink.department;
    if (department === "staff") return;
    const apiBase = department === "dph" ? "/api/dph/resources" : "/api/resources";
    setResourceApiBase(apiBase);
    void fetchJsonArray<DpsResource>(`${apiBase}?public=true`).then(rows => {
      const list = rows.filter(isPublicDepartmentResource);
      const resource = findResourceByLinkSlug(list, resourceDeepLink.linkSlug);
      if (!resource) return;
      if (isPdfLikeResource(resource)) {
        setOpenPdf(resource);
        setOpenDocId(null);
      } else {
        setOpenDocId(resource.id);
        setOpenPdf(null);
      }
    });
  }, [resourceDeepLink]);

  const closePublicResource = useCallback(() => {
    setOpenPdf(null);
    setOpenDocId(null);
    if (resourceDeepLink && window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/");
  }, [navigate, resourceDeepLink]);

  const openResource = (r: DpsResource, department: "dps" | "dph", apiBase = "/api/resources") => {
    setResourcesOpen(false);
    setDphResourcesOpen(false);
    setResourceApiBase(apiBase);
    navigate(departmentResourcePath(department, "public", r.title, r.id));
    if (isPdfLikeResource(r)) {
      setOpenPdf(r);
      setOpenDocId(null);
    } else {
      setOpenDocId(r.id);
      setOpenPdf(null);
    }
  };

  // Home content is mostly static — don't block the whole page on Discord/ERLC stats.
  const pageLoading =
    (tab === "events" && eventsLoading)
    || (tab === "staff" && staffLoading)
    || (tab === "store" && storeProductsLoading);

  return (
    <div className={skin.page}>
      {INDEX_PREVIEW_SKIN && (
        <div className="relative z-50 border-b border-[#4384ff]/25 bg-gradient-to-r from-[#0a1a32] via-[#102040] to-[#0a1a32] px-4 py-2 text-center">
          <p className="text-[11px] font-bold tracking-wide text-[#9ec5ff]">
            <Sparkles className="mr-1.5 inline h-3.5 w-3.5 text-[#4384ff]" />
            Preview index skin — member portal colours &amp; assets (layout unchanged)
          </p>
        </div>
      )}

      {INDEX_PREVIEW_SKIN && (
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -left-32 top-0 h-96 w-96 rounded-full bg-[#4384ff]/8 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-[#f4c542]/5 blur-3xl" />
        </div>
      )}

      {!INDEX_PREVIEW_SKIN && <div className="h-px bg-[#1b2738]" />}

      {/* Header */}
      <header className={skin.header}>
        <div className="mx-auto flex h-full max-w-6xl items-center gap-3 px-4 sm:gap-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            {INDEX_PREVIEW_SKIN ? (
              <>
                <DojrpShield className="h-7 w-7 shrink-0" />
                <span className="truncate text-sm font-black tracking-tight text-white">DOJ:RP CAD</span>
              </>
            ) : (
              <>
                <img src={`${import.meta.env.BASE_URL}dojrp-shield.png`} alt="" className="h-7 w-7 shrink-0" />
                <DojrpLogo />
              </>
            )}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/* Live ERLC badge */}
            <div className={`flex h-9 items-center gap-1.5 rounded-full border px-2.5 sm:px-3 ${
              statsLoading ? ix("border-[#1b2738] bg-[#070d16]", "border-[#1a2d45] bg-[#0a1525]") : skin.liveBadge
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${statsLoading ? "bg-[#2a3a50]" : "animate-pulse bg-[#3ecf8e]"}`} />
              <span className="text-[9px] font-black uppercase tracking-[0.12em] text-[#4384ff] tabular-nums sm:tracking-[0.2em]">
                {statsLoading
                  ? "…"
                  : <>
                      {formatInGameCount(liveStats.erlc_players, liveStats.erlc_max_players)}
                      <span className="hidden sm:inline"> In-Game</span>
                    </>
                }
              </span>
            </div>
            <button
              type="button"
              onClick={handleSignIn}
              className={skin.signInBtn}
            >
              Sign in
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className={`relative overflow-hidden ${skin.heroBorder}`}>
        <div className={skin.heroGradient} />
        <div className="relative mx-auto max-w-6xl px-4 py-10 sm:px-8 sm:py-20">
          <div className="flex flex-col items-center text-center">
            {INDEX_PREVIEW_SKIN ? (
              <DojrpShield className="mb-6 h-20 w-20 opacity-95 drop-shadow-[0_0_30px_rgba(67,132,255,0.45)]" />
            ) : (
              <img
                src={`${import.meta.env.BASE_URL}dojrp-shield.png`}
                alt=""
                className="mb-6 h-20 w-20 opacity-90 drop-shadow-[0_0_30px_rgba(47,112,255,0.4)]"
              />
            )}
            <h1 className="text-[38px] font-black leading-[0.95] tracking-[-0.05em] sm:text-[58px]">
              <DojrpLogo />
            </h1>
            <p className={`mt-3 max-w-lg px-2 text-xs font-semibold sm:mt-4 sm:px-0 sm:text-sm ${skin.mutedText}`}>
              We are one of the largest ER:LC Roleplay Community's, giving you: "A roleplay experience beyond your imagination."
            </p>

            {/* Live stats strip */}
            <div className="mt-6 grid w-full max-w-2xl grid-cols-1 items-stretch gap-2 min-[420px]:grid-cols-3 sm:mt-8 sm:gap-3">
              <StatCard
                icon={Gamepad2}
                label="In-Game"
                value={statsLoading ? "…" : formatInGameCount(liveStats.erlc_players, liveStats.erlc_max_players)}
                sub="ERLC players"
                tone="from-[#102030] to-[#080e18]"
                iconColor="#4fc3f7"
                color="border-[#1a3040] text-[#4fc3f7]"
              />
              <StatCard
                icon={Users}
                label="Members"
                value={statsLoading ? "…" : liveStats.discord_members.toLocaleString()}
                sub="Discord server"
                tone="from-[#143024] to-[#081510]"
                iconColor="#34d399"
                color="border-[#1b3320] text-[#34d399]"
              />
              <StatCard
                icon={Wifi}
                label="Online"
                value={statsLoading ? "…" : liveStats.discord_online.toLocaleString()}
                sub="Discord online"
                tone="from-[#1a3050] to-[#0a1525]"
                iconColor="#4384ff"
                color="border-[#1b2a40] text-[#4384ff]"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Tab bar */}
      <div className={skin.tabBar}>
        <div className="mx-auto max-w-6xl">
          <div
            ref={tabScrollRef}
            className="tab-button-scroller overflow-x-auto overscroll-x-contain px-4 sm:px-8"
          >
            <div className="flex w-max min-w-full">
              {([
                { id: "home",          label: "Home",          shortLabel: "Home",    icon: Shield },
                { id: "departments",   label: "Departments",   shortLabel: "Depts",   icon: Building2 },
                { id: "staff",         label: "Staff Team",    shortLabel: "Staff",   icon: Users },
                { id: "events",        label: "Public Events", shortLabel: "Events",  icon: CalendarDays },
                { id: "announcements", label: "Announcements", shortLabel: "News",    icon: Megaphone },
                { id: "gallery",       label: "Gallery",       shortLabel: "Gallery", icon: ImageIcon },
                { id: "store",         label: "Server Store",  shortLabel: "Store",   icon: ShoppingBag },
                { id: "press",         label: "Press & News",  shortLabel: "Press",   icon: Newspaper },
              ] as { id: Tab; label: string; shortLabel: string; icon: React.ElementType }[]).map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                className={`flex min-h-11 shrink-0 items-center gap-1.5 px-3 py-3 text-[10px] font-black uppercase tracking-[0.12em] transition-colors sm:gap-2 sm:px-3.5 sm:py-3.5 sm:text-[11px] sm:tracking-[0.16em] ${
                  tab === t.id
                    ? "text-white shadow-[inset_0_-2px_0_0_#4384ff]"
                    : skin.tabInactive
                }`}
                >
                  <t.icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="md:hidden">{t.shortLabel}</span>
                  <span className="hidden md:inline">{t.label}</span>
                  {t.id === "announcements" && announcements.length > 0 && (
                    <span className={skin.countBadge}>{announcements.length}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="relative mx-auto max-w-6xl space-y-10 px-4 py-8 sm:space-y-14 sm:px-8 sm:py-12">
        {pageLoading ? (
          <PageLoadingScreen loading accent={INDEX_PREVIEW_SKIN ? skin.accent : undefined} />
        ) : (
        <>

        {/* -- Home tab: About + Gallery ---- */}
        {tab === "home" && (
          <>
            <section>
              <SectionHeading icon={Shield} title="About DOJRP" />
              <div className={`mb-6 px-4 py-6 sm:px-8 sm:py-8 ${skin.card}`}>
                <p className={`text-sm leading-relaxed ${skin.bodyText}`}>
                  DOJ:RP is one of the largest ER:LC servers out there. With multiple departments including DPS and DPH and divisions like Hazmat, SRU, HSU and many more. We aim to ensure that the server is fun for everyone who joins us here in DOJ. We always aim for everyone to have a great time with the amazing staff team, great roleplays and fun events.
                </p>
                <p className={`mt-4 text-sm leading-relaxed ${skin.bodyText}`}>
                  Whether you want to patrol as a cop, or save peoples lives in fires or accidents, or have fun roleplaying as a civilian getting up to all sorts of crime, there's always a place here for you at DOJ.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  { icon: Radio,    title: "Live Roster",              body: "This has a roster live updates for all departments  -  containing department personnel, vehicle restrictions, policies, and more." },
                  { icon: Shield,   title: "Realistic Operations",    body: "Structured rank system, callsign management, and professional standards that mirror real law enforcement procedure." },
                  { icon: Users,    title: "Active Community",        body: "A growing community of dedicated roleplayers committed to immersive, realistic law enforcement and civilian roleplay." },
                ].map(c => (
                  <div key={c.title} className={`px-5 py-6 transition-all hover:border-[#4384ff]/40 sm:px-6 sm:py-7 ${skin.card}`}>
                    <c.icon className="h-6 w-6 text-[#4384ff]" strokeWidth={2.25} />
                    <h3 className="mt-4 text-sm font-black text-white">{c.title}</h3>
                    <p className={`mt-2 text-xs leading-relaxed ${skin.mutedText}`}>{c.body}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Recent Announcements preview */}
            {announcements.length > 0 && (
              <section>
                <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 sm:mb-6">
                  <Megaphone className="h-4 w-4 shrink-0 text-[#4384ff]" />
                  <h2 className="min-w-0 text-sm font-black uppercase tracking-[0.14em] text-white sm:tracking-[0.22em]">Recent Announcements</h2>
                  <span className="rounded-full bg-[#0f1b28] px-2 py-0.5 text-[9px] font-black text-[#526179]">{announcements.length}</span>
                  <div className="order-last h-px min-w-[2rem] flex-1 bg-[#131f30] sm:order-none sm:ml-3" />
                  <button
                    type="button"
                    onClick={() => setTab("announcements")}
                    className="ml-auto flex min-h-9 items-center gap-1 text-[10px] font-black uppercase tracking-[0.15em] text-[#4384ff] transition-colors hover:text-white sm:ml-0"
                  >
                    View all <ChevronLeft className="h-3 w-3 rotate-180" />
                  </button>
                </div>
                <div className="space-y-3">
                  {announcements.slice(0, 3).map(a => (
                    <div key={a.id} className="rounded-xl border border-[#131f30] bg-[#070d16] px-4 py-4 sm:px-6 sm:py-5">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="min-w-0 break-words text-sm font-black text-white">{a.title}</h3>
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
              <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 sm:mb-6">
                <ImageIcon className="h-4 w-4 shrink-0 text-[#4384ff]" />
                <h2 className="min-w-0 text-sm font-black uppercase tracking-[0.14em] text-white sm:tracking-[0.22em]">Gallery</h2>
                <span className="rounded-full bg-[#0f1b28] px-2 py-0.5 text-[9px] font-black text-[#526179]">{gallery.length}</span>
                <div className="order-last h-px min-w-[2rem] flex-1 bg-[#131f30] sm:order-none sm:ml-3" />
                <button
                  type="button"
                  onClick={() => setTab("gallery")}
                  className="ml-auto flex min-h-9 items-center gap-1 text-[10px] font-black uppercase tracking-[0.15em] text-[#4384ff] transition-colors hover:text-white sm:ml-0"
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
                  ref={setGalleryScrollerNode}
                  className="home-gallery-scroller -mx-1 overflow-x-auto overscroll-x-contain px-1 pb-2"
                >
                  <div className="flex w-max gap-3 pr-1">
                    {gallery.map(img => (
                      <button
                        key={img.id}
                        type="button"
                        onClick={() => {
                          pauseGalleryAutoScroll();
                          setLightbox(img);
                        }}
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
            <SectionHeading icon={ImageIcon} title="Gallery" count={gallery.length} />
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

          const byRankThenName = (list: StaffMember[]) =>
            sortByRankThenUsername(list, staffRanks, m => m.staff_rank);

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
            const members = byRankThenName(filtered.filter(m => memberBelongsToGroup(m, g)));
            members.forEach(m => assignedIds.add(m.id));
            return { key: `g${g.id}`, label: g.name, members };
          });

          const orphans = byRankThenName(filtered.filter(m => !assignedIds.has(m.id)));
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
                  {/* Mobile / tablet card list */}
                  <div className="divide-y divide-[#0f1b28] md:hidden">
                    {visibleGroups.map(group => (
                      <div key={group.key}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 bg-[#0a1525] px-4 py-3 text-left transition-colors hover:bg-[#0c1830]"
                          onClick={() => toggleStaffGroup(group.key)}
                        >
                          {staffCollapsed[group.key]
                            ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#4384ff]" />
                            : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#4384ff]" />}
                          <span className="min-w-0 flex-1 truncate text-xs font-black text-white">{group.label}</span>
                          <span className="rounded-full bg-[#172235] px-2 py-0.5 text-[9px] font-black text-[#526179]">
                            {group.members.length}
                          </span>
                        </button>
                        {!staffCollapsed[group.key] && (
                          group.members.length === 0 ? (
                            <p className="px-4 py-3 text-[11px] text-[#3f5470]">No members in this title.</p>
                          ) : (
                            <ul className="space-y-0">
                              {group.members.map(m => {
                                const rankMeta = getRankMeta(m.staff_rank);
                                const active = (m.status ?? "").toLowerCase() === "active";
                                return (
                                  <li key={m.id} className="border-t border-[#0f1b28] px-4 py-3.5">
                                    <div className="flex items-start gap-3">
                                      <StaffAvatar
                                        name={m.discord_username || m.username}
                                        discordId={m.discord_id}
                                        avatarHash={m.avatar_hash}
                                      />
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-xs font-black text-white">{m.username || "—"}</p>
                                        {m.discord_username && (
                                          <p className="truncate text-[10px] text-[#526179]">@{m.discord_username}</p>
                                        )}
                                        <div className="mt-2 flex flex-wrap items-center gap-2">
                                          <span
                                            className="text-[10px] font-black"
                                            style={{ color: rankMeta?.color_hex ?? "#a8b7cd" }}
                                          >
                                            {m.staff_rank || "—"}
                                          </span>
                                          <span className={`inline-flex items-center rounded px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] ${
                                            active ? "bg-emerald-500 text-white" : "bg-[#1a2638] text-[#526179]"
                                          }`}>
                                            {m.status || "Active"}
                                          </span>
                                          <DiscordStatusBadge
                                            status={m.discord_id ? (staffDiscordPresence[m.discord_id] ?? "offline") : "offline"}
                                          />
                                        </div>
                                        <p className="mt-1.5 text-[10px] text-[#3f5470]">
                                          Appointed {m.staff_appointed_date ? formatDate(m.staff_appointed_date) : "—"}
                                        </p>
                                        {m.discord_id && (
                                          <p className="mt-0.5 break-all font-mono text-[10px] text-[#526179]">{m.discord_id}</p>
                                        )}
                                      </div>
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          )
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Desktop table */}
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#131f30]">
                          <th className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Name</th>
                          <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Rank</th>
                          <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Status</th>
                          <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Discord Status</th>
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
                              <td colSpan={6} className="px-5 py-2.5">
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
                                  <td colSpan={6} className="px-5 py-3 text-[11px] text-[#3f5470]">
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
                                      <td className="px-4 py-3.5">
                                        <DiscordStatusBadge
                                          status={m.discord_id ? (staffDiscordPresence[m.discord_id] ?? "offline") : "offline"}
                                        />
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

            <div className="mb-4 flex flex-wrap gap-2">
              {PRIMARY_EVENT_FILTERS.map(item => {
                const active = item.id === "departments"
                  ? isDepartmentEventScope(eventFilter)
                  : eventFilter === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setEventFilterAndUrl(item.id === "departments" ? "departments" : item.id)}
                    className={`rounded-full border px-3.5 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] transition-colors ${
                      active
                        ? "border-[#4384ff]/50 bg-[#4384ff]/15 text-[#4384ff]"
                        : "border-[#1f3050] bg-[#07111f] text-[#8392aa] hover:border-[#4384ff]/30 hover:text-white"
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            {isDepartmentEventScope(eventFilter) && (
              <div className="mb-5 flex flex-wrap gap-2">
                {DEPARTMENT_EVENT_FILTERS.map(item => {
                  const active = eventFilter === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setEventFilterAndUrl(item.id)}
                      className={`rounded-full border px-3 py-1 text-[9px] font-black uppercase tracking-[0.12em] transition-colors ${
                        active
                          ? item.id === "dph"
                            ? ix("border-[#f87171]/50 bg-[#f87171]/15 text-[#f87171]", "border-[#34d399]/50 bg-[#34d399]/15 text-[#34d399]")
                            : "border-[#4384ff]/50 bg-[#4384ff]/15 text-[#4384ff]"
                          : "border-[#1f3050] bg-[#07111f] text-[#526179] hover:border-[#4384ff]/30 hover:text-[#8392aa]"
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            )}

            {filteredEvents.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-[#0f1b28] py-16 text-center">
                <CalendarDays className="h-8 w-8 text-[#1e2e42]" />
                <p className="text-sm font-bold text-[#2a3a50]">{eventFilterEmptyLabel(eventFilter)}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredEvents.map(ev => {
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
                  const badge = eventSourceBadge(ev);
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
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-black text-white">{ev.title}</p>
                          {badge && (
                            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] ${badge.className}`}>
                              {badge.label}
                            </span>
                          )}
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
            <DepartmentIndexPanel
              department="dps"
              title="Department of Public Safety"
              sealUrl={DPS_SEAL_URL}
              info={indexInfo}
              liveDivisions={dpsDivisions}
              fallbackDescription="The Liberty State Department of Public Safety (DPS) is responsible for law enforcement, emergency response, and public security within the county. It oversees Patrol Operations, Special Operations, and Administrative Operations to ensure public safety and uphold the law."
              fallbackDivisions={indexInfo?.divisions ?? []}
              fallbackSubDepartments={[
                { name: "River City Police Department (RCPD)", description: "" },
                { name: "Liberty County Sheriff Office (LCSO)", description: "" },
              ]}
              fallbackHeroUrl={DPS_INDEX_BANNER_URL}
              accent="#4384ff"
              accentMuted="#7eb8ff"
              primaryBtnClass="bg-[#2f66ee] shadow-[0_6px_20px_rgba(47,102,238,0.28)] hover:bg-[#3977ff]"
              outlineBtnClass="border-[#2f66ee]/40 bg-[#2f66ee]/10 text-[#4384ff] hover:bg-[#2f66ee]/20"
              divisionDotClass="bg-[#4384ff]"
              onOpenPage={() => {
                if (getCadSession()) navigate("/dps_information");
                else {
                  sessionStorage.setItem("post_login_redirect", "/dps_information");
                  setIsLoginOpen(true);
                }
              }}
              onResources={() => setResourcesOpen(true)}
              onRoster={() => setRosterOpen(true)}
              onEvents={() => openPublicEvents("dps")}
            />

            <DepartmentIndexPanel
              department="dph"
              title="Department of Public Health"
              sealUrl={DPH_SEAL_URL}
              info={dphIndexInfo}
              liveDivisions={dphDivisions}
              fallbackDescription="The Liberty State Department of Public Health (DPH) is the state's primary agency responsible for protecting and promoting the health, safety, and well-being of the community throughout the county. The Department works to prevent disease, support public health initiatives, coordinate health emergency preparedness, and ensure access to essential health services while maintaining public trust and community engagement."
              fallbackDivisions={dphIndexInfo?.divisions?.length ? dphIndexInfo.divisions : ["Recruitment and Training", "Urban Search and Rescue", "Wildland Subdivision", "Water Rescue"]}
              fallbackSubDepartments={[
                { name: "Liberty County Fire Rescue (LCFR)", description: "" },
                { name: "Liberty County Medical Services (LCMS)", description: "" },
              ]}
              fallbackHeroUrl={DPH_INDEX_BANNER_URL}
              accent={ix("#f87171", "#34d399")}
              accentMuted={ix("#fca5a5", "#6ee7b7")}
              primaryBtnClass={skin.dphBtn}
              outlineBtnClass={skin.dphBtnOutline}
              divisionDotClass={ix("bg-[#ef4444]", "bg-[#34d399]")}
              onOpenPage={() => {
                if (getCadSession()) navigate("/dph_information");
                else {
                  sessionStorage.setItem("post_login_redirect", "/dph_information");
                  setIsLoginOpen(true);
                }
              }}
              onResources={() => setDphResourcesOpen(true)}
              onRoster={() => setDphRosterOpen(true)}
              onEvents={() => openPublicEvents("dph")}
            />
          </div>
        )}

        </>
        )}
      </main>

      {/* Footer */}
      <footer className={skin.footer}>
        <p className={`text-[9px] font-black uppercase tracking-[0.16em] sm:tracking-[0.3em] ${skin.mutedText}`}>
          For roleplay use only  ·  Not affiliated with any real agency
        </p>
      </footer>

      <LoginModal isOpen={isLoginOpen} onClose={() => setIsLoginOpen(false)} />

      <Suspense fallback={null}>
        <DpsPublicRosterModal open={rosterOpen} onClose={() => setRosterOpen(false)} />
        <DpsPublicRosterModal
          open={dphRosterOpen}
          onClose={() => setDphRosterOpen(false)}
          apiBase="/api/dph"
          title="DPH Roster"
          accent="red"
        />
      </Suspense>

      {/* DPS Resources popup */}
      {resourcesOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 px-3 py-4 sm:items-center sm:px-4 sm:py-8">
          <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#1b2738] bg-[#0d1422] shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-[#131f30] px-4 py-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#2f66ee]/25 bg-[#2f66ee]/10">
                  <BookOpen className="h-4 w-4 text-[#4384ff]" />
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-black text-white">DPS Resources</h3>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#526179]">
                    Public department guides &amp; reference materials
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setResourcesOpen(false)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#4a5568] transition-colors hover:bg-white/5 hover:text-white"
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
                      onClick={() => openResource(r, "dps", "/api/resources")}
                      className="flex flex-col gap-2 rounded-xl border border-[#1e2d42] bg-[#070d16] p-4 text-left transition-all hover:border-[#2f66ee]/40 hover:bg-[#0a1525]"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#2f66ee]/20 bg-[#2f66ee]/8">
                        <FileText className="h-4 w-4 text-[#4384ff]" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-white">{r.title}</p>
                        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-[#526179]">
                          {resourceTypeLabel(r)}
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
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 px-3 py-4 sm:items-center sm:px-4 sm:py-8">
          <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#1b2738] bg-[#0d1422] shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-[#131f30] px-4 py-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#ef4444]/25 bg-[#ef4444]/10">
                  <BookOpen className="h-4 w-4 text-[#f87171]" />
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-black text-white">DPH Resources</h3>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#526179]">
                    Public department guides &amp; reference materials
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDphResourcesOpen(false)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#4a5568] transition-colors hover:bg-white/5 hover:text-white"
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
                      onClick={() => openResource(r, "dph", "/api/dph/resources")}
                      className="flex flex-col gap-2 rounded-xl border border-[#1e2d42] bg-[#070d16] p-4 text-left transition-all hover:border-[#ef4444]/40 hover:bg-[#140a0a]"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#ef4444]/20 bg-[#ef4444]/8">
                        <FileText className="h-4 w-4 text-[#f87171]" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-white">{r.title}</p>
                        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-[#526179]">
                          {resourceTypeLabel(r)}
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
        <Suspense fallback={<SimpleLoading label="Opening document…" minHeightClass="min-h-screen" />}>
          <DocumentEditor
            key={`${resourceApiBase}-${openDocId}`}
            resourceId={openDocId}
            canEdit={false}
            apiBase={resourceApiBase}
            onClose={closePublicResource}
          />
        </Suspense>
      )}

      {openPdf !== null && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-[#02060b]">
          <div className="flex shrink-0 items-center justify-between border-b border-[#131f30] px-4 py-3">
            <p className="truncate text-sm font-black text-white">{openPdf.title}</p>
            <button
              type="button"
              onClick={closePublicResource}
              className="rounded-full p-1.5 text-[#4a5568] hover:bg-white/5 hover:text-white"
              aria-label="Close PDF"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <Suspense fallback={<SimpleLoading label="Loading PDF…" minHeightClass="min-h-[50vh]" />}>
            <PdfViewer
              fileUrl={resourceFileUrl(
                resourceApiBase.includes("/dph/") ? "dph" : resourceApiBase.includes("/staff/") ? "staff" : "dps",
                openPdf.id,
                openPdf,
              )}
              downloadName={`${openPdf.title}.pdf`}
              liveRefreshMs={googleFileIdFromResource(openPdf) || openPdf.type === "google_doc" ? 45_000 : undefined}
            />
          </Suspense>
        </div>
      )}

      {/* Lightbox — close via backdrop / Escape; no overlay on the photo */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/85 px-3 py-6 sm:px-4"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            aria-label="Close"
            className="fixed right-3 top-3 z-[51] flex h-10 w-10 items-center justify-center rounded-full border border-[#2a3a50] bg-[#070d16]/90 text-[#a8b7cd] hover:text-white sm:right-5 sm:top-5"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="relative my-auto max-h-[90vh] w-full max-w-4xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <img
              src={lightbox.image_url}
              alt={lightbox.title || "Gallery image"}
              className="max-h-[min(80vh,720px)] w-full rounded-xl object-contain shadow-2xl"
            />
            {(lightbox.title || lightbox.caption) && (
              <div className="mt-3 px-1 pb-2 text-center">
                {lightbox.title && <p className="break-words text-sm font-black text-white">{lightbox.title}</p>}
                {lightbox.caption && <p className="mt-1 break-words text-xs text-[#526179]">{lightbox.caption}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PublicView;
