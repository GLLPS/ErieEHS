#!/usr/bin/env node

/**
 * parse-csa-tracker.js
 *
 * Parses the "CSA Tracker" tab of CSA_Tracker.xlsx and imports Client Service
 * Activity records into Airtable.
 *
 * Usage:
 *   node parse-csa-tracker.js --dry-run              # preview as JSON
 *   node parse-csa-tracker.js --import               # push to Airtable
 *   node parse-csa-tracker.js --dry-run --file path/to/file.xlsx
 *
 * Configuration:
 *   - .env                  (AIRTABLE_PAT)
 *   - airtable-config.json  (baseId, tables.clients, tables.staff,
 *                             tables.clientServiceActivities)
 */

'use strict';

const path = require('path');
const XLSX = require('xlsx');

const {
  loadConfig,
  batchCreateRecords,
  getAllRecords,
  findRecordByName,
} = require('./airtable-utils');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_XLSX_PATH = path.join(__dirname, 'CSA_Tracker.xlsx');
const TARGET_SHEET      = 'CSA Tracker';

/**
 * Map staff initials to full display names.
 * Extend this map as new staff members are added.
 */
const STAFF_INITIALS = {
  MH: 'Mike H.',
  JL: 'Jeff L.',
  DM: 'Dan M.',
  JC: 'Jim C.',
  JK: 'Jake K.',
};

/**
 * Month name -> 0-based month index.
 */
const MONTH_NAMES = {
  january:   0,  jan: 0,
  february:  1,  feb: 1,
  march:     2,  mar: 2,
  april:     3,  apr: 3,
  may:       4,
  june:      5,  jun: 5,
  july:      6,  jul: 6,
  august:    7,  aug: 7,
  september: 8,  sep: 8,  sept: 8,
  october:   9,  oct: 9,
  november: 10,  nov: 10,
  december: 11,  dec: 11,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return true if a cell value should be treated as empty.
 */
function isEmpty(val) {
  if (val === null || val === undefined) return true;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed === '' || trimmed === '---' || trimmed === '-' || trimmed === 'N/A';
  }
  return false;
}

/**
 * Safely stringify a cell value.
 */
function str(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s.length === 0 ? null : s;
}

/**
 * Parse a date value from a cell.
 *
 * Handles:
 *   - Excel serial dates (numbers)
 *   - JS Date objects (already converted by XLSX)
 *   - Full date strings ("3/15/2025", "2025-03-15", etc.)
 *   - Month names ("March", "February") -> 1st of that month, year inferred
 *
 * @param {*} cellValue  The raw .v from the cell, or the cell object itself.
 * @param {object} [cell]  The XLSX cell object (for type detection).
 * @returns {string|null}  ISO date string (YYYY-MM-DD) or null.
 */
function parseDate(cellValue, cell) {
  if (cellValue === null || cellValue === undefined) return null;

  // If the XLSX cell has type 'n' and a date format, convert from serial
  if (cell && cell.t === 'n' && cell.w) {
    // cell.w is the formatted string; try parsing it
    const parsed = new Date(cell.w);
    if (!isNaN(parsed.getTime())) {
      return formatDate(parsed);
    }
    // Fall through to try the raw value
  }

  // If it is already a Date
  if (cellValue instanceof Date) {
    return formatDate(cellValue);
  }

  // If it is a number (Excel serial date)
  if (typeof cellValue === 'number') {
    const d = excelSerialToDate(cellValue);
    return formatDate(d);
  }

  // String handling
  const raw = String(cellValue).trim();
  if (raw === '' || raw === '---' || raw === '-') return null;

  // Try parsing as a month name
  const monthIdx = MONTH_NAMES[raw.toLowerCase()];
  if (monthIdx !== undefined) {
    return formatDate(inferDateFromMonth(monthIdx));
  }

  // Try generic date parsing
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return formatDate(parsed);
  }

  // Could not parse — return null and log a warning
  console.warn(`  [warn] Could not parse date: "${raw}"`);
  return null;
}

/**
 * Convert an Excel serial date number to a JS Date.
 * Excel's epoch is 1900-01-01 (serial 1), but has the Lotus 1-2-3
 * bug treating 1900 as a leap year.
 */
