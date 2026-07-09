// Book Walk — Monthly Library Reports
// Runs on the 1st of each month via GitHub Actions.
// Reports on the PREVIOUS month: pulls each active library's
// participant + scan numbers from Supabase and emails them via Resend.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;

// If TEST_EMAIL is set, ALL reports go to that address instead of the libraries.
const TEST_EMAIL = process.env.TEST_EMAIL || "";

// The address reports are sent from (domain must be verified in Resend).
const FROM = "Book Walk Reports <bookwalk@beckylduncan.com>";

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

// ---------- main ----------

async function main() {
  const { start, end, label } = previousMonthRange();
  console.log(`Generating Book Walk reports for ${label}...`);

  // 1. Get all active library rows, then group by prefix (ERIE-1..ERIE-8 -> ERIE)
  const rows = await supabase("libraries?active=eq.true&select=id,name,email");
  const libraries = {};
  for (const row of rows) {
    const prefix = row.id.split("-")[0];
    if (!libraries[prefix]) {
      libraries[prefix] = { name: row.name, email: row.email };
    }
  }

  const prefixes = Object.keys(libraries);
  console.log(`Found ${prefixes.length} active librar${prefixes.length === 1 ? "y" : "ies"}: ${prefixes.join(", ")}`);

  let sent = 0;
  let skipped = 0;

  // 2. For each library, pull last month's numbers and send the report
  for (const prefix of prefixes) {
    const lib = libraries[prefix];

    if (!lib.email) {
      console.log(`SKIPPED ${prefix}: no email address on file.`);
      skipped++;
      continue;
    }

    const participants = await supabase(
      `participants?library_id=eq.${prefix}&recorded_at=gte.${start}&recorded_at=lt.${end}&select=group_size`
    );
    const scans = await supabase(
      `scans?library_id=eq.${prefix}&scanned_at=gte.${start}&scanned_at=lt.${end}&select=stop_number`
    );

    const totalWalkers = participants.reduce(
      (sum, p) => sum + (Number(p.group_size) || 0),
      0
    );

    const stopCounts = {};
    for (const s of scans) {
      stopCounts[s.stop_number] = (stopCounts[s.stop_number] || 0) + 1;
    }
    const perStop = Object.keys(stopCounts)
      .sort((a, b) => Number(a) - Number(b))
      .map((stop) => ({ stop, count: stopCounts[stop] }));

    const stats = {
      totalWalkers,
      totalGroups: participants.length,
      totalScans: scans.length,
      perStop,
    };

    const recipient = TEST_EMAIL || lib.email;
    const subject = `Your Book Walk Report — ${label}`;
    const html = buildEmailHtml(lib.name, label, stats);

    await sendEmail(recipient, subject, html);
    console.log(
      `SENT ${prefix} -> ${recipient}` +
        (TEST_EMAIL ? " (test mode)" : "") +
        ` | walkers: ${totalWalkers}, groups: ${participants.length}, scans: ${scans.length}`
    );
    sent++;
  }

  console.log(`Done. Sent ${sent}, skipped ${skipped}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
