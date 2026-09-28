import type { Config } from 'tailwindcss'

// Visual 2.0 — todas as cores apontam para os tokens de src/design-tokens.css.
// Os nomes semânticos antigos (bordo/surface/ink/status) foram mantidos para
// que todas as telas herdem o novo tema; `bordo` agora é o magenta D'Rosa.
const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bordo: { DEFAULT: v('accent'), hover: v('accent-hover'), soft: v('accent-soft') },
        accent: { DEFAULT: v('accent'), hover: v('accent-hover'), soft: v('accent-soft') },
        data: { DEFAULT: v('data'), soft: v('data-soft') },
        canvas: v('canvas'),
        surface: { DEFAULT: v('surface'), raised: v('raised'), sunken: v('sunken'), overlay: v('overlay') },
        ink: { DEFAULT: v('ink'), muted: v('ink-muted'), faint: v('ink-faint') },
        status: { success: v('success'), warning: v('warning'), danger: v('danger'), info: v('info'), neutral: v('neutral') },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      borderRadius: { card: 'var(--radius-card)' },
      boxShadow: { panel: 'var(--shadow-panel)', pop: 'var(--shadow-pop)', glow: 'var(--glow-accent)' },
      transitionTimingFunction: { out: 'var(--ease-out)' },
    },
  },
  plugins: [],
} satisfies Config