function excelSerialToDate(serial) {
  // 25569 = days between 1900-01-01 and 1970-01-01
  const utcDays = serial - 25569;
  const utcMs   = utcDays * 86400 * 1000;
  return new Date(utcMs);
}

/**
 * Given a 0-based month index, infer a full date (1st of that month).
 *
 * Heuristic: if the month is in the past relative to "now" (Feb 2026),
 * assume the current year (2026) for months Jan-Feb, and 2025 for months
 * that would be in the future of 2025 context but past relative to now.
 * More practically: months already passed in the current year get 2025 if
 * they predate the data context; months Mar-Dec that haven't arrived in
 * 2026 yet still get 2025 when the data was likely captured.
 *
 * Simplified rule used here:
 *   - month <= current month (Feb = 1) => year = current year (2026)
 *   - month > current month            => year = 2025
 *
 * This covers the typical scenario where the tracker references upcoming
 * months from late 2025 / early 2026.
 */
function inferDateFromMonth(monthIdx) {
  const now          = new Date();
  const currentYear  = now.getFullYear();  // 2026
  const currentMonth = now.getMonth();     // 0-based

  // If the month has already occurred this year (or is this month), use
  // current year.  Otherwise fall back to 2025 (the most likely prior year).
  const year = monthIdx <= currentMonth ? currentYear : currentYear - 1;

  return new Date(year, monthIdx, 1);
}

/**
 * Format a Date as YYYY-MM-DD for Airtable.
 */
function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Resolve staff initials to a full name.
 * Returns the mapped name, or the original value if not found.
 */
function resolveStaff(initials) {
  if (!initials) return null;
  const key = initials.trim().toUpperCase();
  return STAFF_INITIALS[key] || initials.trim();
}

// ---------------------------------------------------------------------------
// Row parsing
// ---------------------------------------------------------------------------

/**
 * Parse rows from the CSA Tracker sheet.
 *
 * Columns:
 *   A  = Client
 *   B  = Most recent visit date
 *   C  = Most recent visit task
 *   D  = Most recent visit who
 *   E  = Next visit date
 *   F  = Next visit task
 *   G  = Next visit who
 *   H  = Future visit date
 *   I  = Future visit task
 *   J  = Future visit who
 */
