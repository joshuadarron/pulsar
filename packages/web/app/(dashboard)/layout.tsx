'use client';

import NotificationToast from '@/components/NotificationToast';
import Sidebar from '@/components/Sidebar';
import { SessionProvider } from 'next-auth/react';

export default function DashboardLayout({
	children
}: {
	children: React.ReactNode;
}) {
	return (
		<SessionProvider>
			<div className="flex h-screen">
				<Sidebar />
				<main className="flex-1 overflow-y-auto bg-bg print-full">
					<div className="mx-auto max-w-7xl p-6">{children}</div>
				</main>
			</div>
			<NotificationToast />
		</SessionProvider>
	);
}
