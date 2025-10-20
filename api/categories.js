import express from 'express';
import { supabase } from '../db/supabase.js';

const router = express.Router();

// GET /api/categories
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('categories').select('*').order('name');
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/categories
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase.from('categories').insert({ name }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/categories/:id
router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name } = req.body;
    const { data, error } = await supabase.from('categories').update({ name }).eq('id', id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/categories/:id
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/categories/sync - ensure default frontend categories exist
router.post('/sync', async (_req, res) => {
  try {
    const defaults = ['Men', 'Women', 'Unisex', 'Special Offers'];
    // Fetch existing
    const { data: existing, error: selErr } = await supabase.from('categories').select('id, name');
    if (selErr) throw selErr;
    const have = new Set((existing || []).map(c => (c.name || '').toLowerCase()));
    const toInsert = defaults
      .filter(n => !have.has(n.toLowerCase()))
      .map(name => ({ name }));
    if (toInsert.length) {
      const { error: insErr } = await supabase.from('categories').insert(toInsert);
      if (insErr) throw insErr;
    }
    const { data: all, error: allErr } = await supabase.from('categories').select('*').order('name');
    if (allErr) throw allErr;
    res.json({ success: true, categories: all });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
