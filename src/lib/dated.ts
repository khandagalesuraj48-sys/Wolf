// A record with its From and Till (23-11-2026, his words: "pratek gost edit delet fromdate as sagle asaw proper" – pictures M1–M8).
// In use on a day between its From and its Till; removed = taken out with the reason (it stays in the record – the database's
// public.in_use is the same rule). The lists of the apps keep only what is in use today.
import { today } from './fmt';

export interface Dated { active?: boolean | null; valid_from?: string | null; valid_to?: string | null; removed_at?: string | null }
export type DatedState = 'active' | 'ending' | 'coming' | 'ended' | 'removed' | 'inactive';

export const inUse = (r: Dated, on = today()) =>
  r.active !== false && (!r.valid_from || r.valid_from <= on) && (!r.valid_to || r.valid_to >= on);

export function stateOf(r: Dated, on = today()): DatedState {
  if (r.active === false) return 'inactive';
  if (r.valid_to && r.valid_to < on) return r.removed_at ? 'removed' : 'ended';
  if (r.removed_at && (!r.valid_to || (r.valid_from && r.valid_to < r.valid_from))) return 'removed';
  if (r.valid_from && r.valid_from > on) return 'coming';
  if (r.removed_at || r.valid_to) return r.valid_to ? 'ending' : 'active';
  return 'active';
}

// what the "Active" list shows: in use, coming, or in use till a day
export const listed = (r: Dated, on = today()) => ['active', 'ending', 'coming'].includes(stateOf(r, on));
