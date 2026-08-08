// In-memory active unit registry.
// Units are added on sign-on and removed on sign-off or expiry.
// A unit is considered stale if no heartbeat has been received within UNIT_TTL_MS.

export type UnitStatus = 'Available' | 'Unavailable' | 'Busy' | 'Enroute' | 'On-Scene';

export interface ActiveUnit {
  userId: number;
  username: string;
  callsign: string;
  unitNumber: string;
  department: string;
  division?: string;
  location?: string;
  rank: string;
  status: UnitStatus;
  signedOnAt: number;   // epoch ms
  lastHeartbeat: number; // epoch ms
}

const units = new Map<number, ActiveUnit>(); // userId → ActiveUnit

export const signOn = (unit: Omit<ActiveUnit, 'signedOnAt' | 'lastHeartbeat'>): ActiveUnit => {
  const now = Date.now();
  const entry: ActiveUnit = { ...unit, signedOnAt: now, lastHeartbeat: now };
  units.set(unit.userId, entry);
  return entry;
};

export const signOff = (userId: number): boolean => {
  return units.delete(userId);
};

export const updateStatus = (userId: number, status: UnitStatus): ActiveUnit | null => {
  const unit = units.get(userId);
  if (!unit) return null;
  unit.status = status;
  unit.lastHeartbeat = Date.now();
  units.set(userId, unit);
  return unit;
};

export const unitHeartbeat = (userId: number): void => {
  const unit = units.get(userId);
  if (unit) {
    unit.lastHeartbeat = Date.now();
  }
};

export const getActiveUnits = (): ActiveUnit[] => {
  return Array.from(units.values())
    .map(u => ({ ...u }))
    .sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));
};

export const getUnit = (userId: number): ActiveUnit | undefined => {
  return units.get(userId);
};

export const updateUnitNumber = (userId: number, unitNumber: string): ActiveUnit | null => {
  const unit = units.get(userId);
  if (!unit) return null;
  unit.unitNumber = unitNumber;
  units.set(userId, unit);
  return unit;
};

export const isSignedOn = (userId: number): boolean => {
  return units.has(userId);
};
