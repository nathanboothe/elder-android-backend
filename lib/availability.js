// lib/availability.js
// Availability-calculation and conflict-checking logic for
// elder-android-backend. Adapted from coastal-elder-scheduler's version of
// this file (same algorithm, same Airtable field names, since both systems
// read/write the same base) but reimplemented against this backend's own
// lib/airtable.js — nothing is imported or shared between the two repos
// except the underlying Airtable data itself, per the "repos stay
// self-contained" rule.
//
// If coastal-elder-scheduler's availability.js changes in the future
// (e.g. new fields, new rules), this file needs to be updated to match by
// hand — there's no automatic sync between the two.

const { listRecords, createRecord } = require('./airtable');
const config = require('../config');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// How many days after the "We Are Coastal" class date a member must wait
// before meeting with an Elder.
const MIN_LEAD_DAYS = 7;

function dayName(date) {
  return DAY_NAMES[date.getUTCDay()];
}

function weekOfMonth(date) {
  const dayOfMonth = date.getUTCDate();
  const nth = Math.ceil(dayOfMonth / 7); // 1-5, matches the Availability table's "Week of Month" choices
  const labels = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th' };
  return labels[nth] || '5th';
}

function isoDate(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function escapeFormulaValue(value) {
  return String(value).replace(/'/g, "\\'");
}

const SLOT_ORDER = [
  '7:30 AM', '8:00 AM', '8:30 AM', '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM',
  '11:00 AM', '11:30 AM', '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM', '2:00 PM',
  '2:30 PM', '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM', '5:00 PM', '5:30 PM',
  '6:00 PM', '6:30 PM', '7:00 PM', '7:30 PM', '8:00 PM', '8:30 PM', '9:00 PM',
  '9:30 PM', '10:00 PM',
];

/** Fetch elder records for a given campus name — restricted to elders that
 *  are Active and marked Visible In Wizard, since this feeds every
 *  member-facing booking-flow lookup (dates, times, elder selection). */
async function getEldersForCampus(campusName) {
  return listRecords(config.airtable.tables.elders, {
    filterByFormula: `AND({Campus} = '${escapeFormulaValue(campusName)}', {Status} = 'Active', {Visible In Wizard} = TRUE())`,
  });
}

/** Public-safe elder lookup for the member wizard's "preferred elder" step. */
async function getEldersForCampusPublic(campusName) {
  const elders = await getEldersForCampus(campusName);
  return elders.map((e) => ({ id: e.id, name: e.fields['Full Name'] }));
}

/** Fetch Availability rows for a list of elder names, for a specific day of week. */
async function getAvailabilityForElders(elderNames, dayOfWeek) {
  if (elderNames.length === 0) return [];
  const nameClauses = elderNames.map((n) => `{Elder Name} = '${escapeFormulaValue(n)}'`).join(', ');
  return listRecords(config.airtable.tables.availability, {
    filterByFormula: `AND(OR(${nameClauses}), {Day of Week} = '${dayOfWeek}')`,
  });
}

/** Fetch TimeOff rows for a list of elder names that overlap a given date. */
async function getTimeOffForElders(elderNames, dateStr) {
  if (elderNames.length === 0) return [];
  const nameClauses = elderNames.map((n) => `{Elder Name} = '${escapeFormulaValue(n)}'`).join(', ');
  return listRecords(config.airtable.tables.timeOff, {
    filterByFormula: `AND(OR(${nameClauses}), IS_BEFORE({Start Date}, '${dateStr}T23:59:59.000Z'), IS_AFTER({End Date}, '${dateStr}T00:00:00.000Z'))`,
  });
}

/** Fetch confirmed Appointments for a given date (optionally narrowed to a campus). */
async function getConfirmedAppointments(dateStr, campusName) {
  const clauses = [`{Date} = '${dateStr}'`, `{Status} = 'Confirmed'`];
  if (campusName) clauses.push(`{Campus} = '${escapeFormulaValue(campusName)}'`);
  return listRecords(config.airtable.tables.appointments, {
    filterByFormula: `AND(${clauses.join(', ')})`,
  });
}

/**
 * Returns up to config.scheduling.weeksAhead upcoming dates for a given
 * day-of-week (default Sunday) where at least one elder at the campus has
 * an open slot — and which fall at least MIN_LEAD_DAYS after classDate.
 */
async function getAvailableDates(campusId, campusName, dayOfWeek = 'Sunday', classDate) {
  const elders = await getEldersForCampus(campusName);
  const elderNames = elders.map((e) => e.fields['Full Name']);
  if (elderNames.length === 0) return [];

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  let cursor = today;
  if (classDate) {
    const earliestAllowed = new Date(`${classDate}T00:00:00.000Z`);
    earliestAllowed.setUTCDate(earliestAllowed.getUTCDate() + MIN_LEAD_DAYS);
    if (earliestAllowed > cursor) cursor = earliestAllowed;
  }
  cursor = new Date(cursor); // clone, since we mutate it below

  while (dayName(cursor) !== dayOfWeek) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const results = [];
  // Circuit breaker so a data-entry gap in Availability can't hang a request
  // indefinitely — 104 weeks (2 years) is far more than this should ever need.
  let iterations = 0;
  const MAX_ITERATIONS = 104;

  while (results.length < config.scheduling.weeksAhead && iterations < MAX_ITERATIONS) {
    iterations++;
    const dateStr = isoDate(cursor);
    const wom = weekOfMonth(cursor);

    const availRows = await getAvailabilityForElders(elderNames, dayOfWeek);
    const matchingRows = availRows.filter((r) => {
      const weeks = r.fields['Week of Month'] || [];
      return weeks.includes(wom) || weeks.includes('Every Week');
    });

    if (matchingRows.length > 0) {
      const timeOffRows = await getTimeOffForElders(elderNames, dateStr);
      const appts = await getConfirmedAppointments(dateStr, campusName);
      const bookedElderTimeSlots = new Set(
        appts.map((a) => `${a.fields['Elder Name']}|${a.fields['Time Slot']}`)
      );

      const anyOpenSlot = matchingRows.some((r) => {
        const elderName = r.fields['Elder Name'];
        const onTimeOff = timeOffRows.some((t) => t.fields['Elder Name'] === elderName);
        if (onTimeOff) return false;
        const slots = r.fields['Time Slots'] || [];
        return slots.some((slot) => !bookedElderTimeSlots.has(`${elderName}|${slot}`));
      });

      if (anyOpenSlot) results.push(dateStr);
    }

    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  return results;
}

/** Returns the union of open time slots for a campus on a specific date,
 *  or — if elderName is provided — only that one elder's open slots. */
async function getAvailableTimes(campusId, campusName, dateStr, elderName) {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  const dow = dayName(date);
  const wom = weekOfMonth(date);

  const elders = await getEldersForCampus(campusName);
  const elderNames = elderName ? [elderName] : elders.map((e) => e.fields['Full Name']);
  if (elderNames.length === 0) return [];

  const availRows = await getAvailabilityForElders(elderNames, dow);
  const matchingRows = availRows.filter((r) => {
    const weeks = r.fields['Week of Month'] || [];
    return weeks.includes(wom) || weeks.includes('Every Week');
  });

  const timeOffRows = await getTimeOffForElders(elderNames, dateStr);
  const appts = await getConfirmedAppointments(dateStr, campusName);
  const bookedElderTimeSlots = new Set(
    appts.map((a) => `${a.fields['Elder Name']}|${a.fields['Time Slot']}`)
  );

  const openSlots = new Set();
  for (const row of matchingRows) {
    const name = row.fields['Elder Name'];
    if (timeOffRows.some((t) => t.fields['Elder Name'] === name)) continue;
    for (const slot of row.fields['Time Slots'] || []) {
      if (!bookedElderTimeSlots.has(`${name}|${slot}`)) openSlots.add(slot);
    }
  }

  // Sort chronologically using the canonical slot order.
  return SLOT_ORDER.filter((s) => openSlots.has(s));
}

/** Returns the elders at a campus who are free at a specific date+time. */
async function getAvailableElders(campusId, campusName, dateStr, timeSlot) {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  const dow = dayName(date);
  const wom = weekOfMonth(date);

  const elders = await getEldersForCampus(campusName);
  const elderNames = elders.map((e) => e.fields['Full Name']);

  const availRows = await getAvailabilityForElders(elderNames, dow);
  const timeOffRows = await getTimeOffForElders(elderNames, dateStr);
  const appts = await getConfirmedAppointments(dateStr, campusName);
  const bookedElderTimeSlots = new Set(
    appts.map((a) => `${a.fields['Elder Name']}|${a.fields['Time Slot']}`)
  );

  return elders.filter((e) => {
    const name = e.fields['Full Name'];
    const rows = availRows.filter((r) => r.fields['Elder Name'] === name);
    const hasSlot = rows.some((r) => {
      const weeks = r.fields['Week of Month'] || [];
      const slots = r.fields['Time Slots'] || [];
      return (weeks.includes(wom) || weeks.includes('Every Week')) && slots.includes(timeSlot);
    });
    if (!hasSlot) return false;
    if (timeOffRows.some((t) => t.fields['Elder Name'] === name)) return false;
    if (bookedElderTimeSlots.has(`${name}|${timeSlot}`)) return false;
    return true;
  });
}

/**
 * Creates an appointment IF the slot is still free (re-checks at write time
 * to close the race condition between a user viewing options and submitting).
 * Throws SLOT_NO_LONGER_AVAILABLE if the elder/date/time is no longer open.
 *
 * NOTE: this check is independent of coastal-elder-scheduler's equivalent
 * check. Both backends read/write the same Appointments table, but there is
 * no cross-backend locking — if both systems receive a request for the same
 * slot at nearly the same instant, it's possible (though unlikely) for both
 * to pass this check before either write lands. Airtable has no
 * transactions, so this mirrors the original's best-effort approach rather
 * than a stronger guarantee.
 */
async function createAppointment({ campusName, elderName, date, timeSlot, memberName, memberEmail }) {
  const appts = await getConfirmedAppointments(date, campusName);
  const conflict = appts.some(
    (a) => a.fields['Elder Name'] === elderName && a.fields['Time Slot'] === timeSlot
  );
  if (conflict) {
    throw new Error('SLOT_NO_LONGER_AVAILABLE');
  }

  return createRecord(config.airtable.tables.appointments, {
    'Member Name': memberName,
    'Member Email': memberEmail,
    Campus: campusName,
    'Elder Name': elderName,
    Date: date,
    'Time Slot': timeSlot,
    Status: 'Confirmed',
    'Created At': new Date().toISOString(),
  });
}

async function createSundayOptOut({ campusName, memberName, memberEmail, notes }) {
  return createRecord(config.airtable.tables.sundayOptOut, {
    'Member Name': memberName,
    'Member Email': memberEmail,
    Campus: campusName,
    Notes: notes || '',
    'Created At': new Date().toISOString(),
  });
}

module.exports = {
  getAvailableDates,
  getAvailableTimes,
  getAvailableElders,
  getEldersForCampusPublic,
  createAppointment,
  createSundayOptOut,
  weekOfMonth,
  dayName,
};
