import nodemailer from 'nodemailer';
import { env } from '@pulsar/shared/config/env';
import { query } from '@pulsar/shared/db/postgres';

export async function sendReportEmail(reportId: string): Promise<void> {
	if (!env.smtp.user || !env.smtp.password) {
		console.log('[Notify] SMTP not configured, skipping email.');
		return;
	}

	// Get active subscribers from DB, fall back to env var
	const subsResult = await query<{ email: string }>(
		'SELECT email FROM subscribers WHERE active = true',
	);
	const recipients = subsResult.rows.map((r) => r.email);
	if (recipients.length === 0 && env.smtp.notifyTo) {
		recipients.push(env.smtp.notifyTo);
	}
	if (recipients.length === 0) {
		console.log('[Notify] No subscribers, skipping email.');
		return;
	}

	// Fetch pre-rendered email HTML from the web API (single template source of truth)
	const emailUrl = `${env.nextauth.url}/api/reports/${reportId}/email`;
	const response = await fetch(emailUrl);
	if (!response.ok) {
		throw new Error(`Failed to fetch email HTML: ${response.status} ${response.statusText}`);
	}
	const html = await response.text();

	// Get generated date for subject line
	const result = await query<{ generated_at: string }>(
		'SELECT generated_at FROM reports WHERE id = $1',
		[reportId],
	);
	const generatedAt = result.rows[0]
		? new Date(result.rows[0].generated_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
		: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

	const transporter = nodemailer.createTransport({
		host: env.smtp.host,
		port: env.smtp.port,
		secure: false,
		auth: {
			user: env.smtp.user,
			pass: env.smtp.password,
		},
	});

	await transporter.sendMail({
		from: `"Pulsar" <${env.smtp.user}>`,
		to: recipients.join(', '),
		subject: `Pulsar: Market Analysis Report — ${generatedAt}`,
		html,
	});

	console.log(`[Notify] Email sent to ${recipients.length} subscriber(s)`);
}
