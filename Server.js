const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3900;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.FRONTEND_ORIGIN || '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  next();
});

// PhonePe Configuration
const PHONEPE_CONFIG = {
  CLIENT_ID: process.env.PHONEPE_CLIENT_ID,
  CLIENT_SECRET: process.env.PHONEPE_CLIENT_SECRET,
  MERCHANT_ID: process.env.PHONEPE_MERCHANT_ID,
  BASE_URL: process.env.PHONEPE_BASE_URL,
  CALLBACK_URL: process.env.CALLBACK_URL
};

// Generate Auth Token
async function generateAuthToken() {
  try {
    const authHeader = Buffer.from(`${PHONEPE_CONFIG.CLIENT_ID}:${PHONEPE_CONFIG.CLIENT_SECRET}`).toString('base64');
    
    const response = await axios.post(`${PHONEPE_CONFIG.BASE_URL}/pg/v1/auth`, {}, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${authHeader}`
      }
    });

    return response.data.data.token;
  } catch (error) {
    console.error('Error generating auth token:', error.response?.data || error.message);
    throw error;
  }
}

// Generate X-Verify header
function generateXVerify(payload, apiEndpoint) {
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
  const stringToHash = base64Payload + apiEndpoint + PHONEPE_CONFIG.CLIENT_SECRET;
  const hash = crypto.createHash('sha256').update(stringToHash).digest('hex');
  return hash;
}

// Create Payment Endpoint
app.post('/create-payment', async (req, res) => {
  try {
    const { amount, orderId, userId } = req.body;
    
    const authToken = await generateAuthToken();
    
    const payload = {
      merchantId: PHONEPE_CONFIG.MERCHANT_ID,
      merchantTransactionId: orderId,
      amount: amount * 100,
      merchantUserId: userId,
      redirectUrl: `${PHONEPE_CONFIG.CALLBACK_URL}?type=redirect`,
      redirectMode: 'POST',
      callbackUrl: `${PHONEPE_CONFIG.CALLBACK_URL}?type=webhook`,
      paymentInstrument: {
        type: 'PAY_PAGE'
      }
    };

    const apiEndpoint = '/pg/v1/pay';
    const response = await axios.post(`${PHONEPE_CONFIG.BASE_URL}${apiEndpoint}`, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': generateXVerify(payload, apiEndpoint),
        'Authorization': `Bearer ${authToken}`
      }
    });

    res.json({
      success: true,
      data: response.data,
      redirectUrl: response.data.data.instrumentResponse.redirectInfo.url
    });
  } catch (error) {
    console.error('Payment creation error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: 'Payment creation failed',
      error: error.response?.data || error.message
    });
  }
});

// Payment Callback Handler
app.post('/phonepe-callback', async (req, res) => {
  try {
    const { transactionId, code, merchantTransactionId, type } = req.query;
    
    if (type === 'webhook') {
      // Handle webhook callback
      console.log('Webhook received:', req.body);
      res.status(200).send('Webhook processed');
    } else {
      // Handle redirect callback
      const paymentStatus = await checkPaymentStatus(merchantTransactionId);
      
      if (paymentStatus && paymentStatus.code === 'PAYMENT_SUCCESS') {
        res.redirect(`${process.env.FRONTEND_ORIGIN}/payment-success`);
      } else {
        res.redirect(`${process.env.FRONTEND_ORIGIN}/payment-failed`);
      }
    }
  } catch (error) {
    console.error('Callback error:', error);
    res.redirect(`${process.env.FRONTEND_ORIGIN}/payment-error`);
  }
});

// Check Payment Status
async function checkPaymentStatus(merchantTransactionId) {
  try {
    const authToken = await generateAuthToken();
    const apiEndpoint = `/pg/v1/status/${PHONEPE_CONFIG.MERCHANT_ID}/${merchantTransactionId}`;
    
    const response = await axios.get(`${PHONEPE_CONFIG.BASE_URL}${apiEndpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': generateXVerify({}, apiEndpoint),
        'Authorization': `Bearer ${authToken}`
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Status check error:', error.response?.data || error.message);
    throw error;
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('PhonePe PG Integration ready for production');
});
