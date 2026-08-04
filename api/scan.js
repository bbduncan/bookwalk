import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  const { id } = req.query

  if (!id) {
    return res.redirect('https://beckylduncan.com/bookwalkinactive.html')
  }

  const parts = id.split('-')
  const stopNumber = parseInt(parts[parts.length - 1])
  const libraryPrefix = parts.slice(0, -1).join('-')

  const { data: library, error } = await supabase
    .from('libraries')
    .select('active')
    .eq('id', libraryPrefix)
    .single()

  await supabase.from('scans').insert({
    library_id: libraryPrefix,
    stop_number: stopNumber
  })

  // Only show the hiatus page when a library is explicitly switched off.
  // If the lookup errored or found nothing, fail OPEN so a patron is never
  // stranded — send them through and log the problem instead.
  if (library && library.active === false) {
    return res.redirect('https://beckylduncan.com/bookwalkinactive.html')
  }

  // Fail-open path: lookup errored or found no library. Patron still goes
  // through below — but log it, and alert Becky at most once per library
  // per hour so an outage can't flood her inbox.
  if (error || !library) {
    const message = error ? error.message : 'library not found'
    console.error('scan.js: library lookup failed for', libraryPrefix, message)

    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

      const { data: recent } = await supabase
        .from('scan_errors')
        .select('id')
        .eq('library_id', libraryPrefix)
        .gte('occurred_at', oneHourAgo)
        .limit(1)

      const alreadyAlerted = recent && recent.length > 0

      await supabase.from('scan_errors').insert({
        library_id: libraryPrefix,
        message
      })

      if (!alreadyAlerted && process.env.RESEND_API_KEY && process.env.ALERT_EMAIL) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'Book Walk Alerts <becky@beckylduncan.com>',
            to: process.env.ALERT_EMAIL,
            subject: `⚠️ Book Walk scan issue — ${libraryPrefix}`,
            text:
              `A patron scanned "${id}" and the library lookup failed, so they were ` +
              `sent through anyway (fail-open). Nobody was blocked, but something ` +
              `needs a look.\n\n` +
              `Library: ${libraryPrefix}\n` +
              `Scanned code: ${id}\n` +
              `Problem: ${message}\n` +
              `Time: ${new Date().toISOString()}\n\n` +
              `Check that the "${libraryPrefix}" row exists in the libraries table ` +
              `and that scan.js is looking it up correctly.\n\n` +
              `(You'll get at most one of these per library per hour.)`
          })
        })
      }
    } catch (alertErr) {
      console.error('scan.js: alerting failed', alertErr)
    }
  }

  if (stopNumber === 1) {
    return res.redirect(`/start.html?library=${libraryPrefix}`)
  }

  return res.redirect(`https://beckylduncan.com/bookwalk${stopNumber}.html`)
}
