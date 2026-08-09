// config.js
// Central config for elder-android-backend. Nothing here is imported from
// or shared with coastal-elder-scheduler — the only thing the two systems
// have in common is the Airtable base ID itself, entered independently here.

require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,

  airtable: {
    apiKey: process.env.AIRTABLE_API_KEY,
    baseId: process.env.AIRTABLE_BASE_ID,
    tables: {
      elders: process.env.AIRTABLE_TABLE_ELDERS,
      availability: process.env.AIRTABLE_TABLE_AVAILABILITY,
      campuses: process.env.AIRTABLE_TABLE_CAMPUSES,
      appointments: process.env.AIRTABLE_TABLE_APPOINTMENTS,
      timeOff: process.env.AIRTABLE_TABLE_TIMEOFF,
      sundayOptOut: process.env.AIRTABLE_TABLE_SUNDAY_OPTOUT,
      wacCodes: process.env.AIRTABLE_TABLE_WAC_CODES,
    },
  },

  auth: {
    pin: process.env.SCHEDULER_PIN,
    jwtSecret: process.env.JWT_SECRET,
    tokenExpiresIn: '12h',
  },

  scheduling: {
    // How many qualifying upcoming dates getAvailableDates should collect
    // before stopping. Matches coastal-elder-scheduler's config shape.
    weeksAhead: Number(process.env.SCHEDULING_WEEKS_AHEAD) || 5,
  },

  entra: {
    tenantId: process.env.ENTRA_TENANT_ID,
    clientId: process.env.ENTRA_CLIENT_ID,
    // Both groups grant the same admin-app access — no tiered permission
    // level between the two right now.
    elderGroupId: process.env.ENTRA_GROUP_ID_ELDERS,
    adminGroupId: process.env.ENTRA_GROUP_ID_ADMINS,
  },

  // Graph mail — its own separate Entra app registration/credentials,
  // independent of coastal-elder-scheduler's, per the self-contained
  // repos rule.
  graph: {
    tenantId: process.env.GRAPH_TENANT_ID,
    clientId: process.env.GRAPH_CLIENT_ID,
    clientSecret: process.env.GRAPH_CLIENT_SECRET,
    sendAsMailbox: process.env.GRAPH_SEND_AS_MAILBOX,
  },

  notifications: {
    omeEmail: process.env.OME_EMAIL,
  },
};
