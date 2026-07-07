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

  const { data: library } = await supabase
    .from('libraries')
    .select('active')
    .eq('id', id)
    .single()

  await supabase.from('scans').insert({
    library_id: libraryPrefix,
    stop_number: stopNumber
  })

  if (!library || !library.active) {
    return res.redirect('https://beckylduncan.com/bookwalkinactive.html')
  }

  if (stopNumber === 1) {
    return res.redirect(`/start.html?library=${libraryPrefix}`)
  }

  return res.redirect(`https://beckylduncan.com/bookwalk${stopNumber}.html`)
}