import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  const { id } = req.query

  if (!id) {
    return res.redirect('https://beckylduncan.com/storytimeinactive.html')
  }

  const libraryId = id

  const { data: library, error } = await supabase
    .from('libraries')
    .select('storytime_active')
    .eq('id', libraryId)
    .single()

  await supabase.from('storytime_scans').insert({
    library_id: libraryId
  })

  // Show the inactive page only when the library is explicitly NOT subscribed
  // to Story Time. On any empty/errored lookup, fail OPEN — never strand a kid.
  if (library && library.storytime_active === false) {
    return res.redirect('https://beckylduncan.com/storytimeinactive.html')
  }

  if (error || !library) {
    const message = error ? error.message : 'library not found'
    console.error('storytime.js: library lookup failed for', libraryId, message)

    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

      const { data: recent } = await supabase
        .from('scan_errors')
        .select('id')
        .eq('library_id', libraryId)
        .ilike('message', 'storytime:%')
        .gte('occurred_at', oneHourAgo)
        .limit(1)

      const alreadyAlerted = recent && recent.length > 0

      await supabase.from('scan_errors').insert({
        library_id: libraryId,
        message: `storytime: ${message}`
      })

      if (!alreadyAlerted && process.env.RESEND_API_KEY && process.env.ALERT_EMAIL) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'Story Time Alerts <becky@beckylduncan.com>',
            to: process.env.ALERT_EMAIL,
            subject: `⚠️ Story Time scan issue — ${libraryId}`,
            text:
              `A patron scanned Story Time for "${id}" and the library lookup ` +
              `failed, so they were sent through anyway (fail-open). Nobody was ` +
              `blocked.\n\n` +
              `Library: ${libraryId}\n` +
              `Problem: ${message}\n` +
              `Time: ${new Date().toISOString()}\n\n` +
              `(At most one alert per library per hour.)`
          })
        })
      }
    } catch (alertErr) {
      console.error('storytime.js: alerting failed', alertErr)
    }
  }

  // Forward to the headcount popup, carrying the library so attendance
  // attributes to the right one.
  return res.redirect(`/storytimestart.html?library=${libraryId}`)
}
