import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('[supabase] Missing SUPABASE_URL or SUPABASE_*_KEY in environment');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

export async function ensureBucket(bucketName) {
  try {
    if (!bucketName) return;
    // list buckets (requires service role key); ignore if not permitted
    const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
    if (listErr) {
      console.warn('[supabase] listBuckets not available (likely anon key):', listErr.message);
      return; // cannot ensure bucket without admin privileges
    }
    if (buckets?.some(b => b.name === bucketName)) return;
    const { error } = await supabase.storage.createBucket(bucketName, { public: true, fileSizeLimit: 10 * 1024 * 1024 });
    if (error) {
      console.error('[supabase] createBucket error:', error.message);
    } else {
      console.log(`[supabase] Created storage bucket "${bucketName}"`);
    }
  } catch (e) {
    console.warn('[supabase] ensureBucket skipped:', e.message);
  }
}
