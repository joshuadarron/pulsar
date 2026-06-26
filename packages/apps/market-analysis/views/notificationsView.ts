import { query } from '@pulsar/shared/db/postgres';
import {
	type ListItem,
	type Tone,
	type ViewModel,
	emptyState,
	list,
	section,
	view
} from '@pulsar/view-model';

export const NOTIFICATIONS_VIEW_ID = 'market-analysis.notifications';

interface NotificationRow {
	id: string;
	type: string;
	title: string;
	message: string;
	link: string | null;
	read: boolean;
	created_at: Date;
}

export type Notification = {
	id: string;
	type: string;
	title: string;
	message: string;
	link: string | null;
	read: boolean;
	createdAt: Date;
};

const TYPE_TONES: Record<string, Tone> = {
	report: 'info',
	pipeline: 'info',
	drafts: 'warn'
};

async function loadNotifications(): Promise<Notification[]> {
	const result = await query<NotificationRow>(
		'SELECT id, type, title, message, link, read, created_at FROM notifications ORDER BY created_at DESC LIMIT 50'
	);
	return result.rows.map((row) => ({
		id: row.id,
		type: row.type,
		title: row.title,
		message: row.message,
		link: row.link,
		read: row.read,
		createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at)
	}));
}

function notificationToItem(n: Notification): ListItem {
	const tsParts: string[] = [];
	const d = n.createdAt;
	if (!Number.isNaN(d.getTime())) {
		tsParts.push(d.toLocaleDateString());
		tsParts.push(d.toLocaleTimeString());
	}
	const badgeTone = TYPE_TONES[n.type] ?? 'neutral';
	const label = n.read ? n.type : `${n.type} (unread)`;
	return {
		primary: n.title,
		secondary: n.message,
		timestamp: tsParts.join(' ') || undefined,
		href: n.link ?? undefined,
		badge: { label, tone: badgeTone }
	};
}

export function buildNotificationsViewFromRows(notifications: Notification[]): ViewModel {
	if (notifications.length === 0) {
		return view(
			NOTIFICATIONS_VIEW_ID,
			[emptyState('No notifications yet.', 'Notifications appear after pipeline runs complete.')],
			{ title: 'Notifications' }
		);
	}

	return view(
		NOTIFICATIONS_VIEW_ID,
		[
			section(undefined, [list(notifications.map(notificationToItem), 'plain')], {
				subtitle: 'Pipeline reports and content generation alerts'
			})
		],
		{ title: 'Notifications', meta: { unreadCount: notifications.filter((n) => !n.read).length } }
	);
}

export async function buildNotificationsView(): Promise<ViewModel> {
	const rows = await loadNotifications();
	return buildNotificationsViewFromRows(rows);
}
