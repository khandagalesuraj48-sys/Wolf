import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { homes, isStaff, SessionProvider, useSession, type Role } from './lib/session';
import { Setup } from './screens/Setup';
import * as Start from './screens/start';
import * as Emp from './screens/employee';
import * as Guest from './screens/guest';
import * as Own from './screens/owner';
import * as Drv from './screens/driver';
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
  return <>{children}</>;
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

const EMP: Role[] = ['employee', 'guest'];
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

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  );
}
