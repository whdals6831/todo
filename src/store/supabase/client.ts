import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined

/** .env.local 에 Supabase 주소와 공개 키가 있으면 Supabase 에 저장한다. 없으면 이 브라우저(localStorage)에 저장 */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null
