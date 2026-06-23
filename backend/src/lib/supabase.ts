import { createClient } from '@supabase/supabase-js'

const url  = process.env.SUPABASE_URL
const key  = process.env.SUPABASE_SERVICE_KEY

if (!url || !key) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios no .env')
}

export const supabase = createClient(url, key)
