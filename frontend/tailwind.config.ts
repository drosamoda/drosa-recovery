import type { Config } from 'tailwindcss'

// Paleta D'Rosa: bordo como cor primaria (uso pontual: ativo, CTA, destaque),
// off-white sofisticado como fundo, grafite como texto. Ver ADR de identidade
// visual em docs/handoff/REACT_MIGRATION_BLUEPRINT_2026-09-26.md.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bordo: {
          DEFAULT: '#6b1530',
          hover: '#7d1a38',
          soft: '#f6e9ec',
        },
        surface: {
          DEFAULT: '#fcfbfa',
          raised: '#ffffff',
          sunken: '#f5f3f1',
        },
        ink: {
          DEFAULT: '#1c1b1a',
          muted: '#5c5a57',
          faint: '#8a8783',
        },
        status: {
          success: '#2f7a4d',
          warning: '#b5790a',
          danger: '#b3261e',
          neutral: '#6b6864',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '12px',
      },
    },
  },
  plugins: [],
} satisfies Config
