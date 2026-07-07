import { createClient } from '@supabase/supabase-js'
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  const { password } = req.query
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).send('Unauthorized')
  }

  const now = new Date()
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const { data: scans } = await supabase
    .from('scans')
    .select('library_id, stop_number, scanned_at')
    .gte('scanned_at', firstOfMonth.toISOString())

  const { data: participants } = await supabase
    .from('participants')
    .select('library_id, group_size, recorded_at')
    .gte('recorded_at', firstOfMonth.toISOString())

  const { data: libraries } = await supabase
    .from('libraries')
    .select('id, name')

  const results = {}
  for (const lib of libraries || []) {
    results[lib.id] = { name: lib.name, totalScans: 0, stops: {}, totalParticipants: 0 }
    for (let i = 1; i <= 8; i++) results[lib.id].stops[i] = 0
  }

  for (const scan of scans || []) {
    if (results[scan.library_id]) {
      results[scan.library_id].totalScans++
      if (scan.stop_number) results[scan.library_id].stops[scan.stop_number]++
    }
  }

  for (const p of participants || []) {
    if (results[p.library_id]) {
      results[p.library_id].totalParticipants += p.group_size || 0
    }
  }

  const rows = Object.values(results).map(lib => `
    <tr style="background:#f9f9f9">
      <td><strong>${lib.name}</strong></td>
      <td><strong>${lib.totalParticipants}</strong></td>
      <td><strong>${lib.totalScans}</strong></td>
      ${[1,2,3,4,5,6,7,8].map(i => `<td>${lib.stops[i]}</td>`).join('')}
    </tr>
  `).join('')

  res.send(`
    <html>
      <body style="font-family: sans-serif; padding: 40px;">
        <h1>Book Walk — ${now.toLocaleString('default', { month: 'long' })} ${now.getFullYear()}</h1>
        <table border="1" cellpadding="10">
          <tr>
            <th>Library</th>
            <th>Participants</th>
            <th>Total Scans</th>
            <th>Stop 1</th><th>Stop 2</th><th>Stop 3</th><th>Stop 4</th>
            <th>Stop 5</th><th>Stop 6</th><th>Stop 7</th><th>Stop 8</th>
          </tr>
          ${rows}
        </table>
      </body>
    </html>
  `)
}