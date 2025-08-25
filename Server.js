import express from "express";
import axios from "axios";
import crypto from "crypto";

const app = express();
app.use(express.json());

// 🔹 Helpers
function base64Payload(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

function computeXVerify(base64, apiPath) {
  const key = process.env.PHONEPE_CLIENT_SECRET;
  const clientId = process.env.PHONEPE_CLIENT_ID;
  const hash = crypto
    .createHash("sha256")
    .update(base64 + apiPath + key)
    .digest("hex");
  return hash + "###" + clientId;
}

// 🟢 Route 1: Healthcheck
app.get("/", (req, res) => {
  res.send("PhonePe V2 backend is running ✅");
});

// 🟢 Route 2: Create Payment
app.post("/create-payment", async (req, res) => {
  try {
    const { amount, transactionId } = req.body;

    const payload = {
      merchantId: process.env.PHONEPE_MERCHANT_ID,
      merchantTransactionId: transactionId,
      amount: amount * 100, // convert to paise
      callbackUrl: process.env.CALLBACK_URL,
      paymentInstrument: { type: "PAY_PAGE" }
    };

    const base64 = base64Payload(payload);
    const apiPath = "/pay";
    const xVerify = computeXVerify(base64, apiPath);

    const phonepeResp = await axios.post(
      process.env.PHONEPE_BASE_URL + apiPath,
      { request: base64 },
      {
        headers: {
          "Content-Type": "application/json",
          "X-VERIFY": xVerify,
          "X-MERCHANT-ID": process.env.PHONEPE_MERCHANT_ID
        }
      }
    );

    res.json(phonepeResp.data);
  } catch (err) {
    console.error("create-payment error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// 🟢 Route 3: Check Status
app.get("/status/:txnId", async (req, res) => {
  try {
    const { txnId } = req.params;

    const apiPath = `/status/${txnId}`;
    const base64 = ""; // status API doesn’t need payload
    const xVerify = computeXVerify(base64, apiPath);

    const statusResp = await axios.get(
      process.env.PHONEPE_BASE_URL + apiPath,
      {
        headers: {
          "Content-Type": "application/json",
          "X-VERIFY": xVerify,
          "X-MERCHANT-ID": process.env.PHONEPE_MERCHANT_ID
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
