import type { Config } from 'tailwindcss';

// The colours of the approved look (src/styles/design.css) – one source: the CSS variables there.
const v = (n: string) => `var(--${n})`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        cream: v('cream'), paper: v('paper'), ink: v('ink'), muted: v('muted'), faint: v('faint'), line: v('line'), line2: v('line2'),
        leaf: v('leaf'), leafD: v('leafD'), leafS: v('leafS'), sf: v('sf'), sfD: v('sfD'), sfS: v('sfS'), saffron: '#C2560E',
        navy: v('navy'), navy2: v('navy2'), navy3: v('navy3'), gold: v('gold'), goldI: v('goldI'), red: v('red'), redS: v('redS'),
        blue: v('blue'), blueS: v('blueS'), amber: v('amber'), amberS: v('amberS'), plum: v('plum'), plumS: v('plumS'), whatsapp: '#128C4A',
      },
      fontFamily: { sans: ["'Schibsted Grotesk'", 'system-ui', '-apple-system', "'Segoe UI'", 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config;
