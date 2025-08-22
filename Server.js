// server.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json({ limit: '200kb' }));

// allow CORS from your site in production - replace with your real origin
const ALLOWED_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
app.use(cors({ origin: ALLOWED_ORIGIN }));

// Simple file-based orders DB (for beginners) - orders.json will be created automatically
const ORDERS_FILE = path.join(__dirname, 'orders.json');
function readOrders() {
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); } catch (e) { return {}; }
}
function saveOrders(data) { fs.writeFileSync(ORDERS_FILE, JSON.stringify(data, null, 2)); }
function upsertOrder(order) {
  const all = readOrders();
  all[order.merchantTransactionId] = order;
  saveOrders(all);
}
function getOrder(id) { return readOrders()[id]; }

// Env vars (set these on Render or .env locally)
const {
  PHONEPE_MERCHANT_ID,
  PHONEPE_SALT_KEY,
  PHONEPE_SALT_INDEX,
  PHONEPE_BASE_URL,      // e.g. sandbox: https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/pay
  PORT = 3000
} = process.env;

if (!PHONEPE_MERCHANT_ID || !PHONEPE_SALT_KEY || !PHONEPE_SALT_INDEX || !PHONEPE_BASE_URL) {
  console.error('Missing required env vars: PHONEPE_MERCHANT_ID | PHONEPE_SALT_KEY | PHONEPE_SALT_INDEX | PHONEPE_BASE_URL');
  console.error('See .env.example for names.');
  // Do NOT exit so new users can still run in dev if they want to see helpful error
}

