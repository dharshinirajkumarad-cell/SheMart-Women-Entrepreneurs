const nodemailer = require('nodemailer');

let transporter;
function getTransporter() {
  if (process.env.EMAIL_PROVIDER === 'resend') {
    throw new Error('Resend provider is selected; use sendEmail() provider branch.');
  }
  if (!process.env.SMTP_USER || !process.env.SMTP_APP_PASSWORD) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE || 'true') === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_APP_PASSWORD }
    });
  }
  return transporter;
}

async function sendEmail({ to, subject, text, html }) {
  if (!to) return { sent: false, reason: 'missing-recipient' };
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;
  if (process.env.EMAIL_PROVIDER === 'resend') {
    if (!process.env.RESEND_API_KEY || !from) {
      console.warn('Email skipped: Resend configuration is incomplete.');
      return { sent: false, reason: 'email-not-configured' };
    }
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({ from, to, subject, text, html });
    if (result.error) throw new Error('Transactional email provider rejected the message.');
    return { sent: true };
  }
  const mailer = getTransporter();
  if (!mailer || !from) {
    console.warn(`Email skipped (not configured): ${subject} -> ${to}`);
    return { sent: false, reason: 'email-not-configured' };
  }
  await mailer.sendMail({ from, to, subject, text, html });
  return { sent: true };
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

async function sendVerificationEmail(user, rawToken) {
  const url = `${process.env.APP_URL || 'http://localhost:3000'}/verify-email.html?token=${encodeURIComponent(rawToken)}`;
  return sendEmail({
    to: user.email,
    subject: 'Verify your SheMart email',
    text: `Hi ${user.name}, verify your SheMart email by opening: ${url}\nIf you did not create this account, ignore this email.`,
    html: `<p>Hi ${escapeHtml(user.name)},</p><p>Verify your SheMart email address to activate your account.</p><p><a href="${url}">Verify my email</a></p><p>If you did not create this account, you can ignore this email.</p>`
  });
}

async function sendOrderEmails(order) {
  const orderUrl = `${process.env.APP_URL || 'http://localhost:3000'}/account.html`;
  const lines = order.items.map(i => `${i.title} × ${i.qty} — ₹${(i.price * i.qty).toFixed(2)} (seller: ${i.sellerName})`);
  const payment = order.paymentMethod === 'cod' ? 'Cash on Delivery (payment due on delivery)' : 'Online payment';
  const text = `Order ${order.orderNumber}\nStatus: ${order.status}\nPayment: ${payment} (${order.paymentStatus})\nTotal: ₹${order.totalAmount.toFixed(2)}\n\n${lines.join('\n')}\n\nTrack your order: ${orderUrl}`;
  const html = `<h2>SheMart order ${escapeHtml(order.orderNumber)}</h2><p>Your order status is <b>${escapeHtml(order.status)}</b>.</p><p>Payment: ${escapeHtml(payment)} (${escapeHtml(order.paymentStatus)}).</p><ul>${order.items.map(i => `<li>${escapeHtml(i.title)} × ${i.qty} — ₹${(i.price*i.qty).toFixed(2)}</li>`).join('')}</ul><p><b>Total: ₹${order.totalAmount.toFixed(2)}</b></p><p><a href="${orderUrl}">View your orders</a></p>`;
  const results = await Promise.allSettled([sendEmail({ to: order.customerEmail, subject: `SheMart order confirmation — ${order.orderNumber}`, text, html })]);
  const sellers = [...new Map(order.items.map(i => [String(i.sellerId), i])).values()];
  for (const seller of sellers) {
    const sellerLines = order.items.filter(i => String(i.sellerId) === String(seller.sellerId)).map(i => `${i.title} × ${i.qty} — ₹${(i.price*i.qty).toFixed(2)}`);
    results.push(await Promise.allSettled([sendEmail({
      to: seller.sellerEmail,
      subject: `New SheMart order — ${order.orderNumber}`,
      text: `Hello ${seller.sellerName},\nYou have a new order.\nOrder: ${order.orderNumber}\nItems:\n${sellerLines.join('\n')}\nPayment method: ${payment}\nPlease sign in to SheMart to manage fulfillment.`,
      html: `<p>Hello ${escapeHtml(seller.sellerName)},</p><p>You have a new SheMart order: <b>${escapeHtml(order.orderNumber)}</b>.</p><ul>${sellerLines.map(escapeHtml).map(s => `<li>${s}</li>`).join('')}</ul><p>Payment method: ${escapeHtml(payment)}.</p><p>Please sign in to SheMart to manage fulfillment.</p>`
    })]));
  }
  return results;
}

module.exports = { sendEmail, sendVerificationEmail, sendOrderEmails };
