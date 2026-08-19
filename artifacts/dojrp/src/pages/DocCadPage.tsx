import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCadSession, clearCadSession, setCadSession } from '@/lib/cad-session';
import { canAccessDocCad } from '@/lib/cad-access';
import { useCadStatus, cadModeLabel } from '@/hooks/useCadStatus';
import { useSelfDispatch } from '@/hooks/useSelfDispatch';
import { useCadData, type CadCall, type CadGroup } from '@/hooks/useCadData';
import {
  Radio, AlertCircle, Users, ArrowLeft, Search,
  Clock, Shield, Zap, Navigation, LogIn, LogOut, ChevronDown, Pencil, RefreshCw, ShieldAlert,
  Database, FileText, BookOpen, Scale, NotebookPen, PhoneCall,
  User, Car, Crosshair, X, ClipboardList, AlertTriangle, History, Gavel, Library,
  PlusCircle, MinusCircle, ArrowRightLeft, FilePlus, Trash2, UserPlus, Check, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────────────
type UnitStatus = 'Available' | 'Unavailable' | 'Busy' | 'Enroute' | 'On-Scene';

interface CivilianResult {
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
  bolo_reason?: string | null;
  valid_licence: boolean;
  created_at: string;
  citation_count?: number;
}
interface BoloRecord {
  kind: 'civilian' | 'vehicle';
  id: number;
  bolo_reason: string | null;
  created_at: string;
  // civilian fields
  first_name?: string | null;
  last_name?: string | null;
  gender?: string | null;
  hair_colour?: string | null;
  occupation?: string | null;
  // vehicle fields
  plate?: string | null;
  make?: string | null;
  model?: string | null;
  year?: string | null;
  color?: string | null;
  owner_name?: string | null;
}
interface UnitGroup {
  id: string;
  memberUsernames: string[];
  createdAt: number;
}
interface GroupInvite {
  id: string;
  fromUsername: string;
  fromCallsign: string;
  fromUnitNumber: string;
  toUsername: string;
  groupId: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: number;
}

interface CivilianVehicle {
  id: number;
  plate: string;
  make: string;
  model: string;
  year: string | null;
  color: string | null;
  registered: boolean;
  stolen: boolean;
}

interface VehicleSearchResult {
  id: number;
  plate: string;
  make: string;
  model: string | null;
  year: string | null;
  color: string | null;
  vin: string | null;
  registered: boolean;
  insured: boolean;
  stolen: boolean;
  bolo: boolean;
  bolo_reason: string | null;
  owner_name: string | null;
  owner_id: number | null;
}
interface CivilianArrest {
  id: number;
  charges: string;
  officer: string | null;
  notes: string | null;
  created_at: string;
}
interface CivilianCitation {
  id: number;
  violation: string;
  fine_amount: string | null;
  officer: string | null;
  date_time: string | null;
  location: string | null;
  notes: string | null;
  created_at: string;
}
interface CivilianHistory {
  id: number;
  type: string;
  description: string | null;
  officer: string | null;
  created_at: string;
}

interface ActiveUnit {
  userId: number;
  username: string;
  callsign: string;
  unitNumber: string;
  department: string;
  division?: string;
  location?: string;
  rank: string;
  status: UnitStatus;
  signedOnAt: number;
  lastHeartbeat: number;
}

interface ManualCall {
  id: number;
  origin: string;
  status: string;
  location: string | null;
  ten_code: string | null;
  units: string[] | null;
  description: string | null;
  priority: number;
  created_by: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<UnitStatus, string> = {
  Available:   'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
  Unavailable: 'border-red-500/40    bg-red-500/10    text-red-400',
  Busy:        'border-orange-500/40 bg-orange-500/10 text-orange-400',
  Enroute:     'border-blue-500/40   bg-blue-500/10   text-blue-400',
  'On-Scene':  'border-purple-500/40 bg-purple-500/10 text-purple-400',
};
const STATUS_DOT: Record<UnitStatus, string> = {
  Available:   'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]',
  Unavailable: 'bg-red-500',
  Busy:        'bg-orange-400',
  Enroute:     'bg-blue-400',
  'On-Scene':  'bg-purple-400',
};

const STATUS_BORDER_B: Record<UnitStatus, string> = {
  Available:   'border-b-emerald-400/60',
  Unavailable: 'border-b-red-500/50',
  Busy:        'border-b-orange-400/60',
  Enroute:     'border-b-blue-400/60',
  'On-Scene':  'border-b-purple-400/60',
};

const STATUS_BORDER_T: Record<UnitStatus, string> = {
  Available:   'border-t-emerald-400/60',
  Unavailable: 'border-t-red-500/50',
  Busy:        'border-t-orange-400/60',
  Enroute:     'border-t-blue-400/60',
  'On-Scene':  'border-t-purple-400/60',
};

const CALL_STATUS_STYLES: Record<string, string> = {
  Pending:   'border-[#1a3060]     bg-[#0a1830]     text-[#4384ff]',
  Active:    'border-yellow-500/40 bg-yellow-500/10 text-yellow-400',
  'On-Scene':'border-purple-500/40 bg-purple-500/10 text-purple-400',
  Closed:    'border-[#1a2a3a]     bg-[#030912]     text-[#2a3a50]',
  Removed:   'border-[#2a1a1a]     bg-[#150808]     text-[#5a3030]',
};

const PRIORITY_COLOR: Record<number, string> = {
  1: 'text-red-400',
  2: 'text-orange-400',
  3: 'text-yellow-400',
  4: 'text-sky-400',
};
const PRIORITY_LABEL: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };

const STATUSES: UnitStatus[] = ['Available', 'Unavailable', 'Busy'];

const DEPARTMENTS = [
  'Department of Communications',
  'Department of Public Health',
];

const DOC_ROLES = ['Dispatch', 'Operator', 'Supervisor'];

// ── Helpers ────────────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: UnitStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${STATUS_STYLES[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT[status]}`} />
      {status}
    </span>
  );
}

