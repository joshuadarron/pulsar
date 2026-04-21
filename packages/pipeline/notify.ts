import nodemailer from "nodemailer";
import { env } from "@pulsar/shared/config/env";
import { query } from "@pulsar/shared/db/postgres";
import type { ReportData } from "@pulsar/shared/types";

export async function sendReportEmail(reportId: string): Promise<void> {
  if (!env.smtp.user || !env.smtp.password || !env.smtp.notifyTo) {
    console.log("[Notify] SMTP not configured, skipping email.");
    return;
  }

  const result = await query<{ report_data: ReportData; generated_at: string }>(
    "SELECT report_data, generated_at FROM reports WHERE id = $1",
    [reportId],
  );
  if (result.rows.length === 0) return;

  const report = result.rows[0].report_data;
  const generatedAt = new Date(result.rows[0].generated_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const periodStart = new Date(report.period.start).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const periodEnd = new Date(report.period.end).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const reportUrl = `${env.nextauth.url}/reports/${reportId}`;
  const pdfUrl = `${env.nextauth.url}/api/reports/${reportId}/export/pdf`;

  // Metrics
  const metrics = [
    { label: "Articles", value: report.articleCount },
    { label: "Keywords", value: report.trendingKeywords.length },
    { label: "Topics", value: report.trendingTopics.length },
    { label: "Entities", value: report.entityProminence.length },
    { label: "Sources", value: report.sourceDistribution.length },
  ];
  const metricsRow = metrics
    .map((m) => `<td style="text-align:center;padding:12px 8px;width:20%;"><div style="font-size:28px;font-weight:700;color:#6366f1;">${m.value}</div><div style="font-size:11px;text-transform:uppercase;color:#6b7280;margin-top:4px;">${m.label}</div></td>`)
    .join("");

  // Keywords table
  const keywordsTable = report.trendingKeywords.slice(0, 10).map((k) => {
    const arrow = k.delta > 0 ? "&#9650;" : k.delta < 0 ? "&#9660;" : "&#8212;";
    const arrowColor = k.delta > 0 ? "#10b981" : k.delta < 0 ? "#ef4444" : "#6b7280";
    return `<tr><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;">${k.keyword}</td><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right;">${k.count7d}</td><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right;">${k.count30d}</td><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:center;color:${arrowColor};">${arrow}</td></tr>`;
  }).join("");

  // Tech table
  const techTable = report.trendingTechnologies.slice(0, 5).map((t, i) =>
    `<tr><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;">${i + 1}</td><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;">${t.name}</td><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;">${t.type}</td><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right;">${t.mentionCount}</td></tr>`,
  ).join("");

  // Entity sentence
  const entitySentence = report.entityProminence.slice(0, 5)
    .map((e, i, arr) => `<strong>${e.name}</strong> (${e.mentionCount} mentions)${i < arr.length - 1 ? (i === arr.length - 2 ? ", and " : ", ") : ""}`)
    .join("");

  // Opportunities
  const opportunityCards = report.contentOpportunities.slice(0, 5).map((o, i) =>
    `<div style="border-left:4px solid #6366f1;padding:12px 16px;margin-bottom:12px;background:#fafafa;border-radius:0 8px 8px 0;">
      <div style="font-size:12px;font-weight:700;color:#6366f1;margin-bottom:4px;">${i + 1}</div>
      <p style="margin:0;font-size:14px;color:#1a1a1a;">${o.signal}</p>
      <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">${o.source}${o.url ? ` — <a href="${o.url}" style="color:#6366f1;">View source</a>` : ""}</p>
    </div>`,
  ).join("");

  // Emerging topics
  const emergingTopics = report.emergingTopics.length > 0
    ? `<p style="margin-top:16px;font-size:14px;line-height:1.7;color:#374151;">Several emerging themes are gaining traction: ${report.emergingTopics.map((t) => `<strong style="background:#fef3c7;padding:2px 6px;border-radius:4px;">${t}</strong>`).join(", ")}.</p>`
    : "";

  // Source list
  const sourceRows = report.sourceDistribution
    .sort((a, b) => b.articleCount - a.articleCount)
    .map((s) => `<tr><td style="padding:4px 8px;font-size:13px;color:#6b7280;">${s.source}</td><td style="padding:4px 8px;font-size:13px;color:#6b7280;text-align:right;">${s.articleCount}</td></tr>`)
    .join("");

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px; color: #1a1a1a; background: #f9fafb;">

      <!-- Section 1: Header -->
      <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 28px 24px; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">Pulsar Intelligence Report</h1>
        <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 14px;">${periodStart} — ${periodEnd}</p>
      </div>

      <div style="background: white; border: 1px solid #e5e7eb; border-top: none; padding: 0; border-radius: 0 0 12px 12px;">

        <!-- Section 2: Key Metrics -->
        <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-bottom:1px solid #e5e7eb;" cellpadding="0" cellspacing="0">
          <tr>${metricsRow}</tr>
        </table>

        <!-- Section 3: Executive Summary -->
        <div style="padding: 24px;">
          <h2 style="font-size: 18px; margin: 0 0 12px; color: #111827;">Executive Summary</h2>
          <p style="line-height: 1.7; font-size: 15px; color: #374151; margin: 0;">${report.executiveSummary}</p>
        </div>

        <!-- Section 4: Keyword & Topic Landscape -->
        <div style="padding: 0 24px 24px;">
          <h2 style="font-size: 18px; margin: 0 0 12px; color: #111827;">Keyword & Topic Landscape</h2>
          ${report.narrativeAnalysis.keywords ? `<p style="line-height:1.7;font-size:14px;color:#374151;margin:0 0 16px;">${report.narrativeAnalysis.keywords}</p>` : ""}
          ${keywordsTable ? `
            <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
              <tr style="border-bottom:2px solid #e5e7eb;">
                <th style="text-align:left;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#9ca3af;">Keyword</th>
                <th style="text-align:right;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#9ca3af;">7d</th>
                <th style="text-align:right;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#9ca3af;">30d</th>
                <th style="text-align:center;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#9ca3af;">Trend</th>
              </tr>
              ${keywordsTable}
            </table>
          ` : ""}
          ${report.narrativeAnalysis.topics ? `<p style="line-height:1.7;font-size:14px;color:#374151;margin:0 0 8px;">${report.narrativeAnalysis.topics}</p>` : ""}
          ${emergingTopics}
        </div>

        <!-- Section 5: Technology & Entity Analysis -->
        <div style="padding: 0 24px 24px;">
          <h2 style="font-size: 18px; margin: 0 0 12px; color: #111827;">Technology & Entity Analysis</h2>
          ${report.narrativeAnalysis.technologies ? `<p style="line-height:1.7;font-size:14px;color:#374151;margin:0 0 16px;">${report.narrativeAnalysis.technologies}</p>` : ""}
          ${techTable ? `
            <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
              <tr style="border-bottom:2px solid #e5e7eb;">
                <th style="text-align:left;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#9ca3af;">#</th>
                <th style="text-align:left;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#9ca3af;">Technology</th>
                <th style="text-align:left;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#9ca3af;">Type</th>
                <th style="text-align:right;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#9ca3af;">Mentions</th>
              </tr>
              ${techTable}
            </table>
          ` : ""}
          ${entitySentence ? `<p style="line-height:1.7;font-size:14px;color:#374151;margin:0;">Key entities this period include ${entitySentence}.</p>` : ""}
        </div>

        <!-- Section 6: Content Opportunities -->
        <div style="padding: 0 24px 24px;">
          <h2 style="font-size: 18px; margin: 0 0 8px; color: #111827;">Content Opportunities</h2>
          <p style="font-size:13px;color:#6b7280;margin:0 0 16px;">Based on the trends identified above, the following content opportunities have been identified:</p>
          ${opportunityCards || '<p style="font-size:14px;color:#9ca3af;">No opportunities identified this period.</p>'}
          ${report.narrativeAnalysis.opportunities ? `<p style="line-height:1.7;font-size:14px;color:#374151;margin:16px 0 0;">${report.narrativeAnalysis.opportunities}</p>` : ""}
        </div>

        <!-- Section 7: Data Sources -->
        ${sourceRows ? `
          <div style="padding: 0 24px 24px;">
            <h2 style="font-size: 12px; text-transform: uppercase; color: #9ca3af; margin: 0 0 8px;">Data Sources</h2>
            <table style="width:100%;border-collapse:collapse;">
              ${sourceRows}
            </table>
            <p style="font-size:11px;color:#9ca3af;margin:8px 0 0;">Data collected from ${report.sourceDistribution.length} sources across the reporting period.</p>
          </div>
        ` : ""}

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
    to: env.smtp.notifyTo,
    subject: `Pulsar Intelligence Report — ${generatedAt}`,
    html,
  });

  console.log(`[Notify] Email sent to ${env.smtp.notifyTo}`);
}
