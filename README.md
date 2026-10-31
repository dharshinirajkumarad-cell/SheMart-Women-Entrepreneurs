# SheMart 2.0

SheMart is a Node.js/Express + MongoDB marketplace prototype for women-owned businesses. This update connects the public pages to the API and adds email/password registration, email verification, Google Sign-In, seller product management, cart/checkout, COD, Razorpay order/payment verification, order history, seller order updates, and transactional email hooks.

> **Important:** This is an implementation baseline, not a claim that live payments or email have been verified in your accounts. Live integrations require your own credentials and provider-side setup. Start with test credentials and test orders only.

## Requirements

- Node.js 20 or newer
- MongoDB local instance or MongoDB Atlas database
- Google OAuth Web client ID (optional; needed for Google Sign-In)
- Gmail account with 2-Step Verification and a Google App Password (development email)
- Razorpay test account and API keys (optional; needed for online payment testing)

## Setup

1. Extract this folder and open it in VS Code.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env` (Windows PowerShell):

   ```powershell
   Copy-Item .env.example .env
   ```

   macOS/Linux:

   ```bash
   cp .env.example .env
   ```

4. Generate a secure JWT secret and put it in `.env`:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

5. Set `MONGODB_URI` to your local database or Atlas connection string. Never commit `.env` or share it in a ZIP.
6. Configure Gmail SMTP if you want actual emails. Use a Google **App Password**, not your normal Gmail password. Set `SMTP_USER`, `SMTP_APP_PASSWORD`, `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, and `EMAIL_FROM`.
7. Configure Google Sign-In if desired:
   - Create a Web OAuth client in Google Cloud Console.
   - Add `http://localhost:3000` to authorized JavaScript origins for local development.
   - Set its client ID as `GOOGLE_CLIENT_ID`.
   - The client ID is public configuration; never put a Google client secret in frontend code.
8. Configure Razorpay **test keys** for online checkout:
   - Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `.env`.
   - Configure a Razorpay webhook pointing to `https://YOUR_PUBLIC_HOST/api/payments/webhook` and set `RAZORPAY_WEBHOOK_SECRET` to the webhook secret.
   - Enable at least `payment.captured` and `payment.failed` events.
   - Localhost webhooks need a secure tunnel or a deployed test server.
9. Start the app:

   ```bash
   npm run dev
   ```

10. Open `http://localhost:3000`. Do not open HTML files directly or use VS Code Live Server; the app should be served by Express so API requests use the same origin.

## Environment variables

