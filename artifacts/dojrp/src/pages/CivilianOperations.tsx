import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Car, ChevronDown, ChevronUp, FileText, LayoutDashboard, Lock, Phone, Plus, Scale, Shield, Trash2, User, Users, Crosshair, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import DojrpLogo from '@/components/shared/DojrpLogo';
import DojrpShield from '@/components/shared/DojrpShield';
import PhonePanel from '@/components/overlays/PhonePanel';
import IncomingCallOverlay, { type IncomingCall } from '@/components/overlays/IncomingCallOverlay';
import { clearCadSession, getCadSession, type CadSession } from '@/lib/cad-session';
import { useCadStatus, cadModeLabel } from '@/hooks/useCadStatus';
import { usePhoneSSE, type PhoneSSEEvent } from '@/hooks/usePhoneSSE';

// ── Types ─────────────────────────────────────────────────────────────────────
type CivTab = 'characters' | 'vehicles' | 'weapons';

type Character = {
  id: number;
  first_name: string;
  last_name: string;
  dob: string | null;
  gender: string | null;
  ethnicity: string | null;
  hair_colour: string | null;
  occupation: string | null;
  address: string | null;
  phone: string | null;
  notes: string | null;
  wanted: boolean;
  valid_licence: boolean;
};

type Vehicle = {
  id: number;
  civilian_id: number | null;
  civilian_name: string | null;
  plate: string;
  make: string;
  model: string | null;
  year: string | null;
  color: string | null;
  vin: string | null;
  registered: boolean;
  insured: boolean;
  stolen: boolean;
};

type Weapon = {
  id: number;
  civilian_id: number | null;
  civilian_name: string | null;
  weapon_type: string;
  serial_number: string | null;
  registered: boolean;
};

type Citation = {
  id: number;
  subject: string;
  officer: string;
  date_time: string | null;
  location: string | null;
  violation: string | null;
  fine_amount: string | null;
  notes: string | null;
};

type Arrest = {
  id: number;
  officer: string;
  charges: string | null;
  notes: string | null;
  created_at: string;
};

const calcAge = (dob: string): string => {
  // Accepts MM/DD/YYYY
  const parts = dob.split('/');
  if (parts.length !== 3) return '';
  const [mm, dd, yyyy] = parts;
  const birth = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  if (isNaN(birth.getTime())) return '';
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age >= 0 ? String(age) : '';
};

const emptyChar = { first_name: '', last_name: '', dob: '', gender: '', ethnicity: '', hair_colour: '', occupation: '', address: '', notes: '', wanted: false, valid_licence: true };
const generateVin = () => `LSV${Math.floor(10000000 + Math.random() * 90000000)}`;
const emptyVeh = { civilian_id: '', plate: '', make: '', model: '', year: '', color: '', vin: '', registered: true, insured: false, stolen: false };
const emptyWep = { civilian_id: '', weapon_type: '', serial_number: '', registered: true };

