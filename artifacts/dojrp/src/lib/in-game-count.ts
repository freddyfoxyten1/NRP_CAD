/** Format live ER:LC occupancy as `current/max` for dashboard badges. */
export function formatInGameCount(
  current: number | null | undefined,
  max: number | null | undefined,
): string {
  const players = Math.max(0, Number(current) || 0);
  const capacity = Number(max) || 0;
  return capacity > 0 ? `${players}/${capacity}` : `${players}/—`;
}