function parseCSARows(worksheet) {
  const range = XLSX.utils.decode_range(worksheet['!ref']);
  const rows  = [];

  for (let r = range.s.r + 1; r <= range.e.r; r++) { // skip header
    const getCell = (c) => worksheet[XLSX.utils.encode_cell({ r, c })];
    const getVal  = (c) => {
      const cell = getCell(c);
      return cell ? cell.v : null;
    };

    const clientName = str(getVal(0));
    if (!clientName) continue; // skip blank rows

    const entry = {
      clientName,
      visits: [],
    };

    // Most recent visit (columns B-D) -> Completed
    const recentDate = parseDate(getVal(1), getCell(1));
    const recentTask = str(getVal(2));
    const recentWho  = resolveStaff(str(getVal(3)));
    if (recentDate || recentTask) {
      entry.visits.push({
        status: 'Completed',
        date:   recentDate,
        task:   recentTask,
        who:    recentWho,
      });
    }

    // Next visit (columns E-G) -> Scheduled
    const nextDate = parseDate(getVal(4), getCell(4));
    const nextTask = str(getVal(5));
    const nextWho  = resolveStaff(str(getVal(6)));
    if (nextDate || nextTask) {
      entry.visits.push({
        status: 'Scheduled',
        date:   nextDate,
        task:   nextTask,
        who:    nextWho,
      });
    }

    // Future visit (columns H-J) -> Scheduled
    const futureDate = parseDate(getVal(7), getCell(7));
    const futureTask = str(getVal(8));
    const futureWho  = resolveStaff(str(getVal(9)));
    if (futureDate || futureTask) {
      entry.visits.push({
        status: 'Scheduled',
        date:   futureDate,
        task:   futureTask,
        who:    futureWho,
      });
    }

    rows.push(entry);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Airtable record builders
// ---------------------------------------------------------------------------

/**
 * Build Client Service Activity records for Airtable.
 *
 * @param {object[]} entries         Parsed CSA entries.
 * @param {object}   clientIdMap     Map of client name -> Airtable record ID.
 * @param {object}   staffIdMap      Map of staff display name -> Airtable record ID.
 * @param {string[]} unmatchedClients  Array to collect unmatched client names.
 * @param {string[]} unmatchedStaff    Array to collect unmatched staff names.
 * @returns {object[]} Array of { fields } objects.
 */
function buildCSARecords(entries, clientIdMap, staffIdMap, unmatchedClients, unmatchedStaff) {
  const records = [];

  for (const entry of entries) {
    const clientRecId = clientIdMap[entry.clientName];
    if (!clientRecId) {
      unmatchedClients.push(entry.clientName);
    }

    for (const visit of entry.visits) {
      const fields = {
        Status: visit.status,
      };

      if (visit.date) fields['Date'] = visit.date;
      if (visit.task) fields['Task'] = visit.task;

      // Link to client
      if (clientRecId) {
        fields['Client'] = [clientRecId];
      } else {
        fields['Client Name (Import)'] = entry.clientName;
      }

      // Link to staff
      if (visit.who) {
        const staffRecId = staffIdMap[visit.who];
        if (staffRecId) {
          fields['Staff'] = [staffRecId];
        } else {
          unmatchedStaff.push(visit.who);
          fields['Staff Name (Import)'] = visit.who;
        }
      }

      records.push({ fields });
    }
  }

  return records;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args     = process.argv.slice(2);
  const dryRun   = args.includes('--dry-run');
  const doImport = args.includes('--import');
  const fileIdx  = args.indexOf('--file');
  const xlsxPath = fileIdx >= 0 && args[fileIdx + 1]
    ? path.resolve(args[fileIdx + 1])
    : DEFAULT_XLSX_PATH;

  if (!dryRun && !doImport) {
    console.error('Usage: node parse-csa-tracker.js [--dry-run | --import] [--file path]');
    console.error('  --dry-run   Parse the Excel file and output JSON to stdout');
    console.error('  --import    Parse and push records to Airtable');
    process.exit(1);
  }

  // ---- Load Excel ---------------------------------------------------------
  console.log(`Reading ${xlsxPath}...`);

  let workbook;
  try {
    workbook = XLSX.readFile(xlsxPath, { cellStyles: true, cellHTML: false });
  } catch (err) {
    console.error(`Failed to read Excel file: ${err.message}`);
    process.exit(1);
  }

  // Find the "CSA Tracker" sheet
  let sheetName = TARGET_SHEET;
  if (!workbook.SheetNames.includes(sheetName)) {
    // Try case-insensitive match
    const match = workbook.SheetNames.find(
      (s) => s.toLowerCase() === TARGET_SHEET.toLowerCase()
    );
    if (match) {
      sheetName = match;
    } else {
      console.error(
        `Sheet "${TARGET_SHEET}" not found. Available sheets: ` +
        workbook.SheetNames.join(', ')
      );
      process.exit(1);
    }
  }

  console.log(`Using sheet: "${sheetName}"`);
  const worksheet = workbook.Sheets[sheetName];

  // ---- Parse rows ---------------------------------------------------------
  const entries = parseCSARows(worksheet);
  console.log(`Parsed ${entries.length} client row(s) with visit data.`);

  const totalVisits = entries.reduce((sum, e) => sum + e.visits.length, 0);
  console.log(`Total visit records to create: ${totalVisits}`);

  // ---- Dry-run mode -------------------------------------------------------
  if (dryRun) {
    const output = {
      summary: {
        clientRowCount: entries.length,
        visitCount:     totalVisits,
      },
      entries: entries.map((e) => ({
        clientName: e.clientName,
        visits:     e.visits,
      })),
      airtableRecords: buildCSARecords(entries, {}, {}, [], []),
    };

    console.log(JSON.stringify(output, null, 2));
    console.log('\n--- DRY RUN COMPLETE ---');
    console.log(`${entries.length} client rows processed.`);
    console.log(`${totalVisits} visit records would be created.`);
    return;
  }

  // ---- Import mode --------------------------------------------------------
  console.log('\nLoading Airtable configuration...');
  const { pat, baseId, tables } = loadConfig();

  const clientsTable = tables.clients || tables.Clients || 'Clients';
  const staffTable   = tables.staff   || tables.Staff   || 'Staff';
  const csaTable     = tables.clientServiceActivities
    || tables['Client Service Activities']
    || 'Client Service Activities';

  console.log(`Base ID:     ${baseId}`);
  console.log(`Clients:     ${clientsTable}`);
  console.log(`Staff:       ${staffTable}`);
  console.log(`CSA table:   ${csaTable}`);

  // 1. Fetch existing clients -----------------------------------------------
  console.log('\nFetching existing Client records from Airtable...');
  const existingClients = await getAllRecords(baseId, clientsTable, pat);
  console.log(`  Found ${existingClients.length} client record(s).`);

  // Build client name -> record ID map using fuzzy matching
  const clientIdMap = {};
  for (const entry of entries) {
    const match = findRecordByName(existingClients, 'Client Name', entry.clientName);
    if (match) {
      clientIdMap[entry.clientName] = match.id;
    }
  }

  const matchedCount   = Object.keys(clientIdMap).length;
  const unmatchedCount = entries.length - matchedCount;
  console.log(`  Matched ${matchedCount} client(s), ${unmatchedCount} unmatched.`);

  // 2. Fetch existing staff -------------------------------------------------
  console.log('\nFetching existing Staff records from Airtable...');
  const existingStaff = await getAllRecords(baseId, staffTable, pat);
  console.log(`  Found ${existingStaff.length} staff record(s).`);

  // Build staff name -> record ID map
  const staffIdMap = {};
  const allStaffNames = new Set(
    entries.flatMap((e) => e.visits.map((v) => v.who).filter(Boolean))
  );
  for (const staffName of allStaffNames) {
    // Try matching against "Name" or "Staff Name" field
    let match = findRecordByName(existingStaff, 'Name', staffName);
    if (!match) {
      match = findRecordByName(existingStaff, 'Staff Name', staffName);
    }
    if (match) {
      staffIdMap[staffName] = match.id;
    }
  }

  const staffMatched = Object.keys(staffIdMap).length;
  console.log(`  Matched ${staffMatched} of ${allStaffNames.size} unique staff name(s).`);

  // 3. Build and create CSA records -----------------------------------------
  const unmatchedClients = [];
  const unmatchedStaff   = [];
  const csaRecords = buildCSARecords(
    entries, clientIdMap, staffIdMap, unmatchedClients, unmatchedStaff
  );

  // Deduplicate warnings
  const uniqueUnmatchedClients = [...new Set(unmatchedClients)];
  const uniqueUnmatchedStaff   = [...new Set(unmatchedStaff)];

  if (uniqueUnmatchedClients.length > 0) {
    console.warn('\n  [warn] Unmatched clients (records will lack Client link):');
    uniqueUnmatchedClients.forEach((n) => console.warn(`    - ${n}`));
  }
  if (uniqueUnmatchedStaff.length > 0) {
    console.warn('\n  [warn] Unmatched staff (records will lack Staff link):');
    uniqueUnmatchedStaff.forEach((n) => console.warn(`    - ${n}`));
  }

  console.log(`\nCreating ${csaRecords.length} Client Service Activity record(s)...`);
  const createdRecords = await batchCreateRecords(
    baseId, csaTable, csaRecords, pat
  );
  console.log(`  Created ${createdRecords.length} record(s).`);

  // ---- Summary ------------------------------------------------------------
  console.log('\n========================================');
  console.log('  IMPORT COMPLETE');
  console.log('========================================');
  console.log(`  Client rows processed:       ${entries.length}`);
  console.log(`  CSA records created:         ${createdRecords.length}`);
  console.log(`  Clients matched:             ${matchedCount}`);
  console.log(`  Clients unmatched:           ${uniqueUnmatchedClients.length}`);
  console.log(`  Staff matched:               ${staffMatched}`);
  console.log(`  Staff unmatched:             ${uniqueUnmatchedStaff.length}`);
  console.log('========================================');
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error('\nFATAL ERROR:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
