#!/usr/bin/env node

/**
 * bigtime-sync.js
 *
 * Syncs client data from BigTime to Airtable.
 *
 * Flow:
 *   1. Authenticate with the BigTime API
 *   2. Pull the full client list
 *   3. For each client, pull the detail view (address, contact info)
 *   4. Fetch all Clients from Airtable
 *   5. Fuzzy-match BigTime clients to Airtable clients by name
 *   6. Update matched Airtable records with BigTime data
 *
 * Rate limits:
 *   - BigTime: max 30 calls/minute (2-second gap between calls)
 *   - Airtable: 5 req/sec (handled by airtable-utils)
 *
 * Usage:
 *   node bigtime-sync.js [--dry-run]
 *
 * Environment variables (via .env):
 *   BIGTIME_USER       - BigTime login email
 *   BIGTIME_PASSWORD   - BigTime password
 *   AIRTABLE_PAT       - Airtable Personal Access Token
 *   AIRTABLE_BASE_ID   - Airtable Base ID
 */

'use strict';

const fetch = require('node-fetch');

const {
  loadConfig,
  fetchAllRecords,
  updateRecord,
  TABLES,
  sleep,
} = require('./airtable-utils');

// ---------------------------------------------------------------------------
// Load configuration (reads .env and airtable-config.json)
// ---------------------------------------------------------------------------

