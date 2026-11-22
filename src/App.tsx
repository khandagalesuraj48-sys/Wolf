import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { homes, isStaff, SessionProvider, useSession, type Role } from './lib/session';
import { Setup } from './screens/Setup';
import * as Start from './screens/start';
import * as Emp from './screens/employee';
import * as Guest from './screens/guest';
import * as Own from './screens/owner';
import * as Drv from './screens/driver';
// The office's web pages are loaded only when one is opened – a phone never downloads them.
type Mod = Record<string, ComponentType>;
const page = (load: () => Promise<unknown>, name: string) => lazy(() => load().then((m) => ({ default: (m as Mod)[name]! })));
const ops = () => import('./screens/admin/ops'), mst = () => import('./screens/admin/masters');
const bil = () => import('./screens/admin/billing'), ppl = () => import('./screens/admin/people');
const Ops = { Dashboard: page(ops, 'Dashboard'), Consumption: page(ops, 'Consumption'), Complaints: page(ops, 'Complaints'), Reports: page(ops, 'Reports'),
  Analytics: page(ops, 'Analytics'), Scorecard: page(ops, 'Scorecard'), Audit: page(ops, 'Audit') };
const Mst = { Sites: page(mst, 'Sites'), Messes: page(mst, 'Messes'), WorkOrders: page(mst, 'WorkOrders') };
const Bil = { Billing: page(bil, 'Billing'), Reconciliation: page(bil, 'Reconciliation'), Approvals: page(bil, 'Approvals') };
const Ppl = { Registrations: page(ppl, 'Registrations'), Guests: page(ppl, 'Guests'), PeopleRoles: page(ppl, 'PeopleRoles'), Settings: page(ppl, 'Settings') };
import { Body, Denied, Failed, Loading, Screen } from './ui/kit';

