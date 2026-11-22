import { useEffect, useState } from 'react';
import { BROWSER_SETTINGS, ready, settings } from '../lib/env';
import { Icon } from '../ui/Icon';

// The setup check: is this FALCON connected to its own database? Shown until the screens are built, and at /setup after that –
// so a deployment can be checked without signing in. It shows names and yes / no only, never a value.
type Reach = 'checking' | 'yes' | 'no';

export function Setup() {
  const [reach, setReach] = useState<Reach>(ready(settings) ? 'checking' : 'no');

  useEffect(() => {
    if (!ready(settings)) return;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    fetch(settings.supabaseUrl + '/auth/v1/health', { headers: { apikey: settings.publishableKey }, signal: ctl.signal })
      .then((r) => setReach(r.ok ? 'yes' : 'no'))
      .catch(() => setReach('no'))
      .finally(() => clearTimeout(t));
    return () => { clearTimeout(t); ctl.abort(); };
  }, []);

  return (
    <div className="scr f">
      <div className="top">
        <div className="tile s40 navy"><Icon name="utensils" /></div>
        <div className="t"><b>FALCON</b><small>Food &amp; Site Operations · setup check</small></div>
      </div>
      <div className="body">
        <div className="card col" style={{ gap: 12 }}>
          {BROWSER_SETTINGS.map((n) => {
            const bad = settings.missing.includes(n) || settings.wrong.includes(n);
            return (
              <div className="row sm" key={n}>
                <span className="sp" style={{ color: 'var(--ink)' }}>{n}</span>
                <span className={'chip ' + (bad ? 'red' : 'leaf')} style={{ height: 26 }}>
                  {settings.missing.includes(n) ? 'not set' : settings.wrong.includes(n) ? 'wrong value' : 'set'}
                </span>
              </div>
            );
          })}
          <div className="hr" />
          <div className="row sm">
            <span className="sp" style={{ color: 'var(--ink)' }}>Database answers</span>
            <span className={'chip ' + (reach === 'yes' ? 'leaf' : reach === 'no' ? 'red' : 'amber')} style={{ height: 26 }}>
              {reach === 'yes' ? 'yes' : reach === 'no' ? 'no' : 'checking'}
            </span>
          </div>
        </div>
        <div className="row xs" style={{ gap: 8, alignItems: 'flex-start' }}>
          <Icon name="info" size={14} />
          <span className="sp">The values are set in Vercel → Settings → Environment Variables. A secret key is refused here: only the publishable key belongs in the browser.</span>
        </div>
      </div>
    </div>
  );
}