let config;
try {
  config = loadConfig(__dirname);
} catch (err) {
  // loadConfig may fail if airtable-config.json is missing; fall back to
  // plain dotenv so the script still works with just .env + env vars.
  require('dotenv').config();
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BIGTIME_USER     = process.env.BIGTIME_USER;
const BIGTIME_PASSWORD = process.env.BIGTIME_PASSWORD;
const BIGTIME_BASE_URL = 'https://iq.bigtime.net/BigtimeData/api/v2';

// Rate limit: 30 calls/minute = 1 call every 2 seconds
const BIGTIME_RATE_LIMIT_MS = 2000;

// Track the last BigTime API call time for rate-limiting
let _lastBigtimeCall = 0;

// Parse CLI flags
const DRY_RUN = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

if (!BIGTIME_USER || !BIGTIME_PASSWORD) {
  console.error(
    'ERROR: BIGTIME_USER and BIGTIME_PASSWORD must be set in .env'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// BigTime rate limiter
// ---------------------------------------------------------------------------

/**
 * Enforces a minimum 2-second gap between BigTime API calls to stay within
 * the 30 calls/minute rate limit.
 */
async function bigtimeRateLimit() {
  const now     = Date.now();
  const elapsed = now - _lastBigtimeCall;
  if (elapsed < BIGTIME_RATE_LIMIT_MS) {
    await sleep(BIGTIME_RATE_LIMIT_MS - elapsed);
  }
  _lastBigtimeCall = Date.now();
}

// ---------------------------------------------------------------------------
// BigTime API helpers
// ---------------------------------------------------------------------------

/**
 * Authenticates with the BigTime API and returns the session token and firmId.
 *
 * POST https://iq.bigtime.net/BigtimeData/api/v2/session
 * Body: { UserId, Pwd }
 * Response: { token, firmId, ... }
 *
 * @returns {Promise<{token: string, firmId: string}>}
 */
async function bigtimeAuthenticate() {
  console.log('Authenticating with BigTime API...');

  const response = await fetch(`${BIGTIME_BASE_URL}/session`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      UserId: BIGTIME_USER,
      Pwd:    BIGTIME_PASSWORD,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `BigTime authentication failed (${response.status}): ${text}`
    );
  }

  const data = await response.json();

  if (!data.token || !data.firmId) {
    throw new Error(
      'BigTime authentication response missing token or firmId: ' +
        JSON.stringify(data)
    );
  }

  console.log('BigTime authentication successful.');
  return { token: data.token, firmId: data.firmId };
}

/**
 * Makes a rate-limited GET request to the BigTime API.
 *
 * @param {string} apiPath - API path (appended to base URL, e.g. "/client")
 * @param {string} token   - Auth token from session endpoint
 * @param {string} firmId  - Firm ID from session endpoint
 * @returns {Promise<any>}   Parsed JSON response
 */
async function bigtimeGet(apiPath, token, firmId) {
  // Enforce 2-second gap between BigTime calls
  await bigtimeRateLimit();

  const url      = `${BIGTIME_BASE_URL}${apiPath}`;
  const response = await fetch(url, {
    method:  'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Token': token,
      'X-Auth-Realm': firmId,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `BigTime GET ${apiPath} failed (${response.status}): ${text}`
    );
  }

  return response.json();
}

/**
 * Fetches the full BigTime client list.
 *
 * GET /client
 *
 * @param {string} token  - Auth token
 * @param {string} firmId - Firm ID
 * @returns {Promise<Array>} Array of client summary objects
 */
async function bigtimeGetClients(token, firmId) {
  console.log('Fetching BigTime client list...');
  const clients = await bigtimeGet('/client', token, firmId);
  console.log(`  Found ${clients.length} BigTime client(s).`);
  return clients;
}

/**
 * Fetches detailed information for a single BigTime client.
 *
 * GET /client/{clientId}/detail
 *
 * @param {string} clientId - BigTime client ID
 * @param {string} token    - Auth token
 * @param {string} firmId   - Firm ID
 * @returns {Promise<object>} Client detail object (address, contacts, etc.)
 */
async function bigtimeGetClientDetail(clientId, token, firmId) {
  return bigtimeGet(`/client/${clientId}/detail`, token, firmId);
}

// ---------------------------------------------------------------------------
// Name matching utilities
// ---------------------------------------------------------------------------

// Common business entity suffixes to strip for fuzzy matching.
// Applied in order so compound suffixes like "Company, Inc." are handled.
const BUSINESS_SUFFIXES = [
  /,?\s*(inc\.?|incorporated)$/i,
  /,?\s*(llc\.?)$/i,
  /,?\s*(ltd\.?|limited)$/i,
  /,?\s*(llp\.?)$/i,
  /,?\s*(corp\.?|corporation)$/i,
  /,?\s*(co\.?|company)$/i,
  /,?\s*(pllc\.?)$/i,
  /,?\s*(lp\.?)$/i,
  /,?\s*(p\.?c\.?)$/i,
  /,?\s*(d\.?b\.?a\.?)$/i,
];

/**
 * Normalizes a company name for fuzzy matching:
 *   - Convert to lowercase
 *   - Strip common business entity suffixes (Inc, LLC, Ltd, Corp, etc.)
 *   - Collapse whitespace
 *   - Trim leading/trailing whitespace
 *
 * @param {string} name - Raw company name
 * @returns {string} Normalized name for comparison
 */
function normalizeName(name) {
  if (!name) return '';

  let normalized = name.toLowerCase().trim();

  // Strip business suffixes — iterate to handle compound cases
  for (const suffix of BUSINESS_SUFFIXES) {
    normalized = normalized.replace(suffix, '');
  }

  // Collapse multiple spaces and trim
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Matches BigTime clients to Airtable clients by normalized name.
 *
 * Creates a lookup map from Airtable client names and then attempts to match
 * each BigTime client against it. Reports matched pairs, unmatched BigTime
 * clients, and unmatched Airtable clients.
 *
 * @param {Array<object>} bigtimeClients
 *   BigTime client detail objects
 * @param {Array<{id: string, fields: object}>} airtableClients
 *   Airtable client records
 * @returns {{
 *   matched: Array<{bigtime: object, airtable: object}>,
 *   unmatchedBigtime: Array<object>,
 *   unmatchedAirtable: Array<{id: string, fields: object}>
 * }}
 */
function matchClients(bigtimeClients, airtableClients) {
  const matched          = [];
  const unmatchedBigtime = [];

  // Build a lookup map for Airtable clients keyed by normalized name.
  // Track which Airtable records have been matched so we can report unmatched.
  const airtableMap      = new Map();
  const matchedAirtableIds = new Set();

  for (const atRecord of airtableClients) {
    // The Airtable Clients table may use "Client Name" or "Name" as the field
    const name = atRecord.fields['Client Name']
              || atRecord.fields['Name']
              || '';
    const key = normalizeName(name);
    if (key) {
      // If multiple records share the same normalized name, keep the first
      if (!airtableMap.has(key)) {
        airtableMap.set(key, atRecord);
      }
    }
  }

  for (const btClient of bigtimeClients) {
    const btName = btClient.ClientName
                || btClient.Name
                || btClient.Nm
                || '';
    const key = normalizeName(btName);

    if (key && airtableMap.has(key)) {
      const atRecord = airtableMap.get(key);
      matched.push({ bigtime: btClient, airtable: atRecord });
      matchedAirtableIds.add(atRecord.id);
    } else {
      unmatchedBigtime.push(btClient);
    }
  }

  const unmatchedAirtable = airtableClients.filter(
    (r) => !matchedAirtableIds.has(r.id)
  );

  return { matched, unmatchedBigtime, unmatchedAirtable };
}

// ---------------------------------------------------------------------------
// Field extraction
// ---------------------------------------------------------------------------

/**
 * Extracts fields from a BigTime client detail object and maps them to the
 * corresponding Airtable field names in the Clients table.
 *
 * BigTime detail responses typically include:
 *   - ClientId / Id / ClientID
 *   - Street1 / Addr1, Street2 / Addr2, City, State / Region,
 *     Zip / PostalCode / ZipCode
 *   - ContactName / PrimaryContact / Contact
 *   - ContactEmail / Email / ContactEMail
 *   - ContactPhone / Phone / ContactTelephone
 *
 * @param {object} detail - BigTime client detail object
 * @returns {object} Fields object ready for Airtable update
 */
function extractAirtableFields(detail) {
  // Build the street address (combine Street1 + Street2 if present)
  const street1 = detail.Street1 || detail.Addr1 || '';
  const street2 = detail.Street2 || detail.Addr2 || '';
  const streetAddress = [street1, street2].filter(Boolean).join(', ');

  return {
    'BigTime Client ID': String(
      detail.ClientId || detail.Id || detail.ClientID || ''
    ),
    'Street Address':  streetAddress || undefined,
    'City':            detail.City || undefined,
    'State':           detail.State || detail.Region || undefined,
    'Zip':             detail.Zip || detail.PostalCode || detail.ZipCode || undefined,
    'Primary Contact': detail.ContactName || detail.PrimaryContact || detail.Contact || undefined,
    'Contact Email':   detail.ContactEmail || detail.Email || detail.ContactEMail || undefined,
    'Contact Phone':   detail.ContactPhone || detail.Phone || detail.ContactTelephone || undefined,
  };
}

/**
 * Removes keys with undefined or empty-string values so we don't overwrite
 * existing Airtable data with blanks when BigTime has no info for that field.
 *
 * @param {object} obj
 * @returns {object} Cleaned copy
 */
function removeUndefined(obj) {
  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== '') {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('='.repeat(60));
  console.log('BigTime -> Airtable Client Sync');
  if (DRY_RUN) {
    console.log('  *** DRY RUN MODE -- no changes will be made ***');
  }
  console.log('='.repeat(60));
  console.log('');

  // -----------------------------------------------------------------------
  // Step 1: Authenticate with BigTime
  // -----------------------------------------------------------------------
  const { token, firmId } = await bigtimeAuthenticate();
  console.log('');

  // -----------------------------------------------------------------------
  // Step 2: Get full client list from BigTime
  // -----------------------------------------------------------------------
  const clientList = await bigtimeGetClients(token, firmId);
  console.log('');

  // -----------------------------------------------------------------------
  // Step 3: For each client, pull the detail view
  // -----------------------------------------------------------------------
  console.log(
    'Fetching BigTime client details (rate limited to 30 req/min)...'
  );
  const bigtimeDetails = [];

  for (let i = 0; i < clientList.length; i++) {
    const client   = clientList[i];
    const clientId = client.ClientId || client.Id || client.ClientID;

    if (!clientId) {
      console.warn(
        `  WARNING: Skipping client with no ID: ${JSON.stringify(client)}`
      );
      continue;
    }

    try {
      const detail = await bigtimeGetClientDetail(clientId, token, firmId);
      bigtimeDetails.push(detail);

      const displayName = detail.ClientName
                       || detail.Name
                       || detail.Nm
                       || clientId;
      console.log(
        `  [${i + 1}/${clientList.length}] Fetched detail for: ${displayName}`
      );
    } catch (err) {
      console.error(
        `  ERROR fetching detail for client ${clientId}: ${err.message}`
      );
      // Continue with remaining clients instead of aborting
    }
  }

  console.log(`  Fetched details for ${bigtimeDetails.length} client(s).`);
  console.log('');

  // -----------------------------------------------------------------------
  // Step 4: Fetch all Clients from Airtable
  // -----------------------------------------------------------------------
  console.log('Fetching Airtable Clients...');
  const airtableClients = await fetchAllRecords(TABLES.CLIENTS);
  console.log(`  Found ${airtableClients.length} Airtable client record(s).`);
  console.log('');

  // -----------------------------------------------------------------------
  // Step 5: Match BigTime clients to Airtable clients by name
  // -----------------------------------------------------------------------
  console.log('Matching clients by name (fuzzy)...');
  const { matched, unmatchedBigtime, unmatchedAirtable } = matchClients(
    bigtimeDetails,
    airtableClients
  );
  console.log(`  Matched:              ${matched.length}`);
  console.log(`  Unmatched (BigTime):  ${unmatchedBigtime.length}`);
  console.log(`  Unmatched (Airtable): ${unmatchedAirtable.length}`);
  console.log('');

  // -----------------------------------------------------------------------
  // Step 6: Update matched Airtable records
  // -----------------------------------------------------------------------
  let updatedCount = 0;
  let skippedCount = 0;

  if (matched.length > 0) {
    console.log('Updating matched Airtable records...');

    for (const { bigtime, airtable } of matched) {
      const rawFields = extractAirtableFields(bigtime);
      const fields    = removeUndefined(rawFields);

      // Skip if there is nothing to update
      if (Object.keys(fields).length === 0) {
        const skipName = bigtime.ClientName
                      || bigtime.Name
                      || bigtime.Nm
                      || 'Unknown';
        console.log(`  SKIP (no data): ${skipName}`);
        skippedCount++;
        continue;
      }

      const clientDisplayName = bigtime.ClientName
                             || bigtime.Name
                             || bigtime.Nm
                             || 'Unknown';

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would update "${clientDisplayName}":`);
        for (const [key, value] of Object.entries(fields)) {
          console.log(`    ${key}: ${value}`);
        }
        updatedCount++;
      } else {
        try {
          await updateRecord(TABLES.CLIENTS, airtable.id, fields);
          console.log(`  Updated: ${clientDisplayName}`);
          updatedCount++;
        } catch (err) {
          console.error(
            `  ERROR updating "${clientDisplayName}" (${airtable.id}): ${err.message}`
          );
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Final report
  // -----------------------------------------------------------------------
  console.log('');
  console.log('='.repeat(60));
  console.log('SYNC REPORT');
  console.log('='.repeat(60));
  console.log(`BigTime clients fetched:   ${bigtimeDetails.length}`);
  console.log(`Airtable clients fetched:  ${airtableClients.length}`);
  console.log(`Matched:                   ${matched.length}`);
  console.log(
    `Updated:                   ${updatedCount}${DRY_RUN ? ' (dry run)' : ''}`
  );
  console.log(`Skipped (no data):         ${skippedCount}`);
  console.log('');

  if (unmatchedBigtime.length > 0) {
    console.log('--- Unmatched BigTime Clients (not found in Airtable) ---');
    for (const bt of unmatchedBigtime) {
      const name = bt.ClientName || bt.Name || bt.Nm || 'Unknown';
      const id   = bt.ClientId   || bt.Id   || bt.ClientID || '?';
      console.log(`  - ${name} (BigTime ID: ${id})`);
    }
    console.log('');
  }

  if (unmatchedAirtable.length > 0) {
    console.log('--- Unmatched Airtable Clients (not found in BigTime) ---');
    for (const at of unmatchedAirtable) {
      const name = at.fields['Client Name']
                || at.fields['Name']
                || 'Unknown';
      console.log(`  - ${name} (Airtable ID: ${at.id})`);
    }
    console.log('');
  }

  console.log('Done.');
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error('');
  console.error('FATAL ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
