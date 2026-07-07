import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  const { library, size } = req.query

  if (library && size) {
    await supabase.from('participants').insert({
      library_id: library,
      group_size: parseInt(size)
    })
  }

  res.status(200).json({ ok: true })
}