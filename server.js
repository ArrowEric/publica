import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import productsRouter from './api/products.js';
import ordersRouter from './api/orders.js';
import categoriesRouter from './api/categories.js';
import { ensureBucket } from './db/supabase.js';
import { requireAuth } from './middleware/auth.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// CORS origins from env (comma-separated)
const origins = (process.env.CORS_ORIGINS)
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors({ origin: origins, credentials: false }));
app.use(express.json({ limit: '2mb' }));

// Health
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Optional admin auth for write operations
// Allow unauthenticated checkout order creation (POST /api/orders)
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    // If posting a new order, skip auth so customers can checkout
    if (req.method === 'POST' && req.path && req.path.startsWith('/orders')) {
      return next();
    }
    return requireAuth(req, res, next);
  }
  next();
});

app.use('/api/products', productsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/categories', categoriesRouter);

app.listen(PORT, async () => {
  console.log(`API server running on http://localhost:${PORT}`);
  await ensureBucket(process.env.SUPABASE_BUCKET);
});
