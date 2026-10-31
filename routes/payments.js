const express = require('express');
const crypto = require('crypto');
const auth = require('../config/auth');
const Order = require('../models/Order');
const Product = require('../models/Product');
const { sendOrderEmails, sendEmail } = require('../services/email');

const router = express.Router();
router.post('/verify', auth, async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;
    if (!process.env.RAZORPAY_KEY_SECRET) return res.status(503).json({ error: 'Online payments are not configured.' });
    if (![razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId].every(v => typeof v === 'string' && v.length > 0)) return res.status(400).json({ error: 'Payment verification details are incomplete.' });
    const order = await Order.findOne({ _id: orderId, customer: req.user.id, paymentMethod: 'razorpay' });
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (order.paymentStatus === 'paid') return res.json({ message: 'Payment already verified.', order });
    if (order.paymentProviderOrderId !== razorpay_order_id) return res.status(400).json({ error: 'Payment order does not match.' });
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
    const supplied = Buffer.from(razorpay_signature), expectedBuffer = Buffer.from(expected);
    if (supplied.length !== expectedBuffer.length || !crypto.timingSafeEqual(supplied, expectedBuffer)) return res.status(400).json({ error: 'Payment signature verification failed.' });
    const updated = await Order.findOneAndUpdate({ _id: order._id, paymentStatus: 'pending' }, { $set: { paymentStatus: 'paid', status: 'placed', paymentProviderPaymentId: razorpay_payment_id, paymentSignature: razorpay_signature } }, { new: true });
    const finalOrder = updated || await Order.findById(order._id);
    if (updated) await sendOrderEmails(updated).catch(err => console.error('Order email error:', err.message));
    return res.json({ message: 'Payment verified successfully.', order: finalOrder });
  } catch (err) { next(err); }
});

async function handleWebhook(req, res) {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET, signature = req.get('x-razorpay-signature');
    if (!secret) return res.status(503).send('Webhook secret not configured');
    if (!Buffer.isBuffer(req.body) || !signature) return res.status(400).send('Invalid webhook request');
    const expected = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
    const a = Buffer.from(signature), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(400).send('Invalid webhook signature');
    const event = JSON.parse(req.body.toString('utf8'));
    const entity = event.payload && event.payload.payment && event.payload.payment.entity;
    if (!entity) return res.status(200).json({ received: true });
    const order = await Order.findOne({ paymentProviderOrderId: entity.order_id, paymentMethod: 'razorpay' });
    if (!order) return res.status(200).json({ received: true });
    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      const updated = await Order.findOneAndUpdate({ _id: order._id, paymentStatus: 'pending' }, { $set: { paymentStatus: 'paid', status: 'placed', paymentProviderPaymentId: entity.id } }, { new: true });
      if (updated) await sendOrderEmails(updated).catch(err => console.error('Webhook email error:', err.message));
    } else if (event.event === 'payment.failed') {
      const updated = await Order.findOneAndUpdate({ _id: order._id, paymentStatus: 'pending' }, { $set: { paymentStatus: 'failed', status: 'cancelled' } }, { new: true });
      if (updated) {
        for (const item of updated.items) await Product.updateOne({ _id: item.product }, { $inc: { stock: item.qty } });
        await sendEmail({ to: updated.customerEmail, subject: `SheMart payment failed — ${updated.orderNumber}`, text: `Payment for order ${updated.orderNumber} failed. No payment was recorded. Please try again.` }).catch(err => console.error('Payment failure email error:', err.message));
      }
    }
    return res.status(200).json({ received: true });
  } catch (err) { console.error('Payment webhook failed:', err.message); return res.status(400).send('Webhook processing failed'); }
}
module.exports = router;
module.exports.handleWebhook = handleWebhook;
