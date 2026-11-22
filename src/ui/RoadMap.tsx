// The road as the designs draw it (boards e05, e09, o08, o10, d05, w01, w02): the corridor by chainage, its circles, the sections
// as pins, the van between its stops. Drawn from FALCON's own data (km of each section) – no outside map is needed. A live street
// map (Google Maps) comes when its key is set (docs/DECISIONS.md 4).
export interface MapSection { id: string; code: string; km: number | null; circle?: string | null }
export interface MapCircle { code: string; km_from: number | null; km_to: number | null }

const COLORS = ['#2F7A45', '#1E63D6', '#C2560E', '#7B3FD0', '#B07A1E'];

export function RoadMap({ sections, circles = [], mine, van, done = [], height = 240, dark = false, label }: {
  sections: MapSection[]; circles?: MapCircle[]; mine?: string | null; van?: number | null; done?: string[]; height?: number; dark?: boolean; label: string;
}) {
  const kms = [...sections.map((s) => s.km ?? 0), ...circles.flatMap((c) => [c.km_from ?? 0, c.km_to ?? 0])];
  const lo = Math.min(0, ...kms), hi = Math.max(1, ...kms);
  const W = 400, H = 240;
  const x = (km: number) => 24 + ((km - lo) / (hi - lo || 1)) * (W - 48);
  const y = (km: number) => H / 2 + 46 * Math.sin((km - lo) / ((hi - lo || 1) / 3.2));
  const path = (a: number, b: number) => {
    const pts: string[] = [];
    for (let i = 0; i <= 40; i++) { const k = a + ((b - a) * i) / 40; pts.push((i ? 'L' : 'M') + x(k).toFixed(1) + ' ' + y(k).toFixed(1)); }
    return pts.join(' ');
  };
  const bg = dark ? '#0E1B33' : '#EEF0E6', road = dark ? '#33496F' : '#FFFFFF', edge = dark ? '#22385F' : '#D9DCCD', ink = dark ? '#fff' : '#18221C';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} role="img" aria-label={label} preserveAspectRatio="xMidYMid slice" style={{ display: 'block', background: bg }}>
      <defs><pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke={dark ? '#172A4C' : '#E3E6D8'} strokeWidth="1" /></pattern></defs>
      <rect width={W} height={H} fill="url(#g)" />
      <path d={path(lo, hi)} stroke={edge} strokeWidth="18" fill="none" strokeLinecap="round" />
      <path d={path(lo, hi)} stroke={road} strokeWidth="12" fill="none" strokeLinecap="round" />
      {circles.map((c, i) => c.km_from != null && c.km_to != null &&
        <path key={c.code} d={path(c.km_from, c.km_to)} stroke={COLORS[i % COLORS.length]} strokeOpacity=".55" strokeWidth="4" fill="none" />)}
      {circles.map((c, i) => c.km_from != null && c.km_to != null &&
        <text key={'t' + c.code} x={x((c.km_from + c.km_to) / 2)} y={y((c.km_from + c.km_to) / 2) + 34} textAnchor="middle" fontSize="10" fontWeight="600" fill={COLORS[i % COLORS.length]}>Circle {c.code}</text>)}
      {sections.filter((s) => s.km != null).map((s) => {
        const on = s.id === mine, d = done.includes(s.id);
        return (
          <g key={s.id} transform={`translate(${x(s.km!)},${y(s.km!)})`}>
            <line x1="0" y1="0" x2="0" y2="-16" stroke={on ? '#C2560E' : ink} strokeWidth="2" />
            <rect x={-18} y={-34} width="36" height="18" rx="6" fill={on ? '#C2560E' : d ? '#2F7A45' : '#0E1B33'} />
            <text x="0" y="-21" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">{s.code}</text>
            <circle r="4" fill={on ? '#C2560E' : ink} />
          </g>
        );
      })}
      {van != null && (
        <g transform={`translate(${x(van)},${y(van)})`}>
          <circle r="16" fill="#C2560E" fillOpacity=".25" />
          <circle r="11" fill="#C2560E" />
          <path d="M-6 -2h7v6h-7z M1 0h3l2 2v2h-5z" fill="#fff" />
        </g>
      )}
    </svg>
  );
}
