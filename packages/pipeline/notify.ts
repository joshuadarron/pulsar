import nodemailer from 'nodemailer';
import { env } from '@pulsar/shared/config/env';
import { query } from '@pulsar/shared/db/postgres';
import { renderReportEmail } from './lib/render-email.js';
import type { ReportData, EvaluationSummary } from '@pulsar/shared/types';

export async function sendReportEmail(
	reportId: string,
	evaluationSummary?: EvaluationSummary
): Promise<void> {
	if (!env.smtp.user || !env.smtp.password) {
		console.log('[Notify] SMTP not configured, skipping email.');
		return;
	}

	// Get active subscribers from DB, fall back to env var
	const subsResult = await query<{ email: string }>(
		'SELECT email FROM subscribers WHERE active = true'
	);
	const recipients = subsResult.rows.map((r) => r.email);
	if (recipients.length === 0 && env.smtp.notifyTo) {
		recipients.push(env.smtp.notifyTo);
	}
	if (recipients.length === 0) {
		console.log('[Notify] No subscribers, skipping email.');
		return;
	}

	// Get report data and render email using the shared template
	const result = await query<{ report_data: ReportData; generated_at: string; run_id: string }>(
		'SELECT report_data, generated_at, run_id FROM reports WHERE id = $1',
		[reportId]
	);
	if (result.rows.length === 0) return;

	const reportData = result.rows[0].report_data;
	const generatedAt = result.rows[0].generated_at;
	const runId = result.rows[0].run_id;
	const reportUrl = `${env.nextauth.url}/reports/${reportId}`;
	const pdfUrl = `${env.nextauth.url}/api/reports/${reportId}/export/pdf`;
	const evalsUrl = `${env.nextauth.url}/evals/${runId}`;

	const html = renderReportEmail(
		reportData,
		reportId,
		generatedAt,
		reportUrl,
		pdfUrl,
		evaluationSummary,
		evalsUrl
	);

	const formattedDate = new Date(generatedAt).toLocaleDateString('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric'
	});

	const transporter = nodemailer.createTransport({
		host: env.smtp.host,
		port: env.smtp.port,
		secure: false,
		auth: {
			user: env.smtp.user,
			pass: env.smtp.password
		}
	});

	await transporter.sendMail({
		from: `"Pulsar" <${env.smtp.user}>`,
		to: recipients.join(', '),
		subject: `Pulsar: Market Analysis Report (${formattedDate})`,
		html
	});

	console.log(`[Notify] Email sent to ${recipients.length} subscriber(s)`);
}
