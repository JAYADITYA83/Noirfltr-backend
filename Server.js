import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// 🟢 Healthcheck
app.get("/", (req, res) => {
  res.send("✅ PhonePe V2 backend running");
});

// 🟢 Create Payment
app.post("/create-payment", async (req, res) => {
  try {
    const { amount, transactionId } = req.body;

    const payResp = await axios.post(
      process.env.PHONEPE_BASE_URL + "/pay",
      {
        merchantId: process.env.PHONEPE_MERCHANT_ID,
        merchantTransactionId: transactionId,
        amount: amount * 100, // convert ₹ to paise
        callbackUrl: process.env.CALLBACK_URL,
        paymentInstrument: {
          type: "PAY_PAGE"
        }
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-CLIENT-ID": process.env.PHONEPE_CLIENT_ID,
          "X-CLIENT-SECRET": process.env.PHONEPE_CLIENT_SECRET
        }
      }
    );

    res.json(payResp.data);
  } catch (err) {
    console.error("❌ create-payment error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// 🟢 Check Status
app.get("/status/:txnId", async (req, res) => {
  try {
    const { txnId } = req.params;

    const statusResp = await axios.get(
      `${process.env.PHONEPE_BASE_URL}/status/${txnId}`,
      {
        headers: {
          "Content-Type": "application/json",
          "X-CLIENT-ID": process.env.PHONEPE_CLIENT_ID,
          "X-CLIENT-SECRET": process.env.PHONEPE_CLIENT_SECRET
        }
      }
    );

    res.json(statusResp.data);
  } catch (err) {
    console.error("❌ status error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// 🟢 Webhook
app.post("/phonepe-callback", (req, res) => {
  console.log("📩 Webhook received:", req.body);
  res.sendStatus(200);
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () =>
  console.log(`🚀 Server running at http://localhost:${port}`)
);
