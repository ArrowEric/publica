import express from 'express';
import { supabase } from '../db/supabase.js';

const router = express.Router();

// GET /api/orders
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    let query = supabase
      .from('orders')
      .select('id, user_name, phone, address, city, county, email, delivery_type, subtotal, total, status, created_at')
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/orders/:id
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();
    if (orderErr) throw orderErr;

    const { data: items, error: itemsErr } = await supabase
      .from('order_items')
      .select('id, order_id, product_id, quantity, price, products:products!order_items_product_id_fkey(id, name, image_url)')
      .eq('order_id', id);
    if (itemsErr) throw itemsErr;

    res.json({ ...order, items: items || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/orders
router.post('/', async (req, res) => {
  try {
    const {
      user_name,
      phone,
      address,
      city,
      county,
      email,
      delivery_type,
      items
    } = req.body;

    if (!user_name || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Missing user_name or items' });
    }

    // Fetch product prices and validate stock
    const productIds = [...new Set(items.map(i => Number(i.product_id)))];
    const { data: products, error: prodErr } = await supabase
      .from('products')
      .select('id, price, stock')
      .in('id', productIds);
    if (prodErr) throw prodErr;

    const priceMap = new Map(products.map(p => [p.id, p]));
    let subtotal = 0;
    for (const item of items) {
      const p = priceMap.get(Number(item.product_id));
      if (!p) return res.status(400).json({ error: `Product ${item.product_id} not found` });
      if (p.stock < Number(item.quantity)) return res.status(400).json({ error: `Insufficient stock for product ${item.product_id}` });
      subtotal += Number(p.price) * Number(item.quantity);
    }
    const total = subtotal; // adjust for shipping/taxes as needed

    // Create order
    const { data: newOrder, error: orderErr } = await supabase
      .from('orders')
      .insert({ user_name, phone, address, city, county, email, delivery_type, subtotal, total, status: 'Pending' })
      .select()
      .single();
    if (orderErr) throw orderErr;

    // Insert items and decrement stock sequentially (note: not transactional)
    for (const item of items) {
      const { error: itemErr } = await supabase.from('order_items').insert({
        order_id: newOrder.id,
        product_id: Number(item.product_id),
        quantity: Number(item.quantity),
        price: Number(priceMap.get(Number(item.product_id)).price)
      });
      if (itemErr) throw itemErr;
      const { error: stockErr } = await supabase
        .from('products')
        .update({ stock: priceMap.get(Number(item.product_id)).stock - Number(item.quantity) })
        .eq('id', Number(item.product_id));
      if (stockErr) throw stockErr;
    }

    res.status(201).json({ id: newOrder.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/orders/:id/status
router.put('/:id/status', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;
    const allowed = ['Pending', 'Shipped', 'Delivered'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const { data, error } = await supabase.from('orders').update({ status }).eq('id', id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
