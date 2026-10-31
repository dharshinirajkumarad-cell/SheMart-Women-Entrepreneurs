const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const auth = require('../config/auth');
const { sendVerificationEmail, sendEmail } = require('../services/email');

const router = express.Router();
const googleClient = new OAuth2Client();
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const publicUser = user => ({
  id: String(user._id), name: user.name, email: user.email, role: user.role,
  emailVerified: user.emailVerified, sellerStatus: user.sellerStatus,
  businessName: user.businessName || ''
});
function issueToken(user) {
  return jwt.sign({ id: String(user._id), role: user.role, name: user.name, email: user.email }, process.env.JWT_SECRET, { expiresIn: '2h', algorithm: 'HS256' });
}

router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, role, phone, city, businessName, category } = req.body;
    const normalizedEmail = normalizeEmail(email);
    if (!String(name || '').trim() || !normalizedEmail || !password) return res.status(400).json({ error: 'Name, email, and password are required.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (String(password).length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return res.status(400).json({ error: 'Password must be at least 10 characters and include a letter and a number.' });
    const chosenRole = role === 'seller' ? 'seller' : 'customer';
    if (chosenRole === 'seller' && !String(businessName || '').trim()) return res.status(400).json({ error: 'Business name is required for seller registration.' });
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) return res.status(409).json({ error: 'This email is already registered. Try signing in instead.' });

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const user = new User({
      name: String(name).trim(), email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 12),
      role: chosenRole, phone: String(phone || '').trim(), city: String(city || '').trim(),
      businessName: chosenRole === 'seller' ? String(businessName).trim() : undefined,
      category: chosenRole === 'seller' ? String(category || '').trim() : undefined,
      sellerStatus: chosenRole === 'seller' ? 'pending' : 'not-applicable',
      emailVerificationTokenHash: hashToken(verificationToken),
      emailVerificationExpires: new Date(Date.now() + 30 * 60 * 1000)
    });
    await user.save();
    let emailSent = false;
    try { emailSent = (await sendVerificationEmail(user, verificationToken)).sent; }
    catch (e) { console.error('Verification email failed:', e.message); }
    const response = { message: 'Account created. Verify your email before signing in.', emailSent };
    if (process.env.NODE_ENV !== 'production' && !emailSent) {
      response.developmentVerificationUrl = `${process.env.APP_URL || 'http://localhost:3000'}/verify-email.html?token=${encodeURIComponent(verificationToken)}`;
    }
    return res.status(201).json(response);
  } catch (err) { return next(err); }
});

router.post('/verify-email', async (req, res, next) => {
  try {
    const token = String(req.body.token || '');
    if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ error: 'Verification link is invalid or expired.' });
    const user = await User.findOne({
      emailVerificationTokenHash: hashToken(token),
      emailVerificationExpires: { $gt: new Date() }
    }).select('+emailVerificationTokenHash +emailVerificationExpires');
    if (!user) return res.status(400).json({ error: 'Verification link is invalid or expired. Please register again or request a new link.' });
    user.emailVerified = true;
    user.emailVerificationTokenHash = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();
    await sendEmail({ to: user.email, subject: 'Welcome to SheMart', text: `Hi ${user.name}, your email is verified. You can now sign in to SheMart.` });
    return res.json({ message: 'Email verified. You can now sign in.' });
  } catch (err) { return next(err); }
});

router.post('/login', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Invalid email or password.' });
    if (!user.emailVerified) return res.status(403).json({ error: 'Please verify your email before signing in.' });
    return res.json({ token: issueToken(user), user: publicUser(user) });
  } catch (err) { return next(err); }
});

router.post('/google', async (req, res, next) => {
  try {
    const credential = String(req.body.credential || '');
    if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google Sign-In is not configured yet. Add GOOGLE_CLIENT_ID to your environment.' });
    if (!credential) return res.status(400).json({ error: 'Google credential is required.' });
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email || payload.email_verified !== true) return res.status(401).json({ error: 'Google did not provide a verified email.' });
    const email = normalizeEmail(payload.email);
    let user = await User.findOne({ $or: [{ googleId: payload.sub }, { email }] });
    if (user) {
      if (user.googleId && user.googleId !== payload.sub) return res.status(409).json({ error: 'This account is linked to a different Google identity.' });
      user.googleId = payload.sub;
      user.emailVerified = true;
      if (!user.name) user.name = payload.name || email.split('@')[0];
      await user.save();
    } else {
      user = await User.create({
        name: payload.name || email.split('@')[0], email, googleId: payload.sub,
        emailVerified: true, role: 'customer', sellerStatus: 'not-applicable'
      });
    }
    return res.json({ token: issueToken(user), user: publicUser(user) });
  } catch (err) { return next(err); }
});

router.get('/me', auth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    res.json({ user: publicUser(user) });
  } catch (err) { next(err); }
});

router.post('/resend-verification', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const user = await User.findOne({ email });
    // Avoid exposing whether an account exists.
    if (user && !user.emailVerified) {
      const token = crypto.randomBytes(32).toString('hex');
      user.emailVerificationTokenHash = hashToken(token);
      user.emailVerificationExpires = new Date(Date.now() + 30 * 60 * 1000);
      await user.save();
      await sendVerificationEmail(user, token);
    }
    res.json({ message: 'If the account exists and needs verification, a new email has been sent.' });
  } catch (err) { next(err); }
});

module.exports = router;
