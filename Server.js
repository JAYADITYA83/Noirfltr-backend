import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// ✅ 1. Healthcheck
app.get("/", (req, res) => {
  res.send("✅ PhonePe V2 backend is running");
});

// ✅ 2. Create Payment
app.post("/create-payment", async (req, res) => {
  try {
    const { amount, transactionId } = req.body;

    if (!amount || !transactionId) {
      return res.status(400).json({ error: "amount & transactionId are required" });
    }

    const payload = {
      merchantId: process.env.PHONEPE_MERCHANT_ID,
      merchantOrderId: transactionId,
      amount: amount * 100, // convert to paise
      callbackUrl: process.env.CALLBACK_URL,
      instrument: {
        type: "PAY_PAGE"
      }
    };

    const response = await axios.post(
      "https://api.phonepe.com/apis/pg/checkout/v2/pay",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "X-CLIENT-ID": process.env.PHONEPE_CLIENT_ID,
          "X-CLIENT-SECRET": process.env.PHONEPE_CLIENT_SECRET
        }
      }
    );

    res.json(response.data); // should include redirectUrl
  } catch (err) {
    console.error("❌ create-payment error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// ✅ 3. Check Status
app.get("/status/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    const response = await axios.get(
      `https://api.phonepe.com/apis/pg/checkout/v2/status/${process.env.PHONEPE_MERCHANT_ID}/${orderId}`,
      {
        headers: {
          "Content-Type": "application/json",
          "X-CLIENT-ID": process.env.PHONEPE_CLIENT_ID,
          "X-CLIENT-SECRET": process.env.PHONEPE_CLIENT_SECRET
        }
      }
    );

    res.json(response.data);
  } catch (err) {
    console.error("❌ status error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// ✅ 4. Webhook (PhonePe callback)
app.post("/phonepe-callback", (req, res) => {
  console.log("📩 Webhook received:", req.body);
  res.sendStatus(200);
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () =>
  console.log(`🚀 Server running on http://localhost:${port}`)
);
