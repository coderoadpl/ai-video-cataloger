export function gateTimeoutFactor(): number {
  const raw = process.env.AVC_GATE_TIMEOUT_FACTOR;
  if (raw === undefined) return 1;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function scaledTimeout(baseMs: number): number {
  return Math.round(baseMs * gateTimeoutFactor());
}
