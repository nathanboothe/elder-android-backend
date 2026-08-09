// lib/graphClient.js
// Shared OAuth 2.0 client-credentials token acquisition for Microsoft Graph.
//
// Uses its own separate Entra app registration and credentials
// (config.graph.*) — independent of coastal-elder-scheduler's, per this
// project's repo-isolation rule. The pattern mirrors that repo's version
// of this file, but nothing is shared except the concept.

const config = require('../config');

let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const tokenUrl = `https://login.microsoftonline.com/${config.graph.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: config.graph.clientId,
    client_secret: config.graph.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Failed to acquire Graph token: ${res.status} ${errBody}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  cachedTokenExpiresAt = now + data.expires_in * 1000;
  return cachedToken;
}

module.exports = { getAccessToken };
// this is a update