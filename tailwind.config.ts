import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './context/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'q-orange': 'var(--or)',
        'q-orange-h': 'var(--orh)',
        'q-orange-b': 'var(--orb)',
        'q-green': 'var(--gr)',
        'q-green-l': 'var(--grl)',
        'q-green-c': 'var(--grc)',
        'q-black': 'var(--bk)',
        'q-dark': 'var(--dk)',
        'q-gray-d': 'var(--gd)',
        'q-gray-m': 'var(--gm)',
        'q-gray-g': 'var(--gg)',
        'q-gray-l': 'var(--gl)',
        'q-blue-l': 'var(--bl)',
        'q-cream': 'var(--cp)',
        'q-light-b': 'var(--lb)',
        'q-neon': 'var(--nn)',
        'q-red': 'var(--rd)',
        'q-bg': 'var(--bg)',
        'q-c1': 'var(--c1)',
        'q-c2': 'var(--c2)',
        'q-cb': 'var(--cb)',
        'q-ct': 'var(--ct)',
        'q-cs': 'var(--cs)',
        'q-ch': 'var(--ch)',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
