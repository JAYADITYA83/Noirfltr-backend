import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// 🟢 Route 1: Healthcheck
app.get("/", (req, res) => {
  res.send("PhonePe V2 backend is running ✅");
});

// 🟢 Route 2: Create Payment
app.post("/create-payment", async (req, res) => {
  try {
    const { amount, transactionId } = req.body;

    // Step 1: Fetch Auth Token
    const authResp = await axios.post(
      process.env.PHONEPE_BASE_URL + "/authorize",
      {
        clientId: process.env.PHONEPE_CLIENT_ID,
        clientSecret: process.env.PHONEPE_CLIENT_SECRET,
        merchantId: process.env.PHONEPE_MERCHANT_ID
      },
      { headers: { "Content-Type": "application/json" } }
    );

    const authToken = authResp.data.token;
    if (!authToken) throw new Error("Auth token not received");

    // Step 2: Create Payment
    const payResp = await axios.post(
      process.env.PHONEPE_BASE_URL + "/pay",
      {
        merchantId: process.env.PHONEPE_MERCHANT_ID,
        merchantTransactionId: transactionId,
        amount: amount * 100, // convert to paise
        callbackUrl: process.env.CALLBACK_URL,
        paymentInstrument: {
          type: "PAY_PAGE"
        }
      },
      {
        headers: {
          "Authorization": `Bearer ${authToken}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json(payResp.data);
  } catch (err) {
    console.error("create-payment error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// 🟢 Route 3: Check Status
app.get("/status/:txnId", async (req, res) => {
  try {
    const { txnId } = req.params;

    const authResp = await axios.post(
      process.env.PHONEPE_BASE_URL + "/authorize",
      {
        clientId: process.env.PHONEPE_CLIENT_ID,
        clientSecret: process.env.PHONEPE_CLIENT_SECRET,
        merchantId: process.env.PHONEPE_MERCHANT_ID
      },
      { headers: { "Content-Type": "application/json" } }
    );

    const authToken = authResp.data.token;

    const statusResp = await axios.get(
      `${process.env.PHONEPE_BASE_URL}/status/${txnId}`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json(statusResp.data);
  } catch (err) {
    console.error("status error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// 🟢 Route 4: Webhook callback
app.post("/phonepe-callback", (req, res) => {
  console.log("Webhook received:", req.body);
  res.sendStatus(200);
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () =>
  console.log(`Server running at http://localhost:${port}`)
);