function CallStatusBadge({ status }: { status: string }) {
  const style = CALL_STATUS_STYLES[status] ?? 'border-[#1a3060] bg-[#0a1830] text-[#4384ff]';
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${style}`}>
      {status}
    </span>
  );
}

function useClock() {
  const [time, setTime] = useState(() => new Date().toLocaleTimeString('en-US', { hour12: false }));
  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toLocaleTimeString('en-US', { hour12: false })), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

// ── Panel header ───────────────────────────────────────────────────────────────
function PanelHeader({
  icon: Icon, label, accent, count, search, onSearch,
}: {
  icon: React.ElementType; label: string; accent: string;
  count: number; search: string; onSearch: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-[#0f1c2e] bg-[#050d1a] px-4 py-2.5 shrink-0">
      <Icon className={`h-3.5 w-3.5 shrink-0 ${accent}`} />
      <span className={`text-[10px] font-black uppercase tracking-[0.22em] ${accent}`}>{label}</span>
      <span className={`rounded border px-1.5 py-px text-[9px] font-black ${count > 0 ? 'border-[#1a3060] bg-[#0a1830] text-[#4384ff]' : 'border-[#0d1c2e] bg-[#040a14] text-[#2a3a50]'}`}>
        {count}
      </span>
      <div className="relative ml-auto">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#2a3a50]" />
        <input
          type="text"
          placeholder={`Search…`}
          value={search}
          onChange={e => onSearch(e.target.value)}
          className="h-6 w-32 rounded border border-[#0d1c2e] bg-[#02060b] pl-6 pr-2 text-[10px] font-semibold text-white placeholder:text-[#1e2e42] outline-none focus:border-[#2f70ff] transition-colors"
        />
      </div>
    </div>
  );
}

// ── Column header row ──────────────────────────────────────────────────────────
function ColHeaders({ cols, flexes }: { cols: string[]; flexes?: string[] }) {
  return (
    <div className="flex gap-0 border-b border-[#0a1520] bg-[#030912] px-4 py-1.5 shrink-0">
      {cols.map((c, i) => (
        <span key={`${c}-${i}`} className={`${flexes?.[i] ?? 'flex-1'} min-w-0 text-[10px] font-black uppercase tracking-[0.28em] text-white`}>{c}</span>
      ))}
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────
function EmptyState({ icon: Icon, line1, line2, action }: {
  icon: React.ElementType; line1: string; line2: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-8">
      <Icon className="h-7 w-7 text-[#0d1a2a] mb-1" />
      <p className="text-[11px] font-bold text-[#1e2e42]">{line1}</p>
      <p className="text-[10px] text-[#131e2d]">{line2}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

// ── Status dropdown ────────────────────────────────────────────────────────────
function StatusDropdown({ current, onChange }: { current: UnitStatus; onChange: (s: UnitStatus) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest transition-opacity hover:opacity-80 ${STATUS_STYLES[current]}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT[current]}`} />
        {current}
        <ChevronDown className="h-2.5 w-2.5 ml-0.5" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-36 rounded border border-[#1a2e4a] bg-[#03080f] shadow-xl">
          {STATUSES.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => { onChange(s); setOpen(false); }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest transition-colors hover:bg-[#0a1530] ${s === current ? STATUS_STYLES[s] : 'text-[#526179]'}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT[s]}`} />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Unit Manager Gate ──────────────────────────────────────────────────────────
function UnitManagerGate({
  myUnit,
  callsign,
  rank,
  avatarUrl,
  onClose,
  onSignOn,
  onSignOff,
  onStatusChange,
}: {
  myUnit: ActiveUnit | null;
  callsign: string;
  rank: string;
  avatarUrl: string | null;
  onClose: () => void;
  onSignOn: (unitNumber: string, department: string, division: string) => Promise<void>;
  onSignOff: () => Promise<void>;
  onStatusChange: (status: UnitStatus) => Promise<void>;
}) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem('doc_unit_pref') ?? 'null'); } catch { return null; } })();
  const [unitNumber, setUnitNumber] = useState(myUnit?.unitNumber ?? saved?.unitNumber ?? callsign);
  const [department, setDepartment] = useState(myUnit?.department ?? saved?.department ?? DEPARTMENTS[0]);
  const [role, setRole]             = useState(myUnit?.division   ?? saved?.division   ?? DOC_ROLES[0]);
  const [loading, setLoading]       = useState(false);
  const [signingOff, setSigningOff] = useState(false);
  const [error, setError]           = useState('');

  useEffect(() => {
    if (myUnit) {
      setUnitNumber(myUnit.unitNumber);
      setDepartment(myUnit.department);
      setRole(myUnit.division ?? DOC_ROLES[0]);
      localStorage.setItem('doc_unit_pref', JSON.stringify({
        unitNumber: myUnit.unitNumber,
        department: myUnit.department,
        division:   myUnit.division ?? DOC_ROLES[0],
      }));
    }
  }, [myUnit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = (unitNumber || callsign).trim();
    setLoading(true);
    setError('');
    try {
      await onSignOn(trimmed, department, role);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update unit.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOff = async () => {
    setSigningOff(true);
    try { await onSignOff(); } finally { setSigningOff(false); }
  };

  const initials = callsign.slice(0, 2).toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-[380px] rounded-xl border border-[#1a2e4a] bg-[#0a1220] shadow-2xl overflow-hidden">

        {/* ── Window chrome ── */}
        <div className="flex items-center gap-1.5 bg-[#06101a] px-4 py-2.5 border-b border-[#0f1c2e]">
          <button type="button" onClick={onClose}
            className="h-3 w-3 rounded-full bg-red-500/70 hover:bg-red-500 transition-colors" />
          <div className="h-3 w-3 rounded-full bg-[#1a2e4a]" />
          <div className="h-3 w-3 rounded-full bg-[#1a2e4a]" />
          <span className="mx-auto text-[10px] font-black uppercase tracking-[0.3em] text-[#2a4060]">CAD · Unit Manager</span>
        </div>

        {/* ── Identity card ── */}
        <div className="flex flex-col items-center gap-3 px-8 pt-8 pb-6 border-b border-[#0f1c2e]">
          {/* Avatar */}
          <div className="relative">
            <div className="h-20 w-20 rounded-full border-2 border-[#1a3060] bg-[#060f20] overflow-hidden shadow-[0_0_24px_rgba(67,132,255,0.15)]">
              {avatarUrl
                ? <img src={avatarUrl} alt={callsign} className="h-full w-full object-cover" />
                : <div className="flex h-full w-full items-center justify-center text-2xl font-black text-[#4384ff]">{initials}</div>
              }
            </div>
            {/* Online dot */}
            <span className="absolute bottom-0.5 right-0.5 h-4 w-4 rounded-full border-2 border-[#0a1220] bg-emerald-500" />
          </div>
          {/* Name + rank */}
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[15px] font-black text-white tracking-wide">{callsign}</span>
            <span className="text-[9px] font-black uppercase tracking-[0.28em] text-[#4384ff]">{rank}</span>
          </div>
          {/* Current unit badge (if signed on) */}
          {myUnit && (
            <div className="flex items-center gap-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
              <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400">
                Unit {myUnit.unitNumber} · {myUnit.department.split(' ')[0]}
              </span>
            </div>
          )}
        </div>

        {/* ── Sign-on form ── */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 px-8 py-6">
          {/* Role */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[8px] font-black uppercase tracking-[0.25em] text-[#3a5070]">Role</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              className="h-9 rounded-md border border-[#1a2e4a] bg-[#060f1e] px-3 text-[11px] font-semibold text-white outline-none focus:border-[#2f70ff] focus:shadow-[0_0_0_2px_rgba(47,112,255,0.15)] transition-all appearance-none"
            >
              {DOC_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {/* Department */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[8px] font-black uppercase tracking-[0.25em] text-[#3a5070]">Department</label>
            <select
              value={department}
              onChange={e => setDepartment(e.target.value)}
              className="h-9 rounded-md border border-[#1a2e4a] bg-[#060f1e] px-3 text-[11px] font-semibold text-white outline-none focus:border-[#2f70ff] focus:shadow-[0_0_0_2px_rgba(47,112,255,0.15)] transition-all appearance-none"
            >
              <option value="Department of Communications">Department of Communications</option>
              <option value="Department of Public Health" disabled style={{ color: '#3a5070' }}>
                Department of Public Health (Coming Soon)
              </option>
            </select>
          </div>

          {error && (
            <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[10px] text-red-400">{error}</p>
          )}

          {/* Actions */}
          <div className="flex gap-2 mt-1">
            {myUnit && (
              <button type="button" onClick={handleSignOff} disabled={signingOff}
                className="flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-red-400 hover:bg-red-500/15 disabled:opacity-50 transition-colors">
                <LogOut className="h-3 w-3" />
                {signingOff ? 'Off…' : 'Sign Off'}
              </button>
            )}
            <button type="submit" disabled={loading || !unitNumber.trim()}
              className="flex-1 flex items-center justify-center gap-2 rounded-md border border-[#2f70ff]/50 bg-[#2f70ff]/15 py-2 text-[10px] font-black uppercase tracking-widest text-[#4384ff] hover:bg-[#2f70ff]/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-[0_0_16px_rgba(47,112,255,0.12)]">
              {loading ? 'Saving…' : myUnit ? 'Update Unit' : '10-41 · Sign On'}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}

// ── Unit group context menu ────────────────────────────────────────────────────
const GROUP_DOT: string[] = [
  'bg-[#4384ff]', 'bg-emerald-400', 'bg-purple-400', 'bg-yellow-400', 'bg-orange-400',
];

const PANEL_STATUSES: UnitStatus[] = ['Available', 'Unavailable', 'Busy', 'Enroute', 'On-Scene'];

function UnitContextMenu({
  x, y, unit, groups, onClose, onStatusChange, onCallsignEdit, onGroupAssign,
}: {
  x: number; y: number;
  unit: ActiveUnit;
  groups: UnitGroup[];
  onClose: () => void;
  onStatusChange: (status: UnitStatus) => void;
  onCallsignEdit: (unitNumber: string) => Promise<void>;
  onGroupAssign: (groupId: string | null) => void;
}) {
  const [editNum, setEditNum] = useState(unit.unitNumber);
  const [saving, setSaving]   = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', handler);
    window.addEventListener('contextmenu', handler);
    return () => { window.removeEventListener('mousedown', handler); window.removeEventListener('contextmenu', handler); };
  }, [onClose]);

  const currentGroup = groups.find(g => g.memberUsernames.includes(unit.username));

  const left = Math.min(x, window.innerWidth  - 264);
  const top  = Math.min(y, window.innerHeight - 420);

  const handleSave = async () => {
    const trimmed = editNum.trim();
    if (!trimmed || trimmed === unit.unitNumber) return;
    setSaving(true);
    try { await onCallsignEdit(trimmed); onClose(); } finally { setSaving(false); }
  };

  const statusCls = (s: UnitStatus) =>
    s === 'Available'   ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' :
    s === 'Busy'        ? 'border-orange-500/40 bg-orange-500/10 text-orange-400'   :
    s === 'Unavailable' ? 'border-red-500/40 bg-red-500/10 text-red-400'            :
    s === 'Enroute'     ? 'border-blue-500/40 bg-blue-500/10 text-blue-400'          :
                          'border-purple-500/40 bg-purple-500/10 text-purple-400';

  return (
    <div
      ref={panelRef}
      className="fixed z-[200] w-[252px] rounded-lg border border-[#1a2e4a] bg-[#07111e] shadow-2xl overflow-hidden"
      style={{ left, top }}
      onContextMenu={e => e.preventDefault()}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#0f1c2e] bg-[#030912] px-3.5 py-2.5">
        <div>
          <p className="text-[10px] font-black text-white">{unit.callsign}</p>
          <p className="text-[8px] text-[#3a5070]">Unit {unit.unitNumber}</p>
        </div>
        <StatusBadge status={unit.status} />
      </div>

      {/* Status */}
      <div className="border-b border-[#0f1c2e] px-3.5 py-2.5">
        <p className="mb-1.5 text-[8px] font-black uppercase tracking-[0.2em] text-[#3a5070]">Status</p>
        <div className="flex flex-wrap gap-1">
          {PANEL_STATUSES.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => { onStatusChange(s); onClose(); }}
              className={`rounded border px-2 py-0.5 text-[8px] font-black uppercase tracking-wider transition-colors ${
                unit.status === s
                  ? statusCls(s)
                  : 'border-[#1a2e4a] text-[#526179] hover:border-[#2a3a50] hover:text-[#7a9bbf]'
              }`}
            >{s}</button>
          ))}
        </div>
      </div>

      {/* Edit callsign */}
      <div className="border-b border-[#0f1c2e] px-3.5 py-2.5">
        <p className="mb-1.5 text-[8px] font-black uppercase tracking-[0.2em] text-[#3a5070]">Callsign</p>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={editNum}
            onChange={e => setEditNum(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
            className="min-w-0 flex-1 rounded border border-[#1a2e4a] bg-[#060f1e] px-2 py-1 text-[10px] font-semibold text-white outline-none focus:border-[#2f70ff] transition-colors"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !editNum.trim() || editNum.trim() === unit.unitNumber}
            className="rounded border border-[#2f70ff]/40 bg-[#2f70ff]/10 px-2.5 py-1 text-[9px] font-black text-[#4384ff] transition-colors hover:bg-[#2f70ff]/20 disabled:cursor-not-allowed disabled:opacity-40"
          >{saving ? '…' : 'Save'}</button>
        </div>
      </div>

      {/* Group */}
      <div className="px-3.5 py-2.5">
        <p className="mb-1.5 text-[8px] font-black uppercase tracking-[0.2em] text-[#3a5070]">Group</p>
        {groups.length === 0 ? (
          <p className="text-[9px] text-[#3a5070]">No active groups</p>
        ) : (
          <div className="flex flex-col gap-1">
            {groups.map((g, i) => {
              const isInThis = g.id === currentGroup?.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => { onGroupAssign(isInThis ? null : g.id); onClose(); }}
                  className={`flex items-center gap-2 rounded border px-2.5 py-1.5 text-[9px] font-semibold transition-colors text-left ${
                    isInThis
                      ? 'border-[#4384ff]/40 bg-[#4384ff]/10 text-[#4384ff]'
                      : 'border-[#1a2e4a] text-[#7a9bbf] hover:border-[#2a3a50] hover:bg-[#060f1e]'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${GROUP_DOT[i % GROUP_DOT.length]}`} />
                  Group {i + 1}
                  {isInThis && <span className="ml-auto text-[8px] text-[#3a5070]">Remove</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Group invite toast ─────────────────────────────────────────────────────────
function GroupInviteToast({
  invite, onAccept, onDecline,
}: { invite: GroupInvite; onAccept: () => void; onDecline: () => void }) {
  return (
    <div className="fixed bottom-10 right-4 z-[300] w-[300px] rounded-xl border border-[#4384ff]/40 bg-[#050e1c] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4">
      <div className="flex items-center gap-2 border-b border-[#0d1c2e] bg-[#030912] px-4 py-2.5">
        <UserPlus className="h-3.5 w-3.5 text-[#4384ff]" />
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Group Invite</span>
      </div>
      <div className="px-4 py-3">
        <p className="text-[11px] text-[#8aadcf] leading-relaxed">
          <span className="font-black text-white">{invite.fromCallsign}</span>
          <span className="text-[#3a5070]"> (Unit {invite.fromUnitNumber})</span>
          {' '}wants to add you to their group.
        </p>
      </div>
      <div className="flex gap-2 border-t border-[#0d1c2e] px-4 py-2.5">
        <button
          type="button"
          onClick={onDecline}
          className="flex flex-1 items-center justify-center gap-1.5 rounded border border-red-500/30 bg-red-500/10 py-1.5 text-[9px] font-black uppercase tracking-widest text-red-400 hover:bg-red-500/20 transition-colors"
        >
          <XCircle className="h-3 w-3" /> Decline
        </button>
        <button
          type="button"
          onClick={onAccept}
          className="flex flex-1 items-center justify-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 py-1.5 text-[9px] font-black uppercase tracking-widest text-emerald-400 hover:bg-emerald-500/20 transition-colors"
        >
          <Check className="h-3 w-3" /> Accept
        </button>
      </div>
    </div>
  );
}

// ── Unit row (signed-on units) ─────────────────────────────────────────────────
const GROUP_COLOURS = [
  'border-[#4384ff]/50 bg-[#4384ff]/10 text-[#4384ff]',
  'border-emerald-500/50 bg-emerald-500/10 text-emerald-400',
  'border-purple-500/50 bg-purple-500/10 text-purple-400',
  'border-yellow-500/50 bg-yellow-500/10 text-yellow-400',
  'border-orange-500/50 bg-orange-500/10 text-orange-400',
];

function UnitRow({
  unit, isOwn, unitGroups, allGroups, onStatusChange, onCallsignEdit, onGroupAssign,
}: {
  unit: ActiveUnit;
  isOwn: boolean;
  unitGroups: UnitGroup[];
  allGroups: UnitGroup[];
  onStatusChange: (userId: number, status: UnitStatus) => void;
  onCallsignEdit: (userId: number, unitNumber: string) => Promise<void>;
  onGroupAssign: (username: string, groupId: string | null) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const group = unitGroups.find(g => g.memberUsernames.includes(unit.username));
  const groupIndex = group ? allGroups.findIndex(g => g.id === group.id) : -1;
  const groupColour = groupIndex >= 0 ? GROUP_COLOURS[groupIndex % GROUP_COLOURS.length] : '';

  const handleClick = (e: React.MouseEvent) => {
    setMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <div
        onClick={handleClick}
        className={`flex items-center gap-0 border-b border-[#060e18] px-4 py-2 text-xs transition-colors cursor-default select-none ${isOwn ? 'bg-[#040d1e]' : 'hover:bg-[#030810]'}`}
      >
        <span className="flex-1 min-w-0 font-black text-[#4384ff]">{unit.unitNumber}</span>
        <span className="flex-1 min-w-0 font-semibold text-white truncate flex items-center gap-1.5">
          {unit.callsign}
          {isOwn && <span className="text-[9px] font-black uppercase tracking-widest text-[#2a3a50]">(you)</span>}
          {group && (
            <span className={`rounded border px-1.5 py-0.5 text-[7px] font-black uppercase tracking-widest ${groupColour}`}>
              GRP {groupIndex + 1}
            </span>
          )}
        </span>
        <span className="flex-1 min-w-0 text-white truncate">{unit.rank}</span>
        <span className="flex-1 min-w-0 text-white truncate">{unit.location || '—'}</span>
        <span className="flex-1 min-w-0 text-white truncate">{unit.department}</span>
        <span className="flex-1 min-w-0 text-white truncate">{unit.division || '—'}</span>
        <div className="flex-1 min-w-0">
          <StatusBadge status={unit.status} />
        </div>
      </div>

      {menu && (
        <UnitContextMenu
          x={menu.x} y={menu.y}
          unit={unit}
          groups={allGroups}
          onClose={() => setMenu(null)}
          onStatusChange={s => onStatusChange(unit.userId, s)}
          onCallsignEdit={num => onCallsignEdit(unit.userId, num)}
          onGroupAssign={gid => onGroupAssign(unit.username, gid)}
        />
      )}
    </>
  );
}

// ── Call history types ─────────────────────────────────────────────────────────
interface CallHistoryEvent {
  id: number;
  call_id: number;
  event_type: string;
  description: string | null;
  actor: string | null;
  created_at: string;
}

// ── Event icon + colour mapping ────────────────────────────────────────────────
function eventMeta(eventType: string): { icon: React.ElementType; colour: string; dot: string } {
  switch (eventType) {
    case 'call_created':   return { icon: FilePlus,         colour: 'text-[#4384ff]',   dot: 'bg-[#4384ff]' };
    case 'status_changed': return { icon: ArrowRightLeft,   colour: 'text-yellow-400',  dot: 'bg-yellow-400' };
    case 'units_assigned': return { icon: PlusCircle,       colour: 'text-emerald-400', dot: 'bg-emerald-400' };
    case 'units_added':    return { icon: PlusCircle,       colour: 'text-emerald-400', dot: 'bg-emerald-400' };
    case 'units_removed':  return { icon: MinusCircle,      colour: 'text-red-400',     dot: 'bg-red-400' };
    case 'call_edited':    return { icon: Pencil,           colour: 'text-sky-400',     dot: 'bg-sky-400' };
    default:               return { icon: Clock,            colour: 'text-[#3a5070]',   dot: 'bg-[#3a5070]' };
  }
}

// ── Edit call modal ────────────────────────────────────────────────────────────
function EditCallModal({ call, units, actor, onClose, onSaved }: {
  call: ManualCall; units: ActiveUnit[]; actor: string;
  onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    origin:      call.origin,
    status:      call.status,
    location:    call.location ?? '',
    ten_code:    call.ten_code ?? '',
    description: call.description ?? '',
    priority:    call.priority,
  });
  const [selectedUnits, setSelectedUnits] = useState<string[]>(call.units ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string, v: string | number) => setForm(f => ({ ...f, [k]: v }));
  const toggleUnit = (cs: string) => setSelectedUnits(p => p.includes(cs) ? p.filter(u => u !== cs) : [...p, cs]);

  const labelCls  = 'text-[8px] font-black uppercase tracking-[0.25em] text-[#3a5070]';
  const inputCls  = 'w-full rounded border border-[#1a2e4a] bg-[#060f1e] px-3 py-2 text-[11px] font-semibold text-white placeholder:text-[#1e3050] outline-none focus:border-[#2f70ff] transition-colors';
  const selectCls = `${inputCls} appearance-none cursor-pointer`;

  const handleSave = async () => {
    if (!form.origin.trim()) { setError('Origin is required.'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/cad/calls/${call.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          origin:      form.origin.trim(),
          status:      form.status,
          location:    form.location.trim() || null,
          ten_code:    form.ten_code.trim() || null,
          units:       selectedUnits,
          description: form.description.trim() || null,
          priority:    form.priority,
          actor,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.error ?? 'Failed to save.'); }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const CALL_STATUSES = ['Pending', 'Active', 'On-Scene', 'Closed'];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-sm">
      <div className="w-[500px] max-h-[88vh] flex flex-col rounded-xl border border-[#1a2e4a] bg-[#0a1220] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-[#0f1c2e] bg-[#060e1c] px-5 py-3 shrink-0">
          <Pencil className="h-3.5 w-3.5 text-[#4384ff]" />
          <span className="text-[11px] font-black uppercase tracking-[0.22em] text-white">Edit Call <span className="text-[#3a5070]">#{call.id}</span></span>
          <button type="button" onClick={onClose} className="ml-auto h-2.5 w-2.5 rounded-full bg-red-500/70 hover:bg-red-500 transition-colors" />
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1"><label className={labelCls}>Origin / Caller</label>
              <input value={form.origin} onChange={e => set('origin', e.target.value)} className={inputCls} placeholder="Nature of call…" />
            </div>
            <div className="flex flex-col gap-1"><label className={labelCls}>Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className={selectCls}>
                {CALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1"><label className={labelCls}>Location</label>
              <input value={form.location} onChange={e => set('location', e.target.value)} className={inputCls} placeholder="Street or area…" />
            </div>
            <div className="flex flex-col gap-1"><label className={labelCls}>10-Code</label>
              <input value={form.ten_code} onChange={e => set('ten_code', e.target.value)} className={inputCls} placeholder="e.g. 10-54" />
            </div>
          </div>
          <div className="flex flex-col gap-1"><label className={labelCls}>Priority</label>
            <select value={form.priority} onChange={e => set('priority', Number(e.target.value))} className={selectCls}>
              <option value={1}>P1 — Emergency</option>
              <option value={2}>P2 — High</option>
              <option value={3}>P3 — Medium</option>
              <option value={4}>P4 — Low</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Units {selectedUnits.length > 0 && <span className="ml-1.5 rounded bg-[#4384ff]/20 px-1 py-px text-[8px] text-[#4384ff]">{selectedUnits.length}</span>}</label>
            {units.length === 0
              ? <p className="text-[10px] italic text-[#3a5070]">No units signed on.</p>
              : <div className="max-h-[100px] overflow-y-auto rounded border border-[#1a2e4a] bg-[#060f1e] p-1.5 space-y-0.5">
                  {units.map(u => {
                    const checked = selectedUnits.includes(u.callsign);
                    return (
                      <button key={u.userId} type="button" onClick={() => toggleUnit(u.callsign)}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${checked ? 'bg-[#4384ff]/15 text-white' : 'text-[#66748a] hover:bg-[#0a1a30]'}`}>
                        <span className={`h-3.5 w-3.5 shrink-0 rounded border flex items-center justify-center text-[8px] font-black ${checked ? 'border-[#4384ff] bg-[#4384ff] text-white' : 'border-[#1a2e4a]'}`}>{checked && '✓'}</span>
                        <span className="text-[10px] font-black">{u.callsign}</span>
                        <span className="text-[9px] text-[#3a5070]">{u.rank}</span>
                      </button>
                    );
                  })}
                </div>
            }
          </div>
          <div className="flex flex-col gap-1"><label className={labelCls}>Description</label>
            <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)}
              placeholder="Details about the call…" className={`${inputCls} resize-none`} />
          </div>
          {error && <p className="text-[10px] font-bold text-red-400">{error}</p>}
        </div>
        {/* Footer */}
        <div className="flex gap-2 border-t border-[#0f1c2e] px-5 py-3 shrink-0">
          <button type="button" onClick={onClose}
            className="rounded-md border border-[#1a2e4a] bg-[#060f1e] px-4 py-2 text-[9px] font-black uppercase tracking-widest text-[#3a5070] hover:text-white transition-colors">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving}
            className="flex-1 rounded-md border border-[#2f70ff]/50 bg-[#2f70ff]/15 py-2 text-[10px] font-black uppercase tracking-widest text-[#4384ff] hover:bg-[#2f70ff]/25 disabled:opacity-40 transition-colors">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Call row ──────────────────────────────────────────────────────────────────
function CallRow({ call, onRefresh, activeUnits, myCallsign }: {
  call: ManualCall; onRefresh: () => void; activeUnits: ActiveUnit[]; myCallsign: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<CallHistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const [closing, setClosing] = useState(false);
  const [removing, setRemoving] = useState(false);

  const priorityLabel = PRIORITY_LABEL[call.priority] ?? `P${call.priority}`;
  const priorityColor = PRIORITY_COLOR[call.priority] ?? 'text-[#3a5070]';
  const PRIORITY_BG: Record<number, string> = {
    1: 'border-red-500/40 bg-red-500/10 text-red-400',
    2: 'border-orange-500/40 bg-orange-500/10 text-orange-400',
    3: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-400',
    4: 'border-sky-500/40 bg-sky-500/10 text-sky-400',
  };
  const priorityBadgeCls = PRIORITY_BG[call.priority] ?? 'border-[#1a3060] bg-[#0a1830] text-[#4384ff]';

  const createdAt = call.created_at
    ? new Date(call.created_at).toLocaleString('en-US', {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
      })
    : null;

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError('');
    fetch(`/api/cad/calls/${call.id}/history`, { headers: { accept: 'application/json' } })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then((data: CallHistoryEvent[]) => { if (!cancelled) setHistory(data); })
      .catch(() => { if (!cancelled) setHistoryError('Failed to load history.'); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [expanded, call.id]);

  const handleClose = async () => {
    if (closing) return;
    setClosing(true);
    try {
      await fetch(`/api/cad/calls/${call.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'Closed', actor: myCallsign }),
      });
      onRefresh();
    } catch { /* ignore */ } finally { setClosing(false); }
  };

  const handleRemove = async () => {
    if (removing) return;
    if (!window.confirm(`Remove call #${call.id} from Active Calls? It will still appear in Call History.`)) return;
    setRemoving(true);
    try {
      await fetch(`/api/cad/calls/${call.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'Removed', actor: myCallsign }),
      });
      onRefresh();
    } catch { /* ignore */ } finally { setRemoving(false); }
  };

  const isClosed = call.status === 'Closed';

  return (
    <>
      {showEdit && (
        <EditCallModal
          call={call} units={activeUnits} actor={myCallsign}
          onClose={() => setShowEdit(false)}
          onSaved={onRefresh}
        />
      )}
      <div className="border-b border-[#060e1a]">
      {/* ── Summary row ── */}
      <div className={`flex items-center transition-colors ${expanded ? 'bg-[#04101e]' : 'hover:bg-[#030a14]'}`}>
        {/* Expand toggle */}
        <button
          type="button"
          onClick={() => setExpanded(o => !o)}
          className="flex flex-1 items-center gap-0 px-4 py-2 text-left min-w-0"
        >
          <span className="flex-[0.6] min-w-0 text-xs font-black text-[#f4c542] tabular-nums truncate">
            #{call.id}
          </span>
          <span className="flex-1 min-w-0 text-xs font-semibold text-white truncate">
            {call.origin}
          </span>
          <span className="flex-[1.2] min-w-0 text-xs text-[#66748a] truncate">
            {call.location || '—'}
          </span>
          <span className="flex-[0.7] min-w-0 text-xs font-black text-[#3a5070] truncate">
            {call.ten_code || '—'}
          </span>
          <span className="flex-[1.2] min-w-0 text-xs text-[#66748a] truncate">
            {call.units?.join(', ') || '—'}
          </span>
          <span className={`flex-[0.5] min-w-0 text-xs font-black tabular-nums truncate ${priorityColor}`}>
            {priorityLabel}
          </span>
          <span className="flex-[0.8] min-w-0 flex items-center gap-1.5">
            <CallStatusBadge status={call.status} />
            <ChevronDown className={`h-3 w-3 text-[#2a3a50] shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
          </span>
        </button>
        {/* Action buttons */}
        <div className="w-24 shrink-0 flex items-center justify-end gap-1 pr-3">
          <button
            type="button"
            title="Edit call"
            onClick={() => setShowEdit(true)}
            className="rounded p-1 text-[#3a5070] hover:bg-[#0a1830] hover:text-[#4384ff] transition-colors"
          >
            <Pencil className="h-3 w-3" />
          </button>
          {!isClosed && (
            <button
              type="button"
              title="Close call"
              onClick={handleClose}
              disabled={closing}
              className="rounded p-1 text-[#3a5070] hover:bg-red-500/10 hover:text-red-400 transition-colors disabled:opacity-40"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            title="Remove from list"
            onClick={handleRemove}
            disabled={removing}
            className="rounded p-1 text-[#3a5070] hover:bg-red-900/20 hover:text-red-500 transition-colors disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* ── Expanded detail panel ── */}
      {expanded && (
        <div className="px-4 py-3 bg-[#02070f] border-t border-[#060e1a] flex flex-col gap-3">

          {/* Description */}
          <div className="flex flex-col gap-1">
            <span className="text-[9px] font-black uppercase tracking-[0.25em] text-[#3a5070]">Description</span>
            {call.description ? (
              <p className="text-[11px] font-semibold text-[#aab8cc] leading-relaxed whitespace-pre-wrap">
                {call.description}
              </p>
            ) : (
              <p className="text-[10px] italic text-[#2a3a50]">No description provided.</p>
            )}
          </div>

          {/* Units */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[9px] font-black uppercase tracking-[0.25em] text-[#3a5070]">Assigned Units</span>
            {call.units && call.units.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {call.units.map((u, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center rounded border border-[#1a3060] bg-[#0a1830] px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-[#4384ff]"
                  >
                    {u}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[10px] italic text-[#2a3a50]">No units assigned.</p>
            )}
          </div>

          {/* Meta row: priority + created-by + created-at */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Priority badge */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#3a5070]">Priority</span>
              <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${priorityBadgeCls}`}>
                {priorityLabel}
              </span>
            </div>

            {/* Divider */}
            <span className="h-3 w-px bg-[#0f1c2e]" />

            {/* Created by */}
            {call.created_by && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#3a5070]">Created by</span>
                  <span className="text-[10px] font-semibold text-[#aab8cc]">{call.created_by}</span>
                </div>
                <span className="h-3 w-px bg-[#0f1c2e]" />
              </>
            )}

            {/* Created at */}
            {createdAt && (
              <div className="flex items-center gap-1.5">
                <Clock className="h-3 w-3 text-[#2a3a50]" />
                <span className="text-[10px] font-semibold text-[#66748a]">{createdAt}</span>
              </div>
            )}
          </div>

          {/* ── Call History Timeline ── */}
          <div className="flex flex-col gap-1.5 border-t border-[#060e1a] pt-3">
            <div className="flex items-center gap-1.5 mb-1">
              <History className="h-3 w-3 text-[#3a5070]" />
              <span className="text-[9px] font-black uppercase tracking-[0.25em] text-[#3a5070]">Call Log</span>
            </div>

            {historyLoading && (
              <div className="flex items-center gap-2 py-2">
                <RefreshCw className="h-3 w-3 text-[#2a3a50] animate-spin" />
                <span className="text-[10px] text-[#2a3a50]">Loading history…</span>
              </div>
            )}

            {historyError && !historyLoading && (
              <p className="text-[10px] text-red-400/70 italic">{historyError}</p>
            )}

            {!historyLoading && !historyError && history.length === 0 && (
              <div className="flex items-center gap-2 py-2">
                <History className="h-4 w-4 text-[#0d1a2a]" />
                <p className="text-[10px] italic text-[#1e2e42]">No history recorded for this call.</p>
              </div>
            )}

            {!historyLoading && !historyError && history.length > 0 && (
              <div className="relative flex flex-col">
                {/* Vertical timeline line */}
                <div className="absolute left-[6px] top-2 bottom-2 w-px bg-[#0d1c2e]" />

                {history.map((evt, idx) => {
                  const { icon: EvtIcon, colour, dot } = eventMeta(evt.event_type);
                  const ts = new Date(evt.created_at).toLocaleString('en-US', {
                    month: 'short', day: 'numeric',
                    hour: '2-digit', minute: '2-digit', hour12: false,
                  });
                  return (
                    <div key={evt.id} className={`flex items-start gap-3 pl-1 ${idx < history.length - 1 ? 'pb-2.5' : ''}`}>
                      {/* Dot */}
                      <div className={`relative z-10 mt-[3px] h-3 w-3 rounded-full shrink-0 ${dot} shadow-[0_0_6px_rgba(0,0,0,0.6)]`} />

                      {/* Content */}
                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <EvtIcon className={`h-2.5 w-2.5 shrink-0 ${colour}`} />
                          <span className={`text-[10px] font-semibold leading-tight ${colour}`}>
                            {evt.description ?? evt.event_type}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] text-[#2a3a50] tabular-nums">{ts}</span>
                          {evt.actor && (
                            <>
                              <span className="text-[9px] text-[#1a2a3a]">·</span>
                              <span className="text-[9px] text-[#3a5070]">{evt.actor}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
    </>
  );
}

// ── Group row ─────────────────────────────────────────────────────────────────
function GroupRow({ group }: { group: CadGroup }) {
  return (
    <div className="flex items-center gap-0 border-b border-[#060e1a] px-4 py-2 hover:bg-[#030a14] transition-colors">
      <span className="flex-1 min-w-0 text-xs font-black text-[#8b5cf6] truncate">
        {group.name}
        <span className="ml-1.5 text-[10px] font-semibold text-[#3a5070]">
          ({group.count})
        </span>
      </span>
      <span className="flex-1 min-w-0 text-xs text-[#3a5070] truncate">
        {group.location}
      </span>
      <span className="flex-1 min-w-0 text-xs text-[#3a5070] truncate">
        {group.department}
      </span>
      <span className="flex-1 min-w-0 text-xs text-[#3a5070] truncate">—</span>
      <span className="flex-1 min-w-0">
        <span className="inline-flex items-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
          {group.status}
        </span>
      </span>
    </div>
  );
}

// ── Skeleton loader ────────────────────────────────────────────────────────────
// ── Call History Modal (standalone DB search view) ────────────────────────────
function CallHistoryModal({ onClose }: { onClose: () => void }) {
  const [calls, setCalls] = useState<ManualCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [history, setHistory] = useState<CallHistoryEvent[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [histError, setHistError] = useState('');
  const [deleting, setDeleting] = useState<number | null>(null);

  const loadCalls = () => {
    fetch('/api/cad/calls', { headers: { accept: 'application/json' } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setCalls)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadCalls(); }, []);

  const toggle = (id: number) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    setHistory([]);
    setHistError('');
    setHistLoading(true);
    fetch(`/api/cad/calls/${id}/history`, { headers: { accept: 'application/json' } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: CallHistoryEvent[]) => setHistory(data))
      .catch(() => setHistError('Failed to load history.'))
      .finally(() => setHistLoading(false));
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm(`Permanently delete call #${id} and all its history?`)) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/cad/calls/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setCalls(prev => prev.filter(c => c.id !== id));
        if (expanded === id) setExpanded(null);
      }
    } catch { /* ignore */ } finally { setDeleting(null); }
  };

  const q = search.toLowerCase();
  const filtered = calls.filter(c =>
    !q
    || String(c.id).includes(q)
    || c.origin.toLowerCase().includes(q)
    || (c.location ?? '').toLowerCase().includes(q)
    || (c.ten_code ?? '').toLowerCase().includes(q)
    || (c.description ?? '').toLowerCase().includes(q)
    || c.status.toLowerCase().includes(q)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-[680px] max-h-[88vh] flex flex-col rounded-lg border border-[#1a2e4a] bg-[#0d1520] shadow-2xl overflow-hidden">

        {/* Title bar */}
        <div className="flex items-center gap-2 border-b border-[#0f1c2e] bg-[#08111e] px-4 py-2.5 shrink-0">
          <History className="h-3.5 w-3.5 text-[#f4c542]" />
          <span className="text-[11px] font-black uppercase tracking-[0.22em] text-white">Call History</span>
          <span className={`rounded border px-1.5 py-px text-[9px] font-black ml-1 ${filtered.length > 0 ? 'border-[#1a3060] bg-[#0a1830] text-[#4384ff]' : 'border-[#0d1c2e] bg-[#040a14] text-[#2a3a50]'}`}>
            {filtered.length}
          </span>
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#2a3a50]" />
            <input
              type="text"
              placeholder="Search calls…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-6 w-40 rounded border border-[#0d1c2e] bg-[#02060b] pl-6 pr-2 text-[10px] font-semibold text-white placeholder:text-[#1e2e42] outline-none focus:border-[#2f70ff] transition-colors"
            />
          </div>
          <button type="button" onClick={onClose}
            className="ml-2 h-2.5 w-2.5 rounded-full bg-red-500/70 hover:bg-red-500 transition-colors"
            aria-label="Close" />
        </div>

        {/* Column headers */}
        <div className="flex gap-0 border-b border-[#0a1520] bg-[#030912] px-4 py-1.5 shrink-0">
          {['ID', 'Origin', 'Location', '10-Code', 'Priority', 'Status'].map(c => (
            <span key={c} className="flex-1 min-w-0 text-[10px] font-black uppercase tracking-[0.28em] text-white">{c}</span>
          ))}
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto bg-[#02060b]">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <span className="text-[10px] text-[#3a5070] animate-pulse">Loading calls…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1.5 py-10">
              <History className="h-7 w-7 text-[#0d1a2a] mb-1" />
              <p className="text-[11px] font-bold text-[#1e2e42]">No calls found</p>
              <p className="text-[10px] text-[#131e2d]">Create a call from the CAD terminal</p>
            </div>
          ) : (
            filtered.map(call => {
              const isOpen = expanded === call.id;
              const pColor = PRIORITY_COLOR[call.priority] ?? 'text-[#3a5070]';
              const pLabel = PRIORITY_LABEL[call.priority] ?? `P${call.priority}`;
              const createdAt = call.created_at
                ? new Date(call.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
                : null;

              return (
                <div key={call.id} className="border-b border-[#060e1a]">
                  {/* Summary row */}
                  <div className={`flex items-center transition-colors ${isOpen ? 'bg-[#04101e]' : 'hover:bg-[#030a14]'}`}>
                    <button
                      type="button"
                      onClick={() => toggle(call.id)}
                      className="flex flex-1 items-center gap-0 px-4 py-2 text-left min-w-0"
                    >
                      <span className="flex-1 min-w-0 text-xs font-black text-[#f4c542] tabular-nums truncate">#{call.id}</span>
                      <span className="flex-1 min-w-0 text-xs font-semibold text-white truncate">{call.origin}</span>
                      <span className="flex-1 min-w-0 text-xs text-[#66748a] truncate">{call.location || '—'}</span>
                      <span className="flex-1 min-w-0 text-xs font-black text-[#3a5070] truncate">{call.ten_code || '—'}</span>
                      <span className={`flex-1 min-w-0 text-xs font-black truncate ${pColor}`}>{pLabel}</span>
                      <span className="flex-1 min-w-0 flex items-center gap-1.5">
                        <CallStatusBadge status={call.status} />
                        <ChevronDown className={`h-3 w-3 text-[#2a3a50] shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                      </span>
                    </button>
                    {/* Delete button */}
                    <button
                      type="button"
                      title="Delete call log"
                      onClick={() => handleDelete(call.id)}
                      disabled={deleting === call.id}
                      className="shrink-0 mr-3 rounded p-1 text-[#3a5070] hover:bg-red-500/10 hover:text-red-400 transition-colors disabled:opacity-40"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Expanded panel */}
                  {isOpen && (
                    <div className="px-4 py-3 bg-[#02070f] border-t border-[#060e1a] flex flex-col gap-3">
                      {/* Meta */}
                      <div className="flex flex-wrap gap-4">
                        {call.description && (
                          <div className="flex flex-col gap-0.5 flex-1 min-w-[200px]">
                            <span className="text-[9px] font-black uppercase tracking-[0.25em] text-[#3a5070]">Description</span>
                            <p className="text-[11px] font-semibold text-[#aab8cc] leading-relaxed whitespace-pre-wrap">{call.description}</p>
                          </div>
                        )}
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] font-black uppercase tracking-[0.25em] text-[#3a5070]">Created</span>
                          <span className="text-[10px] font-semibold text-[#66748a]">{createdAt ?? '—'}</span>
                          {call.created_by && (
                            <span className="text-[10px] text-[#3a5070]">by {call.created_by}</span>
                          )}
                        </div>
                        {call.units && call.units.length > 0 && (
                          <div className="flex flex-col gap-1">
                            <span className="text-[9px] font-black uppercase tracking-[0.25em] text-[#3a5070]">Units</span>
                            <div className="flex flex-wrap gap-1">
                              {call.units.map((u, i) => (
                                <span key={i} className="rounded border border-[#1a3060] bg-[#0a1830] px-2 py-0.5 text-[9px] font-black text-[#4384ff]">{u}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* History log */}
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[9px] font-black uppercase tracking-[0.25em] text-[#3a5070]">Event Log</span>
                        {histLoading ? (
                          <p className="text-[10px] text-[#3a5070] animate-pulse">Loading…</p>
                        ) : histError ? (
                          <p className="text-[10px] text-red-400">{histError}</p>
                        ) : history.length === 0 ? (
                          <p className="text-[10px] italic text-[#2a3a50]">No events logged.</p>
                        ) : (
                          <div className="flex flex-col gap-0 relative">
                            <div className="absolute left-[5px] top-2 bottom-2 w-px bg-[#0f1c2e]" />
                            {history.map((ev, i) => {
                              const { icon: EvIcon, colour, dot } = eventMeta(ev.event_type);
                              const ts = new Date(ev.created_at).toLocaleString('en-US', {
                                month: 'short', day: 'numeric',
                                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
                              });
                              return (
                                <div key={ev.id} className="flex items-start gap-3 py-1.5 relative">
                                  <span className={`relative z-10 mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
                                  <EvIcon className={`h-3.5 w-3.5 shrink-0 mt-px ${colour}`} />
                                  <div className="flex flex-col gap-0.5 min-w-0">
                                    <span className={`text-[10px] font-semibold ${colour}`}>{ev.description}</span>
                                    <span className="text-[9px] text-[#2a3a50]">
                                      {ts}{ev.actor ? ` · ${ev.actor}` : ''}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function DatabaseSearchModal({ onClose, onNameDb, onVehicleDb }: {
  onClose: () => void; onNameDb: () => void; onVehicleDb: () => void;
}) {
  const options = [
    { icon: User,        label: 'Name Database',     desc: 'Search persons by name',             disabled: false, action: onNameDb },
    { icon: Car,         label: 'Vehicle Database',  desc: 'Search vehicles by plate or VIN',    disabled: false, action: onVehicleDb },
    { icon: Crosshair,   label: 'Firearm Database',  desc: 'Coming Soon',                        disabled: true,  action: undefined },
    { icon: FileText,    label: 'Incident Database', desc: 'Search filed incident reports',      disabled: true,  action: undefined },
    { icon: ShieldAlert, label: 'Bolo Database',     desc: 'View and search active BOLOs',       disabled: true,  action: undefined },
    { icon: Gavel,       label: 'Warrant Database',  desc: 'Coming Soon',                        disabled: true,  action: undefined },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-[420px] rounded-lg border border-[#1a2e4a] bg-[#0d1520] shadow-2xl overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center gap-2 border-b border-[#0f1c2e] bg-[#08111e] px-4 py-2.5">
          <Database className="h-3.5 w-3.5 text-[#4384ff]" />
          <span className="text-[11px] font-black uppercase tracking-[0.22em] text-white">Database Search</span>
          <button type="button" onClick={onClose}
            className="ml-auto h-2.5 w-2.5 rounded-full bg-red-500/70 hover:bg-red-500 transition-colors"
            aria-label="Close" />
        </div>
        {/* Options */}
        <div className="flex flex-col gap-1 p-3">
          {options.map(({ icon: Icon, label, desc, disabled, action }) => (
            <button
              key={label}
              type="button"
              disabled={disabled}
              onClick={action}
              className={`flex items-center gap-3 rounded border px-4 py-3 text-left transition-colors ${
                disabled
                  ? 'cursor-not-allowed border-[#0f1c2e] bg-[#060e18] opacity-40'
                  : 'border-[#1a2e4a] bg-[#08111e] hover:border-[#2f70ff] hover:bg-[#0d1a30]'
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${disabled ? 'text-[#3a5070]' : 'text-[#4384ff]'}`} />
              <div className="flex flex-col gap-0.5">
                <span className={`text-[10px] font-black uppercase tracking-[0.18em] ${disabled ? 'text-[#3a5070]' : 'text-white'}`}>
                  {label}
                </span>
                <span className="text-[9px] font-semibold text-[#3a5070]">{desc}</span>
              </div>
              {disabled && (
                <span className="ml-auto text-[8px] font-black uppercase tracking-widest text-[#2a3a50] border border-[#1a2e4a] rounded px-1.5 py-0.5">
                  Coming Soon
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Collapsible accordion section ─────────────────────────────────────────────
function AccordionSection({
  icon: Icon, label, accent, count, children, defaultOpen = false,
}: {
  icon: React.ElementType; label: string; accent: string; count: number;
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[#0f1c2e] rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-4 py-2.5 bg-[#060e18] hover:bg-[#080f1c] transition-colors"
      >
        <Icon className={`h-3.5 w-3.5 shrink-0 ${accent}`} />
        <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${accent}`}>{label}</span>
        <span className={`rounded border px-1.5 py-px text-[9px] font-black ${count > 0 ? 'border-[#1a3060] bg-[#0a1830] text-[#4384ff]' : 'border-[#0d1c2e] bg-[#040a14] text-[#2a3a50]'}`}>
          {count}
        </span>
        <ChevronDown className={`ml-auto h-3.5 w-3.5 text-[#3a5070] transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="bg-[#030912]">{children}</div>}
    </div>
  );
}

// ── Citation Report Modal ──────────────────────────────────────────────────────
function CitationReportModal({
  onClose, subject = '', officer = '', civilianId = null,
}: {
  onClose: () => void; subject?: string; officer?: string; civilianId?: number | null;
}) {
  const [form, setForm] = useState({
    subject, officer,
    date: new Date().toISOString().slice(0, 16),
    location: '', violation: '', fine_amount: '', notes: '',
  });
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const labelCls = 'text-[8px] font-black uppercase tracking-[0.25em] text-[#3a5070]';
  const inputCls = 'w-full rounded border border-[#1a2e4a] bg-[#060f1e] px-3 py-2 text-[11px] font-semibold text-white placeholder:text-[#1e3050] outline-none focus:border-[#2f70ff] transition-colors';

  const handleSubmit = async () => {
    if (!form.subject.trim()) { setErrorMsg('Subject name is required.'); setStatus('error'); return; }
    if (!form.violation.trim()) { setErrorMsg('Violation / offence is required.'); setStatus('error'); return; }

    setStatus('saving');
    setErrorMsg('');
    try {
      const res = await fetch('/api/reports/citation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subject:     form.subject.trim(),
          officer:     form.officer.trim() || undefined,
          date_time:   form.date || undefined,
          location:    form.location.trim() || undefined,
          violation:   form.violation.trim(),
          fine_amount: form.fine_amount.trim() || undefined,
          notes:       form.notes.trim() || undefined,
          civilian_id: civilianId ?? undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Failed to save citation.');
      }
      setStatus('success');
      setTimeout(onClose, 1200);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save citation.');
      setStatus('error');
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-sm">
      <div className="w-[520px] max-h-[90vh] flex flex-col rounded-xl border border-[#1a2e4a] bg-[#0a1220] shadow-2xl overflow-hidden">

        {/* Title bar */}
        <div className="flex items-center gap-2 shrink-0 bg-[#06101a] px-4 py-2.5 border-b border-[#0f1c2e]">
          <ClipboardList className="h-3.5 w-3.5 text-[#f4c542]" />
          <span className="text-[11px] font-black uppercase tracking-[0.22em] text-white">Citation Report</span>
          <button type="button" onClick={onClose}
            className="ml-auto h-2.5 w-2.5 rounded-full bg-red-500/70 hover:bg-red-500 transition-colors" />
        </div>

        {/* Success banner */}
        {status === 'success' && (
          <div className="shrink-0 flex items-center gap-2 border-b border-emerald-500/30 bg-emerald-500/10 px-6 py-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Citation filed successfully</span>
          </div>
        )}

        {/* Form body */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-4 px-6 py-5">

            {/* Subject + Officer */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Subject Name <span className="text-red-400">*</span></label>
                <input type="text" required value={form.subject}
                  onChange={e => set('subject', e.target.value)}
                  placeholder="First Last" className={inputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Issuing Officer</label>
                <input type="text" value={form.officer}
                  onChange={e => set('officer', e.target.value)}
                  placeholder="Officer name" className={inputCls} />
              </div>
            </div>

            {/* Date/Time + Location */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Date &amp; Time <span className="text-red-400">*</span></label>
                <input type="datetime-local" required value={form.date}
                  onChange={e => set('date', e.target.value)}
                  className={`${inputCls} [color-scheme:dark]`} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Location</label>
                <input type="text" value={form.location}
                  onChange={e => set('location', e.target.value)}
                  placeholder="Street / area" className={inputCls} />
              </div>
            </div>

            {/* Violation */}
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>Violation / Offence <span className="text-red-400">*</span></label>
              <textarea required rows={3} value={form.violation}
                onChange={e => set('violation', e.target.value)}
                placeholder="List violations, one per line"
                className={`${inputCls} resize-none leading-relaxed`} />
            </div>

            {/* Fine Amount */}
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>Fine Amount</label>
              <input type="text" value={form.fine_amount}
                onChange={e => set('fine_amount', e.target.value)}
                placeholder="e.g. $250" className={inputCls} />
            </div>

            {/* Notes */}
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>Notes</label>
              <textarea rows={3} value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="Additional notes or observations"
                className={`${inputCls} resize-none leading-relaxed`} />
            </div>

            {status === 'error' && (
              <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[10px] text-red-400">{errorMsg}</p>
            )}

          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 shrink-0 border-t border-[#0f1c2e] bg-[#06101a] px-6 py-3">
          <button type="button" onClick={onClose}
            className="px-4 py-1.5 text-[9px] font-black uppercase tracking-widest text-[#526179] hover:text-white transition-colors">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={status === 'saving' || status === 'success'}
            className="flex items-center gap-1.5 rounded border border-[#f4c542]/40 bg-[#f4c542]/15 px-4 py-1.5 text-[9px] font-black uppercase tracking-widest text-[#f4c542] hover:bg-[#f4c542]/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            <ClipboardList className="h-3 w-3" />
            {status === 'saving' ? 'Filing…' : 'File Citation'}
          </button>
        </div>

      </div>
    </div>
  );
}

// ── BOLO rows ─────────────────────────────────────────────────────────────────
const BOLO_BADGE = (
  <span className="flex items-center gap-1 rounded border border-red-500/50 bg-red-500/15 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-red-400 shadow-[0_0_6px_rgba(239,68,68,0.2)]">
    <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />BOLO
  </span>
);

function BoloDetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[8px] font-black uppercase tracking-[0.25em] text-[#2a4060]">{label}</span>
      <span className="text-[10px] font-semibold text-[#8aadcf]">{value}</span>
    </div>
  );
}

function CivilianBoloRow({ bolo }: { bolo: BoloRecord }) {
  const [open, setOpen] = useState(false);
  const name   = `${bolo.first_name ?? ''} ${bolo.last_name ?? ''}`.trim() || '—';
  const reason = bolo.bolo_reason || '—';
  const issued = bolo.created_at ? new Date(bolo.created_at).toLocaleString() : '—';
  return (
    <div className="border-b border-[#080f1a]">
      {/* Summary row — clickable */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full grid items-center px-4 py-2.5 hover:bg-[#040a12] transition-colors text-left"
        style={{ gridTemplateColumns: '1.2fr 0.9fr 1fr auto 20px' }}
      >
        <div className="flex flex-col gap-0.5 min-w-0 pr-2">
          <span className="text-[11px] font-black text-white leading-none truncate">{name}</span>
          <span className="text-[9px] text-[#3a5070] truncate">{bolo.occupation || '—'}</span>
        </div>
        <div className="flex items-center min-w-0 pr-2">
          <span className="text-[10px] text-[#8a9ab5] truncate">{bolo.gender || '—'}</span>
        </div>
        <div className="flex items-center min-w-0 pr-2">
          <span className="text-[10px] text-[#8a9ab5] truncate">{bolo.hair_colour || '—'}</span>
        </div>
        <div className="flex items-center">{BOLO_BADGE}</div>
        <div className="flex items-center justify-end">
          <ChevronDown className={`h-3 w-3 text-[#2a4060] transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Expanded detail panel */}
      {open && (
        <div className="border-t border-[#0a1a2e] bg-[#030b16] px-5 py-3">
          <div className="flex items-center gap-1.5 mb-3">
            <span className="h-px flex-1 bg-[#0d1e30]" />
            <span className="text-[8px] font-black uppercase tracking-[0.3em] text-[#1e3a55]">BOLO Details</span>
            <span className="h-px flex-1 bg-[#0d1e30]" />
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-3 mb-3">
            <BoloDetailField label="Full Name"    value={name} />
            <BoloDetailField label="Gender"       value={bolo.gender || '—'} />
            <BoloDetailField label="Hair Colour"  value={bolo.hair_colour || '—'} />
            <BoloDetailField label="Occupation"   value={bolo.occupation || '—'} />
            <BoloDetailField label="Issued"       value={issued} />
          </div>
          <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2">
            <span className="text-[8px] font-black uppercase tracking-[0.25em] text-red-500/60 block mb-1">Reason for BOLO</span>
            <span className="text-[10px] font-semibold text-red-300/80">{reason}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function VehicleBoloRow({ bolo }: { bolo: BoloRecord }) {
  const [open, setOpen] = useState(false);
  const make   = [bolo.make, bolo.model].filter(Boolean).join(' ') || '—';
  const colour = bolo.color || '—';
  const reason = bolo.bolo_reason || '—';
  const issued = bolo.created_at ? new Date(bolo.created_at).toLocaleString() : '—';
  return (
    <div className="border-b border-[#080f1a]">
      {/* Summary row — clickable */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full grid items-center px-4 py-2.5 hover:bg-[#040a12] transition-colors text-left"
        style={{ gridTemplateColumns: '1fr 1.1fr 0.7fr 0.9fr auto 20px' }}
      >
        <div className="flex flex-col gap-0.5 min-w-0 pr-2">
          <span className="text-[11px] font-black tracking-[0.15em] text-white leading-none truncate">{bolo.plate || '—'}</span>
          <span className="text-[9px] text-[#3a5070] truncate">{bolo.owner_name || 'No owner'}</span>
        </div>
        <div className="flex items-center min-w-0 pr-2">
          <span className="text-[10px] text-[#8a9ab5] truncate">{make}</span>
        </div>
        <div className="flex items-center min-w-0 pr-2">
          <span className="text-[10px] text-[#8a9ab5] truncate">{bolo.year || '—'}</span>
        </div>
        <div className="flex items-center min-w-0 pr-2">
          <span className="text-[10px] text-[#8a9ab5] truncate">{colour}</span>
        </div>
        <div className="flex items-center">{BOLO_BADGE}</div>
        <div className="flex items-center justify-end">
          <ChevronDown className={`h-3 w-3 text-[#2a4060] transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Expanded detail panel */}
      {open && (
        <div className="border-t border-[#0a1a2e] bg-[#030b16] px-5 py-3">
          <div className="flex items-center gap-1.5 mb-3">
            <span className="h-px flex-1 bg-[#0d1e30]" />
            <span className="text-[8px] font-black uppercase tracking-[0.3em] text-[#1e3a55]">BOLO Details</span>
            <span className="h-px flex-1 bg-[#0d1e30]" />
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-3 mb-3">
            <BoloDetailField label="Plate"          value={bolo.plate || '—'} />
            <BoloDetailField label="Make"           value={bolo.make || '—'} />
            <BoloDetailField label="Model"          value={bolo.model || '—'} />
            <BoloDetailField label="Colour"         value={colour} />
            <BoloDetailField label="Registered Owner" value={bolo.owner_name || 'Unknown'} />
            <BoloDetailField label="Issued"         value={issued} />
          </div>
          <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2">
            <span className="text-[8px] font-black uppercase tracking-[0.25em] text-red-500/60 block mb-1">Reason for BOLO</span>
            <span className="text-[10px] font-semibold text-red-300/80">{reason}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── BOLO issue modal ──────────────────────────────────────────────────────────
function BoloModal({
  fields, onConfirm, onCancel, loading,
}: {
  fields: { label: string; value: string }[];
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-sm">
      <div className="w-[460px] rounded-xl border border-orange-500/30 bg-[#0a1220] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 bg-[#06101a] px-4 py-2.5 border-b border-[#0f1c2e]">
          <Radio className="h-3.5 w-3.5 text-orange-400" />
          <span className="text-[11px] font-black uppercase tracking-[0.22em] text-white">Issue BOLO</span>
          <button type="button" onClick={onCancel}
            className="ml-auto h-2.5 w-2.5 rounded-full bg-red-500/70 hover:bg-red-500 transition-colors" />
        </div>
        {/* Pre-filled info grid */}
        <div className="grid grid-cols-2 gap-px bg-[#0a1520] border-b border-[#0f1c2e]">
          {fields.map(({ label, value }) => (
            <div key={label} className="flex flex-col gap-0.5 px-5 py-3 bg-[#050d1a]">
              <span className="text-[8px] font-black uppercase tracking-[0.25em] text-[#3a5070]">{label}</span>
              <span className="text-[11px] font-semibold text-white">{value || '—'}</span>
            </div>
          ))}
        </div>
        {/* Reason */}
        <div className="px-5 py-4">
          <label className="mb-2 block text-[8px] font-black uppercase tracking-[0.25em] text-[#3a5070]">
            Reason for BOLO <span className="text-orange-500">*</span>
          </label>
          <textarea
            autoFocus
            rows={3}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Describe the reason for issuing this BOLO…"
            className="w-full rounded-md border border-[#1a2e4a] bg-[#060f1e] px-3 py-2.5 text-[11px] font-semibold text-white placeholder:text-[#1e3050] outline-none focus:border-orange-500/50 focus:shadow-[0_0_0_2px_rgba(249,115,22,0.1)] resize-none transition-all"
          />
        </div>
        {/* Actions */}
        <div className="flex gap-3 px-5 pb-5">
          <button type="button" onClick={onCancel}
            className="rounded-md border border-[#263247] px-4 py-2 text-[9px] font-black uppercase tracking-widest text-[#a8b7cd] hover:text-white transition-colors">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => reason.trim() && onConfirm(reason.trim())}
            disabled={!reason.trim() || loading}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-md border border-orange-500/40 bg-orange-500/15 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-orange-400 hover:bg-orange-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Radio className="h-3 w-3" />
            {loading ? 'Issuing…' : 'Issue BOLO'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Character profile modal ────────────────────────────────────────────────────
function CharacterProfileModal({
  civilian, onClose, onBack, onArrest, onCite, onWarn, onBoloChanged,
}: {
  civilian: CivilianResult; onClose: () => void; onBack: () => void; onArrest: () => void; onCite: () => void; onWarn: () => void; onBoloChanged?: () => void;
}) {
  const [vehicles,     setVehicles]     = useState<CivilianVehicle[]>([]);
  const [arrests,      setArrests]      = useState<CivilianArrest[]>([]);
  const [citations,    setCitations]    = useState<CivilianCitation[]>([]);
  const [history,      setHistory]      = useState<CivilianHistory[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [localWanted,  setLocalWanted]  = useState(civilian.wanted);
  const [boloLoading,  setBoloLoading]  = useState(false);
  const [showBoloModal, setShowBoloModal] = useState(false);

  const handleIssueBolo = async (reason: string) => {
    setBoloLoading(true);
    try {
      const res = await fetch(`/api/civilian/characters/${civilian.id}/bolo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wanted: true, bolo_reason: reason }),
      });
      if (!res.ok) throw new Error();
      setLocalWanted(true);
      setShowBoloModal(false);
      onBoloChanged?.();
    } finally {
      setBoloLoading(false);
    }
  };

  const handleClearBolo = async () => {
    if (boloLoading) return;
    setBoloLoading(true);
    try {
      const res = await fetch(`/api/civilian/characters/${civilian.id}/bolo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wanted: false, bolo_reason: null }),
      });
      if (!res.ok) throw new Error();
      setLocalWanted(false);
      onBoloChanged?.();
    } finally {
      setBoloLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    const safeJson = (r: Response) => r.ok ? r.json().catch(() => []) : [];
    Promise.allSettled([
      fetch(`/api/civilian/${civilian.id}/vehicles`).then(safeJson),
      fetch(`/api/civilian/${civilian.id}/arrests`).then(safeJson),
      fetch(`/api/civilian/${civilian.id}/citations`).then(safeJson),
      fetch(`/api/civilian/${civilian.id}/history`).then(safeJson),
    ]).then(([v, a, c, h]) => {
      setVehicles(Array.isArray(v.status === 'fulfilled' ? v.value : []) ? (v.status === 'fulfilled' ? v.value : []) : []);
      setArrests(Array.isArray(a.status === 'fulfilled' ? a.value : []) ? (a.status === 'fulfilled' ? a.value : []) : []);
      setCitations(Array.isArray(c.status === 'fulfilled' ? c.value : []) ? (c.status === 'fulfilled' ? c.value : []) : []);
      setHistory(Array.isArray(h.status === 'fulfilled' ? h.value : []) ? (h.status === 'fulfilled' ? h.value : []) : []);
    }).finally(() => setLoading(false));
  }, [civilian.id]);

  const fullName = `${civilian.first_name} ${civilian.last_name}`;
  const fmtDate = (s: string | null) => {
    if (!s) return '—';
    try { return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return s; }
  };

  return (
    <>
    {showBoloModal && (
      <BoloModal
        fields={[
          { label: 'Name',        value: fullName },
          { label: 'ID',          value: `#${civilian.id}` },
          { label: 'Date of Birth', value: civilian.dob ?? '' },
          { label: 'Gender',      value: civilian.gender ?? '' },
          { label: 'Hair Colour', value: civilian.hair_colour ?? '' },
          { label: 'Occupation',  value: civilian.occupation ?? '' },
        ]}
        onConfirm={handleIssueBolo}
        onCancel={() => setShowBoloModal(false)}
        loading={boloLoading}
      />
    )}
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-sm">
      <div className="w-[580px] max-h-[85vh] flex flex-col rounded-xl border border-[#1a2e4a] bg-[#0a1220] shadow-2xl overflow-hidden">

        {/* Title bar */}
        <div className="flex items-center gap-2 shrink-0 bg-[#06101a] px-4 py-2.5 border-b border-[#0f1c2e]">
          <button type="button" onClick={onBack}
            className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-[#3a5070] hover:text-[#4384ff] transition-colors">
            <ArrowLeft className="h-3 w-3" />
            Back
          </button>
          <div className="h-3.5 w-px bg-[#0f1c2e] mx-1" />
          <User className="h-3.5 w-3.5 text-[#4384ff]" />
          <span className="text-[11px] font-black uppercase tracking-[0.22em] text-white">Character Record</span>
          {localWanted && (
            <span className="flex items-center gap-1.5 rounded border border-red-500/50 bg-red-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-red-400 shadow-[0_0_8px_rgba(239,68,68,0.3)]">
              <span className="h-1.5 w-1.5 rounded-full bg-red-400 shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
              WANTED
            </span>
          )}
          <button type="button" onClick={onClose}
            className="ml-auto h-2.5 w-2.5 rounded-full bg-red-500/70 hover:bg-red-500 transition-colors" />
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Identity header */}
          <div className="flex items-start gap-4 px-6 py-5 border-b border-[#0f1c2e] bg-[#050d1a]">
            <div className="h-14 w-14 rounded-full border-2 border-[#1a3060] bg-[#060f20] flex items-center justify-center shrink-0 shadow-[0_0_16px_rgba(67,132,255,0.12)]">
              <User className="h-6 w-6 text-[#4384ff]" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[18px] font-black text-white tracking-wide leading-none">{fullName}</span>
              <div className="flex items-center gap-2 mt-0.5">
                {civilian.wanted ? (
                  <span className="text-[9px] font-black uppercase tracking-widest text-red-400">⚠ Wanted Person</span>
                ) : (
                  <span className="text-[9px] font-black uppercase tracking-widest text-[#3a5070]">No Warrant</span>
                )}
                <span className="text-[#1e2e42]">·</span>
                <span className="text-[9px] text-[#3a5070]">ID #{civilian.id}</span>
                {!loading && citations.length > 0 && (
                  <>
                    <span className="text-[#1e2e42]">·</span>
                    <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-[#f4c542]">
                      <ClipboardList className="h-2.5 w-2.5" />
                      {citations.length} {citations.length === 1 ? 'Citation' : 'Citations'}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 px-5 py-3 border-b border-[#0f1c2e] bg-[#060e1b]">
            <button
              type="button"
              onClick={onWarn}
              className="flex-1 flex items-center justify-center gap-1.5 rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-yellow-400 hover:bg-yellow-500/20 transition-colors"
            >
              <AlertTriangle className="h-3 w-3" /> Warning
            </button>
            <button
              type="button"
              onClick={onCite}
              className="flex-1 flex items-center justify-center gap-1.5 rounded border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-blue-400 hover:bg-blue-500/20 transition-colors"
            >
              <FileText className="h-3 w-3" /> Cite
            </button>
            <button
              type="button"
              onClick={onArrest}
              className="flex-1 flex items-center justify-center gap-1.5 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-red-400 hover:bg-red-500/20 transition-colors"
            >
              <Scale className="h-3 w-3" /> Arrest
            </button>
            <button
              type="button"
              onClick={() => localWanted ? handleClearBolo() : setShowBoloModal(true)}
              disabled={boloLoading}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded border px-3 py-2 text-[9px] font-black uppercase tracking-widest transition-colors disabled:opacity-50 ${
                localWanted
                  ? 'border-orange-500/60 bg-orange-500/20 text-orange-300 hover:bg-orange-500/30'
                  : 'border-orange-500/30 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20'
              }`}
            >
              <Radio className="h-3 w-3" /> {localWanted ? 'Clear BOLO' : 'BOLO'}
            </button>
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-px bg-[#0a1520] border-b border-[#0f1c2e]">
            {[
              { label: 'Date of Birth', value: civilian.dob ?? '—' },
              { label: 'Age',           value: civilian.ethnicity ?? '—' },
              { label: 'Gender',        value: civilian.gender ?? '—' },
              { label: 'Hair Colour',   value: civilian.hair_colour ?? '—' },
              { label: 'Occupation',    value: civilian.occupation ?? '—' },
              { label: 'Phone',         value: civilian.phone ?? '—' },
              { label: 'Address',       value: civilian.address ?? '—' },
              { label: 'Notes',         value: civilian.notes ?? '—' },
            ].map(({ label, value }) => (
              <div key={label} className="flex flex-col gap-0.5 px-5 py-3 bg-[#050d1a]">
                <span className="text-[8px] font-black uppercase tracking-[0.25em] text-[#3a5070]">{label}</span>
                <span className="text-[11px] font-semibold text-white">{value}</span>
              </div>
            ))}
            {/* Driving Licence — full width */}
            <div className="col-span-2 flex flex-col gap-0.5 px-5 py-3 bg-[#050d1a]">
              <span className="text-[8px] font-black uppercase tracking-[0.25em] text-[#3a5070]">Driving Licence</span>
              <span className={`inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest ${civilian.valid_licence ? 'text-emerald-400' : 'text-red-400'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${civilian.valid_licence ? 'bg-emerald-400' : 'bg-red-400'}`} />
                {civilian.valid_licence ? 'Valid' : 'Not Valid'}
              </span>
            </div>
          </div>

          {/* Accordion sections */}
          <div className="flex flex-col gap-2 p-4">

            {/* History */}
            <AccordionSection icon={Clock} label="History" accent="text-[#3a5070]" count={history.length}>
              {loading ? (
                <div className="px-4 py-3 text-[10px] text-[#3a5070]">Loading…</div>
              ) : history.length === 0 ? (
                <div className="flex flex-col items-center gap-1 py-5">
                  <Clock className="h-5 w-5 text-[#0d1a2a]" />
                  <p className="text-[10px] text-[#1e2e42]">No incident history on record</p>
                </div>
              ) : (
                history.map(h => (
                  <div key={h.id} className="border-b border-[#0a1520] px-4 py-2.5 last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-black text-white">{h.type}</span>
                      <span className="text-[9px] text-[#3a5070]">{fmtDate(h.created_at)}</span>
                    </div>
                    {h.description && <p className="mt-0.5 text-[10px] text-[#526179]">{h.description}</p>}
                    {h.officer && <p className="mt-0.5 text-[9px] text-[#2a3a50]">Officer: {h.officer}</p>}
                  </div>
                ))
              )}
            </AccordionSection>

            {/* Arrests */}
            <AccordionSection icon={Scale} label="Arrests" accent="text-[#f87171]" count={arrests.length}>
              {loading ? (
                <div className="px-4 py-3 text-[10px] text-[#3a5070]">Loading…</div>
              ) : arrests.length === 0 ? (
                <div className="flex flex-col items-center gap-1 py-5">
                  <Scale className="h-5 w-5 text-[#0d1a2a]" />
                  <p className="text-[10px] text-[#1e2e42]">No arrests on record</p>
                </div>
              ) : (
                arrests.map(a => (
                  <div key={a.id} className="border-b border-[#0a1520] px-4 py-2.5 last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-black text-white">{a.charges}</span>
                      <span className="text-[9px] text-[#3a5070]">{fmtDate(a.created_at)}</span>
                    </div>
                    {a.notes && <p className="mt-0.5 text-[10px] text-[#526179]">{a.notes}</p>}
                    {a.officer && <p className="mt-0.5 text-[9px] text-[#2a3a50]">Arresting Officer: {a.officer}</p>}
                  </div>
                ))
              )}
            </AccordionSection>

            {/* Citations */}
            <AccordionSection icon={ClipboardList} label="Citations" accent="text-[#f4c542]" count={citations.length}>
              {loading ? (
                <div className="px-4 py-3 text-[10px] text-[#3a5070]">Loading…</div>
              ) : citations.length === 0 ? (
                <div className="flex flex-col items-center gap-1 py-5">
                  <ClipboardList className="h-5 w-5 text-[#0d1a2a]" />
                  <p className="text-[10px] text-[#1e2e42]">No citations on record</p>
                </div>
              ) : (
                citations.map(c => (
                  <div key={c.id} className="border-b border-[#0a1520] px-4 py-2.5 last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-black text-white">{c.violation}</span>
                      <span className="text-[9px] text-[#3a5070]">{c.date_time ? new Date(c.date_time).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : fmtDate(c.created_at)}</span>
                    </div>
                    {c.fine_amount && (
                      <p className="mt-0.5 text-[9px] font-black text-[#f4c542]/80">Fine: {c.fine_amount}</p>
                    )}
                    {c.officer && <p className="mt-0.5 text-[9px] text-[#2a3a50]">Issuing Officer: {c.officer}</p>}
                    {c.notes && <p className="mt-0.5 text-[10px] text-[#526179]">{c.notes}</p>}
                  </div>
                ))
              )}
            </AccordionSection>

            {/* Personal Vehicles */}
            <AccordionSection icon={Car} label="Personal Vehicles" accent="text-[#4384ff]" count={vehicles.length}>
              {loading ? (
                <div className="px-4 py-3 text-[10px] text-[#3a5070]">Loading…</div>
              ) : vehicles.length === 0 ? (
                <div className="flex flex-col items-center gap-1 py-5">
                  <Car className="h-5 w-5 text-[#0d1a2a]" />
                  <p className="text-[10px] text-[#1e2e42]">No vehicles registered</p>
                </div>
              ) : (
                vehicles.map(v => (
                  <div key={v.id} className="border-b border-[#0a1520] px-4 py-2.5 last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-black text-[#4384ff] tracking-widest">{v.plate}</span>
                      <div className="flex items-center gap-1.5">
                        {v.stolen && (
                          <span className="rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-red-400">
                            Stolen
                          </span>
                        )}
                        {!v.registered && (
                          <span className="rounded border border-orange-500/40 bg-orange-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-orange-400">
                            Unregistered
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="mt-0.5 text-[10px] text-[#526179]">
                      {[v.year, v.color, v.make, v.model].filter(Boolean).join(' ')}
                    </p>
                  </div>
                ))
              )}
            </AccordionSection>

          </div>
        </div>
      </div>
    </div>
    </>
  );
}

// ── Name Search Modal ─────────────────────────────────────────────────────────
function NameSearchModal({
  onClose, onSelect,
}: {
  onClose: () => void; onSelect: (c: CivilianResult) => void;
}) {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState<CivilianResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [active,  setActive]  = useState(false); // true once user has typed ≥1 char
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Live debounced search — fires 220 ms after the user stops typing
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setResults([]);
      setActive(false);
      setLoading(false);
      return;
    }
    setActive(true);
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/civilian/search?q=${encodeURIComponent(q)}`);
        const data = await r.json();
        setResults(Array.isArray(data) ? data : []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  // Highlight matching letters in a name
  function highlight(text: string, q: string) {
    if (!q) return <>{text}</>;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return <>{text}</>;
    return (
      <>
        {text.slice(0, idx)}
        <span className="text-[#4384ff]">{text.slice(idx, idx + q.length)}</span>
        {text.slice(idx + q.length)}
      </>
    );
  }

  const showDropdown = active;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-[480px] rounded-lg border border-[#1a2e4a] bg-[#0d1520] shadow-2xl overflow-hidden">

        {/* Title bar */}
        <div className="flex items-center gap-2 border-b border-[#0f1c2e] bg-[#08111e] px-4 py-2.5">
          <User className="h-3.5 w-3.5 text-[#4384ff]" />
          <span className="text-[11px] font-black uppercase tracking-[0.22em] text-white">Name Database</span>
          <button type="button" onClick={onClose}
            className="ml-auto h-2.5 w-2.5 rounded-full bg-red-500/70 hover:bg-red-500 transition-colors" />
        </div>

        {/* Search input */}
        <div className="px-4 py-4 bg-[#06101a]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#2a3a50]" />
            {loading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="h-3.5 w-3.5 rounded-full border-2 border-[#2f70ff]/30 border-t-[#4384ff] animate-spin" />
              </div>
            )}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && onClose()}
              placeholder="Start typing a name…"
              className="h-10 w-full rounded-md border border-[#1a2e4a] bg-[#040c18] pl-9 pr-9 text-[12px] font-semibold text-white placeholder:text-[#1e3050] outline-none focus:border-[#2f70ff] focus:shadow-[0_0_0_2px_rgba(47,112,255,0.15)] transition-all"
            />
          </div>
          <p className="mt-1.5 text-[9px] text-[#2a3a50]">
            Results appear as you type · Press Esc to close
          </p>
        </div>

        {/* Live dropdown results */}
        {showDropdown && (
          <div className="border-t border-[#0a1520] max-h-[380px] overflow-y-auto bg-[#030912]">
            {loading && results.length === 0 ? (
              /* Skeleton while first batch loads */
              <div className="flex flex-col gap-px p-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex items-center gap-3 rounded px-4 py-2.5 animate-pulse">
                    <div className="h-8 w-8 shrink-0 rounded-full bg-[#0a1a2a]" />
                    <div className="flex flex-col gap-1.5 flex-1">
                      <div className="h-2.5 w-36 rounded bg-[#0a1a2a]" />
                      <div className="h-2 w-20 rounded bg-[#060f1e]" />
                    </div>
                  </div>
                ))}
              </div>
            ) : results.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-1.5 py-8">
                <X className="h-6 w-6 text-[#0d1a2a]" />
                <p className="text-[10px] font-bold text-[#1e2e42]">No records found for "{query}"</p>
              </div>
            ) : (
              <>
                {/* Count bar */}
                <div className="flex items-center gap-2 border-b border-[#0a1520] bg-[#040c18] px-4 py-1.5">
                  <span className="text-[9px] font-black uppercase tracking-widest text-[#3a5070]">
                    {results.length} record{results.length !== 1 ? 's' : ''} found
                  </span>
                </div>

                {/* Result rows */}
                {results.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onSelect(c)}
                    className="flex w-full items-center gap-3 border-b border-[#060e18] px-4 py-2.5 text-left last:border-0 hover:bg-[#0d1a30] transition-colors group"
                  >
                    {/* Avatar placeholder */}
                    <div className="h-8 w-8 shrink-0 rounded-full border border-[#1a3060] bg-[#060f20] flex items-center justify-center">
                      <User className="h-3.5 w-3.5 text-[#4384ff]" />
                    </div>

                    {/* Name + meta */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-black text-white">
                          {highlight(c.first_name, query.trim())} {highlight(c.last_name, query.trim())}
                        </span>
                        {c.wanted && (
                          <span className="flex shrink-0 items-center gap-1 rounded border border-red-500/50 bg-red-500/10 px-1.5 py-px text-[8px] font-black uppercase tracking-widest text-red-400">
                            <span className="h-1 w-1 rounded-full bg-red-400" />
                            WANTED
                          </span>
                        )}
                        {!!c.citation_count && c.citation_count > 0 && (
                          <span className="flex shrink-0 items-center gap-1 rounded border border-[#f4c542]/40 bg-[#f4c542]/10 px-1.5 py-px text-[8px] font-black uppercase tracking-widest text-[#f4c542]">
                            <ClipboardList className="h-2.5 w-2.5" />
                            {c.citation_count} {c.citation_count === 1 ? 'Citation' : 'Citations'}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-px">
                        {c.dob      && <span className="text-[9px] text-[#3a5070]">DOB {c.dob}</span>}
                        {c.gender   && <><span className="text-[#1a2a3a]">·</span><span className="text-[9px] text-[#3a5070]">{c.gender}</span></>}
                        {c.ethnicity && <><span className="text-[#1a2a3a]">·</span><span className="text-[9px] text-[#3a5070]">{c.ethnicity}</span></>}
                      </div>
                    </div>

                    <ChevronDown className="-rotate-90 h-3.5 w-3.5 shrink-0 text-[#1e2e42] group-hover:text-[#4384ff] transition-colors" />
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {/* Idle state — shown before any typing */}
        {!showDropdown && (
          <div className="flex flex-col items-center justify-center gap-2 py-10 border-t border-[#0a1520]">
            <User className="h-8 w-8 text-[#0d1a2a]" />
            <p className="text-[11px] font-bold text-[#1e2e42]">Search the civilian database</p>
            <p className="text-[10px] text-[#131e2d]">Type a name to see matching records</p>
          </div>
        )}

      </div>
    </div>
  );
}

function VehicleSearchModal({ onClose, onWarn, onCite, onBoloChanged }: {
  onClose: () => void;
  onWarn: (subject: string) => void;
  onCite: (subject: string, civilianId: number | null) => void;
  onBoloChanged?: () => void;
}) {
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState<VehicleSearchResult[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [searched, setSearched] = useState(false); // true once first search fires
  const [selected, setSelected] = useState<VehicleSearchResult | null>(null);
  const [owner,    setOwner]    = useState<CivilianResult | null>(null);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [showOwnerRecord, setShowOwnerRecord] = useState(false);
  const [stolenLoading, setStolenLoading] = useState(false);
  const [boloLoading,   setBoloLoading]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced live search
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/civilian/vehicles/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setResults(Array.isArray(data) ? data : []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
        setSearched(true);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  // Fetch owner when a vehicle is selected
  const handleSelectVehicle = async (v: VehicleSearchResult) => {
    setSelected(v);
    setOwner(null);
    if (!v.owner_id) return;
    setOwnerLoading(true);
    try {
      const res = await fetch(`/api/civilian/search?q=${encodeURIComponent(v.owner_name ?? '')}`);
      if (!res.ok) throw new Error();
      const data: CivilianResult[] = await res.json();
      const match = data.find(c => c.id === v.owner_id) ?? null;
      setOwner(match);
    } catch {
      setOwner(null);
    } finally {
      setOwnerLoading(false);
    }
  };

  const hasQuery = query.trim().length > 0;

  // ── Stolen toggle ────────────────────────────────────────────────────────────
  const handleToggleStolen = async () => {
    if (!selected || stolenLoading) return;
    setStolenLoading(true);
    try {
      const res = await fetch(`/api/civilian/vehicles/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stolen: !selected.stolen }),
      });
      if (!res.ok) throw new Error();
      setSelected(prev => prev ? { ...prev, stolen: !prev.stolen } : prev);
      setResults(prev => prev.map(v => v.id === selected.id ? { ...v, stolen: !v.stolen } : v));
    } finally {
      setStolenLoading(false);
    }
  };

  const [showBoloModal, setShowBoloModal] = useState(false);

  // ── BOLO handlers (vehicle's own bolo flag — independent of owner) ───────────
  const handleIssueBolo = async (reason: string) => {
    if (!selected) return;
    setBoloLoading(true);
    try {
      const res = await fetch(`/api/civilian/vehicles/${selected.id}/bolo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bolo: true, bolo_reason: reason }),
      });
      if (!res.ok) throw new Error();
      setSelected(prev => prev ? { ...prev, bolo: true, bolo_reason: reason } : prev);
      setResults(prev => prev.map(v => v.id === selected.id ? { ...v, bolo: true } : v));
      setShowBoloModal(false);
      onBoloChanged?.();
    } finally {
      setBoloLoading(false);
    }
  };

  const handleClearBolo = async () => {
    if (!selected || boloLoading) return;
    setBoloLoading(true);
    try {
      const res = await fetch(`/api/civilian/vehicles/${selected.id}/bolo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bolo: false, bolo_reason: null }),
      });
      if (!res.ok) throw new Error();
      setSelected(prev => prev ? { ...prev, bolo: false, bolo_reason: null } : prev);
      setResults(prev => prev.map(v => v.id === selected.id ? { ...v, bolo: false } : v));
      onBoloChanged?.();
    } finally {
      setBoloLoading(false);
    }
  };

  // ── Owner record view ────────────────────────────────────────────────────────
  if (selected && showOwnerRecord && owner) {
    return (
      <CharacterProfileModal
        civilian={owner}
        onClose={onClose}
        onBack={() => setShowOwnerRecord(false)}
        onArrest={() => {}}
        onCite={() => { onCite(`${owner.first_name} ${owner.last_name}`, owner.id); onClose(); }}
        onWarn={() => { onWarn(`${owner.first_name} ${owner.last_name}`); onClose(); }}
      />
    );
  }

  // ── Detail view ──────────────────────────────────────────────────────────────
  if (selected) {
    const v = selected;
    return (
      <>
      {showBoloModal && (
        <BoloModal
          fields={[
            { label: 'Plate',   value: v.plate },
            { label: 'Make',    value: v.make },
            { label: 'Model',   value: v.model ?? '' },
            { label: 'Year',    value: v.year ?? '' },
            { label: 'Colour',  value: v.color ?? '' },
            ...(owner ? [{ label: 'Owner', value: `${owner.first_name} ${owner.last_name}` }] : []),
          ]}
          onConfirm={handleIssueBolo}
          onCancel={() => setShowBoloModal(false)}
          loading={boloLoading}
        />
      )}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="w-[540px] max-h-[90vh] overflow-y-auto rounded-lg border border-[#1a2e4a] bg-[#0d1520] shadow-2xl">
          {/* Title bar */}
          <div className="flex items-center gap-2 border-b border-[#0f1c2e] bg-[#08111e] px-4 py-2.5 sticky top-0 z-10">
            <button type="button" onClick={() => setSelected(null)}
              className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-[#3a5070] hover:text-[#4384ff] transition-colors">
              <ArrowLeft className="h-3 w-3" /> Back
            </button>
            <div className="h-3.5 w-px bg-[#0f1c2e] mx-1" />
            <Car className="h-3.5 w-3.5 text-[#4384ff]" />
            <span className="text-[11px] font-black uppercase tracking-[0.22em] text-white">Vehicle Record</span>
            <button type="button" onClick={onClose}
              className="ml-auto h-2.5 w-2.5 rounded-full bg-red-500/70 hover:bg-red-500 transition-colors" />
          </div>

          {/* Plate header */}
          <div className="flex items-center gap-4 px-6 py-5 border-b border-[#0f1c2e] bg-[#050d1a]">
            <div className="h-14 w-14 rounded-lg border-2 border-[#1a3060] bg-[#060f20] flex items-center justify-center shrink-0">
              <Car className="h-6 w-6 text-[#4384ff]" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[22px] font-black tracking-[0.25em] text-white leading-none">{v.plate}</span>
              <div className="flex items-center gap-2 flex-wrap">
                {v.bolo && (
                  <span className="flex items-center gap-1 rounded border border-red-500/60 bg-red-500/20 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-red-300 shadow-[0_0_10px_rgba(239,68,68,0.4)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse shadow-[0_0_6px_rgba(239,68,68,0.9)]" />BOLO&apos;D
                  </span>
                )}
                {v.stolen && (
                  <span className="flex items-center gap-1 rounded border border-red-500/50 bg-red-500/15 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-red-400 shadow-[0_0_8px_rgba(239,68,68,0.3)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400 shadow-[0_0_6px_rgba(239,68,68,0.8)]" />STOLEN
                  </span>
                )}
                {!v.registered && (
                  <span className="flex items-center gap-1 rounded border border-orange-500/40 bg-orange-500/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-orange-400">
                    UNREGISTERED
                  </span>
                )}
                {!v.insured && (
                  <span className="flex items-center gap-1 rounded border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-yellow-400">
                    UNINSURED
                  </span>
                )}
                {v.registered && v.insured && !v.stolen && !v.bolo && (
                  <span className="flex items-center gap-1 rounded border border-emerald-600/40 bg-emerald-500/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-emerald-400">
                    CLEAR
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 px-5 py-3 border-b border-[#0f1c2e] bg-[#060e1b]">
            <button
              type="button"
              onClick={() => { onWarn(v.owner_name ?? ''); onClose(); }}
              className="flex-1 flex items-center justify-center gap-1.5 rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-yellow-400 hover:bg-yellow-500/20 transition-colors"
            >
              <AlertTriangle className="h-3 w-3" /> Warning
            </button>
            <button
              type="button"
              onClick={() => { onCite(v.owner_name ?? '', v.owner_id ?? null); onClose(); }}
              className="flex-1 flex items-center justify-center gap-1.5 rounded border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-blue-400 hover:bg-blue-500/20 transition-colors"
            >
              <FileText className="h-3 w-3" /> Cite
            </button>
            <button
              type="button"
              onClick={handleToggleStolen}
              disabled={stolenLoading}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded border px-3 py-2 text-[9px] font-black uppercase tracking-widest transition-colors disabled:opacity-50 ${
                selected?.stolen
                  ? 'border-red-500/60 bg-red-500/20 text-red-300 hover:bg-red-500/30'
                  : 'border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20'
              }`}
            >
              <Car className="h-3 w-3" /> {selected?.stolen ? 'Unstolen' : 'Stolen'}
            </button>
            <button
              type="button"
              onClick={() => selected?.bolo ? handleClearBolo() : setShowBoloModal(true)}
              disabled={boloLoading}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded border px-3 py-2 text-[9px] font-black uppercase tracking-widest transition-colors disabled:opacity-50 ${
                selected?.bolo
                  ? 'border-orange-500/60 bg-orange-500/20 text-orange-300 hover:bg-orange-500/30'
                  : 'border-orange-500/30 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20'
              }`}
            >
              <Radio className="h-3 w-3" /> {selected?.bolo ? 'Clear BOLO' : 'BOLO'}
            </button>
          </div>

          {/* Vehicle detail grid */}
          <div className="grid grid-cols-2 gap-px bg-[#0a1520] border-b border-[#0f1c2e]">
            {[
              ['Make',        v.make],
              ['Model',       v.model  ?? '—'],
              ['Year',        v.year   ?? '—'],
              ['Colour',      v.color  ?? '—'],
              ['VIN',         v.vin    ?? '—'],
              ['Registered',  v.registered ? 'Yes' : 'No'],
              ['Insured',     v.insured    ? 'Yes' : 'No'],
              ['Stolen',      v.stolen     ? 'Yes' : 'No'],
            ].map(([lbl, val]) => (
              <div key={lbl} className="flex flex-col gap-0.5 px-5 py-3 bg-[#050d1a]">
                <span className="text-[8px] font-black uppercase tracking-[0.25em] text-[#3a5070]">{lbl}</span>
                <span className={`text-[11px] font-semibold ${
                  (lbl === 'Stolen' && val === 'Yes') ? 'text-red-400' :
                  (lbl === 'Registered' && val === 'No') ? 'text-orange-400' :
                  (lbl === 'Insured' && val === 'No') ? 'text-yellow-400' : 'text-white'
                }`}>{val}</span>
              </div>
            ))}
          </div>

          {/* Owner section */}
          <div className="px-5 py-4">
            <p className="mb-3 text-[8px] font-black uppercase tracking-[0.25em] text-[#3a5070]">Registered Owner</p>
            {ownerLoading ? (
              <div className="flex items-center gap-3 rounded-lg border border-[#172235] bg-[#050d1a] px-4 py-3 animate-pulse">
                <div className="h-8 w-8 rounded-full bg-[#0a1a2a] shrink-0" />
                <div className="h-3 w-36 rounded bg-[#0a1a2a]" />
              </div>
            ) : !v.owner_id || !owner ? (
              <div className="flex items-center gap-3 rounded-lg border border-[#172235] bg-[#050d1a] px-4 py-3">
                <User className="h-5 w-5 text-[#1a2a3a] shrink-0" />
                <p className="text-[10px] text-[#3a5070]">{v.owner_name ?? 'No registered owner on file'}</p>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-[#1a3060] bg-[#050d1a] px-4 py-3">
                <div className="h-8 w-8 rounded-full border border-[#1a3060] bg-[#060f20] flex items-center justify-center shrink-0">
                  <User className="h-3.5 w-3.5 text-[#4384ff]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-black text-white">{owner.first_name} {owner.last_name}</p>
                  {owner.wanted && (
                    <span className="mt-0.5 inline-flex items-center gap-1 rounded border border-red-500/50 bg-red-500/10 px-1.5 py-px text-[8px] font-black uppercase tracking-widest text-red-400">
                      <span className="h-1 w-1 rounded-full bg-red-400" />WANTED
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowOwnerRecord(true)}
                  className="shrink-0 flex items-center gap-1.5 rounded border border-[#2f70ff]/40 bg-[#2f70ff]/10 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-[#4384ff] hover:bg-[#2f70ff]/20 transition-colors"
                >
                  <User className="h-3 w-3" />
                  View Record
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      </>
    );
  }

  // ── Search / list view ───────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-[520px] rounded-lg border border-[#1a2e4a] bg-[#0d1520] shadow-2xl overflow-hidden">

        {/* Title bar */}
        <div className="flex items-center gap-2 border-b border-[#0f1c2e] bg-[#08111e] px-4 py-2.5">
          <Car className="h-3.5 w-3.5 text-[#4384ff]" />
          <span className="text-[11px] font-black uppercase tracking-[0.22em] text-white">Vehicle Database</span>
          <button type="button" onClick={onClose}
            className="ml-auto h-2.5 w-2.5 rounded-full bg-red-500/70 hover:bg-red-500 transition-colors" />
        </div>

        {/* Search input */}
        <div className="px-4 py-4 bg-[#06101a]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#2a3a50]" />
            {loading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="h-3.5 w-3.5 rounded-full border-2 border-[#2f70ff]/30 border-t-[#4384ff] animate-spin" />
              </div>
            )}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Escape' && onClose()}
              placeholder="Plate or VIN…"
              className="h-10 w-full rounded-md border border-[#1a2e4a] bg-[#040c18] pl-9 pr-9 text-[13px] font-black tracking-[0.2em] text-white placeholder:text-[#1e3050] placeholder:tracking-normal placeholder:font-normal outline-none focus:border-[#2f70ff] focus:shadow-[0_0_0_2px_rgba(47,112,255,0.15)] transition-all uppercase"
            />
          </div>
          <p className="mt-1.5 text-[9px] text-[#2a3a50]">Type any part of a plate or VIN — results appear instantly</p>
        </div>

        {/* Results list */}
        {hasQuery && (
          <div className="border-t border-[#0a1520] max-h-[400px] overflow-y-auto bg-[#030912]">
            {loading ? (
              /* Skeleton rows */
              <div className="flex flex-col divide-y divide-[#060e18]">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
                    <div className="h-8 w-8 rounded bg-[#0a1a2a] shrink-0" />
                    <div className="flex flex-col gap-2 flex-1">
                      <div className="h-3 w-24 rounded bg-[#0a1a2a]" />
                      <div className="h-2 w-40 rounded bg-[#060f1e]" />
                    </div>
                  </div>
                ))}
              </div>
            ) : searched && results.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-1.5 py-10">
                <X className="h-6 w-6 text-[#0d1a2a]" />
                <p className="text-[10px] font-bold text-[#1e2e42]">No vehicles match "{query}"</p>
                <p className="text-[9px] text-[#131e2d]">Try a partial plate or VIN</p>
              </div>
            ) : results.length > 0 ? (
              <>
                <div className="flex items-center border-b border-[#0a1520] bg-[#040c18] px-4 py-1.5">
                  <span className="text-[9px] font-black uppercase tracking-widest text-[#3a5070]">
                    {results.length} result{results.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="divide-y divide-[#060e18]">
                  {results.map(v => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => handleSelectVehicle(v)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#0d1a30] transition-colors group"
                    >
                      <div className="h-8 w-8 rounded border border-[#1a3060] bg-[#060f20] flex items-center justify-center shrink-0">
                        <Car className="h-3.5 w-3.5 text-[#4384ff]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[12px] font-black tracking-[0.18em] text-white">{v.plate}</span>
                          {v.stolen && (
                            <span className="flex items-center gap-1 rounded border border-red-500/50 bg-red-500/10 px-1.5 py-px text-[8px] font-black uppercase tracking-widest text-red-400">
                              <span className="h-1 w-1 rounded-full bg-red-400" />STOLEN
                            </span>
                          )}
                          {!v.registered && (
                            <span className="rounded border border-orange-500/40 bg-orange-500/10 px-1.5 py-px text-[8px] font-black uppercase tracking-widest text-orange-400">
                              UNREGISTERED
                            </span>
                          )}
                          {!v.insured && (
                            <span className="rounded border border-yellow-500/40 bg-yellow-500/10 px-1.5 py-px text-[8px] font-black uppercase tracking-widest text-yellow-400">
                              UNINSURED
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[9px] text-[#3a5070]">
                          {[v.year, v.color, v.make, v.model].filter(Boolean).join(' ')}
                          {v.owner_name ? ` · ${v.owner_name}` : ''}
                        </p>
                      </div>
                      <ChevronDown className="-rotate-90 h-3.5 w-3.5 shrink-0 text-[#1e2e42] group-hover:text-[#4384ff] transition-colors" />
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        )}

        {/* Idle state — only when nothing typed */}
        {!hasQuery && (
          <div className="flex flex-col items-center justify-center gap-2 py-10 border-t border-[#0a1520]">
            <Car className="h-8 w-8 text-[#0d1a2a]" />
            <p className="text-[11px] font-bold text-[#1e2e42]">Search the vehicle database</p>
            <p className="text-[10px] text-[#131e2d]">Enter a plate or VIN to see matching records</p>
          </div>
        )}

      </div>
    </div>
  );
}

function ResourcesModal({ onClose, onCallHistory }: { onClose: () => void; onCallHistory: () => void }) {
  const comingSoon = [
    { icon: BookOpen, label: '10-Codes',    desc: 'Radio ten-code reference guide'  },
    { icon: Scale,    label: 'Penal Codes', desc: 'Penal code and charge reference' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-[380px] rounded-lg border border-[#1a2e4a] bg-[#0d1520] shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[#0f1c2e] bg-[#08111e] px-4 py-2.5">
          <Library className="h-3.5 w-3.5 text-[#4384ff]" />
          <span className="text-[11px] font-black uppercase tracking-[0.22em] text-white">Resources</span>
          <button type="button" onClick={onClose}
            className="ml-auto h-2.5 w-2.5 rounded-full bg-red-500/70 hover:bg-red-500 transition-colors"
            aria-label="Close" />
        </div>
        <div className="flex flex-col gap-1 p-3">
          {/* Coming-soon entries */}
          {comingSoon.map(({ icon: Icon, label, desc }) => (
            <button key={label} type="button" disabled
              className="flex items-center gap-3 rounded border cursor-not-allowed border-[#0f1c2e] bg-[#060e18] opacity-40 px-4 py-3 text-left">
              <Icon className="h-4 w-4 shrink-0 text-[#3a5070]" />
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#3a5070]">{label}</span>
                <span className="text-[9px] font-semibold text-[#3a5070]">{desc}</span>
              </div>
              <span className="ml-auto text-[8px] font-black uppercase tracking-widest text-[#2a3a50] border border-[#1a2e4a] rounded px-1.5 py-0.5">
                Coming Soon
              </span>
            </button>
          ))}
          {/* Call History — live */}
          <button type="button" onClick={onCallHistory}
            className="flex items-center gap-3 rounded border px-4 py-3 text-left transition-colors border-[#1a2e4a] bg-[#08111e] hover:border-[#2f70ff] hover:bg-[#0d1a30]">
            <History className="h-4 w-4 shrink-0 text-[#4384ff]" />
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white">Call History</span>
              <span className="text-[9px] font-semibold text-[#3a5070]">Browse and search all CAD calls</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

function ReportsModal({ onClose, onArrestReport, onCitationReport }: { onClose: () => void; onArrestReport: () => void; onCitationReport: () => void }) {
  const options: { icon: React.ElementType; label: string; desc: string; action?: () => void }[] = [
    { icon: FileText,      label: 'Scene Report',     desc: 'Document an incident or scene attended' },
    { icon: Shield,        label: 'Arrest Report',    desc: 'File a report for an arrest made',       action: onArrestReport },
    { icon: Users,         label: 'Supervisor Report', desc: 'Submit a report to a supervisor'       },
    { icon: ClipboardList, label: 'Citation Report',  desc: 'File a citation issued to a subject',   action: onCitationReport },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-[420px] rounded-lg border border-[#1a2e4a] bg-[#0d1520] shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[#0f1c2e] bg-[#08111e] px-4 py-2.5">
          <FileText className="h-3.5 w-3.5 text-[#4384ff]" />
          <span className="text-[11px] font-black uppercase tracking-[0.22em] text-white">Reports</span>
          <button type="button" onClick={onClose}
            className="ml-auto h-2.5 w-2.5 rounded-full bg-red-500/70 hover:bg-red-500 transition-colors"
            aria-label="Close" />
        </div>
        <div className="flex flex-col gap-1 p-3">
          {options.map(({ icon: Icon, label, desc, action }) => {
            const disabled = !action;
            return (
              <button key={label} type="button" disabled={disabled} onClick={action}
                className={`flex items-center gap-3 rounded border px-4 py-3 text-left transition-colors ${
                  disabled
                    ? 'cursor-not-allowed border-[#0f1c2e] bg-[#060e18] opacity-40'
                    : 'border-[#1a2e4a] bg-[#08111e] hover:border-[#2f70ff] hover:bg-[#0d1a30]'
                }`}>
                <Icon className={`h-4 w-4 shrink-0 ${disabled ? 'text-[#3a5070]' : 'text-[#4384ff]'}`} />
                <div className="flex flex-col gap-0.5">
                  <span className={`text-[10px] font-black uppercase tracking-[0.18em] ${disabled ? 'text-[#3a5070]' : 'text-white'}`}>{label}</span>
                  <span className="text-[9px] font-semibold text-[#3a5070]">{desc}</span>
                </div>
                {disabled && (
                  <span className="ml-auto text-[8px] font-black uppercase tracking-widest text-[#2a3a50] border border-[#1a2e4a] rounded px-1.5 py-0.5">
                    Coming Soon
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Arrest Report Modal ────────────────────────────────────────────────────────
function ArrestReportModal({
  onClose, subject = '', officer = '',
}: {
  onClose: () => void; subject?: string; officer?: string;
}) {
  const [form, setForm] = useState({
    subject, officer,
    date: new Date().toISOString().slice(0, 16),
    location: '', charges: '', notes: '',
  });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const labelCls = 'text-[8px] font-black uppercase tracking-[0.25em] text-[#3a5070]';
  const inputCls = 'w-full rounded border border-[#1a2e4a] bg-[#060f1e] px-3 py-2 text-[11px] font-semibold text-white placeholder:text-[#1e3050] outline-none focus:border-[#2f70ff] transition-colors';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-sm">
      <div className="w-[520px] max-h-[90vh] flex flex-col rounded-xl border border-[#1a2e4a] bg-[#0a1220] shadow-2xl overflow-hidden">

        {/* Title bar */}
        <div className="flex items-center gap-2 shrink-0 bg-[#06101a] px-4 py-2.5 border-b border-[#0f1c2e]">
          <Scale className="h-3.5 w-3.5 text-red-400" />
          <span className="text-[11px] font-black uppercase tracking-[0.22em] text-white">Arrest Report</span>
          <button type="button" onClick={onClose}
            className="ml-auto h-2.5 w-2.5 rounded-full bg-red-500/70 hover:bg-red-500 transition-colors" />
        </div>

        {/* Form body */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-4 px-6 py-5">

            {/* Subject + Officer */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Subject Name <span className="text-red-400">*</span></label>
                <input type="text" required value={form.subject}
                  onChange={e => set('subject', e.target.value)}
                  placeholder="First Last" className={inputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Arresting Officer</label>
                <input type="text" value={form.officer}
                  onChange={e => set('officer', e.target.value)}
                  placeholder="Officer name" className={inputCls} />
              </div>
            </div>

            {/* Date/Time + Location */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Date &amp; Time <span className="text-red-400">*</span></label>
                <input type="datetime-local" required value={form.date}
                  onChange={e => set('date', e.target.value)}
                  className={`${inputCls} [color-scheme:dark]`} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Location</label>
                <input type="text" value={form.location}
                  onChange={e => set('location', e.target.value)}
                  placeholder="Street / area of arrest" className={inputCls} />
              </div>
            </div>

            {/* Charges */}
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>Charges <span className="text-red-400">*</span></label>
              <textarea required rows={3} value={form.charges}
                onChange={e => set('charges', e.target.value)}
                placeholder="List charges, one per line"
                className={`${inputCls} resize-none leading-relaxed`} />
            </div>

            {/* Notes */}
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>Notes</label>
              <textarea rows={3} value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="Additional notes, circumstances, or observations"
                className={`${inputCls} resize-none leading-relaxed`} />
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 shrink-0 border-t border-[#0f1c2e] bg-[#06101a] px-6 py-3">
          <button type="button" onClick={onClose}
            className="px-4 py-1.5 text-[9px] font-black uppercase tracking-widest text-[#526179] hover:text-white transition-colors">
            Cancel
          </button>
          <button type="button"
            className="flex items-center gap-1.5 rounded border border-red-500/40 bg-red-500/15 px-4 py-1.5 text-[9px] font-black uppercase tracking-widest text-red-400 hover:bg-red-500/25 transition-colors">
            <Scale className="h-3 w-3" />
            File Arrest Report
          </button>
        </div>

      </div>
    </div>
  );
}

// ── Warning Modal ──────────────────────────────────────────────────────────────
function WarningModal({
  onClose, subject = '', officer = '',
}: {
  onClose: () => void; subject?: string; officer?: string;
}) {
  const [form, setForm] = useState({
    subject, officer,
    date: new Date().toISOString().slice(0, 16),
    location: '', reason: '', notes: '',
  });
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const labelCls = 'text-[8px] font-black uppercase tracking-[0.25em] text-[#3a5070]';
  const inputCls = 'w-full rounded border border-[#1a2e4a] bg-[#060f1e] px-3 py-2 text-[11px] font-semibold text-white placeholder:text-[#1e3050] outline-none focus:border-[#2f70ff] transition-colors';

  const handleSubmit = async () => {
    if (!form.subject.trim()) { setErrorMsg('Subject name is required.'); setStatus('error'); return; }
    if (!form.reason.trim())  { setErrorMsg('Reason is required.');        setStatus('error'); return; }
    setStatus('saving');
    setErrorMsg('');
    try {
      const res = await fetch('/api/reports/warning', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subject:   form.subject.trim(),
          officer:   form.officer.trim() || undefined,
          date_time: form.date || undefined,
          location:  form.location.trim() || undefined,
          reason:    form.reason.trim(),
          notes:     form.notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Failed to save warning.');
      }
      setStatus('success');
      setTimeout(onClose, 1200);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save warning.');
      setStatus('error');
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-sm">
      <div className="w-[520px] max-h-[90vh] flex flex-col rounded-xl border border-[#1a2e4a] bg-[#0a1220] shadow-2xl overflow-hidden">

        {/* Title bar */}
        <div className="flex items-center gap-2 shrink-0 bg-[#06101a] px-4 py-2.5 border-b border-[#0f1c2e]">
          <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />
          <span className="text-[11px] font-black uppercase tracking-[0.22em] text-white">Warning</span>
          <button type="button" onClick={onClose}
            className="ml-auto h-2.5 w-2.5 rounded-full bg-red-500/70 hover:bg-red-500 transition-colors" />
        </div>

        {/* Success banner */}
        {status === 'success' && (
          <div className="shrink-0 flex items-center gap-2 border-b border-emerald-500/30 bg-emerald-500/10 px-6 py-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Warning issued successfully</span>
          </div>
        )}

        {/* Form body */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-4 px-6 py-5">

            {/* Subject + Officer */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Subject Name <span className="text-red-400">*</span></label>
                <input type="text" required value={form.subject}
                  onChange={e => set('subject', e.target.value)}
                  placeholder="First Last" className={inputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Issuing Officer</label>
                <input type="text" value={form.officer}
                  onChange={e => set('officer', e.target.value)}
                  placeholder="Officer name" className={inputCls} />
              </div>
            </div>

            {/* Date/Time + Location */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Date &amp; Time</label>
                <input type="datetime-local" value={form.date}
                  onChange={e => set('date', e.target.value)}
                  className={`${inputCls} [color-scheme:dark]`} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Location</label>
                <input type="text" value={form.location}
                  onChange={e => set('location', e.target.value)}
                  placeholder="Street / area" className={inputCls} />
              </div>
            </div>

            {/* Reason */}
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>Reason <span className="text-red-400">*</span></label>
              <textarea rows={3} required value={form.reason}
                onChange={e => set('reason', e.target.value)}
                placeholder="Describe the reason for the warning…"
                className={`${inputCls} resize-none`} />
            </div>

            {/* Notes */}
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>Additional Notes</label>
              <textarea rows={2} value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="Any additional context…"
                className={`${inputCls} resize-none`} />
            </div>

            {/* Error */}
            {status === 'error' && (
              <p className="text-[10px] font-bold text-red-400">{errorMsg}</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-end gap-2 border-t border-[#0f1c2e] bg-[#06101a] px-6 py-3">
          <button type="button" onClick={onClose}
            className="rounded border border-[#1a2e4a] px-4 py-1.5 text-[9px] font-black uppercase tracking-widest text-[#66748a] hover:text-white transition-colors">
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={status === 'saving' || status === 'success'}
            className="flex items-center gap-1.5 rounded border border-orange-500/40 bg-orange-500/15 px-4 py-1.5 text-[9px] font-black uppercase tracking-widest text-orange-400 hover:bg-orange-500/25 transition-colors disabled:opacity-50">
            <AlertTriangle className="h-3 w-3" />
            {status === 'saving' ? 'Saving…' : 'Issue Warning'}
          </button>
        </div>

      </div>
    </div>
  );
}

// ── New Call Modal ─────────────────────────────────────────────────────────────
const CALL_ORIGINS  = ['Civilian 911', 'Officer Initiated', 'Radio', 'Walk-In', 'Anonymous', 'Other'];
const CALL_STATUSES = ['Pending', 'Active', 'On-Scene', 'Closed'];
const PRIORITIES: { value: number; label: string; color: string; bg: string; border: string }[] = [
  { value: 1, label: 'P1 — Emergency', color: 'text-red-400',    bg: 'bg-red-500/15',    border: 'border-red-500/40'    },
  { value: 2, label: 'P2 — High',      color: 'text-orange-400', bg: 'bg-orange-500/15', border: 'border-orange-500/40' },
  { value: 3, label: 'P3 — Medium',    color: 'text-yellow-400', bg: 'bg-yellow-500/15', border: 'border-yellow-500/40' },
  { value: 4, label: 'P4 — Low',       color: 'text-sky-400',    bg: 'bg-sky-500/15',    border: 'border-sky-500/40'    },
];

function NewCallModal({
  onClose, onCreated, units, createdBy,
}: {
  onClose: () => void; onCreated: () => void; units: ActiveUnit[]; createdBy: string;
}) {
  const [form, setForm] = useState({
    origin: '',
    status: 'Pending',
    location: '',
    ten_code: '',
    description: '',
    priority: 3,
  });
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const set = (k: string, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  const toggleUnit = (callsign: string) =>
    setSelectedUnits(prev =>
      prev.includes(callsign) ? prev.filter(u => u !== callsign) : [...prev, callsign]
    );

  const labelCls  = 'text-[8px] font-black uppercase tracking-[0.25em] text-[#3a5070]';
  const inputCls  = 'w-full rounded border border-[#1a2e4a] bg-[#060f1e] px-3 py-2 text-[11px] font-semibold text-white placeholder:text-[#1e3050] outline-none focus:border-[#2f70ff] transition-colors';
  const selectCls = `${inputCls} appearance-none cursor-pointer`;

  const handleSubmit = async () => {
    if (!form.origin) { setErrorMsg('Call origin is required.'); setStatus('error'); return; }
    setStatus('saving');
    setErrorMsg('');
    try {
      const res = await fetch('/api/cad/calls', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          origin:      form.origin,
          status:      form.status,
          location:    form.location || undefined,
          ten_code:    form.ten_code || undefined,
          units:       selectedUnits.length > 0 ? selectedUnits : undefined,
          description: form.description || undefined,
          priority:    form.priority,
          created_by:  createdBy,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Failed to create call.');
      }
      setStatus('success');
      onCreated();
      setTimeout(onClose, 1100);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create call.');
      setStatus('error');
    }
  };

  const activePriority = PRIORITIES.find(p => p.value === form.priority)!;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm">
      <div className="w-[560px] max-h-[92vh] flex flex-col rounded-xl border border-[#1a2e4a] bg-[#0a1220] shadow-2xl overflow-hidden">

        {/* Title bar */}
        <div className="flex items-center gap-2 shrink-0 bg-[#06101a] px-4 py-2.5 border-b border-[#0f1c2e]">
          <PhoneCall className="h-3.5 w-3.5 text-[#4384ff]" />
          <span className="text-[11px] font-black uppercase tracking-[0.22em] text-white">New Call</span>
          <button type="button" onClick={onClose}
            className="ml-auto h-2.5 w-2.5 rounded-full bg-red-500/70 hover:bg-red-500 transition-colors" />
        </div>

        {/* Success banner */}
        {status === 'success' && (
          <div className="shrink-0 flex items-center gap-2 border-b border-emerald-500/30 bg-emerald-500/10 px-6 py-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Call created successfully</span>
          </div>
        )}

        {/* Form body */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5 px-6 py-5">

            {/* Row 1: Origin + Status */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Call Origin <span className="text-red-400">*</span></label>
                <select value={form.origin} onChange={e => set('origin', e.target.value)} className={selectCls}>
                  <option value="" disabled>Select origin…</option>
                  {CALL_ORIGINS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Call Status</label>
                <select value={form.status} onChange={e => set('status', e.target.value)} className={selectCls}>
                  {CALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            {/* Row 2: Location + 10-Code */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Location</label>
                <input type="text" value={form.location} onChange={e => set('location', e.target.value)}
                  placeholder="Street / area" className={inputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>10-Code</label>
                <input type="text" value={form.ten_code} onChange={e => set('ten_code', e.target.value)}
                  placeholder="e.g. 10-39" className={inputCls} />
              </div>
            </div>

            {/* Priority */}
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>Call Priority</label>
              <div className="grid grid-cols-4 gap-2">
                {PRIORITIES.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => set('priority', p.value)}
                    className={`rounded border px-2 py-2 text-[9px] font-black uppercase tracking-widest transition-colors ${
                      form.priority === p.value
                        ? `${p.border} ${p.bg} ${p.color}`
                        : 'border-[#1a2e4a] bg-[#060f1e] text-[#3a5070] hover:border-[#263247] hover:text-[#66748a]'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Units */}
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>
                Unit/s
                {selectedUnits.length > 0 && (
                  <span className="ml-2 rounded bg-[#4384ff]/20 px-1.5 py-0.5 text-[8px] text-[#4384ff]">
                    {selectedUnits.length} selected
                  </span>
                )}
              </label>
              {units.length === 0 ? (
                <p className="text-[10px] text-[#3a5070] italic">No units currently signed on.</p>
              ) : (
                <div className="max-h-[120px] overflow-y-auto rounded border border-[#1a2e4a] bg-[#060f1e] p-1.5 space-y-0.5">
                  {units.map(u => {
                    const checked = selectedUnits.includes(u.callsign);
                    return (
                      <button
                        key={u.userId}
                        type="button"
                        onClick={() => toggleUnit(u.callsign)}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                          checked ? 'bg-[#4384ff]/15 text-white' : 'text-[#66748a] hover:bg-[#0a1a30] hover:text-[#a8b7cd]'
                        }`}
                      >
                        <span className={`h-3.5 w-3.5 shrink-0 rounded border flex items-center justify-center text-[8px] font-black transition-colors ${
                          checked ? 'border-[#4384ff] bg-[#4384ff] text-white' : 'border-[#1a2e4a] bg-transparent'
                        }`}>
                          {checked && '✓'}
                        </span>
                        <span className="text-[10px] font-black">{u.callsign}</span>
                        <span className="text-[9px] text-[#3a5070]">{u.rank}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Description */}
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>Description</label>
              <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)}
                placeholder="Describe the nature of the call…"
                className={`${inputCls} resize-none`} />
            </div>

            {/* Error */}
            {status === 'error' && (
              <p className="text-[10px] font-bold text-red-400">{errorMsg}</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between border-t border-[#0f1c2e] bg-[#06101a] px-6 py-3">
          {/* Priority summary pill */}
          <span className={`rounded border px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${activePriority.border} ${activePriority.bg} ${activePriority.color}`}>
            {activePriority.label}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose}
              className="rounded border border-[#1a2e4a] px-4 py-1.5 text-[9px] font-black uppercase tracking-widest text-[#66748a] hover:text-white transition-colors">
              Cancel
            </button>
            <button type="button" onClick={handleSubmit}
              disabled={status === 'saving' || status === 'success'}
              className="flex items-center gap-1.5 rounded border border-[#4384ff]/40 bg-[#4384ff]/15 px-4 py-1.5 text-[9px] font-black uppercase tracking-widest text-[#4384ff] hover:bg-[#4384ff]/25 transition-colors disabled:opacity-50">
              <PhoneCall className="h-3 w-3" />
              {status === 'saving' ? 'Creating…' : 'Create Call'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-[#060e1a] px-4 py-2.5 animate-pulse">
          {[40, 60, 80, 50, 45, 55].map((w, j) => (
            <div key={j} className="h-2.5 rounded" style={{ width: `${w}px`, background: '#0a1a2a' }} />
          ))}
        </div>
      ))}
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function DocCadPage() {
  const navigate   = useNavigate();
  const { online: cadOnline, mode: cadMode } = useCadStatus();
  const selfDispatch   = useSelfDispatch();
  const clock      = useClock();
  const isMounted  = useRef(true);

  const [session, setSession]         = useState(getCadSession());
  const [unitSearch,  setUnitSearch]  = useState('');
  const [callSearch,  setCallSearch]  = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [activeUnits, setActiveUnits] = useState<ActiveUnit[]>([]);
  const [myUnit, setMyUnit]           = useState<ActiveUnit | null>(null);
  const [unitsLoaded, setUnitsLoaded] = useState(false);
  const [showGate, setShowGate]       = useState(true);
  const [showDbSearch, setShowDbSearch]       = useState(false);
  const [showCallHistory, setShowCallHistory] = useState(false);
  const [showDispatchDrop, setShowDispatchDrop] = useState(false);
  const dispatchDropRef = useRef<HTMLDivElement>(null);
  const [showReports, setShowReports]         = useState(false);
  const [showResources, setShowResources]     = useState(false);
  const [showNameSearch, setShowNameSearch]     = useState(false);
  const [showVehicleSearch, setShowVehicleSearch] = useState(false);
  const [selectedCivilian, setSelectedCivilian] = useState<CivilianResult | null>(null);
  const [showArrestReport, setShowArrestReport]     = useState(false);
  const [arrestSubject, setArrestSubject]           = useState('');
  const [showCitationReport, setShowCitationReport] = useState(false);
  const [citationSubject, setCitationSubject]       = useState('');
  const [citationCivilianId, setCitationCivilianId] = useState<number | null>(null);
  const [showWarning, setShowWarning]               = useState(false);
  const [warningSubject, setWarningSubject]         = useState('');
  const [showNewCall, setShowNewCall]               = useState(false);
  const [cadCalls, setCadCalls]                     = useState<ManualCall[]>([]);
  const [cadCallsLoading, setCadCallsLoading]       = useState(true);
  const [bolos, setBolos]                           = useState<BoloRecord[]>([]);
  const [bolosLoading, setBolosLoading]             = useState(true);
  const [signingOff, setSigningOff]   = useState(false);
  const [unitGroups, setUnitGroups]   = useState<UnitGroup[]>([]);
  const [pendingInvite, setPendingInvite] = useState<GroupInvite | null>(null);

  // ERLC live data: calls and groups come from the ERLC API
  const { calls, groups, loading: erlcLoading, error: erlcError, lastUpdated } = useCadData();

  const callsign = session?.username ?? '—';
  const rank     = session?.doc_rank || session?.rank || 'Dispatcher';

  // ── Fetch active units ────────────────────────────────────────────────────────
  const fetchUnits = useCallback(async () => {
    try {
      const res = await fetch('/api/units/active', { headers: { accept: 'application/json' } });
      if (!res.ok) return;
      const data: ActiveUnit[] = await res.json();
      if (!isMounted.current) return;
      setActiveUnits(data);
      // DOC sign-on is local-only — never derive myUnit from the server poll.
      setUnitsLoaded(true);
    } catch { /* ignore */ }
  }, [session]);

  // ── Session guard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    isMounted.current = true;
    const s = getCadSession();
    if (!s) { navigate('/', { replace: true }); return; }

    const verify = async () => {
      try {
        const res = await fetch('/api/cad-auth/session-status', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ id: s.id, email: s.email }),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!data.active || !data.account) {
          clearCadSession();
          navigate('/', { replace: true });
          return;
        }

        let docRank: string | null = data.account.doc_rank ?? null;
        if (!docRank && data.account.username) {
          try {
            const meRes = await fetch(
              `/api/doc/me?username=${encodeURIComponent(data.account.username)}`,
              { headers: { accept: 'application/json' } },
            );
            if (meRes.ok) {
              const me = await meRes.json() as { doc_rank?: string | null } | null;
              docRank = me?.doc_rank ?? null;
            }
          } catch { /* non-fatal */ }
        }

        if (!canAccessDocCad(data.account, docRank)) {
          toast.error('You do not have access to the DOC CAD terminal.');
          navigate('/portal_dashboard', { replace: true });
          return;
        }

        const account = { ...data.account, doc_rank: docRank };
        if (isMounted.current) {
          setSession(account);
          setCadSession(account);
        }
      } catch { /* keep existing session on network error */ }
    };

    verify();
    const interval = setInterval(verify, 10_000);
    return () => { isMounted.current = false; clearInterval(interval); };
  }, [navigate]);

  // ── Unit heartbeat — skipped for DOC (units are not stored in active_units) ──

  // ── Poll active units ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetchUnits();
    const id = setInterval(fetchUnits, 5_000);
    return () => clearInterval(id);
  }, [fetchUnits]);

  // ── Close dispatch dropdown on outside click ──────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dispatchDropRef.current && !dispatchDropRef.current.contains(e.target as Node)) {
        setShowDispatchDrop(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Fetch manual CAD calls ────────────────────────────────────────────────────
  const fetchCadCalls = useCallback(async () => {
    try {
      const res = await fetch('/api/cad/calls', { headers: { accept: 'application/json' } });
      if (!res.ok || !isMounted.current) return;
      setCadCalls(await res.json());
    } catch { /* ignore */ } finally {
      if (isMounted.current) setCadCallsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCadCalls();
    const id = setInterval(fetchCadCalls, 15_000);
    return () => clearInterval(id);
  }, [fetchCadCalls]);

  // ── Poll unit groups & invites ────────────────────────────────────────────────
  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const res = await fetch('/api/units/groups', { headers: { accept: 'application/json' } });
        if (!res.ok || !isMounted.current) return;
        setUnitGroups(await res.json());
      } catch { /* ignore */ }
    };
    fetchGroups();
    const id = setInterval(fetchGroups, 5_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!session?.username) return;
    const fetchInvites = async () => {
      try {
        const res = await fetch(`/api/units/groups/invites?username=${encodeURIComponent(session.username)}`, { headers: { accept: 'application/json' } });
        if (!res.ok || !isMounted.current) return;
        const invites: GroupInvite[] = await res.json();
        if (invites.length > 0 && !pendingInvite) setPendingInvite(invites[0]);
      } catch { /* ignore */ }
    };
    fetchInvites();
    const id = setInterval(fetchInvites, 4_000);
    return () => clearInterval(id);
  }, [session?.username, pendingInvite]);

  // ── Fetch active BOLOs ────────────────────────────────────────────────────────
  const fetchBolos = useCallback(async () => {
    try {
      const res = await fetch('/api/civilian/bolos', { headers: { accept: 'application/json' } });
      if (!res.ok || !isMounted.current) return;
      setBolos(await res.json());
    } catch { /* ignore */ } finally {
      if (isMounted.current) setBolosLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBolos();
    const id = setInterval(fetchBolos, 15_000);
    return () => clearInterval(id);
  }, [fetchBolos]);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const handleSignOn = async (unitNumber: string, department: string, division: string) => {
    if (!session) return;
    // DOC units are not written to active_units — sign-on is local-only.
    const unit: ActiveUnit = {
      userId: session.id,
      username: session.username,
      callsign: session.username,
      unitNumber,
      department,
      division: division || undefined,
      rank: rank,
      status: 'Available',
      signedOnAt: Date.now(),
      lastHeartbeat: Date.now(),
    };
    setMyUnit(unit);
  };

  const handleSignOff = async () => {
    if (!session || !myUnit) return;
    setSigningOff(true);
    try {
      // DOC sign-off is local-only — no active_units row to remove.
      // Leave group on sign-off
      await fetch('/api/units/groups/leave', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: session.username }),
      }).catch(() => null);
      setMyUnit(null);
      setActiveUnits(prev => prev.filter(u => u.userId !== session.id));
      setShowGate(true);
    } finally {
      setSigningOff(false);
    }
  };

  const handleGroupInvite = async (toUsername: string) => {
    if (!session || !myUnit) return;
    try {
      await fetch('/api/units/groups/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fromUserId: session.id, toUsername }),
      });
    } catch { /* ignore */ }
  };

  const handleInviteRespond = async (accepted: boolean) => {
    if (!pendingInvite) return;
    try {
      await fetch(`/api/units/groups/invites/${pendingInvite.id}/respond`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accepted }),
      });
    } catch { /* ignore */ } finally {
      setPendingInvite(null);
    }
  };

  const handleStatusChange = async (status: UnitStatus) => {
    if (!myUnit) return;
    // DOC status is local-only — no active_units row to update.
    setMyUnit(prev => prev ? { ...prev, status } : prev);
  };

  // ── Dispatcher-level unit management (from right-click panel) ─────────────────
  const handleDispatchStatusChange = async (userId: number, status: UnitStatus) => {
    try {
      const res = await fetch(`/api/units/${userId}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return;
      const updated = await res.json();
      setActiveUnits(prev => prev.map(u => u.userId === userId ? updated : u));
    } catch { /* ignore */ }
  };

  const handleDispatchCallsignEdit = async (userId: number, unitNumber: string) => {
    const res = await fetch(`/api/units/${userId}/unitNumber`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ unitNumber }),
    });
    if (!res.ok) throw new Error('Failed to update callsign.');
    const updated = await res.json();
    setActiveUnits(prev => prev.map(u => u.userId === userId ? updated : u));
  };

  const handleDispatchGroupAssign = async (username: string, groupId: string | null) => {
    try {
      const res = await fetch('/api/units/groups/assign', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ username, groupId }),
      });
      if (!res.ok) return;
      const { groups: updated } = await res.json();
      setUnitGroups(updated);
    } catch { /* ignore */ }
  };

  // ── Filtered lists ────────────────────────────────────────────────────────────
  const filteredUnits = activeUnits.filter(u => {
    const q = unitSearch.toLowerCase();
    return !q || u.unitNumber.toLowerCase().includes(q) || u.callsign.toLowerCase().includes(q) || u.department.toLowerCase().includes(q);
  });

  const filteredCalls = cadCalls.filter(c => {
    if (c.status === 'Removed') return false;
    const q = callSearch.toLowerCase();
    return !q || c.origin.toLowerCase().includes(q)
              || (c.location ?? '').toLowerCase().includes(q)
              || (c.ten_code ?? '').toLowerCase().includes(q)
              || (c.description ?? '').toLowerCase().includes(q)
              || String(c.id).includes(q);
  });

  const filteredGroups = groups.filter(g => {
    const q = groupSearch.toLowerCase();
    return !q || g.name.toLowerCase().includes(q)
              || g.department.toLowerCase().includes(q);
  });

  const lastUpdatedStr = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-US', { hour12: false })
    : null;

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[#02060b] text-white">

      {showGate && session && unitsLoaded && (
        <UnitManagerGate
          myUnit={myUnit}
          callsign={callsign}
          rank={rank}
          avatarUrl={
            session.discord_id && session.avatar_hash
              ? `https://cdn.discordapp.com/avatars/${session.discord_id}/${session.avatar_hash}.png?size=128`
              : null
          }
          onClose={() => setShowGate(false)}
          onSignOn={handleSignOn}
          onSignOff={async () => { await handleSignOff(); navigate('/doc_personnel-roster'); }}
          onStatusChange={handleStatusChange}
        />
      )}

      {showDbSearch && (
        <DatabaseSearchModal
          onClose={() => setShowDbSearch(false)}
          onNameDb={() => { setShowDbSearch(false); setShowNameSearch(true); }}
          onVehicleDb={() => { setShowDbSearch(false); setShowVehicleSearch(true); }}
        />
      )}

      {showVehicleSearch && (
        <VehicleSearchModal
          onClose={() => setShowVehicleSearch(false)}
          onWarn={(subject) => { setWarningSubject(subject); setShowVehicleSearch(false); setShowWarning(true); }}
          onCite={(subject, civilianId) => { setCitationSubject(subject); setCitationCivilianId(civilianId); setShowVehicleSearch(false); setShowCitationReport(true); }}
          onBoloChanged={fetchBolos}
        />
      )}

      {showCallHistory && (
        <CallHistoryModal onClose={() => setShowCallHistory(false)} />
      )}

      {showNameSearch && !selectedCivilian && (
        <NameSearchModal
          onClose={() => setShowNameSearch(false)}
          onSelect={c => setSelectedCivilian(c)}
        />
      )}

      {selectedCivilian && (
        <CharacterProfileModal
          civilian={selectedCivilian}
          onClose={() => { setSelectedCivilian(null); setShowNameSearch(false); }}
          onBack={() => setSelectedCivilian(null)}
          onArrest={() => {
            const c = selectedCivilian;
            setArrestSubject(`${c.first_name} ${c.last_name}`);
            setShowArrestReport(true);
          }}
          onCite={() => {
            const c = selectedCivilian;
            setCitationSubject(`${c.first_name} ${c.last_name}`);
            setCitationCivilianId(c.id);
            setShowCitationReport(true);
          }}
          onWarn={() => {
            const c = selectedCivilian;
            setWarningSubject(`${c.first_name} ${c.last_name}`);
            setShowWarning(true);
          }}
          onBoloChanged={fetchBolos}
        />
      )}

      {showResources && (
        <ResourcesModal
          onClose={() => setShowResources(false)}
          onCallHistory={() => { setShowResources(false); setShowCallHistory(true); }}
        />
      )}

      {showReports && (
        <ReportsModal
          onClose={() => setShowReports(false)}
          onArrestReport={() => { setArrestSubject(''); setShowReports(false); setShowArrestReport(true); }}
          onCitationReport={() => { setCitationSubject(''); setCitationCivilianId(null); setShowReports(false); setShowCitationReport(true); }}
        />
      )}

      {showArrestReport && (
        <ArrestReportModal
          onClose={() => setShowArrestReport(false)}
          subject={arrestSubject}
          officer={callsign}
        />
      )}

      {showCitationReport && (
        <CitationReportModal
          onClose={() => setShowCitationReport(false)}
          subject={citationSubject}
          officer={callsign}
          civilianId={citationCivilianId}
        />
      )}

      {showWarning && (
        <WarningModal
          onClose={() => setShowWarning(false)}
          subject={warningSubject}
          officer={callsign}
        />
      )}

      {showNewCall && (
        <NewCallModal
          onClose={() => setShowNewCall(false)}
          onCreated={fetchCadCalls}
          units={activeUnits}
          createdBy={callsign}
        />
      )}

      {/* ── Top status bar ────────────────────────────────────────────────────── */}
      <header
        className={`grid shrink-0 items-center border-t border-t-[#0f1c2e] border-b-[3px] bg-[#03080f] px-4 py-2 ${myUnit ? STATUS_BORDER_B[myUnit.status] : 'border-b-[#0f1c2e]'}`}
        style={{ gridTemplateColumns: '1fr auto 1fr' }}
      >

        {/* ── Left: Back + divider + status buttons ── */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/doc_personnel-roster')}
            className="flex items-center gap-1.5 rounded border border-[#1a2e4a] bg-[#060f20] px-2.5 py-1 text-[10px] font-black text-[#a8b7cd] transition-colors hover:border-[#2f70ff] hover:text-[#4384ff]">
            <ArrowLeft className="h-3 w-3" />
            DOC
          </button>

          <div className="h-4 w-px bg-[#0f1c2e]" />

          {/* Status buttons — clickable when signed on */}
          <div className="flex items-center gap-1 rounded border border-[#0f1c2e] px-1 py-0.5">
            {STATUSES.map(s => {
              const isActive = myUnit?.status === s;
              const textCls =
                s === 'Available'   ? 'text-emerald-400' :
                s === 'Unavailable' ? 'text-red-400'     :
                s === 'Busy'        ? 'text-orange-400'  :
                s === 'Enroute'     ? 'text-blue-400'    : 'text-purple-400';
              return myUnit ? (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleStatusChange(s)}
                  className={`flex items-center gap-1.5 rounded px-2 py-1 transition-colors ${isActive ? `${STATUS_STYLES[s]} border` : 'border border-transparent hover:border-[#1a2e4a] hover:bg-[#060f20]'}`}
                >
                  <span className={`h-2 w-2 rounded-full shrink-0 ${STATUS_DOT[s]}`} />
                  <span className={`text-[9px] font-black uppercase tracking-wider ${textCls}`}>{s}</span>
                </button>
              ) : (
                <div key={s} className="flex items-center gap-1.5 px-2 py-1">
                  <span className="h-2 w-2 rounded-full shrink-0 bg-[#1e2e42]" />
                  <span className="text-[9px] font-black uppercase tracking-wider text-[#1e2e42]">{s}</span>
                </div>
              );
            })}
          </div>

          {/* SIGNAL 100 button */}
          <button
            type="button"
            disabled={!myUnit}
            className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-[9px] font-black uppercase tracking-widest transition-colors ${
              myUnit
                ? 'border-yellow-500/50 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 shadow-[0_0_10px_rgba(234,179,8,0.15)]'
                : 'cursor-not-allowed border-[#0f1c2e] text-[#1e2e42]'
            }`}
          >
            <span className={`h-2 w-2 rounded-full shrink-0 ${myUnit ? 'bg-yellow-400 shadow-[0_0_6px_rgba(234,179,8,0.8)]' : 'bg-[#1e2e42]'}`} />
            Signal 100
          </button>

        </div>

        {/* ── Centre: Tool buttons ── */}
        <div className="flex items-center gap-1 justify-center">
          {[
            { icon: Database,     label: 'Database Search', onClick: () => setShowDbSearch(true),  requiresUnit: true  },
            { icon: FileText,     label: 'Reports',         onClick: () => setShowReports(true),   requiresUnit: true  },
            { icon: Library,      label: 'Resources',       onClick: () => setShowResources(true), requiresUnit: true  },
            { icon: NotebookPen,  label: 'Note Pad',        onClick: undefined,                    requiresUnit: true  },
            { icon: PhoneCall,    label: 'New Call',        onClick: () => setShowNewCall(true),   requiresUnit: true  },
          ].map(({ icon: Icon, label, onClick, requiresUnit }) => {
            const disabled = requiresUnit && !myUnit;
            return (
              <button
                key={label}
                type="button"
                disabled={disabled}
                onClick={onClick}
                className={`flex items-center gap-1.5 rounded border border-transparent px-2 py-1 text-[9px] font-black uppercase tracking-wider transition-colors ${
                  !disabled
                    ? 'text-white hover:border-[#1a2e4a] hover:bg-[#060f20] hover:text-white'
                    : 'cursor-not-allowed text-[#1e2e42]'
                }`}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            );
          })}
        </div>

        {/* ── Right: indicators + controls ── */}
        <div className="flex items-center justify-end gap-3">

          {/* CAD status */}
          <div className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${
            cadOnline === false
              ? 'border-red-500/30 bg-red-500/5 text-red-400'
              : 'border-[#0f1c2e] bg-[#02060b] text-[#4384ff]'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${cadOnline === false ? 'bg-red-500' : 'bg-[#4384ff] shadow-[0_0_6px_rgba(67,132,255,0.7)]'}`} />
            {cadOnline === null ? 'Terminal Online' : `Terminal ${cadModeLabel(cadMode)}`}
          </div>

          {/* Active / Self Dispatch status — click for dropdown */}
          <div ref={dispatchDropRef} className="relative">
            <button
              type="button"
              onClick={() => setShowDispatchDrop(v => !v)}
              className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider transition-colors ${
                myUnit?.status === 'Available'   ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20' :
                myUnit?.status === 'Busy'        ? 'border-orange-500/40 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20' :
                myUnit?.status === 'Unavailable' ? 'border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20' :
                selfDispatch                     ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400 hover:bg-emerald-500/10' :
                                                   'border-[#0f1c2e] bg-[#02060b] text-[#526179] hover:bg-[#060f1e]'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                myUnit?.status === 'Available'   ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]' :
                myUnit?.status === 'Busy'        ? 'bg-orange-400' :
                myUnit?.status === 'Unavailable' ? 'bg-red-500' :
                selfDispatch                     ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]' :
                                                   'bg-[#2a3a50]'
              }`} />
              {myUnit?.status === 'Available' ? 'Active Dispatch' : 'Self Dispatch'}
            </button>
            {showDispatchDrop && (
              <div className="absolute left-0 top-full mt-1 z-50 min-w-[160px] rounded border border-[#1a2e4a] bg-[#060f1e] py-1 shadow-xl">
                <p className="px-3 py-1 text-[8px] font-black uppercase tracking-[0.2em] text-[#3a5070]">On Duty</p>
                {myUnit ? (
                  <div className="flex items-center gap-2 px-3 py-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                      myUnit.status === 'Available' ? 'bg-emerald-400' : myUnit.status === 'Busy' ? 'bg-orange-400' : 'bg-red-500'
                    }`} />
                    <span className="text-[9px] font-semibold text-[#7a9bbf]">{myUnit.division || 'Dispatch'}:</span>
                    <span className="text-[9px] font-black text-white">{myUnit.callsign}</span>
                  </div>
                ) : (
                  <p className="px-3 py-1.5 text-[9px] text-[#3a5070]">No dispatchers on duty</p>
                )}
              </div>
            )}
          </div>

          <div className="h-4 w-px bg-[#0f1c2e]" />

          {/* Unit / callsign chip — opens Unit Manager when signed on */}
          {myUnit ? (
            <button
              type="button"
              onClick={() => setShowGate(true)}
              className="flex items-center gap-1.5 rounded border border-[#1a3060] bg-[#060f20] px-2.5 py-1 transition-colors hover:border-[#2f70ff] hover:bg-[#07152a]"
            >
              <Shield className="h-3 w-3 text-[#4384ff]" />
              <span className="text-[10px] font-black text-white">{callsign}</span>
              <span className="text-[9px] text-[#3a5070]">·</span>
              <span className="text-[9px] font-semibold text-[#526179]">{rank}</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 rounded border border-[#1a3060] bg-[#060f20] px-2.5 py-1">
              <Shield className="h-3 w-3 text-[#4384ff]" />
              <span className="text-[10px] font-black text-white">{callsign}</span>
              <span className="text-[9px] text-[#3a5070]">·</span>
              <span className="text-[9px] font-semibold text-[#526179]">{rank}</span>
            </div>
          )}

          {/* Sign On (only shown when not yet signed on) */}
          {!myUnit && (
            <button
              type="button"
              onClick={() => setShowGate(true)}
              className="flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-emerald-400 transition-colors hover:bg-emerald-500/20"
            >
              <LogIn className="h-3 w-3" />
              Sign On
            </button>
          )}
        </div>
      </header>

      {/* ── Active Calls (full width, fixed height) ───────────────────────────── */}
      <section className="flex shrink-0 flex-col border-b border-[#0f1c2e]" style={{ height: '36%' }}>
        <PanelHeader
          icon={AlertCircle} label="Active Calls" accent="text-[#f4c542]"
          count={filteredCalls.length} search={callSearch} onSearch={setCallSearch}
        />
        <ColHeaders
          cols={['ID', 'Origin', 'Location', '10-Code', 'Units', 'Priority', 'Status', '']}
          flexes={['flex-[0.6]', 'flex-1', 'flex-[1.2]', 'flex-[0.7]', 'flex-[1.2]', 'flex-[0.5]', 'flex-[0.8]', 'w-16 shrink-0']}
        />
        <div className="flex-1 overflow-y-auto bg-[#02060b]">
          {cadCallsLoading ? (
            <SkeletonRows count={3} />
          ) : filteredCalls.length === 0 ? (
            <EmptyState icon={AlertCircle} line1="No active calls for service" line2="Use New Call in the toolbar to create one" />
          ) : (
            filteredCalls.map(c => (
              <CallRow key={c.id} call={c} onRefresh={fetchCadCalls} activeUnits={activeUnits} myCallsign={callsign} />
            ))
          )}
        </div>
      </section>

      {/* ── Bottom half — left column (Units + Groups stacked) + right column (BOLO) */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left column: Active Units on top, Active Groups below */}
        <div className="flex flex-col border-r border-[#0f1c2e]" style={{ width: '55%' }}>

          {/* Active Units */}
          <section className="flex flex-col border-b border-[#0f1c2e]" style={{ flex: '1 1 0', minHeight: 0 }}>
            <PanelHeader
              icon={Radio} label="Active Units" accent="text-[#4384ff]"
              count={filteredUnits.length} search={unitSearch} onSearch={setUnitSearch}
            />
            <ColHeaders cols={['Unit #', 'Name', 'Rank', 'Location', 'Department', 'Division', 'Status']} />
            <div className="flex-1 overflow-y-auto bg-[#02060b]">
              {filteredUnits.length === 0 ? (
                <EmptyState
                  icon={Radio}
                  line1="No units currently on duty"
                  line2="Click Sign On in the top bar to go on duty"
                  action={!myUnit ? (
                    <button
                      type="button"
                      onClick={() => setShowGate(true)}
                      className="flex items-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-emerald-400 transition-colors hover:bg-emerald-500/20"
                    >
                      <LogIn className="h-3 w-3" />
                      Sign On Now
                    </button>
                  ) : undefined}
                />
              ) : (
                filteredUnits.map(unit => (
                  <UnitRow
                    key={unit.userId}
                    unit={unit}
                    isOwn={unit.userId === session?.id}
                    unitGroups={unitGroups}
                    allGroups={unitGroups}
                    onStatusChange={handleDispatchStatusChange}
                    onCallsignEdit={handleDispatchCallsignEdit}
                    onGroupAssign={handleDispatchGroupAssign}
                  />
                ))
              )}
            </div>
          </section>

          {/* Active Groups */}
          <section className="flex flex-col" style={{ flex: '1 1 0', minHeight: 0 }}>
            <PanelHeader
              icon={Users} label="Active Groups" accent="text-[#8b5cf6]"
              count={filteredGroups.length} search={groupSearch} onSearch={setGroupSearch}
            />
            <ColHeaders cols={['Group Number', 'Location', 'Department', 'Division', 'Status']} />
            <div className="flex-1 overflow-y-auto bg-[#02060b]">
              {erlcLoading ? (
                <SkeletonRows count={4} />
              ) : filteredGroups.length === 0 ? (
                <EmptyState icon={Users} line1="No active groups" line2="Groups appear when units form up" />
              ) : (
                filteredGroups.map(g => <GroupRow key={g.name} group={g} />)
              )}
            </div>
          </section>

        </div>

        {/* Right column: Active BOLO */}
        <section className="flex flex-col" style={{ width: '45%' }}>
          <PanelHeader
            icon={ShieldAlert} label="Active BOLOs & Warrants" accent="text-[#f87171]"
            count={bolos.length}
          />

          {/* ── Character BOLO sub-section ── */}
          <div className="flex shrink-0 items-center gap-2 border-b border-[#0d1c2e] bg-[#050e1c] px-4 py-1.5">
            <User className="h-3 w-3 text-[#f87171]" />
            <span className="text-[9px] font-black uppercase tracking-[0.28em] text-white">Character BOLO</span>
            <span className="ml-auto flex h-4 min-w-[1rem] items-center justify-center rounded bg-[#0f1c2e] px-1 text-[8px] font-black text-[#4384ff]">
              {bolos.filter(b => b.kind === 'civilian').length}
            </span>
          </div>
          <div className="shrink-0 grid border-b border-[#0a1520] bg-[#030912] px-4 py-1.5"
               style={{ gridTemplateColumns: '1.2fr 0.9fr 1fr auto 20px' }}>
            {(['Name', 'Gender', 'Hair Colour', 'Status'] as const).map(c => (
              <span key={c} className="min-w-0 text-[10px] font-black uppercase tracking-[0.28em] text-white pr-2">{c}</span>
            ))}
            <span />
          </div>
          <div className="overflow-y-auto bg-[#02060b]" style={{ flex: '1 1 0', minHeight: 0 }}>
            {bolosLoading ? (
              <SkeletonRows count={2} />
            ) : bolos.filter(b => b.kind === 'civilian').length === 0 ? (
              <EmptyState icon={User} line1="No character BOLOs" line2="Issue a BOLO from a character record" />
            ) : (
              bolos.filter(b => b.kind === 'civilian').map(b => <CivilianBoloRow key={`c-${b.id}`} bolo={b} />)
            )}
          </div>

          {/* ── Vehicle BOLO sub-section ── */}
          <div className="flex shrink-0 items-center gap-2 border-t-2 border-b border-[#0d1c2e] bg-[#050e1c] px-4 py-1.5" style={{ borderTopColor: '#0f1c2e' }}>
            <Car className="h-3 w-3 text-[#f87171]" />
            <span className="text-[9px] font-black uppercase tracking-[0.28em] text-white">Vehicle BOLO</span>
            <span className="ml-auto flex h-4 min-w-[1rem] items-center justify-center rounded bg-[#0f1c2e] px-1 text-[8px] font-black text-[#4384ff]">
              {bolos.filter(b => b.kind === 'vehicle').length}
            </span>
          </div>
          <div className="shrink-0 grid border-b border-[#0a1520] bg-[#030912] px-4 py-1.5"
               style={{ gridTemplateColumns: '1fr 1.1fr 0.7fr 0.9fr auto 20px' }}>
            {(['Plate', 'Vehicle Make', 'Year', 'Vehicle Colour', 'Status'] as const).map(c => (
              <span key={c} className="min-w-0 text-[10px] font-black uppercase tracking-[0.28em] text-white pr-2">{c}</span>
            ))}
            <span />
          </div>
          <div className="overflow-y-auto bg-[#02060b]" style={{ flex: '1 1 0', minHeight: 0 }}>
            {bolosLoading ? (
              <SkeletonRows count={2} />
            ) : bolos.filter(b => b.kind === 'vehicle').length === 0 ? (
              <EmptyState icon={Car} line1="No vehicle BOLOs" line2="Issue a BOLO from a vehicle record" />
            ) : (
              bolos.filter(b => b.kind === 'vehicle').map(b => <VehicleBoloRow key={`v-${b.id}`} bolo={b} />)
            )}
          </div>
        </section>

      </div>

      {/* ── Bottom bar ────────────────────────────────────────────────────────── */}
      <footer className={`flex shrink-0 items-center gap-3 border-t-[3px] bg-[#03080f] px-4 py-1.5 ${myUnit ? STATUS_BORDER_T[myUnit.status] : 'border-t-[#0f1c2e]'}`}>
        <div className="flex items-center gap-1.5">
          <Zap className="h-3 w-3 text-[#2a3a50]" />
          <span className="text-[9px] font-black uppercase tracking-widest text-[#1e2e42]">Northpoint CAD</span>
        </div>
        {myUnit && (
          <div className="flex items-center gap-1.5 text-[9px] text-[#2a3a50]">
            <span className="font-black text-[#3a5070]">Unit {myUnit.unitNumber}</span>
            <span>·</span>
            <span>{myUnit.department}</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-1.5 text-[11px] font-black tabular-nums text-white">
          <Clock className="h-3.5 w-3.5" />
          {clock}
        </div>
      </footer>

      {/* Group invite toast */}
      {pendingInvite && (
        <GroupInviteToast
          invite={pendingInvite}
          onAccept={() => handleInviteRespond(true)}
          onDecline={() => handleInviteRespond(false)}
        />
      )}

    </main>
  );
}
