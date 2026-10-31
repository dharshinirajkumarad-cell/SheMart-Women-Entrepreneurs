const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  customerName: { type: String, required: true },
  customerEmail: { type: String, required: true },
  items: [{
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sellerEmail: { type: String, required: true },
    sellerName: { type: String, required: true },
    title: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    qty: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['placed', 'confirmed', 'shipped', 'delivered'], default: 'placed' }
  }],
  subtotal: { type: Number, required: true, min: 0 },
  shippingFee: { type: Number, default: 0, min: 0 },
  totalAmount: { type: Number, required: true, min: 0 },
  shippingAddress: { type: String, required: true, maxlength: 1000 },
  phone: { type: String, required: true, maxlength: 30 },
  paymentMethod: { type: String, enum: ['razorpay', 'cod'], required: true },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'cod-pending', 'refunded'], default: 'pending' },
  paymentProviderOrderId: String,
  paymentProviderPaymentId: String,
  paymentSignature: { type: String, select: false },
  status: { type: String, enum: ['awaiting-payment', 'placed', 'confirmed', 'shipped', 'delivered', 'cancelled'], default: 'awaiting-payment' },
  emailEvents: { type: [String], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
