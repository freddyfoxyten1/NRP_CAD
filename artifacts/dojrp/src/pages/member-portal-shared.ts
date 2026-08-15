import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { IncomingCall } from '@/components/overlays/IncomingCallOverlay';
import { clearCadSession, getCadSession, setCadSession, type CadSession } from '@/lib/cad-session';
import { formatInGameCount } from '@/lib/in-game-count';
import { isSuperAdminSession } from '@/lib/superadmin';
import { getMemberDisplayRank, getMemberDisplayRole } from '@/lib/display-rank';
import { useCadStatus } from '@/hooks/useCadStatus';
import { usePhoneSSE, type PhoneSSEEvent } from '@/hooks/usePhoneSSE';
import { usePortalSection } from '@/hooks/usePortalSection';
import type { ContentBlock } from '@/components/shared/ContentBlocks';

export const PORTAL_SECTIONS = ['dashboard', 'information-support'] as const;
export type PortalSection = (typeof PORTAL_SECTIONS)[number];

const PORTAL_SECTION_TO_NAV: Record<PortalSection, string> = {
  dashboard: 'Dashboard',
  'information-support': 'Information & Support',
};

const PORTAL_NAV_TO_SECTION: Record<string, PortalSection> = {
  Dashboard: 'dashboard',
  'Information & Support': 'information-support',
};

export type Announcement = {
  id: number;
  title: string;
  message: string;
  posted_by: string;
  created_at: string;
};

export type PortalData = {
  profile: {
    username: string;
    rank: string;
    role: string;
    dps_rank: string | null;
    dps_role: string | null;
    staff_rank: string | null;
    staff_role: string | null;
    status: string;
    email: string;
    can_access_iab?: boolean;
  };
  stats: {
    totalMembers: number;
    totalPlayTime: string;
    totalOnlineMembers: number;
    inGameCount: string;
  };
};

export type StaffGroup = {
  id: number;
  name: string;
  staff_access: boolean;
  admin_access: boolean;
  doc_access: boolean;
};

export const MEMBER_PORTAL_NAV_ITEMS = [
  'Dashboard',
  'Information & Support',
  'Department of Public Safety',
  'Department of Public Health',
  'Department of Communications',
  'Department of Transportation',
] as const;

export const ADMIN_CODE_STORAGE_KEY = 'west-coast-admin-code';

const toPortalData = (session: CadSession, stats: PortalData['stats']): PortalData => ({
  profile: {
    username: session.username,
    rank: session.rank,
    role: session.role,
    dps_rank: session.dps_rank ?? null,
    dps_role: session.dps_role ?? null,
    staff_rank: session.staff_rank ?? null,
    staff_role: session.staff_role ?? null,
    status: session.status,
    email: session.email,
    can_access_iab: Boolean(session.can_access_iab),
  },
  stats,
});

const defaultStats: PortalData['stats'] = {
  totalMembers: 0,
  totalPlayTime: 'Coming Soon!',
  totalOnlineMembers: 0,
  inGameCount: '—',
};

const fetchStats = async (): Promise<PortalData['stats']> => {
  try {
    const response = await fetch('/api/stats', { headers: { accept: 'application/json' } });
    if (!response.ok) return defaultStats;
    const data = (await response.json()) as {
      totalMembers: number;
      totalOnlineMembers: number;
      inGameCount: number;
      inGameMaxPlayers: number;
    };
    const max = data.inGameMaxPlayers ?? 0;
    return {
      totalMembers: data.totalMembers,
      totalPlayTime: 'Coming Soon!',
      totalOnlineMembers: data.totalOnlineMembers,
      inGameCount: formatInGameCount(data.inGameCount, max),
    };
  } catch {
    return defaultStats;
  }
};

