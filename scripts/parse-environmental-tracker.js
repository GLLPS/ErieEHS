#!/usr/bin/env node

/**
 * parse-environmental-tracker.js
 *
 * Parses GLE_Environmental_Tracker.xlsx and imports client records and
 * environmental profile records into Airtable.
 *
 * Usage:
 *   node parse-environmental-tracker.js --dry-run           # preview as JSON
 *   node parse-environmental-tracker.js --import            # push to Airtable
 *   node parse-environmental-tracker.js --dry-run --file path/to/file.xlsx
 *
 * The script reads configuration from:
 *   - .env              (AIRTABLE_PAT)
 *   - airtable-config.json  (baseId, tables.clients, tables.environmentalProfiles)
 */

'use strict';

const path = require('path');
const XLSX = require('xlsx');

const {
  loadConfig,
  batchCreateRecords,
} = require('./airtable-utils');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_XLSX_PATH = path.join(__dirname, 'GLE_Environmental_Tracker.xlsx');

/** Sentinel values that mean "no data". */
const EMPTY_SENTINELS = new Set(['', '---', 'N/A', 'n/a', 'NA', 'na', '-', '--']);

/** Map spreadsheet "Active Client?" values to Airtable Status. */
const STATUS_MAP = {
  yes:    'Active',
  no:     'Inactive',
  closed: 'Closed',
};

/** Recognised generator class values (case-insensitive lookup key). */
const GENERATOR_CLASSES = new Set(['cesqg', 'vsqg', 'sqg', 'lqg']);

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Return true if a cell value should be treated as empty / no data.
 */
function isEmpty(val) {
  if (val === null || val === undefined) return true;
  if (typeof val === 'string') return EMPTY_SENTINELS.has(val.trim());
  return false;
}

/**
 * Safely convert a cell value to a trimmed string, or null.
 */
function str(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s.length === 0 ? null : s;
}

/**
 * Extract a hyperlink target from a cell object. XLSX stores hyperlinks in
 * `cell.l.Target`.  Falls back to the display text.
 */
function extractHyperlink(cell) {
  if (!cell) return null;
  if (cell.l && cell.l.Target) return cell.l.Target;
  return str(cell.v);
}

// ---------------------------------------------------------------------------
// Row / client parsing
// ---------------------------------------------------------------------------

/**
 * Parse the worksheet into an array of raw row objects (one per spreadsheet
 * row, excluding the header).  Each object has keys a..m corresponding to
 * columns A-M.
 */
