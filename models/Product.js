const mongoose = require('mongoose');
const productSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 3000, default: '' },
  price: { type: Number, required: true, min: 0.01 },
  category: { type: String, trim: true, maxlength: 80, default: 'Home & Decor' },
  imageUrl: { type: String, trim: true, maxlength: 1500, default: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=500&auto=format&fit=crop&q=60' },
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sellerName: { type: String, trim: true, maxlength: 120, required: true },
  businessName: { type: String, trim: true, maxlength: 120, default: '' },
  stock: { type: Number, min: 0, default: 20 },
  active: { type: Boolean, default: true }
}, { timestamps: true });
module.exports = mongoose.model('Product', productSchema);
