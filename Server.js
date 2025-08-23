const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// PhonePe Production Credentials from your screenshot
const PHONEPE_CONFIG = {
  CLIENT_ID: process.env.CLIENT_ID || 'SU2507281958021038993436',
  CLIENT_SECRET: process.env.CLIENT_SECRET || '6fe24886-5b40-4863-bca5-fcc39239ea87',
  BASE_URL: 'https://api.phonepe.com/apis/hermes', // Production URL
  REDIRECT_URL: process.env.REDIRECT_URL || 'https://yourdomain.com' // Your production domain
};

// Generate Auth Token using Client Credentials
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

// Generate X-Verify header for request verification
function generateXVerify(payload, apiEndpoint) {
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
  const stringToHash = base64Payload + apiEndpoint + PHONEPE_CONFIG.CLIENT_SECRET;
  const hash = crypto.createHash('sha256').update(stringToHash).digest('hex');
  return hash;
}

// Create Payment
app.post('/create-payment', async (req, res) => {
  try {
    const { amount, orderId, userId } = req.body;
    
    // Generate auth token first
    const authToken = await generateAuthToken();
    
    const payload = {
      merchantId: PHONEPE_CONFIG.CLIENT_ID,
      merchantTransactionId: orderId,
      amount: amount * 100, // Convert to paise
      merchantUserId: userId,
      redirectUrl: `${PHONEPE_CONFIG.REDIRECT_URL}/payment-callback`,
      redirectMode: 'POST',
      callbackUrl: `${PHONEPE_CONFIG.REDIRECT_URL}/payment-webhook`,
      paymentInstrument: {
        type: 'PAY_PAGE'
      }
    };

    const apiEndpoint = '/pg/v1/pay';
    const url = `${PHONEPE_CONFIG.BASE_URL}${apiEndpoint}`;
    
    const response = await axios.post(url, payload, {
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

// Payment Callback (Redirect)
app.post('/payment-callback', async (req, res) => {
  try {
    const { transactionId, code, merchantTransactionId } = req.body;
    
    // Verify payment status
    const paymentStatus = await checkPaymentStatus(merchantTransactionId);
    
    if (paymentStatus && paymentStatus.code === 'PAYMENT_SUCCESS') {
      // Payment successful logic
      res.redirect('/payment-success');
    } else {
      // Payment failed logic
      res.redirect('/payment-failed');
    }
  } catch (error) {
    console.error('Callback error:', error);
    res.redirect('/payment-error');
  }
});

// Payment Webhook
app.post('/payment-webhook', async (req, res) => {
  try {
    const response = req.body.response;
    const checksum = req.headers['x-verify'];
    
    // Verify webhook signature
    const generatedChecksum = generateXVerify(response, '/pg/v1/webhook');
    
    if (checksum === generatedChecksum) {
      const { code, merchantTransactionId } = response;
      
      if (code === 'PAYMENT_SUCCESS') {
        // Update your database - payment successful
        console.log(`Payment successful for transaction: ${merchantTransactionId}`);
      } else if (code === 'PAYMENT_ERROR') {
        // Update your database - payment failed
        console.log(`Payment failed for transaction: ${merchantTransactionId}`);
      }
      
      res.status(200).send('Webhook processed successfully');
    } else {
      console.error('Webhook signature verification failed');
      res.status(400).send('Invalid signature');
    }
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Webhook processing failed');
  }
});

// Check Payment Status
async function checkPaymentStatus(merchantTransactionId) {
  try {
    const authToken = await generateAuthToken();
    const apiEndpoint = `/pg/v1/status/${PHONEPE_CONFIG.CLIENT_ID}/${merchantTransactionId}`;
    const url = `${PHONEPE_CONFIG.BASE_URL}${apiEndpoint}`;
    
    const response = await axios.get(url, {
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

// Initiate Refund
app.post('/initiate-refund', async (req, res) => {
  try {
    const { originalTransactionId, refundAmount, refundId } = req.body;
    const authToken = await generateAuthToken();
    
    const payload = {
      merchantId: PHONEPE_CONFIG.CLIENT_ID,
      merchantTransactionId: refundId,
      originalTransactionId: originalTransactionId,
      amount: refundAmount * 100, // Convert to paise
      callbackUrl: `${PHONEPE_CONFIG.REDIRECT_URL}/refund-webhook`
    };

    const apiEndpoint = '/pg/v1/refund';
    const url = `${PHONEPE_CONFIG.BASE_URL}${apiEndpoint}`;
    
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': generateXVerify(payload, apiEndpoint),
        'Authorization': `Bearer ${authToken}`
      }
    });

    res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    console.error('Refund initiation error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: 'Refund initiation failed',
      error: error.response?.data || error.message
    });
  }
});

// Basic routes for frontend
app.get('/', (req, res) => {
  res.send('PhonePe PG Integration Server is running');
});

app.get('/payment-success', (req, res) => {
  res.send('Payment was successful!');
});

app.get('/payment-failed', (req, res) => {
  res.send('Payment failed. Please try again.');
});

app.get('/payment-error', (req, res) => {
  res.send('An error occurred during payment processing.');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('PhonePe PG Integration ready for production');
});
