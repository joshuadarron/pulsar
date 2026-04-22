import nodemailer from 'nodemailer';
import { env } from '@pulsar/shared/config/env';
import { query } from '@pulsar/shared/db/postgres';
import type { ReportData } from '@pulsar/shared/types';

/** Convert newline-separated text to HTML paragraphs. */
function textToHtml(text: string, style: string): string {
	return text
		.split('\n\n')
		.filter((p) => p.trim())
		.map((p) => `<p style="${style};margin:0 0 12px;">${p.trim()}</p>`)
		.join('');
}

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

	const result = await query<{ report_data: ReportData; generated_at: string }>(
		'SELECT report_data, generated_at FROM reports WHERE id = $1',
		[reportId],
	);
	if (result.rows.length === 0) return;

	const report = result.rows[0].report_data;
	const sections = report.sections;
	const meta = report.reportMetadata;
	const generatedAt = new Date(result.rows[0].generated_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
	const periodStart = new Date(meta.periodStart).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
	const periodEnd = new Date(meta.periodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
	const reportUrl = `${env.nextauth.url}/reports/${reportId}`;
	const pdfUrl = `${env.nextauth.url}/api/reports/${reportId}/export/pdf`;

	const bodyStyle = 'line-height:1.7;font-size:14px;color:#374151';
	const summaryStyle = 'line-height:1.7;font-size:15px;color:#374151';

	// Metrics
	const metrics = [
		{ label: 'Articles', value: meta.articleCount },
		{ label: 'Keywords', value: sections.technologyTrends?.data?.keywords?.length ?? 0 },
		{ label: 'Topics', value: sections.technologyTrends?.data?.topics?.length ?? 0 },
		{ label: 'Entities', value: sections.marketLandscape?.data?.entities?.length ?? 0 },
		{ label: 'Sources', value: meta.sourcesCount },
	];
	const metricsRow = metrics
		.map((m) => `<td style="text-align:center;padding:12px 8px;width:20%;"><div style="font-size:28px;font-weight:700;color:#6366f1;">${m.value}</div><div style="font-size:11px;text-transform:uppercase;color:#6b7280;margin-top:4px;">${m.label}</div></td>`)
		.join('');

	// Keywords table
	const keywords = sections.technologyTrends?.data?.keywords ?? [];
	const keywordsTable = keywords.slice(0, 10).map((k) => {
		const arrow = k.delta > 0 ? '&#9650;' : k.delta < 0 ? '&#9660;' : '&#8212;';
		const arrowColor = k.delta > 0 ? '#10b981' : k.delta < 0 ? '#ef4444' : '#6b7280';
		return `<tr><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;">${k.keyword}</td><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right;">${k.count7d}</td><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right;">${k.count30d}</td><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:center;color:${arrowColor};">${arrow}</td></tr>`;
	}).join('');

	// Tech table
	const technologies = sections.marketLandscape?.data?.technologies ?? [];
	const techTable = technologies.slice(0, 8).map((t, i) =>
		`<tr><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;">${i + 1}</td><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;">${t.name}</td><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;">${t.type}</td><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right;">${t.mentionCount}</td></tr>`,
	).join('');

	// Entity sentence
	const entities = sections.marketLandscape?.data?.entities ?? [];
	const entitySentence = entities.slice(0, 5)
		.map((e, i, arr) => `<strong>${e.name}</strong> (${e.mentionCount} mentions)${i < arr.length - 1 ? (i === arr.length - 2 ? ', and ' : ', ') : ''}`)
		.join('');

	// Emerging topics
	const emerging = sections.technologyTrends?.data?.emergingTopics ?? [];
	const emergingHtml = emerging.length > 0
		? `<p style="${bodyStyle};margin:16px 0 0;">Emerging themes: ${emerging.map((t) => `<strong style="background:#fef3c7;padding:2px 6px;border-radius:4px;">${t}</strong>`).join(', ')}.</p>`
		: '';

	// Sentiment breakdown bar (matches UI)
	let sentimentHtml = '';
	const sb = sections.developerSignals?.data?.sentimentBreakdown;
	if (sb) {
		const total = sb.positive + sb.negative + sb.neutral;
		if (total > 0) {
			const pPct = Math.round((sb.positive / total) * 100);
			const nPct = Math.round((sb.neutral / total) * 100);
			const negPct = Math.round((sb.negative / total) * 100);
			sentimentHtml = `
				<table style="width:100%;border-collapse:collapse;margin:12px 0;" cellpadding="0" cellspacing="0">
					<tr>
						<td style="width:${pPct}%;height:12px;background:#10b981;${pPct > 0 ? 'border-radius:6px 0 0 6px;' : ''}"></td>
						<td style="width:${nPct}%;height:12px;background:#9ca3af;"></td>
						<td style="width:${negPct}%;height:12px;background:#ef4444;${negPct > 0 ? 'border-radius:0 6px 6px 0;' : ''}"></td>
					</tr>
				</table>
				<p style="font-size:12px;color:#6b7280;margin:0;">${pPct}% positive, ${nPct}% neutral, ${negPct}% negative</p>
			`;
		}
	}

	// Source list
	const sources = sections.marketLandscape?.data?.sourceDistribution ?? [];
	const sourceRows = [...sources]
		.sort((a, b) => b.articleCount - a.articleCount)
		.map((s) => `<tr><td style="padding:4px 8px;font-size:13px;color:#6b7280;">${s.source}</td><td style="padding:4px 8px;font-size:13px;color:#6b7280;text-align:right;">${s.articleCount}</td></tr>`)
		.join('');

	const html = `
		<!DOCTYPE html>
		<html>
		<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px; color: #1a1a1a; background: #f9fafb;">

			<!-- Header -->
			<div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 28px 24px; border-radius: 12px 12px 0 0;">
				<h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">Pulsar Intelligence Report</h1>
				<p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 14px;">${periodStart} to ${periodEnd}</p>
			</div>

			<div style="background: white; border: 1px solid #e5e7eb; border-top: none; padding: 0; border-radius: 0 0 12px 12px;">

				<!-- Key Metrics -->
				<table style="width:100%;border-collapse:collapse;background:#f9fafb;border-bottom:1px solid #e5e7eb;" cellpadding="0" cellspacing="0">
					<tr>${metricsRow}</tr>
				</table>

				<!-- Executive Summary -->
				<div style="padding: 24px;">
					<h2 style="font-size: 18px; margin: 0 0 12px; color: #111827;">Executive Summary</h2>
					${sections.executiveSummary?.text ? textToHtml(sections.executiveSummary.text, summaryStyle) : ''}
				</div>

				<!-- Market Landscape -->
				<div style="padding: 0 24px 24px;">
					<h2 style="font-size: 18px; margin: 0 0 12px; color: #111827;">Market Landscape</h2>
					${sections.marketLandscape?.text ? textToHtml(sections.marketLandscape.text, bodyStyle) : ''}
					${techTable ? `
						<table style="width:100%;border-collapse:collapse;font-size:13px;margin:16px 0;">
							<tr style="border-bottom:2px solid #e5e7eb;">
								<th style="text-align:left;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#9ca3af;">#</th>
								<th style="text-align:left;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#9ca3af;">Technology</th>
								<th style="text-align:left;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#9ca3af;">Type</th>
								<th style="text-align:right;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#9ca3af;">Mentions</th>
							</tr>
							${techTable}
						</table>
					` : ''}
					${entitySentence ? `<p style="${bodyStyle};margin:0;">Key entities: ${entitySentence}.</p>` : ''}
				</div>

				<!-- Technology Trends -->
				<div style="padding: 0 24px 24px;">
					<h2 style="font-size: 18px; margin: 0 0 12px; color: #111827;">Technology Trends</h2>
					${sections.technologyTrends?.text ? textToHtml(sections.technologyTrends.text, bodyStyle) : ''}
					${keywordsTable ? `
						<table style="width:100%;border-collapse:collapse;font-size:13px;margin:16px 0;">
							<tr style="border-bottom:2px solid #e5e7eb;">
								<th style="text-align:left;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#9ca3af;">Keyword</th>
								<th style="text-align:right;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#9ca3af;">7d</th>
								<th style="text-align:right;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#9ca3af;">30d</th>
								<th style="text-align:center;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#9ca3af;">Trend</th>
							</tr>
							${keywordsTable}
						</table>
					` : ''}
					${emergingHtml}
				</div>

				<!-- Developer Signals -->
				${sections.developerSignals?.text ? `
					<div style="padding: 0 24px 24px;">
						<h2 style="font-size: 18px; margin: 0 0 12px; color: #111827;">Developer Signals</h2>
						${textToHtml(sections.developerSignals.text, bodyStyle)}
						${sentimentHtml}
					</div>
				` : ''}

				<!-- Content Recommendations -->
				${sections.contentRecommendations?.text ? `
					<div style="padding: 0 24px 24px;border-left:4px solid #6366f1;">
						<h2 style="font-size: 18px; margin: 0 0 12px; color: #111827;">Content Recommendations</h2>
						${textToHtml(sections.contentRecommendations.text, bodyStyle)}
					</div>
				` : ''}

				<!-- Data Sources -->
				${sourceRows ? `
					<div style="padding: 0 24px 24px;">
						<h2 style="font-size: 12px; text-transform: uppercase; color: #9ca3af; margin: 0 0 8px;">Data Sources</h2>
						<table style="width:100%;border-collapse:collapse;">
							${sourceRows}
						</table>
						<p style="font-size:11px;color:#9ca3af;margin:8px 0 0;">Data collected from ${meta.sourcesCount} sources across the reporting period.</p>
					</div>
				` : ''}

				<!-- CTA Buttons -->
				<div style="padding: 16px 24px 28px; text-align: center;">
					<a href="${reportUrl}" style="display: inline-block; background: #4f46e5; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-right: 12px;">View Full Report</a>
					<a href="${pdfUrl}" style="display: inline-block; background: #f3f4f6; color: #374151; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">Download PDF</a>
				</div>
			</div>

			<p style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 24px;">
				Pulsar — Automated Market Intelligence
			</p>
		</body>
		</html>
	`;

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
		subject: `Pulsar Intelligence Report — ${generatedAt}`,
		html,
	});

	console.log(`[Notify] Email sent to ${recipients.length} subscriber(s)`);
}
