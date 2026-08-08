// In-memory online session tracker.
// A user is considered online if their last session-status heartbeat
// was within the TTL window (2× the 10-second client polling interval).
const ONLINE_TTL_MS = 20_000;
const sessions = new Map<number, number>(); // userId → lastSeen (ms)

export const heartbeat = (userId: number): void => {
  sessions.set(userId, Date.now());
};

export const getOnlineCount = (): number => {
  const now = Date.now();
  let count = 0;
  for (const [id, lastSeen] of sessions) {
    if (now - lastSeen <= ONLINE_TTL_MS) {
      count++;
    } else {
      sessions.delete(id);
    }
  }
  return count;
};
