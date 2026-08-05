// Story Time on Demand — Weekly Library Reports
// Runs every Sunday via GitHub Actions.
// Reports on the PAST 7 DAYS: pulls each Story Time library's attendance
// + scan numbers from Supabase and emails them via Resend.

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

function pastWeekRange() {
  const now = new Date();
  const end = now;
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const opts = { month: "long", day: "numeric", timeZone: "UTC" };
  const label =
    `${start.toLocaleDateString("en-US", opts)}–` +
    `${end.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`;
  return { start: start.toISOString(), end: end.toISOString(), label };
}

function buildEmailHtml(libraryName, weekLabel, stats) {
  return `
  <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#333;">
    <h1 style="font-size:22px;color:#2c5f2d;">Your Story Time Report — ${weekLabel}</h1>
    <p>Hello ${libraryName}!</p>
    <p>Here's how Story Time on Demand went this past week:</p>

    <div style="background:#f6f4ef;border-radius:8px;padding:16px 20px;margin:16px 0;">
      <p style="margin:6px 0;font-size:18px;"><strong>${stats.totalAttendees}</strong> total attendees</p>
      <p style="margin:6px 0;font-size:18px;"><strong>${stats.totalScans}</strong> QR code scans</p>
    </div>

    <p style="margin-top:24px;">Thanks for sharing Story Time — see you next week!</p>
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
  const { start, end, label } = pastWeekRange();
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
      `storytime_attendance?library_id=eq.${lib.id}&recorded_at=gte.${start}&recorded_at=lt.${end}&select=group_size`
    );
    const scans = await supabase(
      `storytime_scans?library_id=eq.${lib.id}&scanned_at=gte.${start}&scanned_at=lt.${end}&select=id`
    );

    const totalAttendees = attendance.reduce(
      (sum, a) => sum + (Number(a.group_size) || 0),
      0
    );

    const stats = { totalAttendees, totalScans: scans.length };

    const recipient = TEST_EMAIL || lib.email;
    const subject = `Your Story Time Report — ${label}`;
    const html = buildEmailHtml(lib.name, label, stats);

    await sendEmail(recipient, subject, html);
    console.log(
      `SENT ${lib.id} -> ${recipient}` +
        (TEST_EMAIL ? " (test mode)" : "") +
        ` | attendees: ${totalAttendees}, scans: ${scans.length}`
    );
    sent++;
  }

  console.log(`Done. Sent ${sent}, skipped ${skipped}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
