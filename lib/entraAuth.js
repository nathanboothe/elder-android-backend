// lib/entraAuth.js
// Validates Microsoft Entra ID tokens from the mobile app's elder/admin
// sign-in flow, and checks group membership via the token's own "groups"
// claim (Entra was configured to embed this directly on the mobile app
// registration) rather than an extra server-to-server Graph call. This
// keeps this backend from needing its own separate confidential-client
// app registration just for that lookup.

const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const config = require('../config');

const client = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${config.entra.tenantId}/discovery/v2.0/keys`,
  cache: true,
  cacheMaxAge: 12 * 60 * 60 * 1000, // 12h
});

function getSigningKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

/**
 * Verifies an Entra-issued ID token's signature, issuer, audience, and
 * expiry. Rejects (throws) on any failure. Resolves with the decoded
 * payload on success.
 */
function verifyEntraToken(idToken) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      idToken,
      getSigningKey,
      {
        audience: config.entra.clientId,
        issuer: `https://login.microsoftonline.com/${config.entra.tenantId}/v2.0`,
        algorithms: ['RS256'],
      },
      (err, payload) => {
        if (err) return reject(err);
        resolve(payload);
      }
    );
  });
}

/**
 * True if the token's groups claim includes either the Elders or
 * Elder App Admins group. Both grant the same admin-app access right now
 * — there's no tiered permission level between the two.
 *
 * NOTE: Entra only includes a full groups claim if the user belongs to
 * 200 or fewer groups total; above that it's replaced with an overage
 * indicator instead, and payload.groups will be undefined. Not expected
 * to matter for elders/admins here, but callers should check for that
 * rather than silently treating a missing claim as "not authorized" with
 * no explanation.
 */
function isAuthorizedGroupMember(payload) {
  const groups = payload.groups || [];
  return groups.includes(config.entra.elderGroupId) || groups.includes(config.entra.adminGroupId);
}

module.exports = { verifyEntraToken, isAuthorizedGroupMember };
