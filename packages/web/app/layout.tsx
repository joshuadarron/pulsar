import ThemeProvider from '@/components/ThemeProvider';
import type { Metadata } from 'next';
import { IBM_Plex_Mono, Instrument_Sans } from 'next/font/google';
import './globals.css';

const instrumentSans = Instrument_Sans({
	subsets: ['latin'],
	weight: ['400', '500', '600', '700'],
	variable: '--font-instrument-sans',
	display: 'swap'
});

const ibmPlexMono = IBM_Plex_Mono({
	subsets: ['latin'],
	weight: ['400', '500', '600'],
	variable: '--font-ibm-plex-mono',
	display: 'swap'
});

export const metadata: Metadata = {
	title: 'Pulsar — AI Market Intelligence',
	description: 'Automated market intelligence and content agent'
};

export default function RootLayout({
	children
}: {
	children: React.ReactNode;
}) {
	return (
		<html
			lang="en"
			suppressHydrationWarning
			className={`${instrumentSans.variable} ${ibmPlexMono.variable}`}
		>
			<body className="min-h-screen antialiased bg-bg text-text-pri font-sans">
				<ThemeProvider>{children}</ThemeProvider>
			</body>
		</html>
	);
}
