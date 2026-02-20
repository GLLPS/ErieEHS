/**
 * airtable-utils.js
 *
 * Shared Airtable utility module for Erie EHS integration scripts.
 * Provides configuration loading, rate-limited HTTP requests, batch record
 * creation, pagination-aware record fetching, fuzzy name matching, and a
 * configured Airtable SDK base instance.
 *
 * Usage:
 *   const {
 *     loadConfig, throttledFetch, batchCreateRecords,
 *     getAllRecords, findRecordByName,
 *     base, fetchAllRecords, updateRecord, TABLES,
 *   } = require('./airtable-utils');
 */

'use strict';

const fs       = require('fs');
const path     = require('path');
const Airtable = require('airtable');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const AIRTABLE_API = 'https://api.airtable.com/v0';
const BATCH_SIZE   = 10; // Airtable allows up to 10 records per create/update

/**
 * Load environment variables from .env and parse airtable-config.json.
 *
 * The .env file is located by searching in this order:
 *   1. The supplied configDir (defaults to __dirname)
 *   2. The parent directory of configDir
 *
 * @param {string} [configDir] Directory containing .env and
 *   airtable-config.json. Defaults to __dirname.
 * @returns {{ pat: string, baseId: string, tables: object, config: object }}
 */
function loadConfig(configDir) {
  const dir = configDir || __dirname;

  // Load .env ---------------------------------------------------------------
  const envPath = path.join(dir, '.env');
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
  } else {
    const parentEnv = path.join(dir, '..', '.env');
    if (fs.existsSync(parentEnv)) {
      require('dotenv').config({ path: parentEnv });
    } else {
      require('dotenv').config(); // default search
    }
  }

  const pat = process.env.AIRTABLE_PAT;
  if (!pat) {
    throw new Error(
      'AIRTABLE_PAT is not set. Add it to .env or export it as an ' +
      'environment variable.'
    );
  }

  // Load config JSON --------------------------------------------------------
  const cfgPath = path.join(dir, 'airtable-config.json');
  if (!fs.existsSync(cfgPath)) {
    throw new Error(
      `airtable-config.json not found at ${cfgPath}. ` +
      'Create it with at least { "baseId": "...", "tables": { ... } }.'
    );
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  } catch (err) {
    throw new Error(`Failed to parse airtable-config.json: ${err.message}`);
  }

  const baseId = config.baseId || process.env.AIRTABLE_BASE_ID;
  if (!baseId) {
    throw new Error(
      'baseId is missing from airtable-config.json and AIRTABLE_BASE_ID ' +
      'is not set in the environment.'
    );
  }

  return {
    pat,
    baseId,
    tables: config.tables || {},
    config,
  };
}

// ---------------------------------------------------------------------------
// Legacy SDK-based base (kept for backward compatibility)
// ---------------------------------------------------------------------------

// Only initialise if the env vars are already present (e.g. scripts that call
// loadConfig() first will have them set by then).
let _base = null;

function getBase() {
  if (_base) return _base;

  const pat    = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;

  if (!pat || !baseId) {
    throw new Error(
      'Call loadConfig() before using the SDK base, or set AIRTABLE_PAT ' +
      'and AIRTABLE_BASE_ID in the environment.'
    );
  }

  Airtable.configure({ apiKey: pat });
  _base = Airtable.base(baseId);
  return _base;
}

// Proxy that lazily initialises the base on first access.
const baseProxy = new Proxy(function () {}, {
  apply(_target, _thisArg, args) {
    return getBase()(...args);
  },
  get(_target, prop) {
    return getBase()[prop];
  },
});

// ---------------------------------------------------------------------------
// Table name constants
// ---------------------------------------------------------------------------

const TABLES = {
  CLIENTS:               'Clients',
  STAFF:                 'Staff',
  ENVIRONMENTAL_PROFILES: 'Environmental Profiles',
  CLIENT_SERVICE_ACTIVITIES: 'Client Service Activities',
  COMPLIANCE_DEADLINES:  'Compliance Deadlines',
  TRAINING_RECORDS:      'Training Records',
};

// ---------------------------------------------------------------------------
// Rate limiting — Airtable allows 5 requests per second
// ---------------------------------------------------------------------------

const THROTTLE_MS = 200; // 5 req/sec => min 200 ms between requests
let _lastRequestTime = 0;