export function useMemberPortal() {
  const navigate = useNavigate();
  const [portalData, setPortalData] = useState<PortalData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const [showPhone, setShowPhone] = useState(false);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [phoneCallEvent, setPhoneCallEvent] = useState<PhoneSSEEvent | null>(null);
  const [answeredCall, setAnsweredCall] = useState<{ phone: string; name: string; callId: string } | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [staffGroups, setStaffGroups] = useState<StaffGroup[]>([]);
  const [canAccessDphIab, setCanAccessDphIab] = useState(false);
  const [portalSection, setPortalSection] = usePortalSection<PortalSection>({
    base: 'portal',
    valid: PORTAL_SECTIONS,
    defaultSection: 'dashboard',
  });
  const activeNav = PORTAL_SECTION_TO_NAV[portalSection];
  const setActiveNav = (nav: string) => {
    const next = PORTAL_NAV_TO_SECTION[nav];
    if (next) setPortalSection(next);
  };
  const [infoSections, setInfoSections] = useState<ContentBlock[]>([]);
  const [infoLoading, setInfoLoading] = useState(false);

  const fetchAnnouncements = async () => {
    try {
      const res = await fetch('/api/announcements', { headers: { accept: 'application/json' } });
      if (res.ok) setAnnouncements((await res.json()) as Announcement[]);
    } catch {
      // silently ignore
    }
  };

  useEffect(() => {
    let isMounted = true;

    const validateSession = async (showLoading: boolean) => {
      const session = getCadSession();

      if (!session) {
        navigate('/', { replace: true });
        return;
      }

      if (showLoading) {
        setIsLoading(true);
      }

      try {
        const [response, grpRes] = await Promise.all([
          fetch('/api/cad-auth/session-status', {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ id: session.id, email: session.email }),
          }),
          fetch('/api/staff/groups', { headers: { accept: 'application/json' } }),
        ]);
        const stats = await fetchStats();
        const contentType = response.headers.get('content-type') ?? '';

        if (!response.ok || !contentType.includes('application/json')) {
          throw new Error('Unable to verify member session.');
        }

        const result = (await response.json()) as {
          active: boolean;
          account?: CadSession;
        };

        if (!result.active || !result.account) {
          clearCadSession();
          sessionStorage.removeItem(ADMIN_CODE_STORAGE_KEY);
          toast.error('Your CAD account was deleted. You have been signed out.');
          navigate('/', { replace: true });
          return;
        }

        setCadSession(result.account);

        let dphIab = false;
        try {
          const meRes = await fetch(
            `/api/dph/me?username=${encodeURIComponent(result.account.username)}`,
            { headers: { accept: 'application/json' } },
          );
          if (meRes.ok) {
            const me = await meRes.json() as { can_access_iab?: boolean } | null;
            dphIab = Boolean(me?.can_access_iab);
          }
        } catch { /* non-fatal */ }

        if (isMounted) {
          setPortalData(toPortalData(result.account, stats));
          setCanAccessDphIab(dphIab);
          if (grpRes.ok) {
            try { setStaffGroups((await grpRes.json()) as StaffGroup[]); } catch { /* keep existing */ }
          }
          setError(null);
          setIsLoading(false);
        }
      } catch {
        if (isMounted) {
          setPortalData(toPortalData(session, defaultStats));
          setError(null);
          setIsLoading(false);
        }
      }
    };

    validateSession(true);
    fetchAnnouncements();
    const interval = window.setInterval(() => {
      validateSession(false);
      fetchAnnouncements();
    }, 10000);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [navigate]);

  useEffect(() => {
    if (!profileOpen) return;
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [profileOpen]);

  useEffect(() => {
    if (portalSection !== 'information-support') return;
    let cancelled = false;
    setInfoLoading(true);
    fetch('/api/portal/content/information_support', { headers: { accept: 'application/json' } })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { sections?: ContentBlock[] } | null) => {
        if (cancelled) return;
        setInfoSections(Array.isArray(d?.sections) ? d!.sections : []);
      })
      .catch(() => {
        if (!cancelled) setInfoSections([]);
      })
      .finally(() => {
        if (!cancelled) setInfoLoading(false);
      });
    return () => { cancelled = true; };
  }, [portalSection]);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    clearCadSession();
    sessionStorage.removeItem(ADMIN_CODE_STORAGE_KEY);
    toast.success('Signed out of the member portal.');
    navigate('/', { replace: true });
  };

  const handleAdminPortal = () => {
    navigate('/admin_members');
  };

  const { online: cadOnline, mode: cadMode } = useCadStatus();
  const username = portalData?.profile.username ?? 'Member';
  const rank = getMemberDisplayRank(portalData?.profile);
  const role = getMemberDisplayRole(portalData?.profile);
  const userGroup = staffGroups.find(
    g => g.name.toLowerCase() === ((portalData?.profile.staff_role || portalData?.profile.role) ?? '').toLowerCase().trim()
  );
  const superAdmin = isSuperAdminSession(getCadSession());
  const canAccessStaff = superAdmin || (userGroup?.staff_access ?? false);
  const canAccessIab = superAdmin || Boolean(portalData?.profile.can_access_iab);
  const canAccessDphInternalAffairs = superAdmin || canAccessDphIab;
  const canAccessAdminPortal = superAdmin || (userGroup?.admin_access ?? false);
  const canAccessDoc = superAdmin || (userGroup?.doc_access ?? false);

  usePhoneSSE(portalData ? username : null, (ev) => {
    if (ev.type === 'incoming_call') {
      setIncomingCall({ callId: ev.callId, callerUsername: ev.callerUsername, calleeName: ev.calleeName, phone: ev.phone });
    } else {
      setPhoneCallEvent(ev);
    }
  });

  const handleAnswer = async (callId: string) => {
    const call = incomingCall;
    setIncomingCall(null);
    await fetch('/api/phone/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callId }),
    });
    if (call) {
      setAnsweredCall({ phone: call.phone, name: call.calleeName, callId });
      setShowPhone(true);
    }
  };

  const handleDecline = async (callId: string) => {
    setIncomingCall(null);
    await fetch('/api/phone/end', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callId, username }),
    });
  };

  return {
    navigate,
    portalData,
    isLoading,
    error,
    isSigningOut,
    profileOpen,
    setProfileOpen,
    profileRef,
    showPhone,
    setShowPhone,
    incomingCall,
    phoneCallEvent,
    answeredCall,
    setAnsweredCall,
    announcements,
    activeNav,
    setActiveNav,
    infoSections,
    infoLoading,
    handleSignOut,
    handleAdminPortal,
    cadOnline,
    cadMode,
    username,
    rank,
    role,
    canAccessStaff,
    canAccessIab,
    canAccessDphInternalAffairs,
    canAccessAdminPortal,
    canAccessDoc,
    handleAnswer,
    handleDecline,
  };
}
