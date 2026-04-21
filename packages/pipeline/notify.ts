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
  const generatedAt = new Date(result.rows[0].generated_at).toLocaleDateString();
  const reportUrl = `${env.nextauth.url}/reports/${reportId}`;
  const pdfUrl = `${env.nextauth.url}/api/reports/${reportId}/export/pdf`;

  const topKeywords = report.trendingKeywords
    .slice(0, 5)
    .map((k, i) => `<li><strong>${i + 1}. ${k.keyword}</strong> — ${k.count7d} mentions (7d)</li>`)
    .join("");

  const topTopics = report.trendingTopics
    .slice(0, 5)
    .map((t, i) => `<li><strong>${i + 1}. ${t.topic}</strong> — score: ${t.trendScore.toFixed(1)}</li>`)
    .join("");

  const opportunities = report.contentOpportunities
    .slice(0, 3)
    .map((o) => `<li>${o.signal} <em>(${o.source})</em></li>`)
    .join("");

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Pulsar Daily Report</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0;">${generatedAt} — ${report.articleCount} articles analyzed</p>
      </div>

      <div style="border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
        <h2 style="font-size: 18px; margin-top: 0;">Executive Summary</h2>
        <p style="line-height: 1.6;">${report.executiveSummary}</p>

        <h2 style="font-size: 18px;">Top Trending Keywords</h2>
        <ol style="padding-left: 20px; line-height: 1.8;">${topKeywords || "<li>No data</li>"}</ol>

        <h2 style="font-size: 18px;">Top Trending Topics</h2>
        <ol style="padding-left: 20px; line-height: 1.8;">${topTopics || "<li>No data</li>"}</ol>

        <h2 style="font-size: 18px;">Content Opportunities</h2>
        <ul style="padding-left: 20px; line-height: 1.8;">${opportunities || "<li>No opportunities identified</li>"}</ul>

        <div style="margin-top: 32px; text-align: center;">
          <a href="${reportUrl}" style="display: inline-block; background: #667eea; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-right: 12px;">View Full Report</a>
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
    subject: `Pulsar Report — ${generatedAt}`,
    html,
  });

  console.log(`[Notify] Email sent to ${env.smtp.notifyTo}`);
}
