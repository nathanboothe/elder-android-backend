// lib/graphMail.js
// Sends email via Microsoft Graph's /sendMail endpoint using OAuth 2.0
// client credentials flow (app-only auth) — same pattern as
// coastal-elder-scheduler's version of this file, but its own separate
// Entra app registration and credentials. See lib/graphClient.js.

const config = require('../config');
const { getAccessToken } = require('./graphClient');

/**
 * Sends a plain-text email via Graph, from the configured shared mailbox.
 * @param {Object} opts
 * @param {string|string[]} opts.to - recipient email(s)
 * @param {string} opts.subject
 * @param {string} opts.body - plain text body
 */
async function sendMail({ to, subject, body }) {
  const token = await getAccessToken();
  const toRecipients = (Array.isArray(to) ? to : [to]).map((address) => ({
    emailAddress: { address },
  }));

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.graph.sendAsMailbox)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'Text', content: body },
          toRecipients,
        },
        saveToSentItems: true,
      }),
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Graph sendMail failed: ${res.status} ${errBody}`);
  }
}

module.exports = { sendMail };
// this is a update