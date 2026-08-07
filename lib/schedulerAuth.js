// lib/schedulerAuth.js
// Two things live here:
//   1. Booking-path login: validates a per-class WAC code (see lib/wacCodes.js)
//      instead of a single shared PIN, and returns which campus that code
//      belongs to so the app can show the "you attended at {campus}" screen
//      without a second request.
//   2. requireAdminAuth: a placeholder gate for the future admin routes
//      (create/deactivate codes, elder management). NOTHING can issue an
//      'admin' scoped token yet — that only happens once Entra SSO is
//      wired up (separate piece of work, blocked on Nathan completing the
//      Entra app registration). The routes are built now so they're ready
//      to connect once that exists.

const jwt = require('jsonwebtoken');
const config = require('../config');
const wacCodes = require('./wacCodes');

async function checkCode(req, res) {
  const { code } = req.body || {};

  if (!config.auth.jwtSecret) {
    return res.status(500).json({ error: 'Server auth is not configured (missing JWT_SECRET)' });
  }
  if (!code) {
    return res.status(400).json({ error: 'code is required' });
  }

  const match = await wacCodes.validateCode(code);
  if (!match) {
    return res.status(401).json({ error: 'That code was not recognized. Check it and try again.' });
  }

  const token = jwt.sign(
    { scope: 'scheduler', campus: match.campusName, classDate: match.classDate },
    config.auth.jwtSecret,
    { expiresIn: config.auth.tokenExpiresIn }
  );

  res.json({
    token,
    expiresIn: config.auth.tokenExpiresIn,
    campus: match.campusName,
    classDate: match.classDate,
  });
}

function requireSchedulerAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header (expected "Bearer <token>")' });
  }

  try {
    const payload = jwt.verify(token, config.auth.jwtSecret);
    if (payload.scope !== 'scheduler') {
      return res.status(403).json({ error: 'Token does not have booking access' });
    }
    req.auth = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// --- Admin scope: placeholder until Entra SSO issues real admin tokens ---

function requireAdminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header (expected "Bearer <token>")' });
  }

  try {
    const payload = jwt.verify(token, config.auth.jwtSecret);
    if (payload.scope !== 'admin') {
      return res.status(403).json({ error: 'Token does not have admin access' });
    }
    req.auth = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { checkCode, requireSchedulerAuth, requireAdminAuth };
