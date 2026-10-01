// Book Walk — Monthly Library Reports
// Runs DAILY via GitHub Actions, but only sends during the first
// CATCHUP_DAYS days of the month, and only to libraries that haven't
// already been sent last month's report (tracked in the report_log table).
// A skipped GitHub run therefore just means the next day's run catches up.
// Any failure emails ALERT_EMAIL and fails the run.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;

// If TEST_EMAIL is set, ALL reports go to that address instead of the libraries.
// Test mode ignores the send log and does NOT write to it.
const TEST_EMAIL = process.env.TEST_EMAIL || "";

// Where failure alerts go.
const ALERT_EMAIL = process.env.ALERT_EMAIL || "becky@beckylduncan.com";

// Only send during the first N days of the month.
const CATCHUP_DAYS = 7;

// The address reports are sent from (domain must be verified in Resend).
const FROM = "Book Walk Reports <becky@beckylduncan.com>";

// Shared monthly social media content pack (same link for every library).
const CONTENT_PACK_URL =
  "https://docs.google.com/spreadsheets/d/1duTJjgWOZefLo6vFbFKR-YcysfUopzmLafd3yRPkjb8/edit?usp=sharing";

// ---------- helpers ----------

async function supabase(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase query failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

async function supabaseInsert(table, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    throw new Error(`Supabase insert failed (${res.status}): ${await res.text()}`);
  }
}

function previousMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const label = start.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return { start: start.toISOString(), end: end.toISOString(), label };
}

function buildEmailHtml(libraryName, monthLabel, stats) {
  const stopRows = stats.perStop
    .map(
      (s) =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;">Stop ${s.stop}</td>` +
        `<td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">${s.count}</td></tr>`
    )
    .join("");

  return `
  <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#333;">
    <h1 style="font-size:22px;color:#2c5f2d;">Your Book Walk Report — ${monthLabel}</h1>
    <p>Hello ${libraryName}!</p>
    <p>Here's how your Book Walk performed last month:</p>

    <div style="background:#f6f4ef;border-radius:8px;padding:16px 20px;margin:16px 0;">
      <p style="margin:6px 0;font-size:18px;"><strong>${stats.totalWalkers}</strong> total walkers</p>
      <p style="margin:6px 0;font-size:18px;"><strong>${stats.totalGroups}</strong> groups or individuals started the walk</p>
      <p style="margin:6px 0;font-size:18px;"><strong>${stats.totalScans}</strong> QR code scans</p>
    </div>

    ${
      stats.perStop.length
        ? `<h3 style="font-size:16px;">Scans by stop</h3>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">
      ${stopRows}
    </table>`
        : ""
    }

    <div style="background:#eef3ee;border-radius:8px;padding:16px 20px;margin:20px 0;">
      <p style="margin:0 0 8px;font-size:16px;"><strong>This month's social media posts</strong></p>
      <p style="margin:0 0 12px;font-size:14px;">Ready-to-use captions and graphics for promoting your Book Walk — free for every subscribing library to use.</p>
      <a href="${CONTENT_PACK_URL}" style="display:inline-block;background:#2c5f2d;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;">Open the content pack &rarr;</a>
    </div>

    <p style="margin-top:24px;">Thanks for walking with us — see you next month!</p>
    <p style="color:#888;font-size:13px;">Book Walk by Library Magic Maker · beckylduncan.com</p>
  </div>`;
}

async function sendEmail(to, subject, html) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  if (!res.ok) {
    throw new Error(`Resend send failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

async function sendAlert(problems) {
  const items = problems.map((p) => `<li>${String(p)}</li>`).join("");
  const html =
    `<div style="font-family:Georgia,serif;max-width:560px;color:#333;">` +
    `<h2 style="color:#b00020;">Book Walk monthly report problem</h2>` +
    `<ul>${items}</ul>` +
    `<p>Check the run: https://github.com/bbduncan/bookwalk/actions/workflows/monthly-report.yml</p>` +
    `</div>`;
  try {
    await sendEmail(ALERT_EMAIL, "ALERT: Book Walk monthly report problem", html);
    console.log(`Alert emailed to ${ALERT_EMAIL}.`);
  } catch (e) {
    console.error("Could not send alert email:", e);
  }
}

// ---------- main ----------

async function main() {
  const { start, end, label } = previousMonthRange();
  const monthKey = start.slice(0, 7); // e.g. "2026-09"
  const today = new Date().getUTCDate();
  console.log(`Book Walk reports for ${label} (${monthKey}). Today is day ${today} (UTC).`);

  // 1. What has already been sent for this month?
  const logged = TEST_EMAIL
    ? []
