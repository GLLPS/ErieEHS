#!/usr/bin/env node

/**
 * asana-sync.js
 *
 * Creates Asana tasks from Airtable deadlines and training records.
 *
 * Flow:
 *   1. Fetch Compliance Deadlines from Airtable (Status = "Upcoming" or "Overdue")
 *   2. Fetch Training Records from Airtable (Status = "Expired/Overdue" or "Expiring Soon")
 *   3. For each item that does NOT already have an Asana Task Link:
 *      a. Create an Asana task with name, due date, assignee, description, project
 *      b. Write the Asana task URL back to the Airtable record
 *   4. Output summary of tasks created and skipped
 *
 * Rate limits:
 *   - Asana: kept modest at ~2 req/sec (well within the 1500 req/min limit)
 *   - Airtable: 5 req/sec (handled by airtable-utils)
 *
 * Usage:
 *   node asana-sync.js [--dry-run]
 *
 * Environment variables (via .env):
 *   ASANA_PAT            - Asana Personal Access Token
 *   ASANA_PROJECT_GID    - Asana Project GID to add tasks to
 *   ASANA_GID_MH         - Asana user GID for staff member MH
 *   ASANA_GID_JL         - Asana user GID for staff member JL
 *   ASANA_GID_DM         - Asana user GID for staff member DM
 *   ASANA_GID_JC         - Asana user GID for staff member JC
 *   ASANA_GID_JK         - Asana user GID for staff member JK
 *   AIRTABLE_PAT         - Airtable Personal Access Token
 *   AIRTABLE_BASE_ID     - Airtable Base ID
 */

'use strict';

const fetch = require('node-fetch');

const {
  loadConfig,
  fetchAllRecords,
  updateRecord,
  getRecordUrl,
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

const ASANA_PAT         = process.env.ASANA_PAT;
const ASANA_PROJECT_GID = process.env.ASANA_PROJECT_GID;
const ASANA_BASE_URL    = 'https://app.asana.com/api/1.0';

// Rate limit: ~2 requests per second (500ms gap), well within 1500/min
const ASANA_RATE_LIMIT_MS = 500;

// Track the last Asana API call time for rate-limiting
let _lastAsanaCall = 0;

// Parse CLI flags
const DRY_RUN = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Staff-to-Asana GID mapping
// ---------------------------------------------------------------------------

// Build a mapping from staff initials to their Asana user GIDs.
// Environment variables follow the pattern ASANA_GID_{INITIALS}.
// We also support looking up by full staff name from Airtable records.
const STAFF_GID_MAP = {};

/**
 * Populates STAFF_GID_MAP from environment variables matching ASANA_GID_*.
 * For example, ASANA_GID_MH=123456 results in { MH: '123456' }.
 */
function loadStaffGidMap() {
  const prefix = 'ASANA_GID_';
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(prefix) && value) {
      const initials = key.slice(prefix.length); // e.g. "MH", "JL"
      STAFF_GID_MAP[initials] = value;
    }
  }
}

/**
 * Attempts to resolve an Airtable staff name or initials to an Asana user GID.
 *
 * Lookup strategies:
 *   1. Direct match on initials (e.g. "MH")
 *   2. Extract initials from a full name (e.g. "Mike Harris" -> "MH")
 *   3. Case-insensitive match
 *
 * @param {string} staffName - Staff name or initials from Airtable
 * @returns {string|null} Asana user GID, or null if no mapping found
 */