/**
 * Wait until at least THROTTLE_MS have elapsed since the last request, then
 * execute a fetch. Keeps us within the Airtable API rate limit.
 *
 * Automatically retries on HTTP 429 with exponential back-off.
 *
 * @param {string} url
 * @param {object} options  Standard fetch() options.
 * @returns {Promise<Response>}
 */
async function throttledFetch(url, options) {
  const now = Date.now();
  const elapsed = now - _lastRequestTime;
  if (elapsed < THROTTLE_MS) {
    await sleep(THROTTLE_MS - elapsed);
  }
  _lastRequestTime = Date.now();

  const response = await fetch(url, options);

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '30', 10);
    const waitMs = retryAfter * 1000;
    console.warn(
      `  [throttledFetch] Rate-limited (429). Retrying in ${retryAfter}s...`
    );
    await sleep(waitMs);
    return throttledFetch(url, options);
  }

  return response;
}

// ---------------------------------------------------------------------------
// Batch create records (REST API)
// ---------------------------------------------------------------------------

/**
 * Create records in an Airtable table, batching into groups of 10.
 *
 * @param {string}   baseId   Airtable base ID (e.g. "appXXXXXX").
 * @param {string}   tableId  Table ID or name.
 * @param {object[]} records  Array of { fields: { ... } } objects.
 * @param {string}   pat      Personal access token.
 * @returns {Promise<object[]>} Created records (Airtable response objects).
 */
async function batchCreateRecords(baseId, tableId, records, pat) {
  if (!records || records.length === 0) return [];

  const url     = `${AIRTABLE_API}/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}`;
  const created = [];

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch      = records.slice(i, i + BATCH_SIZE);
    const batchNum   = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatch = Math.ceil(records.length / BATCH_SIZE);

    console.log(
      `  [batch ${batchNum}/${totalBatch}] Creating ${batch.length} record(s) in ${tableId}...`
    );

    const response = await throttledFetch(url, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${pat}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        records:  batch,
        typecast: true,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Airtable create failed (HTTP ${response.status}) for table ` +
        `"${tableId}" batch ${batchNum}: ${errorBody}`
      );
    }

    const data = await response.json();
    if (data.records) {
      created.push(...data.records);
    }
  }

  return created;
}

// ---------------------------------------------------------------------------
// Get all records (REST API, with pagination)
// ---------------------------------------------------------------------------

/**
 * Fetch every record from an Airtable table, automatically following
 * pagination offsets.
 *
 * @param {string} baseId
 * @param {string} tableId
 * @param {string} pat
 * @param {object} [params]  Extra query params (fields[], filterByFormula, etc.).
 * @returns {Promise<object[]>} Array of record objects.
 */
async function getAllRecords(baseId, tableId, pat, params) {
  const baseUrl    = `${AIRTABLE_API}/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}`;
  const allRecords = [];
  let offset       = null;

  do {
    const qs = new URLSearchParams();

    // Append extra params (handle arrays like fields[])
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (Array.isArray(value)) {
          value.forEach((v) => qs.append(key, v));
        } else {
          qs.set(key, value);
        }
      }
    }

    if (offset) {
      qs.set('offset', offset);
    }

    const sep = qs.toString() ? '?' : '';
    const url = `${baseUrl}${sep}${qs.toString()}`;

    const response = await throttledFetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${pat}` },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Airtable list failed (HTTP ${response.status}) for table ` +
        `"${tableId}": ${errorBody}`
      );
    }

    const data = await response.json();
    if (data.records) {
      allRecords.push(...data.records);
    }
    offset = data.offset || null;
  } while (offset);

  return allRecords;
}

// ---------------------------------------------------------------------------
// Legacy SDK-based helpers (kept for backward compat with existing scripts)
// ---------------------------------------------------------------------------

/**
 * Fetch ALL records via the Airtable SDK, handling pagination.
 */
async function fetchAllRecords(tableName, options) {
  const b = getBase();
  await _sdkRateLimit();

  return new Promise((resolve, reject) => {
    const records = [];
    b(tableName)
      .select(options || {})
      .eachPage(
        function page(pageRecords, fetchNextPage) {
          pageRecords.forEach((record) => {
            records.push({ id: record.id, fields: record.fields });
          });
          _sdkRateLimit().then(() => fetchNextPage());
        },
        function done(err) {
          if (err) reject(err);
          else resolve(records);
        }
      );
  });
}

/**
 * Update a single record via the SDK.
 */
async function updateRecord(tableName, recordId, fields) {
  const b = getBase();
  await _sdkRateLimit();
  return new Promise((resolve, reject) => {
    b(tableName).update(recordId, fields, (err, record) => {
      if (err) return reject(err);
      resolve({ id: record.id, fields: record.fields });
    });
  });
}

/**
 * Batch update records via the SDK (groups of 10).
 */
async function batchUpdateRecords(tableName, records) {
  const b       = getBase();
  const results = [];

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    await _sdkRateLimit();

    const updated = await new Promise((resolve, reject) => {
      b(tableName).update(
        batch.map((r) => ({ id: r.id, fields: r.fields })),
        (err, updatedRecords) => {
          if (err) return reject(err);
          resolve(updatedRecords.map((rec) => ({ id: rec.id, fields: rec.fields })));
        }
      );
    });

    results.push(...updated);
  }

  return results;
}

async function _sdkRateLimit() {
  const now = Date.now();
  const elapsed = now - _lastRequestTime;
  if (elapsed < THROTTLE_MS) {
    await sleep(THROTTLE_MS - elapsed);
  }
  _lastRequestTime = Date.now();
}

/**
 * Build an Airtable record URL.
 */
function getRecordUrl(tableId, recordId) {
  const baseId = process.env.AIRTABLE_BASE_ID;
  return `https://airtable.com/${baseId}/${tableId}/${recordId}`;
}

