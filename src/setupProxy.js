// react-scripts automatically picks up this file if it exists at
// src/setupProxy.js — no import needed anywhere. This replaces the
// simple string-based "proxy" field in package.json, which triggers a
// known react-scripts 5.0.1 bug ("allowedHosts[0] should be a non-empty
// string") on some Windows/corporate-network setups.
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:3001',
      changeOrigin: true,
    })
  );
};