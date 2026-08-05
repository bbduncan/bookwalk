// Story Time on Demand — Monthly Library Reports
// Runs on the 1st of each month via GitHub Actions.
// Reports on the PREVIOUS month: each Story Time library's total attendees
// and scans, plus a week-by-week breakdown (each week = a different story,
// so this shows which stories drew the biggest crowds).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;

// If TEST_EMAIL is set, ALL reports go to that address instead of the libraries.
const TEST_EMAIL = process.env.TEST_EMAIL || "";

// The address reports are sent from (domain must be verified in Resend).
const FROM = "Story Time Reports <becky@beckylduncan.com>";

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

// Sunday 00:00 UTC of the week containing the given timestamp.
function weekStartUTC(iso) {
  const d = new Date(iso);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return new Date(day.getTime() - day.getUTCDay() * 86400000);
}

function weekLabel(sunday) {
  const sat = new Date(sunday.getTime() + 6 * 86400000);
  const opts = { month: "numeric", day: "numeric", timeZone: "UTC" };
  return `${sunday.toLocaleDateString("en-US", opts)}–${sat.toLocaleDateString("en-US", opts)}`;
}

function buildEmailHtml(libraryName, monthLabel, stats) {
  const weekRows = stats.perWeek
    .map(
      (w) =>
        `<tr>` +
        `<td style="padding:6px 12px;border-bottom:1px solid #eee;">Week of ${w.label}</td>` +
        `<td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">${w.scans}</td>` +
        `<td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">${w.attendees}</td>` +
        `</tr>`
    )
    .join("");

  return `
  <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#333;">
    <h1 style="font-size:22px;color:#2c5f2d;">Your Story Time Report — ${monthLabel}</h1>
    <p>Hello ${libraryName}!</p>
    <p>Here's how Story Time on Demand went last month:</p>

    <div style="background:#f6f4ef;border-radius:8px;padding:16px 20px;margin:16px 0;">
      <p style="margin:6px 0;font-size:18px;"><strong>${stats.totalAttendees}</strong> total attendees</p>
      <p style="margin:6px 0;font-size:18px;"><strong>${stats.totalScans}</strong> total QR code scans</p>
    </div>

    ${
      stats.perWeek.length
        ? `<h3 style="font-size:16px;">Week by week</h3>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">
      <tr>
        <th style="padding:6px 12px;text-align:left;border-bottom:2px solid #ddd;">Week</th>
        <th style="padding:6px 12px;text-align:right;border-bottom:2px solid #ddd;">Scans</th>
        <th style="padding:6px 12px;text-align:right;border-bottom:2px solid #ddd;">Attendees</th>
      </tr>
      ${weekRows}
    </table>
    <p style="color:#888;font-size:13px;margin-top:8px;">Each week features a different story, so this shows which ones drew the biggest crowds.</p>`
        : ""
    }

    <p style="margin-top:24px;">Thanks for sharing Story Time — see you next month!</p>
    <p style="color:#888;font-size:13px;">Story Time on Demand by Library Magic Maker · beckylduncan.com</p>
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

// ---------- main ----------

async function main() {
  const { start, end, label } = previousMonthRange();
  console.log(`Generating Story Time reports for ${label}...`);

  const libraries = await supabase(
    "libraries?storytime_active=eq.true&select=id,name,email"
  );
  console.log(
    `Found ${libraries.length} Story Time librar${libraries.length === 1 ? "y" : "ies"}: ` +
      libraries.map((l) => l.id).join(", ")
  );

  let sent = 0;
  let skipped = 0;

  for (const lib of libraries) {
    if (!lib.email) {
      console.log(`SKIPPED ${lib.id}: no email address on file.`);
      skipped++;
      continue;
    }

    const attendance = await supabase(
      `storytime_attendance?library_id=eq.${lib.id}&recorded_at=gte.${start}&recorded_at=lt.${end}&select=group_size,recorded_at`
    );
    const scans = await supabase(
      `storytime_scans?library_id=eq.${lib.id}&scanned_at=gte.${start}&scanned_at=lt.${end}&select=scanned_at`
    );

    const totalAttendees = attendance.reduce(
      (sum, a) => sum + (Number(a.group_size) || 0),
      0
    );

    const weeks = {};
    for (const s of scans) {
      const key = weekStartUTC(s.scanned_at).toISOString();
      if (!weeks[key]) weeks[key] = { scans: 0, attendees: 0 };
      weeks[key].scans++;
    }
    for (const a of attendance) {
      const key = weekStartUTC(a.recorded_at).toISOString();
      if (!weeks[key]) weeks[key] = { scans: 0, attendees: 0 };
      weeks[key].attendees += Number(a.group_size) || 0;
    }
    const perWeek = Object.keys(weeks)
      .sort()
      .map((key) => ({
        label: weekLabel(new Date(key)),
        scans: weeks[key].scans,
        attendees: weeks[key].attendees,
      }));

    const stats = { totalAttendees, totalScans: scans.length, perWeek };

    const recipient = TEST_EMAIL || lib.email;
    const subject = `Your Story Time Report — ${label}`;
    const html = buildEmailHtml(lib.name, label, stats);

    await sendEmail(recipient, subject, html);
    console.log(
      `SENT ${lib.id} -> ${recipient}` +
        (TEST_EMAIL ? " (test mode)" : "") +
        ` | attendees: ${totalAttendees}, scans: ${scans.length}, weeks: ${perWeek.length}`
    );
    sent++;
  }

  console.log(`Done. Sent ${sent}, skipped ${skipped}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
