import express from 'express';
import multer from 'multer';
import { XMLParser } from 'fast-xml-parser';
import { supabase } from '../db/supabase.js';
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/products/normalize-categories - fix existing category_id based on product text
router.post('/normalize-categories', async (_req, res) => {
  try {
    // Load categories
    const { data: cats, error: catErr } = await supabase.from('categories').select('id, name');
    if (catErr) throw catErr;
    const catMap = new Map(cats.map(c => [c.name.toLowerCase(), c.id]));

    const toCategoryName = (text) => {
      const s = (text || '').toString().toLowerCase();
      if (/\b(women|femei)\b/.test(s)) return 'Women';
      if (/\b(men|barbati|bărbați)\b/.test(s)) return 'Men';
      if (s.includes('unisex')) return 'Unisex';
      return 'Special Offers';
    };

    // Get products
    const { data: products, error: prodErr } = await supabase
      .from('products')
      .select('id, name, description, category_id');
    if (prodErr) throw prodErr;

    let updated = 0;
    for (const p of products || []) {
      const desired = toCategoryName(`${p.name} ${p.description || ''}`);
      const desiredId = catMap.get(desired.toLowerCase()) || null;
      if (desiredId && desiredId !== p.category_id) {
        const { error: updErr } = await supabase.from('products').update({ category_id: desiredId }).eq('id', p.id);
        if (updErr) throw updErr;
        updated++;
      }
    }
    res.json({ success: true, updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const BUCKET = process.env.SUPABASE_BUCKET || 'product-images';

// GET /api/products (list)
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, description, price, sale_price, image_url, brand, external_link, category_id, stock, created_at, categories:categories!products_category_id_fkey(id, name)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/products/:id (placed after /import-xml to avoid conflicts)
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { data, error } = await supabase
      .from('products')
      .select('id, name, description, price, sale_price, image_url, brand, external_link, category_id, stock, created_at, categories:categories!products_category_id_fkey(id, name)')
      .eq('id', id)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/products (multipart/form-data)
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const { name, description, price, category_id, stock } = req.body;

    let image_url = null;
    if (req.file) {
      const ext = req.file.originalname.split('.').pop();
      const path = `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, req.file.buffer, {
        upsert: false,
        contentType: req.file.mimetype
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      image_url = pub.publicUrl;
    }

    const { data, error } = await supabase
      .from('products')
      .insert({
        name,
        description: description || null,
        price: Number(price),
        image_url,
        category_id: category_id ? Number(category_id) : null,
        stock: stock != null ? Number(stock) : 0
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/products/:id
router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const payload = {};
    const fields = ['name', 'description', 'price', 'sale_price', 'image_url', 'brand', 'external_link', 'category_id', 'stock'];
    for (const key of fields) if (key in req.body) payload[key] = req.body[key];
    if ('price' in payload) payload.price = Number(payload.price);
    if ('sale_price' in payload && payload.sale_price != null && payload.sale_price !== '') payload.sale_price = Number(payload.sale_price);
    if ('sale_price' in payload && (payload.sale_price === '' || payload.sale_price == null || Number.isNaN(payload.sale_price))) delete payload.sale_price;
    if ('category_id' in payload && payload.category_id != null) payload.category_id = Number(payload.category_id);
    if ('stock' in payload && payload.stock != null) payload.stock = Number(payload.stock);

    const { data, error } = await supabase.from('products').update(payload).eq('id', id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/products/:id
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/products (bulk delete)
router.delete('/', async (_req, res) => {
  try {
    // Use a safe filter that matches all rows without passing a null literal
    const { error } = await supabase.from('products').delete().gt('id', -1);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

// Import XML feed: POST /api/products/import-xml
// Accepts raw XML in body (Content-Type: application/xml or text/plain)
router.post('/import-xml', express.text({ type: ['application/xml', 'text/xml', 'text/plain'], limit: '10mb' }), async (req, res) => {
  try {
    const xml = typeof req.body === 'string' ? req.body : (req.body?.xml || '');
    if (!xml) return res.status(400).json({ error: 'Missing XML body' });

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true,
      trimValues: true,
      cdataPropName: '#text'
    });
    const parsed = parser.parse(xml);
    const entries = parsed?.feed?.entry;
    if (!entries) return res.status(400).json({ error: 'No entries found in feed' });
    const items = Array.isArray(entries) ? entries : [entries];

    // Load categories into a map
    const { data: cats, error: catErr } = await supabase.from('categories').select('id, name');
    if (catErr) throw catErr;
    const catMap = new Map(cats.map(c => [c.name.toLowerCase(), c.id]));

    const toCategoryName = (text) => {
      const s = (text || '').toString().toLowerCase();
      // Check women BEFORE men and use word boundaries to avoid 'women' matching 'men'
      if (/\b(women|femei)\b/.test(s)) return 'Women';
      if (/\b(men|barbati|bărbați)\b/.test(s)) return 'Men';
      if (s.includes('unisex')) return 'Unisex';
      return 'Special Offers';
    };

    // Helper to normalize text nodes that can arrive as arrays or objects with '#text'
    const getText = (val) => {
      if (Array.isArray(val)) val = val[0];
      if (val && typeof val === 'object') {
        if ('#text' in val) return String(val['#text']).trim();
        if ('_text' in val) return String(val['_text']).trim();
        if ('_cdata' in val) return String(val['_cdata']).trim();
        // Fall back to toString
        try { return JSON.stringify(val); } catch { return String(val); }
      }
      return typeof val === 'string' ? val.trim() : String(val ?? '').trim();
    };

    let imported = 0;
    for (const e of items) {
      const name = getText(e?.title ?? e?.g_title ?? '');
      if (!name) continue;
      const desc = getText(e?.description ?? '');
      const priceStr = getText(e?.price ?? '');
      const saleStr = getText(e?.sale_price ?? '');
      const priceNum = Number(String(priceStr).replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
      const saleNum = saleStr ? Number(String(saleStr).replace(/[^0-9.,]/g, '').replace(',', '.')) : null;
      const img = getText(e?.image_link ?? e?.g_image_link ?? '');
      const brand = getText(e?.brand ?? '');
      const external_link = getText(e?.link ?? '');
      const productType = getText(e?.product_type ?? e?.g_product_type ?? '');
      const catName = toCategoryName(productType);
      const category_id = catMap.get(catName.toLowerCase()) || null;
      const availability = getText(e?.availability ?? '').toLowerCase();
      const stock = availability.includes('in_stock') ? 10 : 0;

      // Upsert by name (simple heuristic)
      const { data: existing, error: findErr } = await supabase
        .from('products')
        .select('id')
        .eq('name', name)
        .maybeSingle();
      if (findErr) throw findErr;

      if (existing?.id) {
        const { error: updErr } = await supabase
          .from('products')
          .update({ description: desc, price: priceNum, sale_price: saleNum, image_url: img, brand, external_link, category_id, stock })
          .eq('id', existing.id);
        if (updErr) throw updErr;
      } else {
        const { error: insErr } = await supabase
          .from('products')
          .insert({ name, description: desc, price: priceNum, sale_price: saleNum, image_url: img, brand, external_link, category_id, stock });
        if (insErr) throw insErr;
      }
      imported++;
    }

    res.json({ success: true, imported });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
