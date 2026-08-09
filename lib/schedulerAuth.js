// lib/schedulerAuth.js
// Three things live here:
//   1. Booking-path login: validates a per-class WAC code (see lib/wacCodes.js)
//      instead of a single shared PIN, and returns which campus that code
//      belongs to so the app can show the "you attended at {campus}" screen
//      without a second request.
//   2. checkEntraLogin: the elder/admin login endpoint. Verifies an Entra
//      ID token from the mobile app's sign-in flow (see lib/entraAuth.js),
//      confirms the signed-in user is in the Elders or Elder App Admins
//      group, and if so issues our own admin-scoped bearer token.
//   3. requireAdminAuth: gates the admin-only routes behind that token.

const jwt = require('jsonwebtoken');
const config = require('../config');
const wacCodes = require('./wacCodes');
const entraAuth = require('./entraAuth');
const { listRecords } = require('./airtable');

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

// --- Elder/Admin login (Entra ID token from the mobile app's sign-in flow) ---

async function checkEntraLogin(req, res) {
  const { idToken } = req.body || {};

  if (!config.auth.jwtSecret) {
    return res.status(500).json({ error: 'Server auth is not configured (missing JWT_SECRET)' });
  }
  if (!idToken) {
    return res.status(400).json({ error: 'idToken is required' });
  }

  let payload;
  try {
    payload = await entraAuth.verifyEntraToken(idToken);
  } catch (err) {
    console.error('Entra token verification failed:', err.message || err);
    return res.status(401).json({ error: 'Invalid or expired sign-in token' });
  }

  if (!payload.groups) {
    return res.status(403).json({
      error: 'Could not determine group membership from the sign-in token. Contact an administrator.',
    });
  }

  const isAdminGroup = payload.groups.includes(config.entra.adminGroupId);
  const isElderGroup = payload.groups.includes(config.entra.elderGroupId);

  if (!isAdminGroup && !isElderGroup) {
    return res.status(403).json({ error: 'Your account is not authorized for admin access.' });
  }

  // Hybrid permission model: admins (elder-app-admins group) can manage
  // any elder's availability/time off; plain elders (elders group) are
  // scoped to their own record, matched by signed-in email against the
  // Elders table.
  const role = isAdminGroup ? 'admin' : 'elder';
  const email = payload.email || payload.preferred_username || '';

  let elderId = null;
  let elderName = null;
  if (email) {
    try {
      const matches = await listRecords(config.airtable.tables.elders, {
        filterByFormula: `LOWER({Email}) = '${email.toLowerCase().replace(/'/g, "\\'")}'`,
      });
      if (matches[0]) {
        elderId = matches[0].id;
        elderName = matches[0].fields['Full Name'];
      }
    } catch (err) {
      console.error('Elder lookup by email failed during login:', err.message || err);
      // Non-fatal — sign-in still succeeds, just without a matched elder
      // record (relevant self-service screens will show a clear message).
    }
  }

  const token = jwt.sign(
    { scope: 'admin', role, name: payload.name, email, elderId, elderName },
    config.auth.jwtSecret,
    { expiresIn: config.auth.tokenExpiresIn }
  );

  res.json({ token, expiresIn: config.auth.tokenExpiresIn, name: payload.name, role, elderName });
}

// --- Admin scope: issued by checkEntraLogin above once Entra SSO verifies
// the user and confirms they're in an authorized group ---

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

module.exports = { checkCode, checkEntraLogin, requireSchedulerAuth, requireAdminAuth };
