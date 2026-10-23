// Masked preview of a stored credential (API key or access token).
//
// GET /config never returns the real value: the frontend only receives a hint
// with the first and last characters so the operator can recognise which key is
// saved (e.g. after rotating it in the marketplace back office). Short values
// reveal nothing, so the hint can never reproduce the whole secret.
export function maskSecret(secret?: string | null): string | null {
  const value = (secret ?? '').trim();
  if (!value) return null;
  const dots = '•'.repeat(8);
  if (value.length <= 6) {
    return dots;
  }
  return `${value.slice(0, 3)}${dots}${value.slice(-3)}`;
}
