const express = require('express');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const auth = require('../config/auth');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const { sendOrderEmails, sendEmail } = require('../services/email');

const router = express.Router();
const gatewayConfigured = () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
const makeGateway = () => new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });

router.post('/', auth, async (req, res, next) => {
  const reserved = [];
  let savedOrder;
  try {
    const { items, shippingAddress, phone, paymentMethod } = req.body;
    if (req.user.role !== 'customer') return res.status(403).json({ error: 'Only customer accounts can place orders.' });
    if (!Array.isArray(items) || items.length < 1 || items.length > 30 || !String(shippingAddress || '').trim() || !String(phone || '').trim()) {
      return res.status(400).json({ error: 'Add items, a shipping address, and a phone number.' });
    }
    if (!['razorpay', 'cod'].includes(paymentMethod)) return res.status(400).json({ error: 'Choose online payment or Cash on Delivery.' });
    if (paymentMethod === 'razorpay' && !gatewayConfigured()) return res.status(503).json({ error: 'Online payments are not configured yet. Use Cash on Delivery during development or add Razorpay test keys.' });

    const quantities = new Map();
    for (const item of items) {
      const id = String(item.productId || '');
      const qty = Number(item.qty);
      if (!/^[a-f\d]{24}$/i.test(id) || !Number.isInteger(qty) || qty < 1 || qty > 20) return res.status(400).json({ error: 'Cart contains an invalid product or quantity.' });
      quantities.set(id, (quantities.get(id) || 0) + qty);
    }
    const productIds = [...quantities.keys()];
    const products = await Product.find({ _id: { $in: productIds }, active: true }).populate('sellerId', 'name email role emailVerified sellerStatus businessName');
    if (products.length !== productIds.length) return res.status(400).json({ error: 'One or more products are unavailable. Refresh your cart.' });

    // Validate every item before reserving any stock, so an invalid later item cannot leak earlier reservations.
    for (const product of products) {
      const qty = quantities.get(String(product._id));
      if (!product.sellerId || product.sellerId.role !== 'seller' || !product.sellerId.emailVerified) return res.status(400).json({ error: 'A seller for an item is not eligible to receive orders.' });
      if (product.stock < qty) return res.status(409).json({ error: `${product.title} does not have enough stock.` });
    }

    let subtotal = 0;
    const orderItems = [];
    for (const product of products) {
      const qty = quantities.get(String(product._id));
      const result = await Product.updateOne({ _id: product._id, active: true, stock: { $gte: qty } }, { $inc: { stock: -qty } });
      if (!result.modifiedCount) throw Object.assign(new Error(`${product.title} just sold out. Please refresh your cart.`), { status: 409 });
      reserved.push({ productId: product._id, qty });
      subtotal += product.price * qty;
      orderItems.push({
        product: product._id, sellerId: product.sellerId._id, sellerEmail: product.sellerId.email,
        sellerName: product.sellerId.businessName || product.sellerId.name,
        title: product.title, price: product.price, qty
      });
    }

    const customer = await User.findById(req.user.id);
    if (!customer || !customer.emailVerified) throw Object.assign(new Error('Please verify your email before ordering.'), { status: 403 });
    const shippingFee = 0;
    savedOrder = await Order.create({
      orderNumber: `SHM-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      customer: customer._id, customerName: customer.name, customerEmail: customer.email,
      items: orderItems, subtotal, shippingFee, totalAmount: Number((subtotal + shippingFee).toFixed(2)),
      shippingAddress: String(shippingAddress).trim(), phone: String(phone).trim(),
      paymentMethod, paymentStatus: paymentMethod === 'cod' ? 'cod-pending' : 'pending',
      status: paymentMethod === 'cod' ? 'placed' : 'awaiting-payment'
    });

    if (paymentMethod === 'cod') {
      await sendOrderEmails(savedOrder).catch(err => console.error('Order email error:', err.message));
      return res.status(201).json({ message: 'Order placed. Payment is due on delivery.', order: savedOrder });
    }

    try {
      const gatewayOrder = await makeGateway().orders.create({
        amount: Math.round(savedOrder.totalAmount * 100), currency: 'INR',
        receipt: savedOrder.orderNumber,
        notes: { shemartOrderId: String(savedOrder._id), orderNumber: savedOrder.orderNumber }
      });
      savedOrder.paymentProviderOrderId = gatewayOrder.id;
      await savedOrder.save();
      return res.status(201).json({
        message: 'Order created. Complete payment to confirm it.',
        order: savedOrder,
        payment: { provider: 'razorpay', keyId: process.env.RAZORPAY_KEY_ID, orderId: gatewayOrder.id, amount: gatewayOrder.amount, currency: gatewayOrder.currency }
      });
    } catch (error) {
      await Order.deleteOne({ _id: savedOrder._id });
      savedOrder = null;
      for (const item of reserved) await Product.updateOne({ _id: item.productId }, { $inc: { stock: item.qty } });
      reserved.length = 0;
      return res.status(502).json({ error: 'Payment provider could not create checkout. No order was placed; please try again.' });
    }
  } catch (err) {
    if (!savedOrder) {
      for (const item of reserved) await Product.updateOne({ _id: item.productId }, { $inc: { stock: item.qty } }).catch(() => {});
    }
    return next(err);
  }
});

router.post('/:id/cancel', auth, async (req, res, next) => {
  try {
    if (req.user.role !== 'customer') return res.status(403).json({ error: 'Customer account required.' });
    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, customer: req.user.id, paymentMethod: 'razorpay', paymentStatus: 'pending', status: 'awaiting-payment' },
      { $set: { paymentStatus: 'failed', status: 'cancelled' } },
      { new: true }
    );
    if (!order) return res.status(409).json({ error: 'This order is no longer awaiting payment and cannot be cancelled here.' });
    for (const item of order.items) await Product.updateOne({ _id: item.product }, { $inc: { stock: item.qty } });
    res.json({ message: 'Pending order cancelled and reserved stock released.' });
  } catch (err) { next(err); }
});

router.get('/mine', auth, async (req, res, next) => {
  try {
    if (req.user.role !== 'customer') return res.status(403).json({ error: 'Customer account required.' });
    const orders = await Order.find({ customer: req.user.id }).sort({ createdAt: -1 }).select('-paymentSignature');
    res.json({ orders });
  } catch (err) { next(err); }
});

router.get('/seller', auth, async (req, res, next) => {
  try {
    if (req.user.role !== 'seller') return res.status(403).json({ error: 'Seller account required.' });
    const orders = await Order.find({ 'items.sellerId': req.user.id, status: { $ne: 'awaiting-payment' } }).sort({ createdAt: -1 }).select('-paymentSignature').lean();
    const visible = orders.map(order => {
      const safe = { ...order, items: order.items.filter(item => String(item.sellerId) === String(req.user.id)) };
      delete safe.customerEmail;
      return safe;
    });
    res.json({ orders: visible });
  } catch (err) { next(err); }
});

router.patch('/:id/status', auth, async (req, res, next) => {
  try {
    if (req.user.role !== 'seller') return res.status(403).json({ error: 'Seller account required.' });
    const allowed = ['confirmed', 'shipped', 'delivered'];
    const { status } = req.body;
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid order status.' });
    const order = await Order.findOne({ _id: req.params.id, 'items.sellerId': req.user.id });
    if (!order) return res.status(404).json({ error: 'Order not found for this seller.' });
    if (!['placed', 'confirmed', 'shipped'].includes(order.status) && order.status !== 'delivered') return res.status(409).json({ error: 'This order cannot be updated in its current state.' });
    const ownedItems = order.items.filter(item => String(item.sellerId) === String(req.user.id));
    const transitions = { placed: ['confirmed'], confirmed: ['shipped'], shipped: ['delivered'], delivered: [] };
    if (!ownedItems.length || ownedItems.some(item => !(transitions[item.status || 'placed'] || []).includes(status))) {
      return res.status(409).json({ error: 'The requested status transition is not allowed for your items.' });
    }
    ownedItems.forEach(item => { item.status = status; });
    const itemStatuses = order.items.map(item => item.status || 'placed');
    order.status = itemStatuses.every(s => s === 'delivered') ? 'delivered'
      : itemStatuses.some(s => s === 'shipped') ? 'shipped'
      : itemStatuses.some(s => s === 'confirmed') ? 'confirmed' : 'placed';
    await order.save();
    await sendEmail({
      to: order.customerEmail, subject: `SheMart order update — ${order.orderNumber}`,
      text: `The items fulfilled by ${req.user.name} in SheMart order ${order.orderNumber} are now marked ${status}.`,
      html: `<p>The items fulfilled by ${req.user.name} in SheMart order <b>${order.orderNumber}</b> are now marked <b>${status}</b>.</p>`
    }).catch(err => console.error('Status email failed:', err.message));
    const safeOrder = order.toObject();
    safeOrder.items = safeOrder.items.filter(item => String(item.sellerId) === String(req.user.id));
    delete safeOrder.paymentSignature;
    delete safeOrder.customerEmail;
    res.json({ order: safeOrder });
  } catch (err) { next(err); }
});


router.patch('/:id/cod-payment', auth, async (req, res, next) => {
  try {
    if (req.user.role !== 'seller') return res.status(403).json({ error: 'Seller account required.' });
    const order = await Order.findOne({ _id: req.params.id, 'items.sellerId': req.user.id });
    if (!order) return res.status(404).json({ error: 'Order not found for this seller.' });
    if (order.paymentMethod !== 'cod') return res.status(409).json({ error: 'This order is not Cash on Delivery.' });
    if (order.status !== 'delivered') return res.status(409).json({ error: 'Mark the order delivered before recording COD collection.' });
    if (order.paymentStatus === 'paid') return res.json({ message: 'COD collection was already recorded.', order });
    order.paymentStatus = 'paid';
    await order.save();
    await sendEmail({
      to: order.customerEmail, subject: `SheMart COD payment received — ${order.orderNumber}`,
      text: `Cash on Delivery collection for SheMart order ${order.orderNumber} has been recorded as received. Total: ₹${order.totalAmount.toFixed(2)}.`,
      html: `<p>Cash on Delivery collection for SheMart order <b>${order.orderNumber}</b> has been recorded as received.</p><p>Total: ₹${order.totalAmount.toFixed(2)}.</p>`
    }).catch(err => console.error('COD payment email failed:', err.message));
    const safeOrder = order.toObject();
    safeOrder.items = safeOrder.items.filter(item => String(item.sellerId) === String(req.user.id));
    delete safeOrder.customerEmail;
    delete safeOrder.paymentSignature;
    res.json({ message: 'COD collection recorded.', order: safeOrder });
  } catch (err) { next(err); }
});

module.exports = router;
