const PAT = import.meta.env.VITE_AIRTABLE_PAT;
const BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID;
const API_URL = 'https://api.airtable.com/v0';

const headers = {
  Authorization: `Bearer ${PAT}`,
  'Content-Type': 'application/json',
};

// Simple rate limiter: queue requests with 200ms gaps
let lastRequest = 0;
async function throttledFetch(url, options = {}) {
  const now = Date.now();
  const wait = Math.max(0, lastRequest + 200 - now);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable API error ${res.status}: ${body}`);
  }
  return res.json();
}

// Fetch all records from a table, handling pagination
async function fetchAll(tableIdOrName, params = {}) {
  let allRecords = [];
  let offset = null;
  do {
    const query = new URLSearchParams(params);
    if (offset) query.set('offset', offset);
    const data = await throttledFetch(
      `${API_URL}/${BASE_ID}/${encodeURIComponent(tableIdOrName)}?${query}`
    );
    allRecords = allRecords.concat(data.records);
    offset = data.offset;
  } while (offset);
  return allRecords;
}

// Fetch records with a filter formula
async function fetchFiltered(tableIdOrName, filterFormula, params = {}) {
  return fetchAll(tableIdOrName, { filterByFormula: filterFormula, ...params });
}

// Get a single record
async function fetchRecord(tableIdOrName, recordId) {
  return throttledFetch(`${API_URL}/${BASE_ID}/${encodeURIComponent(tableIdOrName)}/${recordId}`);
}

// Update a record
async function updateRecord(tableIdOrName, recordId, fields) {
  return throttledFetch(
    `${API_URL}/${BASE_ID}/${encodeURIComponent(tableIdOrName)}/${recordId}`,
    { method: 'PATCH', body: JSON.stringify({ fields }) }
  );
}

// Table name constants
export const TABLES = {
  STAFF: 'Staff',
  CLIENTS: 'Clients',
  ENVIRONMENTAL_PROFILES: 'Environmental Profiles',
  COMPLIANCE_DEADLINES: 'Compliance Deadlines',
  SAFETY_PROGRAMS: 'Safety Programs',
  CLIENT_EMPLOYEES: 'Client Employees',
  TRAINING_RECORDS: 'Training Records',
  CLIENT_SERVICE_ACTIVITIES: 'Client Service Activities',
};

// Domain-specific fetchers
export async function getStaff() {
  return fetchAll(TABLES.STAFF);
}

export async function getClients(filter) {
  if (filter) return fetchFiltered(TABLES.CLIENTS, filter);
  return fetchAll(TABLES.CLIENTS);
}

export async function getActiveClients() {
  return fetchFiltered(TABLES.CLIENTS, '{Status} = "Active"', { sort: [{ field: 'Client Name', direction: 'asc' }].map((s, i) => [`sort[${i}][field]`, s.field]).reduce((acc, [k, v], i) => { acc[`sort[${i}][field]`] = v; acc[`sort[${i}][direction]`] = 'asc'; return acc; }, {}) });
}

export async function getClient(recordId) {
  return fetchRecord(TABLES.CLIENTS, recordId);
}

export async function getEnvironmentalProfiles(filter) {
  if (filter) return fetchFiltered(TABLES.ENVIRONMENTAL_PROFILES, filter);
  return fetchAll(TABLES.ENVIRONMENTAL_PROFILES);
}

export async function getComplianceDeadlines(filter) {
  if (filter) return fetchFiltered(TABLES.COMPLIANCE_DEADLINES, filter);
  return fetchAll(TABLES.COMPLIANCE_DEADLINES);
}

export async function getSafetyPrograms(filter) {
  if (filter) return fetchFiltered(TABLES.SAFETY_PROGRAMS, filter);
  return fetchAll(TABLES.SAFETY_PROGRAMS);
}

export async function getClientEmployees(filter) {
  if (filter) return fetchFiltered(TABLES.CLIENT_EMPLOYEES, filter);
  return fetchAll(TABLES.CLIENT_EMPLOYEES);
}

export async function getTrainingRecords(filter) {
  if (filter) return fetchFiltered(TABLES.TRAINING_RECORDS, filter);
  return fetchAll(TABLES.TRAINING_RECORDS);
}

export async function getServiceActivities(filter) {
  if (filter) return fetchFiltered(TABLES.SERVICE_ACTIVITIES, filter);
  return fetchAll(TABLES.CLIENT_SERVICE_ACTIVITIES);
}

// Resolve linked record IDs to names (for display)
// Cache resolved names to avoid redundant lookups
const nameCache = new Map();

export async function resolveLinkedName(tableIdOrName, recordId) {
  const key = `${tableIdOrName}:${recordId}`;
  if (nameCache.has(key)) return nameCache.get(key);
  try {
    const record = await fetchRecord(tableIdOrName, recordId);
    const name = record.fields['Client Name'] || record.fields['Name'] || record.fields['Employee Name'] || record.fields['Deadline Name'] || record.fields['Program Name'] || recordId;
    nameCache.set(key, name);
    return name;
  } catch {
    return recordId;
  }
}

// Batch resolve: given an array of records, resolve all linked fields at once
export async function batchResolveClients(records) {
  const clientIds = new Set();
  for (const r of records) {
    const links = r.fields.Client || [];
    for (const id of links) clientIds.add(id);
  }
  if (clientIds.size === 0) return new Map();

  // Fetch all clients and build lookup
  const clients = await fetchAll(TABLES.CLIENTS);
  const map = new Map();
  for (const c of clients) {
    map.set(c.id, c.fields['Client Name']);
  }
  return map;
}

export async function batchResolveStaff(records) {
  const staffIds = new Set();
  for (const r of records) {
    const links = r.fields['Assigned To'] || [];
    for (const id of links) staffIds.add(id);
  }
  if (staffIds.size === 0) return new Map();

  const staff = await fetchAll(TABLES.STAFF);
  const map = new Map();
  for (const s of staff) {
    map.set(s.id, s.fields['Name']);
  }
  return map;
}

export function isConfigured() {
  return Boolean(PAT && BASE_ID);
}
