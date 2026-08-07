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
};