// ── Component ─────────────────────────────────────────────────────────────────
const CivilianOperations = () => {
  const navigate = useNavigate();
  const { online: cadOnline, mode: cadMode } = useCadStatus();
  const [session, setSession] = useState<CadSession | null>(null);
  const [activeTab, setActiveTab] = useState<CivTab>('characters');
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [showPhone, setShowPhone] = useState(false);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [phoneCallEvent, setPhoneCallEvent] = useState<import('@/hooks/usePhoneSSE').PhoneSSEEvent | null>(null);
  const [answeredCall, setAnsweredCall] = useState<{ phone: string; name: string; callId: string } | null>(null);

  // Characters
  const [characters, setCharacters] = useState<Character[]>([]);
  const [charLoading, setCharLoading] = useState(true);
  const [showCharForm, setShowCharForm] = useState(false);
  const [charForm, setCharForm] = useState({ ...emptyChar });
  const [editCharId, setEditCharId] = useState<number | null>(null);
  const [savingChar, setSavingChar] = useState(false);
  const [deletingCharId, setDeletingCharId] = useState<number | null>(null);
  const [confirmDeleteCharId, setConfirmDeleteCharId] = useState<number | null>(null);
  const [expandedCharId, setExpandedCharId] = useState<number | null>(null);

  // Character record history (citations + arrests)
  const [charCitations, setCharCitations] = useState<Record<number, Citation[]>>({});
  const [charArrests, setCharArrests] = useState<Record<number, Arrest[]>>({});
  const [charRecordsLoading, setCharRecordsLoading] = useState<Record<number, boolean>>({});
  const [citationsOpen, setCitationsOpen] = useState<Set<number>>(new Set());
  const [arrestsOpen, setArrestsOpen] = useState<Set<number>>(new Set());

  // Vehicles
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehLoading, setVehLoading] = useState(true);
  const [showVehForm, setShowVehForm] = useState(false);
  const [vehForm, setVehForm] = useState({ ...emptyVeh });
  const [editVehId, setEditVehId] = useState<number | null>(null);
  const [savingVeh, setSavingVeh] = useState(false);
  const [deletingVehId, setDeletingVehId] = useState<number | null>(null);
  const [confirmDeleteVehId, setConfirmDeleteVehId] = useState<number | null>(null);

  // Weapons
  const [weapons, setWeapons] = useState<Weapon[]>([]);
  const [wepLoading, setWepLoading] = useState(true);
  const [showWepForm, setShowWepForm] = useState(false);
  const [wepForm, setWepForm] = useState({ ...emptyWep });
  const [editWepId, setEditWepId] = useState<number | null>(null);
  const [savingWep, setSavingWep] = useState(false);
  const [deletingWepId, setDeletingWepId] = useState<number | null>(null);
  const [confirmDeleteWepId, setConfirmDeleteWepId] = useState<number | null>(null);

  // ── Auth guard ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const s = getCadSession();
    if (!s) { navigate('/', { replace: true }); return; }
    setSession(s);
    loadAll(s.username);
  }, [navigate]);

  // ── Phone SSE ──────────────────────────────────────────────────────────────
  usePhoneSSE(session?.username ?? null, (ev) => {
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
      body: JSON.stringify({ callId, username: session?.username }),
    });
  };

  const loadAll = (username: string) => {
    loadCharacters(username);
    loadVehicles(username);
    loadWeapons(username);
  };

  // ── Data fetchers ────────────────────────────────────────────────────────────
  const loadCharacters = async (username: string) => {
    setCharLoading(true);
    try {
      const res = await fetch(`/api/civilian/characters?username=${encodeURIComponent(username)}`);
      setCharacters(res.ok ? ((await res.json()) as Character[]) : []);
    } catch { setCharacters([]); } finally { setCharLoading(false); }
  };

  const loadVehicles = async (username: string) => {
    setVehLoading(true);
    try {
      const res = await fetch(`/api/civilian/vehicles?username=${encodeURIComponent(username)}`);
      setVehicles(res.ok ? ((await res.json()) as Vehicle[]) : []);
    } catch { setVehicles([]); } finally { setVehLoading(false); }
  };

  const loadWeapons = async (username: string) => {
    setWepLoading(true);
    try {
      const res = await fetch(`/api/civilian/weapons?username=${encodeURIComponent(username)}`);
      setWeapons(res.ok ? ((await res.json()) as Weapon[]) : []);
    } catch { setWeapons([]); } finally { setWepLoading(false); }
  };

  // ── Character record history ─────────────────────────────────────────────────
  const loadCharRecords = async (charId: number) => {
    if (charCitations[charId] !== undefined) return; // already loaded
    setCharRecordsLoading(prev => ({ ...prev, [charId]: true }));
    try {
      const [citRes, arrRes] = await Promise.all([
        fetch(`/api/civilian/${charId}/citations`),
        fetch(`/api/civilian/${charId}/arrests`),
      ]);
      const [citations, arrests] = await Promise.all([
        citRes.ok ? citRes.json() : Promise.resolve([]),
        arrRes.ok ? arrRes.json() : Promise.resolve([]),
      ]);
      setCharCitations(prev => ({ ...prev, [charId]: citations }));
      setCharArrests(prev => ({ ...prev, [charId]: arrests }));
    } catch {
      setCharCitations(prev => ({ ...prev, [charId]: [] }));
      setCharArrests(prev => ({ ...prev, [charId]: [] }));
    } finally {
      setCharRecordsLoading(prev => ({ ...prev, [charId]: false }));
    }
  };

  const toggleCharExpand = (charId: number) => {
    const opening = expandedCharId !== charId;
    setExpandedCharId(opening ? charId : null);
    if (opening) loadCharRecords(charId);
  };

  const toggleSection = (
    set: Set<number>,
    setter: React.Dispatch<React.SetStateAction<Set<number>>>,
    charId: number,
  ) => {
    setter(prev => {
      const next = new Set(prev);
      next.has(charId) ? next.delete(charId) : next.add(charId);
      return next;
    });
  };

  // ── Character CRUD ───────────────────────────────────────────────────────────
  const openEditChar = (c: Character) => {
    setEditCharId(c.id);
    setCharForm({ first_name: c.first_name, last_name: c.last_name, dob: c.dob ?? '', gender: c.gender ?? '', ethnicity: c.ethnicity ?? '', hair_colour: c.hair_colour ?? '', occupation: c.occupation ?? '', address: c.address ?? '', notes: c.notes ?? '', wanted: c.wanted ?? false, valid_licence: c.valid_licence ?? true });
    setShowCharForm(true);
  };

  const handleSaveChar = async () => {
    if (!charForm.first_name || !charForm.last_name) { toast.error('First and last name are required.'); return; }
    setSavingChar(true);
    try {
      const url = editCharId ? `/api/civilian/characters/${editCharId}` : '/api/civilian/characters';
      const method = editCharId ? 'PATCH' : 'POST';
      const body = editCharId ? charForm : { ...charForm, owner_username: session!.username };
      const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error();
      const saved = (await res.json()) as Character;
      setCharacters(prev => editCharId ? prev.map(c => c.id === editCharId ? saved : c) : [saved, ...prev]);
      toast.success(editCharId ? 'Character updated.' : 'Character created.');
      setShowCharForm(false); setEditCharId(null); setCharForm({ ...emptyChar });
    } catch { toast.error('Failed to save character.'); } finally { setSavingChar(false); }
  };

  const handleDeleteChar = async (id: number) => {
    setDeletingCharId(id);
    try {
      await fetch(`/api/civilian/characters/${id}`, { method: 'DELETE' });
      setCharacters(prev => prev.filter(c => c.id !== id));
      setVehicles(prev => prev.filter(v => v.civilian_id !== id));
      setWeapons(prev => prev.filter(w => w.civilian_id !== id));
      toast.success('Character deleted.');
    } catch { toast.error('Failed to delete character.'); } finally { setDeletingCharId(null); setConfirmDeleteCharId(null); }
  };

  // ── Vehicle CRUD ─────────────────────────────────────────────────────────────
  const openEditVeh = (v: Vehicle) => {
    setEditVehId(v.id);
    setVehForm({ civilian_id: v.civilian_id ? String(v.civilian_id) : '', plate: v.plate, make: v.make, model: v.model ?? '', year: v.year ?? '', color: v.color ?? '', vin: v.vin ?? '', registered: v.registered, insured: v.insured, stolen: v.stolen });
    setShowVehForm(true);
  };

  const handleSaveVeh = async () => {
    if (!vehForm.plate || !vehForm.make) { toast.error('Plate and make are required.'); return; }
    setSavingVeh(true);
    try {
      const url = editVehId ? `/api/civilian/vehicles/${editVehId}` : '/api/civilian/vehicles';
      const method = editVehId ? 'PATCH' : 'POST';
      const vin = vehForm.vin || generateVin();
      const body = editVehId ? { ...vehForm, vin } : { ...vehForm, vin, owner_username: session!.username };
      const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error();
      const saved = (await res.json()) as Vehicle;
      const withName = { ...saved, civilian_name: characters.find(c => c.id === saved.civilian_id) ? `${characters.find(c => c.id === saved.civilian_id)!.first_name} ${characters.find(c => c.id === saved.civilian_id)!.last_name}` : null };
      setVehicles(prev => editVehId ? prev.map(v => v.id === editVehId ? withName : v) : [withName, ...prev]);
      toast.success(editVehId ? 'Vehicle updated.' : 'Vehicle registered.');
      setShowVehForm(false); setEditVehId(null); setVehForm({ ...emptyVeh });
    } catch { toast.error('Failed to save vehicle.'); } finally { setSavingVeh(false); }
  };

  const handleDeleteVeh = async (id: number) => {
    setDeletingVehId(id);
    try {
      await fetch(`/api/civilian/vehicles/${id}`, { method: 'DELETE' });
      setVehicles(prev => prev.filter(v => v.id !== id));
      toast.success('Vehicle removed.');
    } catch { toast.error('Failed to remove vehicle.'); } finally { setDeletingVehId(null); setConfirmDeleteVehId(null); }
  };

  // ── Weapon CRUD ──────────────────────────────────────────────────────────────
  const openEditWep = (w: Weapon) => {
    setEditWepId(w.id);
    setWepForm({ civilian_id: w.civilian_id ? String(w.civilian_id) : '', weapon_type: w.weapon_type, serial_number: w.serial_number ?? '', registered: w.registered });
    setShowWepForm(true);
  };

  const handleSaveWep = async () => {
    if (!wepForm.weapon_type) { toast.error('Weapon type is required.'); return; }
    setSavingWep(true);
    try {
      const url = editWepId ? `/api/civilian/weapons/${editWepId}` : '/api/civilian/weapons';
      const method = editWepId ? 'PATCH' : 'POST';
      const body = editWepId ? wepForm : { ...wepForm, owner_username: session!.username };
      const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error();
      const saved = (await res.json()) as Weapon;
      const withName = { ...saved, civilian_name: characters.find(c => c.id === saved.civilian_id) ? `${characters.find(c => c.id === saved.civilian_id)!.first_name} ${characters.find(c => c.id === saved.civilian_id)!.last_name}` : null };
      setWeapons(prev => editWepId ? prev.map(w => w.id === editWepId ? withName : w) : [withName, ...prev]);
      toast.success(editWepId ? 'Weapon updated.' : 'Weapon registered.');
      setShowWepForm(false); setEditWepId(null); setWepForm({ ...emptyWep });
    } catch { toast.error('Failed to save weapon.'); } finally { setSavingWep(false); }
  };

  const handleDeleteWep = async (id: number) => {
    setDeletingWepId(id);
    try {
      await fetch(`/api/civilian/weapons/${id}`, { method: 'DELETE' });
      setWeapons(prev => prev.filter(w => w.id !== id));
      toast.success('Weapon removed.');
    } catch { toast.error('Failed to remove weapon.'); } finally { setDeletingWepId(null); setConfirmDeleteWepId(null); }
  };

  // ── Sign out ─────────────────────────────────────────────────────────────────
  const handleSignOut = () => {
    setIsSigningOut(true);
    clearCadSession();
    toast.success('Signed out.');
    navigate('/', { replace: true });
  };

  // ── Shared styles ────────────────────────────────────────────────────────────
  const inputCls = 'h-10 w-full rounded-md border border-[#202a3a] bg-[#080d15] px-3 text-sm text-white placeholder:text-[#66748a] focus:outline-none focus:ring-2 focus:ring-[#2f70ff]/50';
  const labelCls = 'mb-1 block text-[10px] font-black uppercase tracking-[0.16em] text-[#72809a]';

  const tabs: { id: CivTab; label: string; icon: typeof User }[] = [
    { id: 'characters', label: 'Characters', icon: User },
    { id: 'vehicles', label: 'Vehicles', icon: Car },
    { id: 'weapons', label: 'Weapons', icon: Crosshair },
  ];

  if (!session) return null;

  return (
    <main className="min-h-screen bg-[#02060b] text-white">

      {/* ── Mobile top bar ─────────────────────────────────────────────────── */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-[#131f30] bg-[#02060b] px-5 py-3 lg:hidden">
        <p className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.08em] text-white"><DojrpShield className="h-5 w-5" /><DojrpLogo /></p>
        <div className={`flex items-center gap-2 rounded-full border px-3 py-1 ${cadOnline === false ? 'border-[#3a1920] bg-[#19070b]' : 'border-[#173053] bg-[#071120]'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${cadOnline === false ? 'bg-[#ff5d5d]' : 'bg-[#4384ff]'}`} />
          <span className={`text-[9px] font-black uppercase tracking-[0.34em] ${cadOnline === false ? 'text-[#ff7070]' : 'text-[#4384ff]'}`}>
            {cadOnline === null ? 'Terminal Online' : `Terminal ${cadModeLabel(cadMode)}`}
          </span>
        </div>
        <button type="button" onClick={handleSignOut} disabled={isSigningOut} className="rounded-full px-3 py-2 text-sm font-bold text-[#526179] transition-colors hover:bg-white/5 hover:text-white disabled:opacity-60">
          {isSigningOut ? 'Signing out...' : 'Sign out'}
        </button>
      </div>

      <div className="flex min-h-screen flex-col pt-[53px] lg:flex-row lg:pt-0">

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside className="border-b border-[#131f30] bg-[#02060b] px-5 py-5 lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-[265px] lg:flex-col lg:border-b-0 lg:border-r lg:border-[#131f30]">
          <div className="lg:shrink-0">
            <h1 className="text-xl font-black tracking-[-0.04em] text-white">Civilian Ops</h1>
            <p className="mt-2 text-sm font-black leading-none text-[#3f85ff]">{session.username}</p>
            <p className="mt-1 text-[10px] font-black uppercase tracking-[0.22em] text-[#526179]">{session.rank}</p>
          </div>

          <div className="sidebar-scroll mt-8 lg:flex-1 lg:overflow-x-hidden lg:overflow-y-auto">
            {/* CAD tab links */}
            <nav className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
              {tabs.map(({ id, label, icon: Icon }) => {
                const locked = id === 'weapons';
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={locked}
                    onClick={() => !locked && setActiveTab(id)}
                    className={`shrink-0 flex items-center gap-2.5 rounded-md px-4 py-3 text-left text-sm font-semibold transition-colors ${
                      locked
                        ? 'cursor-not-allowed opacity-40 text-[#526179]'
                        : activeTab === id
                          ? 'border-l-2 border-[#4384ff] bg-[#071120] text-white'
                          : 'text-[#8392aa] hover:bg-[#070d16] hover:text-white'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{label}</span>
                    {locked && (
                      <span className="flex items-center gap-1 ml-auto">
                        <span className="text-[9px] font-black uppercase tracking-[0.15em]">Coming Soon</span>
                        <Lock className="h-3 w-3 shrink-0" />
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Back links */}
            <div className="mt-6 flex flex-col gap-0 border-t border-[#131f30] pt-6 lg:mt-5">
              <button type="button" onClick={() => navigate('/portal_dashboard')} className="flex w-full items-center gap-3 px-4 text-left text-sm font-black uppercase tracking-[0.08em] text-[#8392aa] transition-colors hover:text-[#4384ff]">
                <LayoutDashboard className="h-4 w-4" />
                Member Portal
              </button>
            </div>
          </div>

        </aside>


        {/* ── Main content ──────────────────────────────────────────────────── */}
        <section className="flex min-h-screen flex-1 flex-col lg:ml-[265px]">

          {/* Desktop top bar */}
          <header className="hidden items-center justify-between border-b border-[#131f30] px-9 py-4 lg:flex">
            <p className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.08em] text-white"><DojrpShield className="h-5 w-5" /><DojrpLogo /></p>
            <div className={`hidden items-center gap-2 rounded-full border px-4 py-2 lg:flex ${cadOnline === false ? 'border-[#3a1920] bg-[#19070b]' : 'border-[#173053] bg-[#071120]'}`}>
              <span className={`h-2 w-2 rounded-full ${cadOnline === false ? 'bg-[#ff5d5d]' : 'bg-[#4384ff]'}`} />
              <span className={`text-[10px] font-black uppercase tracking-[0.34em] ${cadOnline === false ? 'text-[#ff7070]' : 'text-[#4384ff]'}`}>
                {cadOnline === null ? 'Terminal Online' : `Terminal ${cadModeLabel(cadMode)}`}
              </span>
            </div>
            <button type="button" onClick={handleSignOut} disabled={isSigningOut} className="rounded-full px-4 py-2 text-sm font-bold text-[#a8b7cd] transition-colors hover:bg-white/5 hover:text-[#ff7070] disabled:opacity-60">
              {isSigningOut ? 'Signing out...' : 'Sign out'}
            </button>
          </header>

          <div className="flex-1 px-5 py-7 sm:px-8 sm:py-9">

            {/* Page title */}
            <div className="mb-8">
              <h2 className="text-3xl font-black leading-none tracking-[-0.05em] text-white sm:text-4xl">Civilian Operations</h2>
              <p className="mt-2 text-sm text-[#8392aa]">Manage your civilian characters, registered vehicles, and weapons.</p>
            </div>

            {/* ── CHARACTERS ───────────────────────────────────────────────── */}
            {activeTab === 'characters' && (
              <section className="space-y-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#4384ff]">Characters</h3>
                  <button type="button" onClick={() => { setShowCharForm(true); setEditCharId(null); setCharForm({ ...emptyChar }); }} className="inline-flex items-center gap-2 rounded-md bg-[#2f70ff] px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#4384ff]">
                    <Plus className="h-3.5 w-3.5" /> New Character
                  </button>
                </div>

                {/* Create / Edit form */}
                {showCharForm && (
                  <div className="rounded-xl border border-[#263247] bg-[#070d16] p-5 sm:p-6">
                    <div className="mb-4 flex items-center justify-between">
                      <h4 className="text-sm font-black uppercase tracking-[0.16em] text-white">{editCharId ? 'Edit Character' : 'New Character'}</h4>
                      <button type="button" onClick={() => { setShowCharForm(false); setEditCharId(null); }} className="text-[#66748a] hover:text-white"><X className="h-4 w-4" /></button>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {/* First Name */}
                      <div>
                        <label className={labelCls}>First Name</label>
                        <input className={inputCls} value={charForm.first_name} onChange={e => setCharForm(p => ({ ...p, first_name: e.target.value }))} placeholder="First Name" />
                      </div>
                      {/* Last Name */}
                      <div>
                        <label className={labelCls}>Last Name</label>
                        <input className={inputCls} value={charForm.last_name} onChange={e => setCharForm(p => ({ ...p, last_name: e.target.value }))} placeholder="Last Name" />
                      </div>
                      {/* Gender dropdown */}
                      <div>
                        <label className={labelCls}>Gender</label>
                        <select className={`${inputCls} cursor-pointer`} value={charForm.gender} onChange={e => setCharForm(p => ({ ...p, gender: e.target.value }))}>
                          <option value="">Select gender…</option>
                          <option value="Male">Male</option>
                          <option value="Female">Female</option>
                          <option value="Non-Binary">Non-Binary</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      {/* Hair Colour */}
                      <div>
                        <label className={labelCls}>Hair Colour</label>
                        <input className={inputCls} value={charForm.hair_colour} onChange={e => setCharForm(p => ({ ...p, hair_colour: e.target.value }))} placeholder="e.g. Brown" />
                      </div>
                      {/* Occupation */}
                      <div className="sm:col-span-2">
                        <label className={labelCls}>Occupation</label>
                        <input className={inputCls} value={charForm.occupation} onChange={e => setCharForm(p => ({ ...p, occupation: e.target.value }))} placeholder="e.g. Mechanic" />
                      </div>
                      {/* Date of Birth */}
                      <div>
                        <label className={labelCls}>Date of Birth</label>
                        <input
                          className={inputCls}
                          value={charForm.dob}
                          placeholder="MM/DD/YYYY"
                          maxLength={10}
                          onChange={e => {
                            let val = e.target.value.replace(/[^\d/]/g, '');
                            if (val.length === 2 && !val.includes('/')) val += '/';
                            else if (val.length === 5 && val.split('/').length === 2) val += '/';
                            const dob = val;
                            setCharForm(p => ({ ...p, dob, ethnicity: calcAge(dob) }));
                          }}
                        />
                      </div>
                      {/* Age — auto-calculated */}
                      <div>
                        <label className={labelCls}>Age</label>
                        <input className={`${inputCls} cursor-not-allowed opacity-60`} value={charForm.ethnicity} readOnly placeholder="Auto-calculated from DOB" />
                      </div>
                      {/* Address */}
                      <div className="sm:col-span-2">
                        <label className={labelCls}>Address</label>
                        <input className={inputCls} value={charForm.address} onChange={e => setCharForm(p => ({ ...p, address: e.target.value }))} placeholder="123 Main St" />
                      </div>
                      {/* Valid Driving Licence */}
                      <div className="sm:col-span-2">
                        <label className="text-[10px] font-black uppercase tracking-[0.16em] text-[#66748a] mb-2 block">Driving Licence</label>
                        <button
                          type="button"
                          onClick={() => setCharForm(p => ({ ...p, valid_licence: !p.valid_licence }))}
                          className={`inline-flex items-center gap-2 rounded-md border px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-colors ${
                            charForm.valid_licence
                              ? 'border-emerald-600/50 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                              : 'border-red-600/50 bg-red-500/10 text-red-400 hover:bg-red-500/20'
                          }`}
                        >
                          <span className={`h-2 w-2 rounded-full ${charForm.valid_licence ? 'bg-emerald-400' : 'bg-red-400'}`} />
                          {charForm.valid_licence ? 'Valid Driving Licence' : 'No Valid Driving Licence'}
                        </button>
                      </div>
                      {/* Notes */}
                      <div className="sm:col-span-2">
                        <label className={labelCls}>Notes</label>
                        <textarea className={`${inputCls} h-20 resize-none py-2`} value={charForm.notes} onChange={e => setCharForm(p => ({ ...p, notes: e.target.value }))} placeholder="Additional notes..." />
                      </div>
                    </div>
                    <div className="mt-5 flex gap-3">
                      <button type="button" onClick={handleSaveChar} disabled={savingChar} className="rounded-md bg-[#2f70ff] px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-white hover:bg-[#4384ff] disabled:opacity-60">
                        {savingChar ? 'Saving...' : editCharId ? 'Update Character' : 'Create Character'}
                      </button>
                      <button type="button" onClick={() => { setShowCharForm(false); setEditCharId(null); }} className="rounded-md border border-[#263247] px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#a8b7cd] hover:text-white">Cancel</button>
                    </div>
                  </div>
                )}

                {/* Character list */}
                {charLoading ? (
                  <p className="text-sm text-[#526179]">Loading characters...</p>
                ) : characters.length === 0 ? (
                  <div className="rounded-xl border border-[#131f30] bg-[#070d16] p-8 text-center">
                    <User className="mx-auto mb-3 h-8 w-8 text-[#263247]" />
                    <p className="text-sm font-semibold text-[#526179]">No characters yet</p>
                    <p className="mt-1 text-xs text-[#3a4f6e]">Create your first civilian character above.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {characters.map(c => (
                      <div key={c.id} className="rounded-xl border border-[#131f30] bg-[#070d16] overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1a2a3f]">
                              <User className="h-4 w-4 text-[#4384ff]" />
                            </div>
                            <div>
                              <p className="font-bold text-white">{c.first_name} {c.last_name}</p>
                              <p className="text-xs text-[#66748a]">{[c.gender, c.ethnicity ? `${c.ethnicity} yrs` : null, c.dob, c.occupation].filter(Boolean).join(' · ') || 'No additional info'}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => openEditChar(c)} className="rounded-md p-2 text-[#66748a] transition-colors hover:bg-[#1a2a3f] hover:text-white"><Pencil className="h-4 w-4" /></button>
                            <button type="button" onClick={() => toggleCharExpand(c.id)} className="rounded-md p-2 text-[#66748a] transition-colors hover:bg-[#1a2a3f] hover:text-white">
                              {expandedCharId === c.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>
                            {confirmDeleteCharId === c.id ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-red-300">Delete?</span>
                                <button type="button" onClick={() => handleDeleteChar(c.id)} disabled={deletingCharId === c.id} className="rounded-md bg-red-500 px-3 py-1.5 text-[10px] font-black uppercase text-white hover:bg-red-400 disabled:opacity-60">{deletingCharId === c.id ? '...' : 'Yes'}</button>
                                <button type="button" onClick={() => setConfirmDeleteCharId(null)} className="rounded-md border border-[#263247] px-3 py-1.5 text-[10px] font-black uppercase text-[#a8b7cd] hover:text-white">No</button>
                              </div>
                            ) : (
                              <button type="button" onClick={() => setConfirmDeleteCharId(c.id)} className="rounded-md p-2 text-[#66748a] transition-colors hover:bg-red-500/10 hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
                            )}
                          </div>
                        </div>
                        {expandedCharId === c.id && (() => {
                          const linkedVehicles = vehicles.filter(v => v.civilian_id === c.id);
                          const linkedWeapons  = weapons.filter(w => w.civilian_id === c.id);
                          return (
                            <div className="border-t border-[#131f30] px-5 py-4 space-y-4">
                              {/* BOLO banner */}
                              <div className={`flex items-center gap-2 rounded-lg px-4 py-2.5 ${c.wanted ? 'bg-red-500/15 border border-red-500/30' : 'bg-[#0a1220] border border-[#131f30]'}`}>
                                <span className={`h-2 w-2 shrink-0 rounded-full ${c.wanted ? 'bg-red-500' : 'bg-[#263247]'}`} />
                                <span className={`text-[10px] font-black uppercase tracking-[0.22em] ${c.wanted ? 'text-red-300' : 'text-[#526179]'}`}>
                                  {c.wanted ? 'BOLO / Wanted — approach with caution' : 'No active warrants'}
                                </span>
                              </div>
                              {/* Detail fields */}
                              <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                                {([
                                  ['Date of Birth', c.dob],
                                  ['Age',           c.ethnicity ? `${c.ethnicity} years old` : null],
                                  ['Gender',        c.gender],
                                  ['Hair Colour',   c.hair_colour],
                                  ['Occupation',    c.occupation],
                                  ['Phone',         c.phone],
                                  ['Address',       c.address],
                                  ['Notes',         c.notes],
                                ] as [string, string | null][]).map(([lbl, val]) => val ? (
                                  <div key={lbl} className="sm:col-span-1">
                                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#526179]">{lbl}</p>
                                    <p className="mt-0.5 text-sm text-[#a8b7cd]">{val}</p>
                                  </div>
                                ) : null)}
                                {/* Driving Licence — always shown */}
                                <div className="sm:col-span-1">
                                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#526179]">Driving Licence</p>
                                  <p className={`mt-0.5 flex items-center gap-1.5 text-sm font-bold ${c.valid_licence ? 'text-emerald-400' : 'text-red-400'}`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${c.valid_licence ? 'bg-emerald-400' : 'bg-red-400'}`} />
                                    {c.valid_licence ? 'Valid' : 'Not Valid'}
                                  </p>
                                </div>
                              </div>
                              {/* Linked vehicles */}
                              {linkedVehicles.length > 0 && (
                                <div>
                                  <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#526179]">Registered Vehicles</p>
                                  <div className="space-y-1.5">
                                    {linkedVehicles.map(v => (
                                      <div key={v.id} className="flex items-center justify-between rounded-md bg-[#0a1220] border border-[#131f30] px-3 py-2">
                                        <span className="text-sm font-semibold text-[#a8b7cd]">
                                          {[v.year, v.color, v.make, v.model].filter(Boolean).join(' ')}
                                          <span className="ml-2 font-mono text-xs text-[#526179]">{v.plate}</span>
                                        </span>
                                        <div className="flex gap-1.5">
                                          {v.stolen && <span className="rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider bg-red-500/20 text-red-300">Stolen</span>}
                                          {!v.registered && <span className="rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider bg-yellow-500/20 text-yellow-300">Unregistered</span>}
                                          {v.registered && !v.stolen && <span className="rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider bg-green-500/20 text-green-300">Clear</span>}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {/* Linked weapons */}
                              {linkedWeapons.length > 0 && (
                                <div>
                                  <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#526179]">Registered Weapons</p>
                                  <div className="space-y-1.5">
                                    {linkedWeapons.map(w => (
                                      <div key={w.id} className="flex items-center justify-between rounded-md bg-[#0a1220] border border-[#131f30] px-3 py-2">
                                        <span className="text-sm font-semibold text-[#a8b7cd]">
                                          {w.weapon_type}
                                          {w.serial_number && <span className="ml-2 font-mono text-xs text-[#526179]">#{w.serial_number}</span>}
                                        </span>
                                        <div className="flex gap-1.5">
                                          {!w.registered && <span className="rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider bg-yellow-500/20 text-yellow-300">Unregistered</span>}
                                          {w.registered && <span className="rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider bg-green-500/20 text-green-300">Clear</span>}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* ── Citations ── */}
                              {(() => {
                                const loading = charRecordsLoading[c.id];
                                const cits = charCitations[c.id] ?? [];
                                const open = citationsOpen.has(c.id);
                                return (
                                  <div className="rounded-lg border border-[#131f30] overflow-hidden">
                                    <button
                                      type="button"
                                      onClick={() => toggleSection(citationsOpen, setCitationsOpen, c.id)}
                                      className="flex w-full items-center justify-between px-4 py-2.5 bg-[#0a1220] hover:bg-[#0d1628] transition-colors"
                                    >
                                      <div className="flex items-center gap-2">
                                        <FileText className="h-3.5 w-3.5 text-amber-400" />
                                        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#a8b7cd]">Citations</span>
                                        {!loading && (
                                          <span className={`rounded px-1.5 py-0.5 text-[9px] font-black ${cits.length > 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-[#172235] text-[#526179]'}`}>
                                            {cits.length}
                                          </span>
                                        )}
                                      </div>
                                      {open ? <ChevronUp className="h-3.5 w-3.5 text-[#526179]" /> : <ChevronDown className="h-3.5 w-3.5 text-[#526179]" />}
                                    </button>
                                    {open && (
                                      <div className="border-t border-[#131f30] bg-[#060e18] p-3 space-y-2">
                                        {loading ? (
                                          <p className="text-center text-[10px] text-[#526179] py-2">Loading…</p>
                                        ) : cits.length === 0 ? (
                                          <p className="text-center text-[10px] text-[#526179] py-2">No citations on record</p>
                                        ) : cits.map(ct => (
                                          <div key={ct.id} className="rounded-md border border-[#131f30] bg-[#0a1220] px-3 py-2.5 space-y-1.5">
                                            <div className="flex items-start justify-between gap-2">
                                              <span className="text-xs font-bold text-amber-300">{ct.violation || 'Unknown violation'}</span>
                                              {ct.fine_amount && (
                                                <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-black bg-amber-500/15 text-amber-300">${ct.fine_amount}</span>
                                              )}
                                            </div>
                                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-[#526179]">
                                              {ct.officer && <span>Officer: <span className="text-[#a8b7cd]">{ct.officer}</span></span>}
                                              {ct.date_time && <span>{new Date(ct.date_time).toLocaleDateString()}</span>}
                                              {ct.location && <span>@ {ct.location}</span>}
                                            </div>
                                            {ct.notes && <p className="text-[10px] text-[#66748a] italic">{ct.notes}</p>}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}

                              {/* ── Arrests ── */}
                              {(() => {
                                const loading = charRecordsLoading[c.id];
                                const arrs = charArrests[c.id] ?? [];
                                const open = arrestsOpen.has(c.id);
                                return (
                                  <div className="rounded-lg border border-[#131f30] overflow-hidden">
                                    <button
                                      type="button"
                                      onClick={() => toggleSection(arrestsOpen, setArrestsOpen, c.id)}
                                      className="flex w-full items-center justify-between px-4 py-2.5 bg-[#0a1220] hover:bg-[#0d1628] transition-colors"
                                    >
                                      <div className="flex items-center gap-2">
                                        <Scale className="h-3.5 w-3.5 text-red-400" />
                                        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#a8b7cd]">Arrest Record</span>
                                        {!loading && (
                                          <span className={`rounded px-1.5 py-0.5 text-[9px] font-black ${arrs.length > 0 ? 'bg-red-500/20 text-red-300' : 'bg-[#172235] text-[#526179]'}`}>
                                            {arrs.length}
                                          </span>
                                        )}
                                      </div>
                                      {open ? <ChevronUp className="h-3.5 w-3.5 text-[#526179]" /> : <ChevronDown className="h-3.5 w-3.5 text-[#526179]" />}
                                    </button>
                                    {open && (
                                      <div className="border-t border-[#131f30] bg-[#060e18] p-3 space-y-2">
                                        {loading ? (
                                          <p className="text-center text-[10px] text-[#526179] py-2">Loading…</p>
                                        ) : arrs.length === 0 ? (
                                          <p className="text-center text-[10px] text-[#526179] py-2">No arrests on record</p>
                                        ) : arrs.map(ar => (
                                          <div key={ar.id} className="rounded-md border border-[#131f30] bg-[#0a1220] px-3 py-2.5 space-y-1.5">
                                            <span className="text-xs font-bold text-red-300">{ar.charges || 'No charges listed'}</span>
                                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-[#526179]">
                                              {ar.officer && <span>Officer: <span className="text-[#a8b7cd]">{ar.officer}</span></span>}
                                              {ar.created_at && <span>{new Date(ar.created_at).toLocaleDateString()}</span>}
                                            </div>
                                            {ar.notes && <p className="text-[10px] text-[#66748a] italic">{ar.notes}</p>}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* ── VEHICLES ─────────────────────────────────────────────────── */}
            {activeTab === 'vehicles' && (
              <section className="space-y-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#4384ff]">Vehicles</h3>
                  <button type="button" onClick={() => { setShowVehForm(true); setEditVehId(null); setVehForm({ ...emptyVeh }); }} className="inline-flex items-center gap-2 rounded-md bg-[#2f70ff] px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#4384ff]">
                    <Plus className="h-3.5 w-3.5" /> Register Vehicle
                  </button>
                </div>

                {showVehForm && (
                  <div className="rounded-xl border border-[#263247] bg-[#070d16] p-5 sm:p-6">
                    <div className="mb-4 flex items-center justify-between">
                      <h4 className="text-sm font-black uppercase tracking-[0.16em] text-white">{editVehId ? 'Edit Vehicle' : 'Register Vehicle'}</h4>
                      <button type="button" onClick={() => { setShowVehForm(false); setEditVehId(null); }} className="text-[#66748a] hover:text-white"><X className="h-4 w-4" /></button>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {/* Linked Character */}
                      <div className="sm:col-span-2">
                        <label className={labelCls}>Linked Character</label>
                        <select className={`${inputCls} cursor-pointer`} value={vehForm.civilian_id} onChange={e => setVehForm(p => ({ ...p, civilian_id: e.target.value }))}>
                          <option value="">— None —</option>
                          {characters.map(c => <option key={c.id} value={String(c.id)}>{c.first_name} {c.last_name}</option>)}
                        </select>
                      </div>
                      {/* Vehicle Make */}
                      <div>
                        <label className={labelCls}>Vehicle Make</label>
                        <input className={inputCls} value={vehForm.make} onChange={e => setVehForm(p => ({ ...p, make: e.target.value }))} placeholder="e.g. Ford" />
                      </div>
                      {/* Vehicle Model */}
                      <div>
                        <label className={labelCls}>Vehicle Model</label>
                        <input className={inputCls} value={vehForm.model} onChange={e => setVehForm(p => ({ ...p, model: e.target.value }))} placeholder="e.g. Mustang" />
                      </div>
                      {/* Vehicle Year */}
                      <div>
                        <label className={labelCls}>Vehicle Year</label>
                        <input className={inputCls} value={vehForm.year} onChange={e => setVehForm(p => ({ ...p, year: e.target.value }))} placeholder="e.g. 2021" />
                      </div>
                      {/* Vehicle Colour */}
                      <div>
                        <label className={labelCls}>Vehicle Colour</label>
                        <input className={inputCls} value={vehForm.color} onChange={e => setVehForm(p => ({ ...p, color: e.target.value }))} placeholder="e.g. Black" />
                      </div>
                      {/* Vehicle Plate */}
                      <div>
                        <label className={labelCls}>Vehicle Plate</label>
                        <input className={inputCls} value={vehForm.plate} onChange={e => setVehForm(p => ({ ...p, plate: e.target.value }))} placeholder="e.g. ABC1234" />
                      </div>
                      {/* Vehicle VIN — auto-generated, read-only */}
                      <div className="sm:col-span-2">
                        <label className={labelCls}>Vehicle VIN <span className="text-[#3a5070] font-normal normal-case tracking-normal">(auto-generated on registration)</span></label>
                        <input
                          className={`${inputCls} cursor-not-allowed opacity-60`}
                          value={vehForm.vin || (editVehId ? '' : 'Will be generated automatically')}
                          readOnly
                          placeholder="Auto-generated"
                        />
                      </div>
                      {/* Status toggle buttons */}
                      <div className="sm:col-span-2">
                        <label className={labelCls}>Status</label>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {([
                            ['registered', 'Registered', '#2f70ff'],
                            ['insured',    'Insured',    '#16a34a'],
                            ['stolen',     'Stolen',     '#dc2626'],
                          ] as [keyof typeof vehForm, string, string][]).map(([key, lbl, activeColor]) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setVehForm(p => ({ ...p, [key]: !p[key] }))}
                              className={`rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] border transition-all ${
                                vehForm[key]
                                  ? 'text-white border-transparent'
                                  : 'text-[#526179] border-[#263247] hover:border-[#3a5070] hover:text-[#a8b7cd]'
                              }`}
                              style={vehForm[key] ? { background: activeColor } : {}}
                            >
                              {lbl}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="mt-5 flex gap-3">
                      <button type="button" onClick={handleSaveVeh} disabled={savingVeh} className="rounded-md bg-[#2f70ff] px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-white hover:bg-[#4384ff] disabled:opacity-60">
                        {savingVeh ? 'Saving...' : editVehId ? 'Update Vehicle' : 'Register Vehicle'}
                      </button>
                      <button type="button" onClick={() => { setShowVehForm(false); setEditVehId(null); }} className="rounded-md border border-[#263247] px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#a8b7cd] hover:text-white">Cancel</button>
                    </div>
                  </div>
                )}

                {vehLoading ? (
                  <p className="text-sm text-[#526179]">Loading vehicles...</p>
                ) : vehicles.length === 0 ? (
                  <div className="rounded-xl border border-[#131f30] bg-[#070d16] p-8 text-center">
                    <Car className="mx-auto mb-3 h-8 w-8 text-[#263247]" />
                    <p className="text-sm font-semibold text-[#526179]">No vehicles registered</p>
                    <p className="mt-1 text-xs text-[#3a4f6e]">Register your first vehicle above.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {vehicles.map(v => (
                      <div key={v.id} className="rounded-xl border border-[#131f30] bg-[#070d16] px-5 py-4">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1a2a3f]">
                              <Car className="h-4 w-4 text-[#4384ff]" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-bold text-white">{v.plate}</p>
                                <span className="text-xs text-[#526179]">{[v.year, v.color, v.make, v.model].filter(Boolean).join(' ')}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                {v.civilian_name && <span className="text-xs text-[#66748a]">Owner: {v.civilian_name}</span>}
                                {v.vin && <span className="text-[10px] font-mono text-[#3f5470]">{v.vin}</span>}
                              </div>
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                <span className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${v.registered ? 'bg-blue-500/15 text-blue-300' : 'bg-[#1a2a3f] text-[#526179]'}`}>{v.registered ? 'Registered' : 'Unregistered'}</span>
                                <span className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${v.insured ? 'bg-green-500/15 text-green-300' : 'bg-[#1a2a3f] text-[#526179]'}`}>{v.insured ? 'Insured' : 'Uninsured'}</span>
                                {v.stolen && <span className="inline-block rounded-full bg-red-500/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-red-400">Stolen</span>}
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <button type="button" onClick={() => openEditVeh(v)} className="rounded-md p-2 text-[#66748a] hover:bg-[#1a2a3f] hover:text-white"><Pencil className="h-4 w-4" /></button>
                            {confirmDeleteVehId === v.id ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-red-300">Delete?</span>
                                <button type="button" onClick={() => handleDeleteVeh(v.id)} disabled={deletingVehId === v.id} className="rounded-md bg-red-500 px-3 py-1.5 text-[10px] font-black uppercase text-white hover:bg-red-400 disabled:opacity-60">{deletingVehId === v.id ? '...' : 'Yes'}</button>
                                <button type="button" onClick={() => setConfirmDeleteVehId(null)} className="rounded-md border border-[#263247] px-3 py-1.5 text-[10px] font-black uppercase text-[#a8b7cd] hover:text-white">No</button>
                              </div>
                            ) : (
                              <button type="button" onClick={() => setConfirmDeleteVehId(v.id)} className="rounded-md p-2 text-[#66748a] hover:bg-red-500/10 hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* ── WEAPONS ──────────────────────────────────────────────────── */}
            {activeTab === 'weapons' && (
              <section className="space-y-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#4384ff]">Weapons</h3>
                  <button type="button" onClick={() => { setShowWepForm(true); setEditWepId(null); setWepForm({ ...emptyWep }); }} className="inline-flex items-center gap-2 rounded-md bg-[#2f70ff] px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#4384ff]">
                    <Plus className="h-3.5 w-3.5" /> Register Weapon
                  </button>
                </div>

                {showWepForm && (
                  <div className="rounded-xl border border-[#263247] bg-[#070d16] p-5 sm:p-6">
                    <div className="mb-4 flex items-center justify-between">
                      <h4 className="text-sm font-black uppercase tracking-[0.16em] text-white">{editWepId ? 'Edit Weapon' : 'Register Weapon'}</h4>
                      <button type="button" onClick={() => { setShowWepForm(false); setEditWepId(null); }} className="text-[#66748a] hover:text-white"><X className="h-4 w-4" /></button>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className={labelCls}>Linked Character</label>
                        <select className={`${inputCls} cursor-pointer`} value={wepForm.civilian_id} onChange={e => setWepForm(p => ({ ...p, civilian_id: e.target.value }))}>
                          <option value="">— None —</option>
                          {characters.map(c => <option key={c.id} value={String(c.id)}>{c.first_name} {c.last_name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Weapon Type</label>
                        <select className={`${inputCls} cursor-pointer`} value={wepForm.weapon_type} onChange={e => setWepForm(p => ({ ...p, weapon_type: e.target.value }))}>
                          <option value="">— Select type —</option>
                          {['Pistol','Revolver','Shotgun','Rifle','SMG','Sniper Rifle','Knife','Baton','Taser','Other'].map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Serial Number</label>
                        <input className={inputCls} value={wepForm.serial_number} onChange={e => setWepForm(p => ({ ...p, serial_number: e.target.value }))} placeholder="SN-000000" />
                      </div>
                      <div className="flex items-center gap-2 pt-5">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input type="checkbox" checked={wepForm.registered} onChange={e => setWepForm(p => ({ ...p, registered: e.target.checked }))} className="h-4 w-4 rounded border-[#27354c] accent-[#2f70ff]" />
                          <span className="text-sm text-[#a8b7cd]">Registered</span>
                        </label>
                      </div>
                    </div>
                    <div className="mt-5 flex gap-3">
                      <button type="button" onClick={handleSaveWep} disabled={savingWep} className="rounded-md bg-[#2f70ff] px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-white hover:bg-[#4384ff] disabled:opacity-60">
                        {savingWep ? 'Saving...' : editWepId ? 'Update Weapon' : 'Register Weapon'}
                      </button>
                      <button type="button" onClick={() => { setShowWepForm(false); setEditWepId(null); }} className="rounded-md border border-[#263247] px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#a8b7cd] hover:text-white">Cancel</button>
                    </div>
                  </div>
                )}

                {wepLoading ? (
                  <p className="text-sm text-[#526179]">Loading weapons...</p>
                ) : weapons.length === 0 ? (
                  <div className="rounded-xl border border-[#131f30] bg-[#070d16] p-8 text-center">
                    <Crosshair className="mx-auto mb-3 h-8 w-8 text-[#263247]" />
                    <p className="text-sm font-semibold text-[#526179]">No weapons registered</p>
                    <p className="mt-1 text-xs text-[#3a4f6e]">Register your first weapon above.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {weapons.map(w => (
                      <div key={w.id} className="rounded-xl border border-[#131f30] bg-[#070d16] px-5 py-4">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1a2a3f]">
                              <Crosshair className="h-4 w-4 text-[#4384ff]" />
                            </div>
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-bold text-white">{w.weapon_type}</p>
                                {w.serial_number && <span className="text-xs text-[#526179]">SN: {w.serial_number}</span>}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                {w.civilian_name && <span className="text-xs text-[#66748a]">Owner: {w.civilian_name}</span>}
                                <span className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${w.registered ? 'bg-blue-500/15 text-blue-300' : 'bg-red-500/15 text-red-300'}`}>{w.registered ? 'Registered' : 'Unregistered'}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <button type="button" onClick={() => openEditWep(w)} className="rounded-md p-2 text-[#66748a] hover:bg-[#1a2a3f] hover:text-white"><Pencil className="h-4 w-4" /></button>
                            {confirmDeleteWepId === w.id ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-red-300">Delete?</span>
                                <button type="button" onClick={() => handleDeleteWep(w.id)} disabled={deletingWepId === w.id} className="rounded-md bg-red-500 px-3 py-1.5 text-[10px] font-black uppercase text-white hover:bg-red-400 disabled:opacity-60">{deletingWepId === w.id ? '...' : 'Yes'}</button>
                                <button type="button" onClick={() => setConfirmDeleteWepId(null)} className="rounded-md border border-[#263247] px-3 py-1.5 text-[10px] font-black uppercase text-[#a8b7cd] hover:text-white">No</button>
                              </div>
                            ) : (
                              <button type="button" onClick={() => setConfirmDeleteWepId(w.id)} className="rounded-md p-2 text-[#66748a] hover:bg-red-500/10 hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

          </div>
        </section>
      </div>
    </main>
  );
};

export default CivilianOperations;