| Variable | Required? | Purpose |
|---|---|---|
| `PORT` | No | Express port (default `3000`) |
| `NODE_ENV` | No | Use `production` in production |
| `APP_URL` | Yes in deployment | Public base URL used in verification links and emails |
| `MONGODB_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | Random secret of at least 32 characters |
| `SMTP_HOST` | For Gmail SMTP | SMTP hostname, normally `smtp.gmail.com` |
| `SMTP_PORT` | For Gmail SMTP | Usually `465` for SSL or `587` for STARTTLS |
| `SMTP_SECURE` | For Gmail SMTP | `true` for port 465; `false` for port 587 |
| `SMTP_USER` | For Gmail SMTP | Sender Gmail address |
| `SMTP_APP_PASSWORD` | For Gmail SMTP | Google App Password; keep private |
| `EMAIL_FROM` | Recommended | Display name and sender, e.g. `SheMart <sender@example.com>` |
| `EMAIL_PROVIDER` | No | `smtp` by default; `resend` selects the Resend adapter |
| `RESEND_API_KEY` | For Resend | Production transactional email API key; verify sender/domain first |
| `GOOGLE_CLIENT_ID` | For Google login | Google OAuth Web client ID |
| `RAZORPAY_KEY_ID` | For online payments | Razorpay public/test/live key ID |
| `RAZORPAY_KEY_SECRET` | For online payments | Razorpay secret; server only |
| `RAZORPAY_WEBHOOK_SECRET` | Recommended for online payments | Webhook signature verification secret |
| `SUPPORT_EMAIL` | No | Destination for support form messages (defaults to `SMTP_USER`) |

## Implemented user flows

- **Email/password:** customer or seller registers, receives a one-time verification link, verifies the email, then signs in. Verification tokens are stored hashed and expire after 30 minutes. Passwords are hashed with bcrypt.
- **Google:** Google Identity Services returns an ID credential; the backend validates it against `GOOGLE_CLIENT_ID`. Google accounts have a provider-verified email.
- **Seller:** seller profile uses the verified account email for order alerts. Seller product creation requires a signed-in seller account and a verified email.
- **Cart:** cart contents are stored in the browser. The backend reloads product data and computes totals; browser prices are never trusted for order creation.
- **COD:** order is placed with `paymentStatus=cod-pending`; payment is not represented as collected until a separate collection workflow is implemented.
- **Online:** backend creates a Razorpay order; frontend opens checkout; backend verifies the payment signature; a signed webhook can also confirm capture/failure. Online checkout is disabled if Razorpay keys are absent.
- **Emails:** verification, order confirmation, seller notification, payment-failure notification, and order status emails use the email adapter. Email failure is logged and does not silently change payment/order state.

## Transaction design

`Order.status` and `Order.paymentStatus` are intentionally separate. A placed COD order is not marked paid. An online order is not marked paid because the browser reports success; the server verifies the Razorpay signature and receives provider webhook events. The backend reserves stock when an order is created and releases it on a verified failed-payment webhook. A pending online order whose checkout is simply abandoned needs a production expiry/reconciliation job before launch.

The current marketplace prototype does **not** split payouts between sellers. Before accepting real money for a multi-seller marketplace, set up a provider-approved marketplace/settlement arrangement and legal/tax/refund policies. Do not collect all seller funds in a personal account and manually treat them as seller balances.

## Security and production checklist

- Rotate credentials if an earlier `.env` was ever shared; never reuse old JWT/database credentials.
- Keep `.env` out of source control and ZIPs. The archive should include `.env.example` only.
- Use HTTPS, production-grade secrets, restrictive CORS, and production transactional email.
- Set a real `APP_URL`, Google authorized origins, and the correct payment webhook URL.
- Use Razorpay live keys only after test-mode end-to-end checks and provider onboarding.
- Add automated tests, inventory reservation expiry/reconciliation, cancellation/refund flows, audit logs, admin moderation, seller KYC/verification, and per-seller fulfillment suborders before a public launch.
- `sellerStatus` is stored as onboarding metadata but this prototype does not include a complete admin review portal; do not advertise sellers as identity-verified without implementing and performing that review.
- Email sending depends on provider configuration. Check server logs and test delivery to both a buyer and seller email before launch.

## Validation

Run syntax checks:

```bash
npm run check
```

A successful syntax check does not replace runtime tests with MongoDB, Gmail/Resend, Google OAuth, and Razorpay test credentials.

## Smoke-test checklist

1. Start MongoDB and the Express server; confirm `http://localhost:3000/api/health` returns `{ "ok": true, "service": "shemart-api" }`.
2. Register a test customer and verify the email link (use the development link shown by the UI only when email is not configured).
3. Sign in and confirm `/api/auth/me` returns the expected account, without a password hash.
4. Register a test seller using a separate email, verify it, sign in, and publish a product with stock.
5. Open the shop in a customer session, add the product to cart, and place a COD test order. Check both buyer and seller inboxes if SMTP is configured.
6. Confirm the order appears in My Orders and the seller's order inbox. Test `confirmed` → `shipped` → `delivered` updates and customer email notifications.
7. For online payments, use Razorpay test keys and test payment methods only. Verify successful, failed, and dismissed checkout behavior; confirm payment state changes only after server verification/webhook.
8. Test wrong-role access (customer creating a product, seller viewing customer order history, seller updating another seller's order), invalid quantities, and overselling attempts.

Do not use real customer data or live payment keys until all smoke tests pass and the missing production checklist items above have been addressed.
