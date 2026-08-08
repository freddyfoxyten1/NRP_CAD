// ----
// lib/cad-local-accounts.ts   -   Local test-account store
//
// Stores a list of saved accounts in localStorage so developers / demo users
// can quickly switch between identities without going through Discord OAuth.
// Not used in production  -  only the login modal exposes this feature.
// ----
import type { CadSession } from './cad-session';

const CAD_ACCOUNTS_KEY = 'west-coast-cad-local-accounts';
const DEFAULT_RANK = 'member';
const DEFAULT_ROLE = 'Community Members';
const DEFAULT_STATUS = 'active';

export type CadLocalAccount = {
  id: number;
  auth_user_id: string;
  username: string;
  discord_username: string;
  discord_id: string;
  email: string;
  community_code: string;
  status: string;
  rank: string;
  role: string;
  created_at: string;
  updated_at: string;
  password_salt: string;
  password_hash: string;
};

export type CreateCadLocalAccountInput = {
  username: string;
  discordUsername: string;
  discordId: string;
  email: string;
  password: string;
  communityCode: string;
};

const normalizeAccountFields = (account: CadLocalAccount): CadLocalAccount => {
  const rank = account.rank ?? DEFAULT_RANK;
  const role = account.role?.includes('+') ? 'Admin' : account.role ?? DEFAULT_ROLE;

  return role.toLowerCase() === DEFAULT_RANK && rank.toLowerCase() !== DEFAULT_RANK
    ? { ...account, rank: role, role: rank }
    : { ...account, rank, role };
};

const readAccounts = (): CadLocalAccount[] => {
  const raw = localStorage.getItem(CAD_ACCOUNTS_KEY);

  if (!raw) {
    return [];
  }

  try {
    const accounts = JSON.parse(raw) as CadLocalAccount[];
    return Array.isArray(accounts) ? accounts.map(normalizeAccountFields) : [];
  } catch {
    localStorage.removeItem(CAD_ACCOUNTS_KEY);
    return [];
  }
};

const writeAccounts = (accounts: CadLocalAccount[]) => {
  localStorage.setItem(CAD_ACCOUNTS_KEY, JSON.stringify(accounts));
};

export const removeCadLocalAccountsByIds = (ids: number[]) => {
  const deletedIds = new Set(ids);
  writeAccounts(readAccounts().filter((account) => !deletedIds.has(account.id)));
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const makeSalt = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const digest = async (value: string) => {
  const encoded = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const hashPassword = async (password: string, salt: string) => digest(`${salt}:${password}`);

const toSession = (account: Pick<CadLocalAccount, 'id' | 'username' | 'email' | 'rank' | 'role' | 'status' | 'discord_id' | 'discord_username'>): CadSession => ({
  id: account.id,
  username: account.username,
  email: account.email,
  rank: account.rank,
  role: account.role,
  status: account.status,
  dps_rank: null,
  dps_role: null,
  staff_rank: null,
  staff_role: null,
  discord_id: account.discord_id || null,
  avatar_hash: null,
});

const syncCadProfile = async (account: CadLocalAccount) => {
  const response = await fetch('/api/cad-profiles', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      auth_user_id: account.auth_user_id,
      username: account.username,
      discord_username: account.discord_username,
      discord_id: account.discord_id,
      email: account.email,
      community_code: account.community_code,
      role: account.role,
      password_salt: account.password_salt,
      password_hash: account.password_hash,
    }),
  });

  const contentType = response.headers.get('content-type') ?? '';

  if (!response.ok || !contentType.includes('application/json')) {
    throw new Error('Unable to save this account to the shared MDT data storage.');
  }

  return (await response.json()) as { id: number };
};

const signInSharedCadAccount = async (username: string, password: string) => {
  const response = await fetch('/api/cad-auth/sign-in', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const contentType = response.headers.get('content-type') ?? '';

  if (!response.ok || !contentType.includes('application/json')) {
    throw new Error('Unable to reach shared MDT data storage.');
  }

  return (await response.json()) as CadSession | null;
};

export const createCadLocalAccount = async (input: CreateCadLocalAccountInput) => {
  const accounts = readAccounts();
  const email = normalizeEmail(input.email);
  const username = input.username.trim();
  const discordUsername = input.discordUsername.trim();
  const discordId = input.discordId.trim();
  const communityCode = input.communityCode.trim().toUpperCase();

  const duplicate = accounts.find(
    (account) =>
      account.email.toLowerCase() === email ||
      account.username.toLowerCase() === username.toLowerCase() ||
      account.discord_id === discordId,
  );

  if (duplicate) {
    throw new Error('An account with this email, username, or Discord ID already exists.');
  }

  const salt = makeSalt();
  const timestamp = new Date().toISOString();
  const account: CadLocalAccount = {
    id: accounts.reduce((highest, current) => Math.max(highest, current.id), 0) + 1,
    auth_user_id: `local-${crypto.randomUUID()}`,
    username,
    discord_username: discordUsername,
    discord_id: discordId,
    email,
    community_code: communityCode,
    status: DEFAULT_STATUS,
    rank: DEFAULT_RANK,
    role: DEFAULT_ROLE,
    created_at: timestamp,
    updated_at: timestamp,
    password_salt: salt,
    password_hash: await hashPassword(input.password, salt),
  };

  const savedProfile = await syncCadProfile(account);
  const savedAccount = { ...account, id: savedProfile.id };

  writeAccounts([...accounts, savedAccount]);
  return toSession(savedAccount);
};

export const signInCadLocalAccount = async (usernameInput: string, password: string) => {
  const username = usernameInput.trim().toLowerCase();
  let canUseLocalFallback = false;

  try {
    const sharedSession = await signInSharedCadAccount(username, password);
    return sharedSession;
  } catch {
    canUseLocalFallback = true;
  }

  if (!canUseLocalFallback) {
    return null;
  }

  const account = readAccounts().find((candidate) => candidate.username.toLowerCase() === username);

  if (!account) {
    return null;
  }

  const passwordHash = await hashPassword(password, account.password_salt);

  if (passwordHash !== account.password_hash) {
    return null;
  }

  try {
    await syncCadProfile(account);
  } catch {
    // Sign-in still succeeds from the local cache when the shared profile API is unavailable.
  }

  return toSession(account);
};

export const getCadLocalAccountByEmail = (emailInput: string) => {
  const email = normalizeEmail(emailInput);
  return readAccounts().find((account) => account.email.toLowerCase() === email) ?? null;
};

export const listCadLocalAccounts = () =>
  readAccounts().sort((first, second) => (first.created_at < second.created_at ? 1 : -1));

export const getCadLocalStats = () => ({
  totalMembers: readAccounts().length,
  totalPlayTime: 'Coming Soon!',
  totalOnlineMembers: 1,
});
