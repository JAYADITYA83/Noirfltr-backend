// server.js
import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// --- Config / env ---
const PHONEPE_BASE_URL = process.env.PHONEPE_BASE_URL || "https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2";
const CLIENT_ID = process.env.PHONEPE_CLIENT_ID;
const CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET;
const CALLBACK_URL = process.env.CALLBACK_URL;
const PORT = process.env.PORT || 3000;

// Identity (token) endpoints (prod vs preprod)
function identityTokenUrl() {
  // If user set PHONEPE_BASE_URL pointing to preprod/sandbox, pick preprod identity URL
  if (/preprod|pg-sandbox|pre-prod|sandbox/i.test(PHONEPE_BASE_URL)) {
    return "https://api-preprod.phonepe.com/apis/identity-manager/v1/oauth/token";
  }
  return "https://api.phonepe.com/apis/identity-manager/v1/oauth/token";
}

// --- Simple in-memory token cache ---
let cachedToken = null;      // access token string
let cachedTokenExpiry = 0;   // epoch seconds

async function getAuthToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedTokenExpiry - 30 > now) {
    return cachedToken; // still valid
  }

  const url = identityTokenUrl();
  // PhonePe expects client credentials (client_id, client_secret) via form urlencoded
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "client_credentials",
    client_version: process.env.PHONEPE_CLIENT_VERSION || "1"
  });

  try {
    const resp = await axios.post(url, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000
    });

    // Extract token (docs may return token fields in different shapes)
    const data = resp.data || {};
    // Try common shapes:
    const token =
      data.access_token ||
      data.token ||
      data?.data?.access_token ||
      data?.data?.token;

    // expiry: prefer expires_at (epoch) or expires_in (seconds)
    let expiryEpoch = 0;
    if (data.expires_at) {
      // sometimes returned in seconds or milliseconds: normalize
      const t = Number(data.expires_at);
      expiryEpoch = t > 1e12 ? Math.floor(t / 1000) : t;
    } else if (data.expires_in) {
      expiryEpoch = now + Number(data.expires_in);
    } else if (data?.data?.expires_at) {
      const t = Number(data.data.expires_at);
      expiryEpoch = t > 1e12 ? Math.floor(t / 1000) : t;
    } else if (data?.data?.expires_in) {
      expiryEpoch = now + Number(data.data.expires_in);
    } else {
      // default 10 min
      expiryEpoch = now + 600;
    }

    if (!token) throw new Error("Auth token not found in response");

    cachedToken = token;
    cachedTokenExpiry = expiryEpoch;
    return cachedToken;
  } catch (err) {
    console.error("getAuthToken error:", err.response?.data || err.message);
    throw err;
  }
}

// --- Routes ---

app.get("/", (req, res) => res.send("✅ PhonePe V2 backend running"));

/**
 * Create payment (orders)
 * Body: { amount: 100, transactionId: "ORDER123" }
 * amount: rupees (we convert to paise below)
 */
app.post("/create-payment", async (req, res) => {
  try {
    const { amount, transactionId } = req.body;
    if (!amount || !transactionId) {
      return res.status(400).json({ error: "amount and transactionId required" });
    }

    // Build payload as per PhonePe docs (checkout V2)
    const payload = {
      merchantOrderId: String(transactionId).slice(0, 63), // docs max length 63
      amount: Math.round(amount * 100), // convert ₹ to paise (docs expect paise)
      // optional expireAfter, metaInfo
      paymentFlow: {
        type: "PG_CHECKOUT",
        merchantUrls: {
          redirectUrl: CALLBACK_URL // after payment PhonePe will redirect here
        }
      }
    };

    // Get auth token (O-Bearer)
    const token = await getAuthToken();

    // Call PhonePe create-payment
    const url = PHONEPE_BASE_URL.replace(/\/$/, "") + "/pay";

    const resp = await axios.post(url, payload, {
      headers: {
        Authorization: `O-Bearer ${token}`,
        "Content-Type": "application/json"
      },
      timeout: 15000
    });

    // Return PhonePe response directly to caller
    return res.json(resp.data);
  } catch (err) {
    console.error("create-payment error:", err.response?.data || err.message);
    const status = err.response?.status || 500;
    return res.status(500).json({ error: err.response?.data || err.message, status });
  }
});

/**
 * Check order status
 * GET /status/:merchantOrderId
 */
app.get("/status/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) return res.status(400).json({ error: "orderId required" });

    const token = await getAuthToken();
    // docs show status path: /order/{merchantOrderId}/status
    const url = PHONEPE_BASE_URL.replace(/\/$/, "") + `/order/${encodeURIComponent(orderId)}/status`;

    const resp = await axios.get(url, {
      headers: {
        Authorization: `O-Bearer ${token}`,
        "Content-Type": "application/json"
      },
      timeout: 10000
    });

    return res.json(resp.data);
  } catch (err) {
    console.error("status error:", err.response?.data || err.message);
    return res.status(500).json({ error: err.response?.data || err.message });
  }
});

/**
 * Webhook callback for PhonePe to notify events (async)
 */
app.post("/phonepe-callback", (req, res) => {
  console.log("📩 PhonePe webhook payload:", JSON.stringify(req.body).slice(0, 2000));
  // TODO: verify signature if PhonePe sends any header for webhook verification
  res.sendStatus(200);
});

// Start server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