function parseRows(worksheet) {
  const range = XLSX.utils.decode_range(worksheet['!ref']);
  const rows  = [];

  for (let r = range.s.r + 1; r <= range.e.r; r++) { // skip header row
    const row = {};
    for (let c = 0; c <= 12; c++) { // columns A (0) through M (12)
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = worksheet[addr];
      row[String.fromCharCode(97 + c)] = cell; // 'a'..'m'
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Build structured client + profile objects from raw rows.  Handles merged
 * cells (overflow rows where Column A is empty belong to the preceding client).
 */
function buildClients(rows) {
  const clients = [];
  let current   = null;

  for (const row of rows) {
    const clientName = str(row.a ? row.a.v : null);

    if (clientName) {
      // ---- New client row -------------------------------------------------
      current = {
        name:     clientName,
        status:   mapStatus(row.b),
        sicCode:  str(row.c ? row.c.v : null),
        naics:    str(row.d ? row.d.v : null),
        epaEcho:  extractHyperlink(row.e),
        profiles: [],
        _raw:     row,
      };
      clients.push(current);

      // Build environmental profiles from columns F-M
      addProfiles(current, row);
    } else if (current) {
      // ---- Overflow / merged-cell row (Column A is empty) -----------------
      mergeOverflow(current, row);
    }
    // Rows before the first named client are silently ignored.
  }

  return clients;
}

/**
 * Map "Active Client?" cell to a status string.
 */
function mapStatus(cell) {
  if (!cell) return null;
  const raw = String(cell.v).trim().toLowerCase();
  return STATUS_MAP[raw] || str(cell.v);
}

/**
 * Create environmental profile entries from a single data row and push them
 * onto client.profiles.
 */
function addProfiles(client, row) {
  // Column F — Air Permit
  if (!isEmpty(row.f ? row.f.v : null)) {
    client.profiles.push({
      obligationType: 'Air Permit (AFR/ASF)',
      description:    str(row.f.v),
    });
  }

  // Column G — PBS/SPCC
  if (!isEmpty(row.g ? row.g.v : null)) {
    client.profiles.push({
      obligationType: 'PBS/SPCC',
      description:    str(row.g.v),
    });
  }

  // Columns H & I — RCRA/Haz Waste + Generator Class
  if (!isEmpty(row.h ? row.h.v : null)) {
    const rcra = {
      obligationType: 'RCRA/Haz Waste',
      permitIdNumber: str(row.h.v),
    };

    // Column I — Generator Class (attached to the RCRA record)
    const genClass = str(row.i ? row.i.v : null);
    if (genClass && GENERATOR_CLASSES.has(genClass.toLowerCase())) {
      rcra.generatorClass = genClass.toUpperCase();
    } else if (genClass) {
      // Non-standard value — store as-is in notes
      rcra.generatorClass = genClass;
    }

    client.profiles.push(rcra);
  } else if (!isEmpty(row.i ? row.i.v : null)) {
    // Generator class present but no RCRA ID — still create a RCRA record
    const genClass = str(row.i.v);
    const rcra = {
      obligationType: 'RCRA/Haz Waste',
    };
    if (genClass && GENERATOR_CLASSES.has(genClass.toLowerCase())) {
      rcra.generatorClass = genClass.toUpperCase();
    } else if (genClass) {
      rcra.generatorClass = genClass;
    }
    client.profiles.push(rcra);
  }

  // Column J — Tier II
  if (!isEmpty(row.j ? row.j.v : null)) {
    const val = str(row.j.v);
    const profile = { obligationType: 'Tier II' };
    if (val && val.toLowerCase() !== 'yes') {
      profile.description = val; // e.g. a year like "2024"
    }
    client.profiles.push(profile);
  }

  // Column K — TRI
  if (!isEmpty(row.k ? row.k.v : null)) {
    client.profiles.push({
      obligationType: 'TRI',
      description:    str(row.k.v) !== 'Yes' ? str(row.k.v) : undefined,
    });
  }

  // Column L — CBS/SPR
  if (!isEmpty(row.l ? row.l.v : null)) {
    client.profiles.push({
      obligationType: 'CBS/SPR',
      description:    str(row.l.v),
    });
  }

  // Column M — SWPPP/SPDES
  if (!isEmpty(row.m ? row.m.v : null)) {
    client.profiles.push({
      obligationType: 'SWPPP/SPDES',
      description:    str(row.m.v),
    });
  }
}

/**
 * Merge overflow row data into the current client's profile descriptions or
 * notes.  Overflow rows have an empty Column A and contain additional details
 * (e.g. tank details for SPCC) that belong to the preceding client.
 */
function mergeOverflow(client, row) {
  // Collect non-empty values from the overflow row columns F-M
  const overflowCols = [
    { col: 'f', type: 'Air Permit (AFR/ASF)' },
    { col: 'g', type: 'PBS/SPCC' },
    { col: 'h', type: 'RCRA/Haz Waste' },
    // Column I (generator class) handled specially
    { col: 'j', type: 'Tier II' },
    { col: 'k', type: 'TRI' },
    { col: 'l', type: 'CBS/SPR' },
    { col: 'm', type: 'SWPPP/SPDES' },
  ];

  for (const { col, type } of overflowCols) {
    const val = str(row[col] ? row[col].v : null);
    if (!val || isEmpty(val)) continue;

    // Try to find an existing profile of this type to append to
    const existing = client.profiles.find((p) => p.obligationType === type);
    if (existing) {
      if (existing.description) {
        existing.description += '\n' + val;
      } else if (existing.notes) {
        existing.notes += '\n' + val;
      } else {
        existing.notes = val;
      }
    } else {
      // No matching profile yet — create one
      client.profiles.push({
        obligationType: type,
        description:    val,
      });
    }
  }

  // Handle overflow for Column H → RCRA permit ID addendum
  const hVal = str(row.h ? row.h.v : null);
  if (hVal && !isEmpty(hVal)) {
    const rcra = client.profiles.find((p) => p.obligationType === 'RCRA/Haz Waste');
    if (rcra) {
      if (rcra.permitIdNumber) {
        rcra.notes = rcra.notes
          ? rcra.notes + '\n' + hVal
          : hVal;
      } else {
        rcra.permitIdNumber = hVal;
      }
    }
  }

  // Handle overflow for Column I → Generator Class
  const iVal = str(row.i ? row.i.v : null);
  if (iVal && !isEmpty(iVal)) {
    const rcra = client.profiles.find((p) => p.obligationType === 'RCRA/Haz Waste');
    if (rcra && !rcra.generatorClass) {
      if (GENERATOR_CLASSES.has(iVal.toLowerCase())) {
        rcra.generatorClass = iVal.toUpperCase();
      } else {
        rcra.generatorClass = iVal;
      }
    }
  }

  // Also merge Column B-E overflow if present (rare but defensive)
  const bOverflow = str(row.b ? row.b.v : null);
  if (bOverflow && !isEmpty(bOverflow)) {
    client.statusNotes = client.statusNotes
      ? client.statusNotes + '; ' + bOverflow
      : bOverflow;
  }
}

// ---------------------------------------------------------------------------
// Airtable record builders
// ---------------------------------------------------------------------------

/**
 * Build Airtable "Clients" table records from parsed client objects.
 */
function buildClientRecords(clients) {
  return clients.map((c) => {
    const fields = {
      'Client Name': c.name,
    };
    if (c.status)  fields['Status']      = c.status;
    if (c.sicCode) fields['SIC Code']    = c.sicCode;
    if (c.naics)   fields['NAICS Code']  = c.naics;
    if (c.epaEcho) fields['EPA ECHO Link'] = c.epaEcho;

    return { fields };
  });
}

/**
 * Build Airtable "Environmental Profiles" table records.
 *
 * @param {object[]} clients       Parsed client objects.
 * @param {object}   clientIdMap   Map of client name -> Airtable record ID
 *   (populated after clients are created).  When running in dry-run mode this
 *   will be empty and the Client link field is omitted.
 */
function buildProfileRecords(clients, clientIdMap) {
  const records = [];

  for (const client of clients) {
    for (const profile of client.profiles) {
      const fields = {
        'Obligation Type': profile.obligationType,
      };

      if (profile.description)    fields['Description']      = profile.description;
      if (profile.permitIdNumber) fields['Permit/ID Number'] = profile.permitIdNumber;
      if (profile.generatorClass) fields['Generator Class']  = profile.generatorClass;
      if (profile.notes)          fields['Notes']            = profile.notes;

      // Link to the client record if we have its Airtable ID
      const clientRecId = clientIdMap[client.name];
      if (clientRecId) {
        fields['Client'] = [clientRecId];
      } else {
        // Store the name so the user can manually link or typecast resolves it
        fields['Client Name (Import)'] = client.name;
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
  const args      = process.argv.slice(2);
  const dryRun    = args.includes('--dry-run');
  const doImport  = args.includes('--import');
  const fileIdx   = args.indexOf('--file');
  const xlsxPath  = fileIdx >= 0 && args[fileIdx + 1]
    ? path.resolve(args[fileIdx + 1])
    : DEFAULT_XLSX_PATH;

  if (!dryRun && !doImport) {
    console.error('Usage: node parse-environmental-tracker.js [--dry-run | --import] [--file path]');
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

  const sheetName = workbook.SheetNames[0];
  console.log(`Using sheet: "${sheetName}"`);
  const worksheet = workbook.Sheets[sheetName];

  // ---- Parse rows ---------------------------------------------------------
  const rawRows = parseRows(worksheet);
  console.log(`Parsed ${rawRows.length} raw rows (excluding header).`);

  const clients = buildClients(rawRows);
  console.log(`Identified ${clients.length} client(s).`);

  const totalProfiles = clients.reduce((sum, c) => sum + c.profiles.length, 0);
  console.log(`Total environmental profile records: ${totalProfiles}`);

  // ---- Dry-run mode -------------------------------------------------------
  if (dryRun) {
    const output = {
      summary: {
        clientCount:  clients.length,
        profileCount: totalProfiles,
      },
      clients: clients.map((c) => ({
        name:     c.name,
        status:   c.status,
        sicCode:  c.sicCode,
        naics:    c.naics,
        epaEcho:  c.epaEcho,
        profiles: c.profiles,
      })),
      airtableRecords: {
        clients:  buildClientRecords(clients),
        profiles: buildProfileRecords(clients, {}),
      },
    };

    console.log(JSON.stringify(output, null, 2));
    console.log('\n--- DRY RUN COMPLETE ---');
    console.log(`${clients.length} client records would be created.`);
    console.log(`${totalProfiles} environmental profile records would be created.`);
    return;
  }

  // ---- Import mode --------------------------------------------------------
  console.log('\nLoading Airtable configuration...');
  const { pat, baseId, tables } = loadConfig();

  const clientsTable  = tables.clients  || tables.Clients  || 'Clients';
  const profilesTable = tables.environmentalProfiles
    || tables['Environmental Profiles']
    || 'Environmental Profiles';

  console.log(`Base ID:         ${baseId}`);
  console.log(`Clients table:   ${clientsTable}`);
  console.log(`Profiles table:  ${profilesTable}`);

  // 1. Create client records ------------------------------------------------
  console.log(`\nCreating ${clients.length} client record(s)...`);
  const clientRecords = buildClientRecords(clients);
  const createdClients = await batchCreateRecords(
    baseId, clientsTable, clientRecords, pat
  );

  // Build name -> record ID map for linking profiles
  const clientIdMap = {};
  for (let i = 0; i < clients.length; i++) {
    if (createdClients[i]) {
      clientIdMap[clients[i].name] = createdClients[i].id;
    }
  }
  console.log(`  Created ${createdClients.length} client record(s).`);

  // 2. Create environmental profile records ---------------------------------
  const profileRecords = buildProfileRecords(clients, clientIdMap);
  console.log(`\nCreating ${profileRecords.length} environmental profile record(s)...`);

  const createdProfiles = await batchCreateRecords(
    baseId, profilesTable, profileRecords, pat
  );
  console.log(`  Created ${createdProfiles.length} profile record(s).`);

  // ---- Summary ------------------------------------------------------------
  console.log('\n========================================');
  console.log('  IMPORT COMPLETE');
  console.log('========================================');
  console.log(`  Clients created:               ${createdClients.length}`);
  console.log(`  Environmental profiles created: ${createdProfiles.length}`);
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
