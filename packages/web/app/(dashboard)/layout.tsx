'use client';

import { SessionProvider } from 'next-auth/react';
import Sidebar from '@/components/Sidebar';
import NotificationToast from '@/components/NotificationToast';

export default function DashboardLayout({
	children
}: {
	children: React.ReactNode;
}) {
	return (
		<SessionProvider>
			<div className="flex h-screen">
				<Sidebar />
				<main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-neutral-950 print-full">
					<div className="mx-auto max-w-7xl p-6">{children}</div>
				</main>
			</div>
			<NotificationToast />
		</SessionProvider>
	);
}