// helper: base64 encode JSON
function base64Payload(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

// compute X-VERIFY for Create Payment (common pattern)
function computeXVerifyForCreate(base64Payload, apiPath = '/pg/v1/pay') {
  const verifyString = base64Payload + apiPath + PHONEPE_MERCHANT_ID + PHONEPE_SALT_KEY;
  const sha = crypto.createHash('sha256').update(verifyString).digest('hex').toLowerCase();
  return `${sha}###${PHONEPE_SALT_INDEX}`;
}

// create-payment endpoint (called from frontend)
app.post('/create-payment', async (req, res) => {
  try {
    const { amount, orderId, mobile, name, email } = req.body;
    if (!amount || !orderId) return res.status(400).json({ success: false, message: 'amount and orderId required' });

    // Convert rupees to paise (if frontend sends rupees). If you send paise directly, adjust accordingly.
    const amountInPaise = Math.round(parseFloat(amount) * 100);

    const payload = {
      merchantId: PHONEPE_MERCHANT_ID,
      merchantTransactionId: orderId,
      amount: amountInPaise.toString(),
      redirectUrl: `${req.protocol}://${req.get('host')}/phonepe-callback`,
      // optional details:
      customerDetails: {
        mobile: mobile || '',
        email: email || ''
      }
    };

    const base64 = base64Payload(payload);
    const apiPath = '/pg/v1/pay';
    const xVerify = computeXVerifyForCreate(base64, apiPath);

    // PhonePe expects raw base64 as body for create-payment in many examples
const phonepeResp = await axios.post(PHONEPE_BASE_URL + apiPath, { request: base64 }, {
  headers: {
    'Content-Type': 'application/json',
    'X-VERIFY': xVerify,
    'Accept': 'application/json'
  },
  timeout: 15000
});

    // Save order (pending)
    upsertOrder({
      merchantTransactionId: orderId,
      amount: amountInPaise,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      meta: { phonepeResponse: phonepeResp.data }
    });

    // PhonePe returns a URL to redirect user to for checkout. It could be in different fields depending on version.
    const data = phonepeResp.data || {};
    let redirectUrl = data.data?.paymentUrl || data.data?.url || data.data?.redirectUrl || null;

    // debug: if response structure different, send full response back to frontend
    return res.json({ success: true, url: redirectUrl, raw: data });

  } catch (err) {
    console.error('create-payment error:', err?.response?.data || err.message || err);
    return res.status(500).json({ success: false, message: err?.response?.data || err.message || 'create-payment failed' });
  }
});

// Status check (merchant -> PhonePe)
app.get('/status/:merchantTransactionId', async (req, res) => {
  try {
    const { merchantTransactionId } = req.params;
    // Many docs show a status endpoint like: /pg/v1/status/{merchantId}/{merchantTransactionId}
    const statusUrl = PHONEPE_BASE_URL.replace(/\/pg(\/.*)?$/, '') + `/pg/v1/status/${PHONEPE_MERCHANT_ID}/${merchantTransactionId}`;

    // A common verification approach (varies by docs): sha256(merchantId + merchantTransactionId + saltKey)
    const verifyString = PHONEPE_MERCHANT_ID + merchantTransactionId + PHONEPE_SALT_KEY;
    const sha = crypto.createHash('sha256').update(verifyString).digest('hex').toLowerCase();
    const xVerify = `${sha}###${PHONEPE_SALT_INDEX}`;

    const r = await axios.get(statusUrl, { headers: { 'X-VERIFY': xVerify, 'Accept': 'application/json' } });

    // update local order status
    const resp = r.data || {};
    const state = resp.data?.status || resp.data?.paymentStatus || resp.data?.txStatus || null;

    const order = getOrder(merchantTransactionId) || {};
    order.status = state || 'UNKNOWN';
    order.phonepeStatusRaw = resp;
    order.updatedAt = new Date().toISOString();
    upsertOrder(order);

    return res.json({ success: true, raw: resp });
  } catch (err) {
    console.error('status error', err?.response?.data || err.message || err);
    return res.status(500).json({ success: false, message: err?.response?.data || err.message });
  }
});

// Redirect callback (PhonePe sends user back to this)
app.get('/phonepe-callback', async (req, res) => {
  try {
    // PhonePe may redirect with params. Try to get merchantTransactionId from query
    const merchantTransactionId = req.query.merchantTransactionId || req.query.orderId || req.query.txnId || req.query.merchantTxId;
    if (!merchantTransactionId) {
      return res.send(`<h3>Return from PhonePe</h3><p>No merchantTransactionId in query. Query: ${JSON.stringify(req.query)}</p>`);
    }

    // Verify status with server-side status check
    const statusResp = await axios.get(`${req.protocol}://${req.get('host')}/status/${merchantTransactionId}`);
    const status = statusResp.data?.raw?.data?.status || statusResp.data?.raw?.data?.txStatus || 'UNKNOWN';

    // load order and update
    const order = getOrder(merchantTransactionId) || {};
    order.callbackQuery = req.query;
    order.status = status;
    order.updatedAt = new Date().toISOString();
    upsertOrder(order);

    // Simple HTML response for user
    return res.send(`
      <h2>Payment Status</h2>
      <p>Order: ${merchantTransactionId}</p>
      <p>Status: ${status}</p>
      <p><a href="/">Return to site</a></p>
    `);

  } catch (err) {
    console.error('callback error:', err?.response?.data || err.message || err);
    return res.status(500).send('callback handling failed');
  }
});

/**
 * Webhook endpoint - PhonePe server->server notifications
 * PhonePe may send signature headers. This handler shows an example of verifying HMAC-SHA256 signature
 * using PHONEPE_SALT_KEY if PhonePe uses that. Check PhonePe docs for actual header name and verify method.
 */
app.post('/webhook', express.raw({ type: '*/*' }), (req, res) => {
  try {
    const headerSig = req.headers['x-verify-signature'] || req.headers['x-signature'] || req.headers['x-hub-signature'];
    if (headerSig && PHONEPE_SALT_KEY) {
      const computed = crypto.createHmac('sha256', PHONEPE_SALT_KEY).update(req.body).digest('hex');
      if (computed !== headerSig) {
        console.warn('webhook signature mismatch', { computed, headerSig });
        return res.status(401).send('signature mismatch');
      }
    }
    const bodyJson = JSON.parse(req.body.toString('utf8'));
    // Process webhook: update order status etc.
    console.log('webhook event', bodyJson);

    // If webhook contains merchantTransactionId:
    const mtx = bodyJson?.merchantTransactionId || bodyJson?.data?.merchantTransactionId;
    if (mtx) {
      const order = getOrder(mtx) || {};
      order.webhook = bodyJson;
      order.status = bodyJson?.data?.status || order.status;
      order.updatedAt = new Date().toISOString();
      upsertOrder(order);
    }

    return res.status(200).send('OK');
  } catch (err) {
    console.error('webhook error', err);
    return res.status(500).send('error');
  }
});

// Serve static front-end (optional)
app.use('/', express.static(path.join(__dirname)));

const port = process.env.PORT || 3000;
console.log("Registered routes:");
app._router.stack.forEach(r => {
  if (r.route && r.route.path) {
    console.log(r.route.stack[0].method.toUpperCase(), r.route.path);
  }
});

app.listen(port, () => console.log(`Server running at http://localhost:${port} (PORT ${port})`));
