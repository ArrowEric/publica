import { supabase } from '../db/supabase.js';

export async function requireAuth(req, res, next) {
  try {
    if (process.env.AUTH_ENABLED !== 'true') return next();
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Invalid token' });
    req.user = data.user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Auth error' });
  }
}