function resolveStaffGid(staffName) {
  if (!staffName) return null;

  const trimmed = staffName.trim();

  // 1. Direct match (e.g. staffName is just "MH")
  if (STAFF_GID_MAP[trimmed]) {
    return STAFF_GID_MAP[trimmed];
  }

  // 2. Case-insensitive direct match
  const upper = trimmed.toUpperCase();
  if (STAFF_GID_MAP[upper]) {
    return STAFF_GID_MAP[upper];
  }

  // 3. Extract initials from a full name like "Mike Harris" -> "MH"
  const parts    = trimmed.split(/\s+/);
  const initials = parts.map((p) => p.charAt(0).toUpperCase()).join('');
  if (STAFF_GID_MAP[initials]) {
    return STAFF_GID_MAP[initials];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

if (!ASANA_PAT) {
  console.error('ERROR: ASANA_PAT must be set in .env');
  process.exit(1);
}

if (!ASANA_PROJECT_GID) {
  console.error('ERROR: ASANA_PROJECT_GID must be set in .env');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Asana rate limiter
// ---------------------------------------------------------------------------

/**
 * Enforces a minimum gap between Asana API calls to stay well within the
 * 1500 requests/minute rate limit (~2 req/sec).
 */
async function asanaRateLimit() {
  const now     = Date.now();
  const elapsed = now - _lastAsanaCall;
  if (elapsed < ASANA_RATE_LIMIT_MS) {
    await sleep(ASANA_RATE_LIMIT_MS - elapsed);
  }
  _lastAsanaCall = Date.now();
}

// ---------------------------------------------------------------------------
// Asana API helpers
// ---------------------------------------------------------------------------

/**
 * Creates a task in Asana.
 *
 * POST https://app.asana.com/api/1.0/tasks
 * Body: { data: { name, due_on, assignee, notes, projects: [projectGid] } }
 *
 * @param {object} taskData
 * @param {string} taskData.name      - Task name/title
 * @param {string} taskData.due_on    - Due date in YYYY-MM-DD format
 * @param {string} [taskData.assignee]  - Asana user GID to assign the task to
 * @param {string} [taskData.notes]     - Task description / notes
 * @returns {Promise<object>} The created Asana task object
 */
async function createAsanaTask(taskData) {
  await asanaRateLimit();

  const body = {
    data: {
      name:     taskData.name,
      due_on:   taskData.due_on || null,
      notes:    taskData.notes || '',
      projects: [ASANA_PROJECT_GID],
    },
  };

  // Only include assignee if we have a valid GID
  if (taskData.assignee) {
    body.data.assignee = taskData.assignee;
  }

  const response = await fetch(`${ASANA_BASE_URL}/tasks`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${ASANA_PAT}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Asana task creation failed (${response.status}): ${text}`
    );
  }

  const result = await response.json();
  return result.data;
}

/**
 * Builds the Asana task URL from a task GID.
 *
 * @param {string} taskGid - Asana task GID
 * @returns {string} URL to the task in the Asana web UI
 */
function getAsanaTaskUrl(taskGid) {
  return `https://app.asana.com/0/${ASANA_PROJECT_GID}/${taskGid}`;
}

// ---------------------------------------------------------------------------
// Airtable data fetching
// ---------------------------------------------------------------------------

/**
 * Fetches Compliance Deadlines from Airtable where Status is "Upcoming" or
 * "Overdue".
 *
 * @returns {Promise<Array<{id: string, fields: object}>>}
 */
async function fetchComplianceDeadlines() {
  console.log('Fetching Compliance Deadlines from Airtable...');

  const records = await fetchAllRecords(TABLES.COMPLIANCE_DEADLINES, {
    filterByFormula: 'OR({Status} = "Upcoming", {Status} = "Overdue")',
  });

  console.log(`  Found ${records.length} deadline(s) (Upcoming/Overdue).`);
  return records;
}

/**
 * Fetches Training Records from Airtable where Status is "Expired/Overdue"
 * or "Expiring Soon".
 *
 * @returns {Promise<Array<{id: string, fields: object}>>}
 */
async function fetchTrainingRecords() {
  console.log('Fetching Training Records from Airtable...');

  const records = await fetchAllRecords(TABLES.TRAINING_RECORDS, {
    filterByFormula:
      'OR({Status} = "Expired/Overdue", {Status} = "Expiring Soon")',
  });

  console.log(`  Found ${records.length} training record(s) (Expired/Expiring).`);
  return records;
}

// ---------------------------------------------------------------------------
// Task creation logic
// ---------------------------------------------------------------------------

/**
 * Processes a single Compliance Deadline record: creates an Asana task and
 * writes the task link back to Airtable.
 *
 * @param {object} record - Airtable record { id, fields }
 * @returns {Promise<'created'|'skipped'|'error'>} Outcome
 */
async function processComplianceDeadline(record) {
  const fields = record.fields;

  // Skip if already linked to an Asana task
  if (fields['Asana Task Link']) {
    return 'skipped';
  }

  // Build the task name: "{Client Name} -- {Deadline Name}"
  // Client Name may be a linked record (array) or a plain string
  const clientName  = Array.isArray(fields['Client Name'])
    ? fields['Client Name'][0]
    : (fields['Client Name'] || 'Unknown Client');
  const deadlineName = fields['Deadline Name']
                    || fields['Name']
                    || 'Compliance Deadline';
  const taskName     = `${clientName} — ${deadlineName}`;

  // Due date
  const dueDate = fields['Due Date'] || fields['Deadline Date'] || null;

  // Assignee — try "Assigned To", "Assignee", or "Staff" fields
  const assigneeName = Array.isArray(fields['Assigned To'])
    ? fields['Assigned To'][0]
    : (fields['Assigned To'] || fields['Assignee'] || fields['Staff'] || null);
  const assigneeGid  = resolveStaffGid(assigneeName);

  // Build description with Airtable link
  const airtableUrl = getRecordUrl(TABLES.COMPLIANCE_DEADLINES, record.id);
  const notes = [
    `Compliance Deadline: ${deadlineName}`,
    `Client: ${clientName}`,
    `Status: ${fields['Status'] || 'N/A'}`,
    dueDate ? `Due Date: ${dueDate}` : null,
    fields['Notes'] ? `Notes: ${fields['Notes']}` : null,
    '',
    `View in Airtable: ${airtableUrl}`,
  ]
    .filter((line) => line !== null)
    .join('\n');

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would create task: "${taskName}"`);
    console.log(`    Due: ${dueDate || 'none'}`);
    console.log(`    Assignee: ${assigneeName || 'none'} -> GID ${assigneeGid || 'none'}`);
    return 'created';
  }

  try {
    const asanaTask = await createAsanaTask({
      name:     taskName,
      due_on:   dueDate,
      assignee: assigneeGid,
      notes:    notes,
    });

    const taskUrl = getAsanaTaskUrl(asanaTask.gid);
    console.log(`  Created: "${taskName}" -> ${taskUrl}`);

    // Write the Asana task URL back to the Airtable record
    await updateRecord(TABLES.COMPLIANCE_DEADLINES, record.id, {
      'Asana Task Link': taskUrl,
    });

    return 'created';
  } catch (err) {
    console.error(`  ERROR creating task for "${taskName}": ${err.message}`);
    return 'error';
  }
}

/**
 * Processes a single Training Record: creates an Asana task and writes the
 * task link back to Airtable.
 *
 * @param {object} record - Airtable record { id, fields }
 * @returns {Promise<'created'|'skipped'|'error'>} Outcome
 */
async function processTrainingRecord(record) {
  const fields = record.fields;

  // Skip if already linked to an Asana task
  if (fields['Asana Task Link']) {
    return 'skipped';
  }

  // Build the task name: "{Client Name or Staff Name} -- {Training Program Name}"
  const clientOrStaff = Array.isArray(fields['Client Name'])
    ? fields['Client Name'][0]
    : (fields['Client Name']
      || (Array.isArray(fields['Staff Name'])
        ? fields['Staff Name'][0]
        : fields['Staff Name'])
      || 'Unknown');
  const programName = fields['Training Program Name']
                   || fields['Training Program']
                   || fields['Program Name']
                   || fields['Name']
                   || 'Training';
  const taskName    = `${clientOrStaff} — ${programName}`;

  // Due date — use expiration date for training
  const dueDate = fields['Expiration Date']
               || fields['Due Date']
               || fields['Expiry Date']
               || null;

  // Assignee — try various field names
  const assigneeName = Array.isArray(fields['Assigned To'])
    ? fields['Assigned To'][0]
    : (fields['Assigned To']
      || (Array.isArray(fields['Staff Name'])
        ? fields['Staff Name'][0]
        : fields['Staff Name'])
      || fields['Assignee']
      || null);
  const assigneeGid = resolveStaffGid(assigneeName);

  // Build description with Airtable link
  const airtableUrl = getRecordUrl(TABLES.TRAINING_RECORDS, record.id);
  const notes = [
    `Training Program: ${programName}`,
    `Staff/Client: ${clientOrStaff}`,
    `Status: ${fields['Status'] || 'N/A'}`,
    dueDate ? `Expiration Date: ${dueDate}` : null,
    fields['Notes'] ? `Notes: ${fields['Notes']}` : null,
    '',
    `View in Airtable: ${airtableUrl}`,
  ]
    .filter((line) => line !== null)
    .join('\n');

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would create task: "${taskName}"`);
    console.log(`    Due: ${dueDate || 'none'}`);
    console.log(`    Assignee: ${assigneeName || 'none'} -> GID ${assigneeGid || 'none'}`);
    return 'created';
  }

  try {
    const asanaTask = await createAsanaTask({
      name:     taskName,
      due_on:   dueDate,
      assignee: assigneeGid,
      notes:    notes,
    });

    const taskUrl = getAsanaTaskUrl(asanaTask.gid);
    console.log(`  Created: "${taskName}" -> ${taskUrl}`);

    // Write the Asana task URL back to the Airtable record
    await updateRecord(TABLES.TRAINING_RECORDS, record.id, {
      'Asana Task Link': taskUrl,
    });

    return 'created';
  } catch (err) {
    console.error(`  ERROR creating task for "${taskName}": ${err.message}`);
    return 'error';
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('='.repeat(60));
  console.log('Airtable -> Asana Task Sync');
  if (DRY_RUN) {
    console.log('  *** DRY RUN MODE -- no changes will be made ***');
  }
  console.log('='.repeat(60));
  console.log('');

  // Load staff GID mappings from environment
  loadStaffGidMap();
  const staffCount = Object.keys(STAFF_GID_MAP).length;
  console.log(`Loaded ${staffCount} staff-to-Asana GID mapping(s).`);
  if (staffCount > 0) {
    for (const [initials, gid] of Object.entries(STAFF_GID_MAP)) {
      console.log(`  ${initials} -> ${gid}`);
    }
  }
  console.log('');

  // Counters for the final report
  let deadlinesCreated = 0;
  let deadlinesSkipped = 0;
  let deadlinesErrored = 0;
  let trainingCreated  = 0;
  let trainingSkipped  = 0;
  let trainingErrored  = 0;

  // -----------------------------------------------------------------------
  // Step 1: Process Compliance Deadlines
  // -----------------------------------------------------------------------
  const deadlines = await fetchComplianceDeadlines();
  console.log('');

  if (deadlines.length > 0) {
    console.log('Processing Compliance Deadlines...');
    for (const record of deadlines) {
      const outcome = await processComplianceDeadline(record);
      switch (outcome) {
        case 'created': deadlinesCreated++; break;
        case 'skipped': deadlinesSkipped++; break;
        case 'error':   deadlinesErrored++; break;
      }
    }
    console.log('');
  }

  // -----------------------------------------------------------------------
  // Step 2: Process Training Records
  // -----------------------------------------------------------------------
  const trainingRecords = await fetchTrainingRecords();
  console.log('');

  if (trainingRecords.length > 0) {
    console.log('Processing Training Records...');
    for (const record of trainingRecords) {
      const outcome = await processTrainingRecord(record);
      switch (outcome) {
        case 'created': trainingCreated++; break;
        case 'skipped': trainingSkipped++; break;
        case 'error':   trainingErrored++; break;
      }
    }
    console.log('');
  }

  // -----------------------------------------------------------------------
  // Final report
  // -----------------------------------------------------------------------
  const totalCreated = deadlinesCreated + trainingCreated;
  const totalSkipped = deadlinesSkipped + trainingSkipped;
  const totalErrors  = deadlinesErrored + trainingErrored;

  console.log('='.repeat(60));
  console.log('SYNC REPORT');
  console.log('='.repeat(60));
  console.log('');
  console.log('Compliance Deadlines:');
  console.log(`  Tasks created:   ${deadlinesCreated}${DRY_RUN ? ' (dry run)' : ''}`);
  console.log(`  Already linked:  ${deadlinesSkipped} (skipped)`);
  if (deadlinesErrored > 0) {
    console.log(`  Errors:          ${deadlinesErrored}`);
  }
  console.log('');
  console.log('Training Records:');
  console.log(`  Tasks created:   ${trainingCreated}${DRY_RUN ? ' (dry run)' : ''}`);
  console.log(`  Already linked:  ${trainingSkipped} (skipped)`);
  if (trainingErrored > 0) {
    console.log(`  Errors:          ${trainingErrored}`);
  }
  console.log('');
  console.log('Totals:');
  console.log(`  ${totalCreated} task(s) created${DRY_RUN ? ' (dry run)' : ''}, ${totalSkipped} already had links (skipped)`);
  if (totalErrors > 0) {
    console.log(`  ${totalErrors} error(s) encountered`);
  }
  console.log('');
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