// ---------------------------------------------------------------------------
// Fuzzy name matching
// ---------------------------------------------------------------------------

/**
 * Find a record whose `nameField` value matches `name` using progressively
 * looser comparison strategies:
 *
 *   1. Exact match
 *   2. Case-insensitive match
 *   3. Trimmed & normalised whitespace, case-insensitive
 *   4. "Starts with" (either direction, for truncated names)
 *   5. Levenshtein distance <= 3 (catches minor typos)
 *
 * @param {object[]} records    Airtable record objects.
 * @param {string}   nameField  Field key to compare (e.g. "Client Name").
 * @param {string}   name       Name to search for.
 * @returns {object|null} Matched record or null.
 */
function findRecordByName(records, nameField, name) {
  if (!name || !records || records.length === 0) return null;

  const target      = name.trim();
  const targetLower = target.toLowerCase();
  const targetNorm  = normalise(target);

  // 1. Exact
  for (const rec of records) {
    const val = (rec.fields || {})[nameField];
    if (val === target) return rec;
  }

  // 2. Case-insensitive
  for (const rec of records) {
    const val = (rec.fields || {})[nameField];
    if (typeof val === 'string' && val.toLowerCase() === targetLower) return rec;
  }

  // 3. Normalised whitespace + case
  for (const rec of records) {
    const val = (rec.fields || {})[nameField];
    if (typeof val === 'string' && normalise(val) === targetNorm) return rec;
  }

  // 4. Starts-with (either direction)
  for (const rec of records) {
    const val = (rec.fields || {})[nameField];
    if (typeof val === 'string') {
      const valNorm = normalise(val);
      if (valNorm.startsWith(targetNorm) || targetNorm.startsWith(valNorm)) {
        return rec;
      }
    }
  }

  // 5. Levenshtein distance
  let best     = null;
  let bestDist = Infinity;
  for (const rec of records) {
    const val = (rec.fields || {})[nameField];
    if (typeof val === 'string') {
      const d = levenshtein(normalise(val), targetNorm);
      if (d < bestDist) {
        bestDist = d;
        best     = rec;
      }
    }
  }
  if (bestDist <= 3) return best;

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Promise-based sleep.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalise a string for comparison: trim, collapse whitespace, lowercase.
 * @param {string} s
 * @returns {string}
 */
function normalise(s) {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Levenshtein distance between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  const m  = a.length;
  const n  = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[m][n];
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // New REST-based utilities
  loadConfig,
  throttledFetch,
  batchCreateRecords,
  getAllRecords,
  findRecordByName,

  // Legacy SDK-based utilities
  base: baseProxy,
  TABLES,
  sleep,
  airtableRateLimit: _sdkRateLimit,
  fetchAllRecords,
  updateRecord,
  batchUpdateRecords,
  getRecordUrl,

  // Internal helpers (exported for testing)
  normalise,
  levenshtein,

  // Constants
  AIRTABLE_API,
  BATCH_SIZE,
};
