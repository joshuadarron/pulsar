import type { Config } from 'tailwindcss';

const config: Config = {
	darkMode: 'class',
	content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
	theme: {
		extend: {
			colors: {
				bg: 'var(--bg)',
				'bg-alt': 'var(--bg-alt)',
				surface: 'var(--surface)',
				'surface-hover': 'var(--surface-hover)',
				'text-pri': 'var(--text-pri)',
				'text-sec': 'var(--text-sec)',
				'text-muted': 'var(--text-muted)',
				'text-dim': 'var(--text-dim)',
				border: 'var(--border)',
				'border-strong': 'var(--border-strong)',
				'border-hover': 'var(--border-hover)',
				accent: 'var(--accent)',
				'accent-hover': 'var(--accent-hover)',
				'accent-soft': 'var(--accent-soft)',
				'accent-glow': 'var(--accent-glow)',
				success: 'var(--success)',
				warning: 'var(--warning)',
				danger: 'var(--danger)',
				info: 'var(--info)',
				'nav-bg': 'var(--nav-bg)',
				'nav-border': 'var(--nav-border)'
			},
			borderRadius: {
				sm: 'var(--radius-sm)',
				md: 'var(--radius-md)',
				lg: 'var(--radius-lg)',
				xl: 'var(--radius-xl)'
			},
			fontFamily: {
				sans: ['var(--font-sans)'],
				mono: ['var(--font-mono)']
			}
		}
	},
	plugins: []
};

export default config;
