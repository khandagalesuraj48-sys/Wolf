// The RCL ID look-up in HR (decision 2 of docs/DECISIONS.md – not decided yet). Until HR_LOOKUP_URL and HR_LOOKUP_SECRET are set
// in Vercel, the answer is "not_checked" and the person waits for the Site Admin – nothing is made up.
// The answer FALCON keeps: found / not_found, name, designation, HR's key, whether the mobile matches – never KYC, bank or pay.
import { env } from './env.js';

export async function hrLookup(rclId, mobile, fetchImpl = fetch) {
  const url = env('HR_LOOKUP_URL'), secret = env('HR_LOOKUP_SECRET');
  if (!url || !secret || !rclId) return { result: 'not_checked' };
  try {
    const r = await fetchImpl(url, { method: 'POST', headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rcl_id: String(rclId).toUpperCase(), mobile }), signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { result: 'not_checked' };
    const j = await r.json();
    const result = ['found', 'not_found', 'maybe'].includes(j.result) ? j.result : 'not_checked';
    // "mobile" stays on the server (the code is sent to it); the rest is what a person needs to recognise himself
    return { result, name: str(j.name), designation: str(j.designation), department: str(j.department), category: str(j.category),
      site: str(j.site), ref: str(j.ref), mobile: /^\+?[0-9]{10,15}$/.test(String(j.mobile || '')) ? '+' + String(j.mobile).replace(/^\+/, '') : undefined,
      mobile_matches: j.mobile_matches === true };
  } catch {
    return { result: 'not_checked' };
  }
}
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : undefined);
