// lib/airtable.js
// Minimal Airtable REST wrapper for elder-android-backend. Deliberately
// written from scratch here rather than shared/copied from
// coastal-elder-scheduler's version, per the "repos stay self-contained"
// rule — even though the two implementations will look similar.
//
// Uses Node's built-in fetch (Node 18+), no SDK dependency.

const config = require('../config');

const BASE_URL = 'https://api.airtable.com/v0';

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${config.airtable.apiKey}`,
    ...extra,
  };
}

async function listRecords(tableId, { filterByFormula, maxRecords, sort } = {}) {
  if (!tableId) throw new Error('listRecords called with no tableId — check config/env vars');

  let records = [];
  let offset;

  do {
    const params = new URLSearchParams();
    if (filterByFormula) params.set('filterByFormula', filterByFormula);
    if (maxRecords) params.set('maxRecords', String(maxRecords));
    if (sort) {
      sort.forEach((s, i) => {
        params.set(`sort[${i}][field]`, s.field);
        params.set(`sort[${i}][direction]`, s.direction || 'asc');
      });
    }
    if (offset) params.set('offset', offset);

    const res = await fetch(`${BASE_URL}/${config.airtable.baseId}/${tableId}?${params.toString()}`, {
      headers: authHeaders(),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Airtable listRecords failed (${res.status}) on table ${tableId}: ${body}`);
    }

    const data = await res.json();
    records = records.concat(data.records);
    offset = data.offset;
  } while (offset);

  return records;
}

async function createRecord(tableId, fields) {
  if (!tableId) throw new Error('createRecord called with no tableId — check config/env vars');

  const res = await fetch(`${BASE_URL}/${config.airtable.baseId}/${tableId}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ fields, typecast: true }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable createRecord failed (${res.status}) on table ${tableId}: ${body}`);
  }

  return res.json();
}

async function deleteRecords(tableId, ids) {
  if (!tableId) throw new Error('deleteRecords called with no tableId — check config/env vars');
  if (!Array.isArray(ids) || ids.length === 0) return { records: [] };

  const params = new URLSearchParams();
  ids.forEach((id) => params.append('records[]', id));

  const res = await fetch(`${BASE_URL}/${config.airtable.baseId}/${tableId}?${params.toString()}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable deleteRecords failed (${res.status}) on table ${tableId}: ${body}`);
  }

  return res.json();
}

async function updateRecords(tableId, updates) {
  if (!tableId) throw new Error('updateRecords called with no tableId — check config/env vars');
  if (!Array.isArray(updates) || updates.length === 0) return { records: [] };

  const updated = [];
  for (let i = 0; i < updates.length; i += 10) {
    const batch = updates.slice(i, i + 10);
    const res = await fetch(`${BASE_URL}/${config.airtable.baseId}/${tableId}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ records: batch, typecast: true }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Airtable updateRecords failed (${res.status}) on table ${tableId}: ${body}`);
    }

    const data = await res.json();
    updated.push(...data.records);
  }
  return { records: updated };
}

module.exports = { listRecords, createRecord, updateRecords, deleteRecords };
