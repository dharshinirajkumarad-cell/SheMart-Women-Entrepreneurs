const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, select: false },
  googleId: { type: String, sparse: true, unique: true },
  emailVerified: { type: Boolean, default: false },
  emailVerificationTokenHash: { type: String, select: false },
  emailVerificationExpires: { type: Date, select: false },
  role: { type: String, enum: ['seller', 'customer', 'admin'], default: 'customer' },
  sellerStatus: { type: String, enum: ['not-applicable', 'pending', 'approved', 'rejected'], default: 'not-applicable' },
  businessName: { type: String, trim: true, maxlength: 120 },
  city: { type: String, trim: true, maxlength: 100 },
  category: { type: String, trim: true, maxlength: 80 },
  phone: { type: String, trim: true, maxlength: 30 }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
