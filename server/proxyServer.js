/**
 * Angel One API Proxy Server
 * 
 * This server acts as a proxy to handle CORS issues when communicating
 * with the Angel One API from the browser.
 * 
 * Usage:
 *   node server/proxyServer.js
 * 
 * Or with npm script defined in package.json:
 *   npm run proxy
 */

import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import fs from 'fs';
import path from 'path';

const logStream = fs.createWriteStream(path.join(process.cwd(), 'server', 'proxy.log'), { flags: 'a' });
const log = (msg) => {
  const entry = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(entry.trim());
  logStream.write(entry);
};

const app = express();
const PORT = process.env.PROXY_PORT || 3001;

// Angel One API base URL
const ANGLE_ONE_BASE_URL = 'https://apiconnect.angelone.in';
const ANGLE_ONE_WS_URL = 'wss://apiconnect.angelone.in';

// Enable CORS for all origins (you can restrict this in production)
app.use(cors({
  origin: '*', // In production, replace with your frontend URL
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Api-Key', 'Authorization']
}));

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// DEBUG ENDPOINT: Test the API call directly from the server
app.get('/debug-option-chain', async (req, res) => {
  const { symboltoken = '99690', exchange = 'NSE' } = req.query;
  const url = `${ANGLE_ONE_BASE_URL}/rest/hl/optionchain/v1/get?exchange=${exchange}&symboltoken=${symboltoken}`;
  
  log(`DEBUG: Testing direct fetch to ${url}`);
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'X-Api-Key': process.env.VITE_ANGLEONE_API_KEY || 'MISSING_KEY'
      }
    });
    const text = await response.text();
    log(`DEBUG: Response Status: ${response.status}`);
    log(`DEBUG: Response Body: ${text.substring(0, 500)}`);
    res.status(response.status).send(text);
  } catch (err) {
    log(`DEBUG: Fetch failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Proxy configuration for Angel One REST API
const restProxyOptions = {
  target: ANGLE_ONE_BASE_URL,
  changeOrigin: true,
  secure: false, // Ignore SSL certificate errors
  pathRewrite: {
    '^/api/angelone': '', // Remove /api/angelone prefix
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      // Log proxy requests
      log(`${req.method} ${req.path} - Requesting from ${req.ip}`);
      
      // Spoof browser headers to bypass WAF/Bot detection
      proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      proxyReq.setHeader('Accept', 'application/json, text/plain, */*');
      proxyReq.setHeader('Accept-Language', 'en-US,en;q=0.9');
      proxyReq.setHeader('Connection', 'keep-alive');
      proxyReq.setHeader('Cache-Control', 'no-cache');
      
      // Forward important headers
      if (req.headers['x-api-key']) {
        proxyReq.setHeader('X-Api-Key', req.headers['x-api-key']);
      }
      if (req.headers['authorization']) {
        proxyReq.setHeader('Authorization', req.headers['authorization']);
      }
      if (req.headers['content-type']) {
        proxyReq.setHeader('Content-Type', req.headers['content-type']);
      }
    },
    error: (err, req, res) => {
      log(`Proxy error: ${err.message}`);
      res.status(500).json({ error: 'Proxy error', message: err.message });
    }
  }
};

// Apply REST proxy for /api/angelone routes
app.use('/api/angelone', createProxyMiddleware(restProxyOptions));

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Angel One API Proxy Server',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      api: '/api/angelone/*'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Angel One Proxy Server running on http://localhost:${PORT}`);
  console.log(`\n📡 Proxying requests to: ${ANGLE_ONE_BASE_URL}`);
  console.log(`\n💡 To use in frontend, make requests to: http://localhost:${PORT}/api/angelone`);
  console.log(`\n⚠️  Note: Update VITE_ANGLEONE_PROXY_URL in .env to "${process.env.PROXY_URL || `http://localhost:${PORT}`}"\n`);
});

export default app;