// Who may open what: the screens follow the roles (the database checks again on every read and action).
function Need({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const s = useSession();
  if (s.status === 'loading') return <Screen><Body><Loading /></Body></Screen>;
  if (s.status === 'off') return <Navigate to="/setup" replace />;
  if (s.status === 'signedout') return <Navigate to="/start" replace />;
  if (s.status === 'noperson') return <Navigate to="/start" replace />;
  if (s.status === 'stopped') return <Start.Stopped />;
  if (s.needsCode) return <Start.CodeAgain />;
  if (s.me && ['pending_verification', 'mobile_pending', 'whatsapp_verified', 'id_not_found', 'new_registration'].includes(s.me.state) && !isStaff(s.roles)) return <Start.Waiting />;
  if (!s.has(roles)) return <Screen><Body><Denied /></Body></Screen>;
  return <Suspense fallback={<Screen><Body><Loading /></Body></Screen>}>{children}</Suspense>;
}

function Root() {
  const s = useSession();
  if (s.status === 'off') return <Navigate to="/setup" replace />;
  if (s.status === 'loading') return <Screen><Body><Loading /></Body></Screen>;
  if (s.status === 'signedout' || s.status === 'noperson')
    return s.ssoError ? <Screen><Body><Failed error={s.ssoError} /></Body><Start.Who /></Screen> : <Navigate to="/start" replace />;
  if (s.status === 'stopped') return <Start.Stopped />;
  if (s.needsCode) return <Start.CodeAgain />;
  const h = homes(s.roles);
  if (s.me?.state === 'pending_verification' && !isStaff(s.roles)) return <Start.Waiting />;
  if (h.length === 1) return <Navigate to={h[0]!.path} replace />;
  if (h.length === 0) return <Start.Waiting />;
  return <Start.Choose items={h} />;
}

// A mess counter's printed QR opened with the phone's own camera: the mess is remembered, then his meal at that counter.
function MessQr() {
  const { id } = useParams();
  const [q] = useSearchParams();
  if (id && /^[0-9a-f-]{36}$/i.test(id)) { try { sessionStorage.setItem('falcon.mess', id); } catch { /* private mode */ } }
  return <Navigate to={'/app/meal?counter=' + encodeURIComponent((q.get('c') || '1').replace(/\D/g, '') || '1')} replace />;
}

const EMP: Role[] = ['employee', 'guest'];
const OFFICE: Role[] = ['system_admin', 'management', 'accounts', 'site_admin', 'mess_supervisor'];
const OWN: Role[] = ['mess_owner', 'mess_operator'];

export function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Routes>
          <Route path="/" element={<Root />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/start" element={<Start.Who />} />
          <Route path="/start/rcl-id" element={<Start.RclId />} />
          <Route path="/start/found" element={<Start.Found />} />
          <Route path="/start/code" element={<Start.Code />} />
          <Route path="/start/done" element={<Start.Done />} />
          <Route path="/start/not-found" element={<Start.NotFound />} />
          <Route path="/start/new" element={<Start.NewReg />} />
          <Route path="/start/back" element={<Start.Back />} />
          <Route path="/start/temporary" element={<Start.Waiting />} />
          <Route path="/guest/new" element={<Start.GuestNew />} />

          <Route path="/guest" element={<Need roles={['guest']}><Guest.GuestHome /></Need>} />
          <Route path="/guest/welcome" element={<Need roles={['guest']}><Guest.GuestWelcome /></Need>} />
          <Route path="/guest/history" element={<Need roles={['guest']}><Guest.GuestHistory /></Need>} />

          <Route path="/app" element={<Need roles={['employee']}><Emp.Home /></Need>} />
          <Route path="/app/scan" element={<Need roles={EMP}><Emp.Scan /></Need>} />
          <Route path="/app/meal" element={<Need roles={EMP}><Emp.MealAtMess /></Need>} />
          <Route path="/app/parcel" element={<Need roles={EMP}><Emp.Parcel /></Need>} />
          <Route path="/app/section" element={<Need roles={EMP}><Emp.SectionPick /></Need>} />
          <Route path="/app/menu" element={<Need roles={EMP}><Emp.Menu /></Need>} />
          <Route path="/app/menu/poster" element={<Need roles={EMP}><Emp.Poster /></Need>} />
          <Route path="/app/orders" element={<Need roles={EMP}><Emp.Orders /></Need>} />
          <Route path="/app/orders/:id" element={<Need roles={EMP}><Emp.OrderStatus /></Need>} />
          <Route path="/app/orders/:id/track" element={<Need roles={EMP}><Emp.Track /></Need>} />
          <Route path="/app/orders/:id/driver" element={<Need roles={EMP}><Emp.DriverCard /></Need>} />
          <Route path="/app/orders/:id/confirm" element={<Need roles={EMP}><Emp.ShowCode /></Need>} />
          <Route path="/app/orders/:id/quantity" element={<Need roles={EMP}><Emp.Received /></Need>} />
          <Route path="/app/orders/:id/review" element={<Need roles={EMP}><Emp.Review /></Need>} />
          <Route path="/app/complaints/new" element={<Need roles={EMP}><Emp.Complaint /></Need>} />
          <Route path="/app/complaints/:id" element={<Need roles={EMP}><Emp.ComplaintTicket /></Need>} />
          <Route path="/app/guest" element={<Need roles={['employee']}><Emp.GuestRequest /></Need>} />
          <Route path="/app/group" element={<Need roles={['employee']}><Emp.Group /></Need>} />
          <Route path="/app/me" element={<Need roles={EMP}><Emp.Me /></Need>} />
          <Route path="/app/notifications" element={<Need roles={EMP}><Emp.Me /></Need>} />

          <Route path="/owner" element={<Need roles={OWN}><Own.OwnerHome /></Need>} />
          <Route path="/owner/requests" element={<Need roles={OWN}><Own.Requests /></Need>} />
          <Route path="/owner/requests/:id" element={<Need roles={OWN}><Own.RequestDetail /></Need>} />
          <Route path="/owner/kitchen" element={<Need roles={OWN}><Own.Kitchen /></Need>} />
          <Route path="/owner/parcels" element={<Need roles={OWN}><Own.Parcels /></Need>} />
          <Route path="/owner/batches/:id/driver" element={<Need roles={OWN}><Own.BatchDriver /></Need>} />
          <Route path="/owner/batches/:id/route" element={<Need roles={OWN}><Own.BatchRoute /></Need>} />
          <Route path="/owner/batches/:id/dispatch" element={<Need roles={OWN}><Own.BatchDispatch /></Need>} />
          <Route path="/owner/live" element={<Need roles={OWN}><Own.Live /></Need>} />
          <Route path="/owner/menu" element={<Need roles={OWN}><Own.MenuPublish /></Need>} />
          <Route path="/owner/guests" element={<Need roles={OWN}><Own.GuestMeals /></Need>} />
          <Route path="/owner/closing" element={<Need roles={OWN}><Own.Closing /></Need>} />
          <Route path="/owner/complaints" element={<Need roles={['mess_owner']}><Own.OwnerComplaints /></Need>} />
          <Route path="/owner/billing" element={<Need roles={['mess_owner']}><Own.OwnerBilling /></Need>} />
          <Route path="/owner/follow-up" element={<Need roles={['mess_owner']}><Own.FollowUp /></Need>} />

          <Route path="/driver" element={<Need roles={['driver']}><Drv.DriverHome /></Need>} />
          <Route path="/driver/assignments/:id" element={<Need roles={['driver']}><Drv.Assign /></Need>} />
          <Route path="/driver/vehicle" element={<Need roles={['driver']}><Drv.Vehicle /></Need>} />
          <Route path="/driver/trip" element={<Need roles={['driver']}><Drv.TripStops /></Need>} />
          <Route path="/driver/route/:section" element={<Need roles={['driver']}><Drv.RouteNext /></Need>} />
          <Route path="/driver/stops/:section" element={<Need roles={['driver']}><Drv.StopPeople /></Need>} />
          <Route path="/driver/hand/:order/:person" element={<Need roles={['driver']}><Drv.HandOver /></Need>} />
          <Route path="/driver/summary/:id" element={<Need roles={['driver']}><Drv.TripSummary /></Need>} />

          <Route path="/m/:id" element={<MessQr />} />

          <Route path="/admin" element={<Need roles={OFFICE}><Ops.Dashboard /></Need>} />
          <Route path="/admin/consumption" element={<Need roles={OFFICE}><Ops.Consumption /></Need>} />
          <Route path="/admin/complaints" element={<Need roles={OFFICE}><Ops.Complaints /></Need>} />
          <Route path="/admin/sites" element={<Need roles={OFFICE}><Mst.Sites /></Need>} />
          <Route path="/admin/mess" element={<Need roles={OFFICE}><Mst.Messes /></Need>} />
          <Route path="/admin/work-orders" element={<Need roles={OFFICE}><Mst.WorkOrders /></Need>} />
          <Route path="/admin/billing" element={<Need roles={OFFICE}><Bil.Billing /></Need>} />
          <Route path="/admin/reconciliation" element={<Need roles={OFFICE}><Bil.Reconciliation /></Need>} />
          <Route path="/admin/approvals" element={<Need roles={OFFICE}><Bil.Approvals /></Need>} />
          <Route path="/admin/reports" element={<Need roles={OFFICE}><Ops.Reports /></Need>} />
          <Route path="/admin/analytics" element={<Need roles={OFFICE}><Ops.Analytics /></Need>} />
          <Route path="/admin/scorecard" element={<Need roles={OFFICE}><Ops.Scorecard /></Need>} />
          <Route path="/admin/registrations" element={<Need roles={OFFICE}><Ppl.Registrations /></Need>} />
          <Route path="/admin/guests" element={<Need roles={OFFICE}><Ppl.Guests /></Need>} />
          <Route path="/admin/people" element={<Need roles={OFFICE}><Ppl.PeopleRoles /></Need>} />
          <Route path="/admin/settings" element={<Need roles={OFFICE}><Ppl.Settings /></Need>} />
          <Route path="/admin/audit" element={<Need roles={OFFICE}><Ops.Audit /></Need>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  );
}
