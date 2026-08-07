// lib/schedulerAuth.js
// Bearer-token PIN auth for elder-android-backend. Deliberately NOT
// cookie-based — React Native's fetch() doesn't give you reliable
// browser-style cookie jar behavior, so this backend issues a signed JWT
// on successful PIN entry, and the app is expected to store it (e.g. in
// SecureStore or AsyncStorage) and send it as:
//   Authorization: Bearer <token>
// on every subsequent request.
//
// This is a separate secret and separate PIN from coastal-elder-scheduler's
// cookie-based scheduler gate — intentionally not shared.

const jwt = require('jsonwebtoken');
const config = require('../config');

function checkPin(req, res) {
  const { pin } = req.body || {};

  if (!config.auth.pin || !config.auth.jwtSecret) {
    return res.status(500).json({ error: 'Server auth is not configured (missing SCHEDULER_PIN or JWT_SECRET)' });
  }

  if (!pin || pin !== config.auth.pin) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }

  const token = jwt.sign({ scope: 'scheduler' }, config.auth.jwtSecret, {
    expiresIn: config.auth.tokenExpiresIn,
  });

  res.json({ token, expiresIn: config.auth.tokenExpiresIn });
}

function requireSchedulerAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header (expected "Bearer <token>")' });
  }

  try {
    req.auth = jwt.verify(token, config.auth.jwtSecret);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { checkPin, requireSchedulerAuth };
