require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const connectDB = require('./config/db');
const Product = require('./models/Product');
const SupportMessage = require('./models/SupportMessage');
const User = require('./models/User');
const authRoutes = require('./routes/auth');
const orderRoutes = require('./routes/orders');
const paymentRoutes = require('./routes/payments');
const { handleWebhook } = paymentRoutes;
const { sendEmail } = require('./services/email');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || /replace-with|change-me|example/i.test(process.env.JWT_SECRET)) {
  console.error('JWT_SECRET must be set to a random value with at least 32 characters. Copy .env.example to .env and configure it.');
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is required. Copy .env.example to .env and configure it.');
  process.exit(1);
}

const app = express();
const PORT = Number(process.env.PORT || 3000);
app.disable('x-powered-by');
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.APP_URL ? process.env.APP_URL.split(',').map(v => v.trim()) : true }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 200, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }));
// Razorpay signs the exact raw request body. This route must precede express.json().
app.post('/api/payments/webhook', express.raw({ type: 'application/json', limit: '1mb' }), handleWebhook);
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'shemart-api' }));
app.get('/api/config', (req, res) => res.json({
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
  onlinePaymentsEnabled: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
}));
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);

app.get('/api/products', async (req, res, next) => {
  try {
    const query = { active: true };
    const search = String(req.query.search || '').trim().slice(0, 80);
    const category = String(req.query.category || '').trim().slice(0, 80);
    if (search) query.title = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (category && !['all', 'All'].includes(category)) query.category = category;
    const products = await Product.find(query).populate('sellerId', 'name businessName sellerStatus').sort({ createdAt: -1 }).limit(100).lean();
    res.json({ success: true, data: products.map(p => ({ ...p, sellerName: p.businessName || p.sellerId?.businessName || p.sellerId?.name || p.sellerName, sellerStatus: p.sellerId?.sellerStatus })) });
  } catch (err) { next(err); }
});

app.post('/api/products', require('./config/auth'), async (req, res, next) => {
  try {
    if (req.user.role !== 'seller') return res.status(403).json({ error: 'Only seller accounts can add products.' });
    const seller = await User.findById(req.user.id);
    if (!seller || !seller.emailVerified) return res.status(403).json({ error: 'Verify your email before adding products.' });
    const { title, category, price, imageUrl, description, stock } = req.body;
    const amount = Number(price), inventory = stock === undefined || stock === '' ? 20 : Number(stock);
    if (!String(title || '').trim() || !Number.isFinite(amount) || amount <= 0 || amount > 10000000) return res.status(400).json({ error: 'Enter a product name and a valid positive price.' });
    if (!Number.isInteger(inventory) || inventory < 0 || inventory > 100000) return res.status(400).json({ error: 'Stock must be a whole number from 0 to 100000.' });
    let image = String(imageUrl || '').trim();
    if (image && !/^https:\/\//i.test(image)) return res.status(400).json({ error: 'Product image must use an HTTPS URL.' });
    const product = await Product.create({
      title: String(title).trim(), category: String(category || 'Home & Decor').trim(), price: Number(amount.toFixed(2)),
      imageUrl: image || undefined, description: String(description || '').trim(), stock: inventory,
      sellerId: seller._id, sellerName: seller.name, businessName: seller.businessName || seller.name
    });
    res.status(201).json({ message: 'Product added successfully.', product });
  } catch (err) { next(err); }
});

app.post('/api/support', async (req, res, next) => {
  try {
    const { name, email, message } = req.body;
    if (![name, email, message].every(v => typeof v === 'string' && v.trim()) || message.length > 3000) return res.status(400).json({ error: 'Name, email, and a message (max 3000 characters) are required.' });
    const support = await SupportMessage.create({ name: name.trim().slice(0, 100), email: email.trim().toLowerCase().slice(0, 254), message: message.trim() });
    await sendEmail({ to: process.env.SUPPORT_EMAIL || process.env.SMTP_USER, subject: `SheMart support message ${support._id}`, text: `From: ${support.name} (${support.email})\n\n${support.message}` }).catch(err => console.error('Support notification failed:', err.message));
    res.status(201).json({ message: 'Support message received. Thank you.' });
  } catch (err) { next(err); }
});

// Serve only the public web root; configuration, models, and route source stay private.
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny', index: 'index.html' }));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API route not found.' });
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});
app.use((err, req, res, next) => {
  if (err && err.code === 11000) return res.status(409).json({ error: 'This record already exists.' });
  if (err && err.name === 'ValidationError') return res.status(400).json({ error: 'Some submitted fields are invalid.' });
  if (err && err.status) return res.status(err.status).json({ error: err.message });
  console.error('Request failed:', err && err.message ? err.message : 'unknown error');
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

connectDB().then(() => app.listen(PORT, () => console.log(`SheMart running at http://localhost:${PORT}`)));
