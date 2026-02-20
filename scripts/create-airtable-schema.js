#!/usr/bin/env node

/**
 * create-airtable-schema.js
 *
 * Creates the full "GLE EHS Management Hub" Airtable base with all 8 tables,
 * fields, views, and seed data using the Airtable REST API directly (no SDK).
 *
 * Usage:
 *   1. Copy .env.example to .env and fill in AIRTABLE_PAT
 *   2. Optionally set AIRTABLE_BASE_ID if you already have a base
 *   3. Run: node create-airtable-schema.js
 *
 * The script will:
 *   - Create a new base (or use existing) in the user's first workspace
 *   - Create all 8 tables with non-link fields first
 *   - Add linked record fields after all tables exist (so target table IDs are known)
 *   - Create views for each table
 *   - Seed the Staff table with 5 initial records
 *   - Save configuration to airtable-config.json
 *
 * Rate limiting: Airtable allows 5 req/sec. We throttle with 200ms delays.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || null;
const AIRTABLE_WORKSPACE_ID = process.env.AIRTABLE_WORKSPACE_ID || null;
const API_BASE = 'https://api.airtable.com/v0';
const THROTTLE_MS = 200; // 200ms between requests (5 req/sec max)

if (!AIRTABLE_PAT) {
  console.error('ERROR: AIRTABLE_PAT is not set. Copy .env.example to .env and add your token.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Make a throttled request to the Airtable API.
 * Waits THROTTLE_MS before each call to stay within rate limits.
 */
async function airtableRequest(endpoint, method = 'GET', body = null) {
  await sleep(THROTTLE_MS);

  const url = `${API_BASE}${endpoint}`;
  const options = {
    method,
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { rawResponse: text };
  }

  if (!response.ok) {
    const errorMsg = data?.error?.message || data?.error || text;
    throw new Error(
      `Airtable API error [${response.status}] ${method} ${endpoint}: ${JSON.stringify(errorMsg)}`
    );
  }

  return data;
}

// ---------------------------------------------------------------------------
// Single-select option helper
// ---------------------------------------------------------------------------

/**
 * Build a singleSelect field definition with color-coded options.
 * Airtable accepts colors like: blueLight, cyanLight, tealLight, greenLight,
 * yellowLight, orangeLight, redLight, pinkLight, purpleLight, grayLight, etc.
 */
const OPTION_COLORS = [
  'blueLight',
  'cyanLight',
  'tealLight',
  'greenLight',
  'yellowLight',
  'orangeLight',
  'redLight',
  'pinkLight',
  'purpleLight',
  'grayLight',
  'blueDark',
  'cyanDark',
  'tealDark',
  'greenDark',
  'yellowDark',
  'orangeDark',
  'redDark',
  'pinkDark',
  'purpleDark',
  'grayDark',
];

function singleSelectField(name, choices, description) {
  return {
    name,
    type: 'singleSelect',
    description: description || undefined,
    options: {
      choices: choices.map((label, i) => ({
        name: label,
        color: OPTION_COLORS[i % OPTION_COLORS.length],
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Table definitions
// ---------------------------------------------------------------------------
// Each table is defined with:
//   - name: table name
//   - description: table description
//   - primaryFieldName: name of the auto-created primary field
//   - fields: non-link fields to create with the table
//   - linkFields: fields that reference other tables (added after all tables exist)
//   - views: named views to create
//   - seedData: optional records to insert after creation

/**
 * Returns the full schema definition for all 8 tables.
 * Link fields reference tables by name; actual IDs are resolved at runtime.
 */
function getTableDefinitions() {
  return [
    // -----------------------------------------------------------------------
    // 1. Staff (created first -- other tables link to it)
    // -----------------------------------------------------------------------
    {
      name: 'Staff',
      description: 'GLE staff members, roles, and contact information.',
      primaryFieldName: 'Name',
      fields: [
        { name: 'Initials', type: 'singleLineText' },
        { name: 'Email', type: 'email' },
        singleSelectField('Role', ['Principal', 'Senior Consultant', 'Consultant', 'Associate']),
        { name: 'Active', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
      ],
      linkFields: [],
      views: [
        { name: 'All Staff', type: 'grid' },
        { name: 'Active Staff', type: 'grid' },
      ],
      seedData: [
        { Name: 'Mike H.', Initials: 'MH', Role: 'Principal', Active: true },
        { Name: 'Jeff L.', Initials: 'JL', Role: 'Senior Consultant', Active: true },
        { Name: 'Dan M.', Initials: 'DM', Role: 'Consultant', Active: true },
        { Name: 'Jim C.', Initials: 'JC', Role: 'Consultant', Active: true },
        { Name: 'Jake K.', Initials: 'JK', Role: 'Associate', Active: true },
      ],
    },

    // -----------------------------------------------------------------------
    // 2. Clients
    // -----------------------------------------------------------------------
    {
      name: 'Clients',
      description: 'Client organizations, contacts, and service levels.',
      primaryFieldName: 'Client Name',
      fields: [
        { name: 'BigTime Client ID', type: 'singleLineText' },
        singleSelectField('Status', ['Active', 'Inactive', 'Closed']),
        { name: 'Street Address', type: 'singleLineText' },
        { name: 'City', type: 'singleLineText' },
        { name: 'State', type: 'singleLineText' },
        { name: 'Zip', type: 'singleLineText' },
        { name: 'Primary Contact', type: 'singleLineText' },
        { name: 'Contact Email', type: 'email' },
        { name: 'Contact Phone', type: 'phoneNumber' },
        { name: 'SIC Code', type: 'singleLineText' },
        { name: 'NAICS Code', type: 'singleLineText' },
        { name: 'EPA ECHO Link', type: 'url' },
        { name: 'SharePoint Folder', type: 'url' },
        singleSelectField('Service Level — Environmental', [
          'Full Manage',
          'Project-Based',
          'On-Call',
          'None',
        ]),
        singleSelectField('Service Level — Safety', [
          'Full Manage',
          'Deliver Only',
          'Project-Based',
          'On-Call',
          'None',
        ]),
        { name: 'Scope of Services', type: 'multilineText' },
        singleSelectField('Contract Type', ['Retainer', 'Project-Based', 'On-Call']),
        { name: 'Notes', type: 'multilineText' },
      ],
      linkFields: [
        { name: 'GLE Account Manager', linkedTableName: 'Staff' },
      ],
      views: [
        { name: 'All Clients', type: 'grid' },
        { name: 'Active Clients', type: 'grid' },
        { name: 'By Account Manager', type: 'grid' },
      ],
    },

    // -----------------------------------------------------------------------
    // 3. Environmental Profiles
    // -----------------------------------------------------------------------
    {
      name: 'Environmental Profiles',
      description: 'Environmental permits, obligations, and regulatory profiles for each client.',
      primaryFieldName: 'Record Name',
      fields: [
        singleSelectField('Obligation Type', [
          'Air Permit (AFR/ASF)',
          'PBS/SPCC',
          'RCRA/Haz Waste',
          'Tier II',
          'TRI',
          'CBS/SPR',
          'SWPPP/SPDES',
          'Stormwater No-Exposure',
          'Other',
        ]),
        singleSelectField('Status', ['Active', 'Expired', 'Pending', 'N/A']),
        { name: 'Permit/ID Number', type: 'singleLineText' },
        singleSelectField('Generator Class', ['VSQG', 'CESQG', 'SQG', 'LQG', 'N/A']),
        { name: 'Description', type: 'multilineText' },
        { name: 'Issue Date', type: 'date', options: { dateFormat: { name: 'local' } } },
        { name: 'Expiration Date', type: 'date', options: { dateFormat: { name: 'local' } } },
        singleSelectField('Renewal Frequency', [
          'Annual',
          'Biennial',
          '5-Year',
          '10-Year',
          'No Expiration',
          'One-Time',
        ]),
        singleSelectField('Regulating Agency', ['EPA', 'NYSDEC', 'Local', 'OSHA', 'Other']),
        { name: 'Linked Documents', type: 'url' },
        { name: 'Notes', type: 'multilineText' },
      ],
      linkFields: [
        { name: 'Client', linkedTableName: 'Clients' },
      ],
      views: [
        { name: 'All Profiles', type: 'grid' },
        { name: 'By Client', type: 'grid' },
        { name: 'By Obligation Type', type: 'grid' },
        { name: 'Expiring Soon', type: 'grid' },
      ],
    },

    // -----------------------------------------------------------------------
    // 4. Compliance Deadlines
    // -----------------------------------------------------------------------
    {
      name: 'Compliance Deadlines',
      description: 'Regulatory compliance deadlines, renewals, and filing dates.',
      primaryFieldName: 'Deadline Name',
      fields: [
        singleSelectField('Deadline Type', [
          'Permit Renewal',
          'Annual Report',
          'Inspection',
          'Monitoring/Sampling',
          'Certification',
          'Filing',
          'Training',
          'Other',
        ]),
        { name: 'Due Date', type: 'date', options: { dateFormat: { name: 'local' } } },
        singleSelectField('Status', [
          'Upcoming',
          'In Progress',
          'Completed',
          'Overdue',
          'N/A',
        ]),
        singleSelectField('Priority', ['High', 'Medium', 'Low']),
        { name: 'Recurring', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
        singleSelectField('Recurrence', [
          'Monthly',
          'Quarterly',
          'Semi-Annual',
          'Annual',
          'Biennial',
          '5-Year',
          'Custom',
        ]),
        { name: 'Completion Date', type: 'date', options: { dateFormat: { name: 'local' } } },
        { name: 'Linked Documents', type: 'url' },
        { name: 'Asana Task Link', type: 'url' },
        { name: 'Notes', type: 'multilineText' },
      ],
      linkFields: [
        { name: 'Client', linkedTableName: 'Clients' },
        { name: 'Environmental Profile', linkedTableName: 'Environmental Profiles' },
        { name: 'Assigned To', linkedTableName: 'Staff' },
      ],
      views: [
        { name: 'All Deadlines', type: 'grid' },
        { name: 'Upcoming Deadlines', type: 'grid' },
        { name: 'Overdue', type: 'grid' },
        { name: 'By Client', type: 'grid' },
        { name: 'By Assigned Staff', type: 'grid' },
      ],
    },

    // -----------------------------------------------------------------------
    // 5. Safety Programs
    // -----------------------------------------------------------------------
    {
      name: 'Safety Programs',
      description: 'Safety training programs, certifications, and written program status.',
      primaryFieldName: 'Program Name',
      fields: [
        singleSelectField('Program Type', [
          'Forklift/PIT Certification',
          'Respirator Fit Testing',
          'Hearing Conservation/Audiogram',
          'Confined Space Entry',
          'HAZWOPER (Initial 40hr)',
          'HAZWOPER (8hr Refresher)',
          'Fire Extinguisher/Emergency Response',
          'Lockout/Tagout (LOTO)',
          'Bloodborne Pathogens',
          'First Aid/CPR/AED',
          'HazCom/GHS',
          'Fall Protection',
          'Electrical Safety/NFPA 70E',
          'Crane/Rigging',
          'Machine Guarding',
          'Ergonomics',
          'Heat Stress',
          'New Hire Safety Orientation',
          'Site-Specific Safety',
          'Other',
        ]),
        { name: 'OSHA Standard', type: 'singleLineText' },
        singleSelectField('Applies To', [
          'All Employees',
          'Specific Roles',
          'Designated Employees',
          'New Hires Only',
        ]),
        singleSelectField('Frequency', [
          'Initial Only',
          'Annual',
          'Biennial',
          'Every 3 Years',
          'As-Needed',
          'Per Change',
        ]),
        singleSelectField('Delivery Method', [
          'GLE Classroom',
          'GLE On-Site',
          'Client Self-Deliver',
          'Online/LMS',
          'Third Party',
          'Mixed',
        ]),
        singleSelectField('Program Status', [
          'Active',
          'Needs Update',
          'Needs Development',
          'Inactive',
        ]),
        {
          name: 'Written Program Required',
          type: 'checkbox',
          options: { icon: 'check', color: 'greenBright' },
        },
        singleSelectField('Written Program Status', [
          'Current',
          'Needs Update',
          'Needs Development',
          'N/A',
        ]),
        { name: 'Linked Documents', type: 'url' },
        { name: 'Notes', type: 'multilineText' },
      ],
      linkFields: [
        { name: 'Client', linkedTableName: 'Clients' },
      ],
      views: [
        { name: 'All Programs', type: 'grid' },
        { name: 'By Client', type: 'grid' },
        { name: 'By Program Type', type: 'grid' },
        { name: 'Needs Update', type: 'grid' },
      ],
    },

    // -----------------------------------------------------------------------
    // 6. Client Employees
    // -----------------------------------------------------------------------
    {
      name: 'Client Employees',
      description: 'Individual employees at client organizations for training tracking.',
      primaryFieldName: 'Employee Name',
      fields: [
        { name: 'Employee ID', type: 'singleLineText' },
        { name: 'Department', type: 'singleLineText' },
        { name: 'Job Title / Role', type: 'singleLineText' },
        { name: 'Hire Date', type: 'date', options: { dateFormat: { name: 'local' } } },
        singleSelectField('Status', ['Active', 'Inactive', 'Terminated', 'Leave']),
        { name: 'Email', type: 'email' },
        { name: 'Phone', type: 'phoneNumber' },
        { name: 'Notes', type: 'multilineText' },
      ],
      linkFields: [
        { name: 'Client', linkedTableName: 'Clients' },
        { name: 'Required Programs', linkedTableName: 'Safety Programs' },
      ],
      views: [
        { name: 'All Employees', type: 'grid' },
        { name: 'By Client', type: 'grid' },
        { name: 'Active Employees', type: 'grid' },
      ],
    },

    // -----------------------------------------------------------------------
    // 7. Training Records
    // -----------------------------------------------------------------------
    {
      name: 'Training Records',
      description: 'Individual training completion records linking employees to safety programs.',
      primaryFieldName: 'Record ID',
      fields: [
        singleSelectField('Training Type', [
          'Initial',
          'Refresher',
          'Recertification',
          'Toolbox Talk',
          'Hands-On/Practical',
          'Written Test',
          'Medical Evaluation',
        ]),
        { name: 'Date Completed', type: 'date', options: { dateFormat: { name: 'local' } } },
        { name: 'Expiration Date', type: 'date', options: { dateFormat: { name: 'local' } } },
        singleSelectField('Status', [
          'Current',
          'Expiring Soon',
          'Expired/Overdue',
          'Scheduled',
          'Waived',
        ]),
        { name: 'Trainer / Provider', type: 'singleLineText' },
        { name: 'Score / Result', type: 'singleLineText' },
        { name: 'Cert Number', type: 'singleLineText' },
        { name: 'Linked Documents', type: 'url' },
        { name: 'Notes', type: 'multilineText' },
      ],
      linkFields: [
        { name: 'Employee', linkedTableName: 'Client Employees' },
        { name: 'Client', linkedTableName: 'Clients' },
        { name: 'Safety Program', linkedTableName: 'Safety Programs' },
      ],
      views: [
        { name: 'All Records', type: 'grid' },
        { name: 'By Employee', type: 'grid' },
        { name: 'By Client', type: 'grid' },
        { name: 'Expiring Soon', type: 'grid' },
        { name: 'Expired/Overdue', type: 'grid' },
      ],
    },

    // -----------------------------------------------------------------------
    // 8. Client Service Activities
    // -----------------------------------------------------------------------
    {
      name: 'Client Service Activities',
      description: 'Log of GLE service visits and activities performed for clients.',
      primaryFieldName: 'Activity ID',
      fields: [
        { name: 'Visit Date', type: 'date', options: { dateFormat: { name: 'local' } } },
        { name: 'Task / Activity', type: 'singleLineText' },
        singleSelectField('Status', ['Completed', 'Scheduled', 'Cancelled', 'Rescheduled']),
        singleSelectField('Visit Type', [
          'Training Delivery',
          'Safety Inspection',
          'Safety Committee Meeting',
          'Audit',
          'Consultation',
          'On-Site Support',
          'Other',
        ]),
        { name: 'Notes', type: 'multilineText' },
        { name: 'Linked Documents', type: 'url' },
      ],
      linkFields: [
        { name: 'Client', linkedTableName: 'Clients' },
        { name: 'Assigned To', linkedTableName: 'Staff' },
      ],
      views: [
        { name: 'All Activities', type: 'grid' },
        { name: 'By Client', type: 'grid' },
        { name: 'By Staff Member', type: 'grid' },
        { name: 'Upcoming', type: 'grid' },
        { name: 'Completed', type: 'grid' },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Base creation / resolution
// ---------------------------------------------------------------------------

/**
 * Get or create the Airtable base. If AIRTABLE_BASE_ID is set, validate it.
 * Otherwise, create a new base called "GLE EHS Management Hub" in the
 * user's first available workspace.
 */
async function getOrCreateBase() {
  if (AIRTABLE_BASE_ID) {
    console.log(`Using existing base: ${AIRTABLE_BASE_ID}`);
    return AIRTABLE_BASE_ID;
  }

  // We need a workspace ID to create a base — Airtable requires it.
  let workspaceId = AIRTABLE_WORKSPACE_ID;

  if (workspaceId) {
    console.log(`Using workspace ID from env: ${workspaceId}`);
  } else {
    console.log('No AIRTABLE_BASE_ID set. Discovering workspace...');

    // Method 1: Try GET /meta/workspaces (requires workspacesAndBases:read scope)
    try {
      const workspacesResponse = await airtableRequest('/meta/workspaces');
      if (workspacesResponse.workspaces && workspacesResponse.workspaces.length > 0) {
        workspaceId = workspacesResponse.workspaces[0].id;
        console.log(`Found workspace via API: ${workspaceId}`);
      }
    } catch {
      console.log('  /meta/workspaces endpoint not available for this token.');
    }

    // Method 2: Check if any existing base has workspace info in its metadata
    if (!workspaceId) {
      try {
        const basesResponse = await airtableRequest('/meta/bases');
        if (basesResponse.bases && basesResponse.bases.length > 0) {
          // Check if any base object carries a workspaceId
          for (const base of basesResponse.bases) {
            if (base.workspaceId) {
              workspaceId = base.workspaceId;
              console.log(`Found workspace via existing base "${base.name}": ${workspaceId}`);
              break;
            }
          }
        }
      } catch {
        // Ignore
      }
    }
  }

  // If we still don't have a workspace ID, give clear instructions
  if (!workspaceId) {
    console.error('');
    console.error('ERROR: Cannot create a new base without a workspace ID.');
    console.error('');
    console.error('You have two options:');
    console.error('');
    console.error('  Option A — Provide your workspace ID:');
    console.error('    1. Go to https://airtable.com and open any workspace');
    console.error('    2. The URL will look like: airtable.com/wsp***/...');
    console.error('    3. Copy the "wsp..." ID');
    console.error('    4. Add to your .env file: AIRTABLE_WORKSPACE_ID=wsp...');
    console.error('');
    console.error('  Option B — Create the base manually:');
    console.error('    1. Go to https://airtable.com and click "+ Create" to make a new base');
    console.error('    2. Name it "GLE EHS Management Hub"');
    console.error('    3. Open it — the URL will be: airtable.com/app***/...');
    console.error('    4. Copy the "app..." ID');
    console.error('    5. Add to your .env file: AIRTABLE_BASE_ID=app...');
    console.error('');
    console.error('  Also ensure your PAT token has these scopes:');
    console.error('    - data.records:read, data.records:write');
    console.error('    - schema.bases:read, schema.bases:write');
    console.error('');
    process.exit(1);
  }

  // Create the base with the workspace ID
  console.log('Creating new base: "GLE EHS Management Hub"...');
  const createBody = {
    name: 'GLE EHS Management Hub',
    workspaceId,
    tables: [
      {
        name: 'Placeholder',
        description: 'Temporary placeholder table (will be removed).',
        fields: [
          { name: 'Name', type: 'singleLineText' },
        ],
      },
    ],
  };

  const createResponse = await airtableRequest('/meta/bases', 'POST', createBody);
  const baseId = createResponse.id;
  console.log(`Base created: ${baseId}`);
  return baseId;
}

// ---------------------------------------------------------------------------
// Table creation (Phase 1: non-link fields only)
// ---------------------------------------------------------------------------

/**
 * Create a single table with all of its non-link fields.
 * Returns the table ID and a map of field names to field IDs.
 */
async function createTable(baseId, tableDef) {
  console.log(`  Creating table: "${tableDef.name}"...`);

  const body = {
    name: tableDef.name,
    description: tableDef.description,
    fields: [
      // The first field listed becomes the primary field.
      // Airtable requires exactly one primary field of type singleLineText (or similar).
      {
        name: tableDef.primaryFieldName,
        type: 'singleLineText',
        description: 'Primary field',
      },
      // Append all non-link fields
      ...tableDef.fields,
    ],
  };

  const response = await airtableRequest(`/meta/bases/${baseId}/tables`, 'POST', body);

  // Build a field name -> field ID map from the response
  const fieldMap = {};
  if (response.fields) {
    for (const field of response.fields) {
      fieldMap[field.name] = field.id;
    }
  }

  console.log(`    Table "${tableDef.name}" created -> ${response.id} (${Object.keys(fieldMap).length} fields)`);
  return { tableId: response.id, fieldMap };
}

// ---------------------------------------------------------------------------
// Link field creation (Phase 2)
// ---------------------------------------------------------------------------

/**
 * Add linked record fields to a table. Requires all target tables to already exist.
 */
async function addLinkFields(baseId, tableId, tableName, linkFields, tableIdMap) {
  for (const linkDef of linkFields) {
    const linkedTableId = tableIdMap[linkDef.linkedTableName];
    if (!linkedTableId) {
      console.error(
        `    WARNING: Cannot create link field "${linkDef.name}" on "${tableName}" — ` +
        `target table "${linkDef.linkedTableName}" not found in tableIdMap.`
      );
      continue;
    }

    console.log(`    Adding link field "${linkDef.name}" -> "${linkDef.linkedTableName}" on "${tableName}"...`);

    const body = {
      name: linkDef.name,
      type: 'multipleRecordLinks',
      options: {
        linkedTableId,
      },
    };

    await airtableRequest(`/meta/bases/${baseId}/tables/${tableId}/fields`, 'POST', body);
    console.log(`      Link field "${linkDef.name}" created.`);
  }
}

// ---------------------------------------------------------------------------
// View creation
// ---------------------------------------------------------------------------

/**
 * Create views for a table. Airtable's Metadata API supports creating views
 * via POST /v0/meta/bases/{baseId}/views or via table-level endpoints.
 *
 * Note: The Airtable Metadata API for views is:
 *   POST /v0/meta/bases/{baseId}/tables/{tableId}/views
 *   Body: { name, type }
 *
 * If the view creation endpoint is not available (some API tiers), we log a
 * warning and continue.
 */
async function createViews(baseId, tableId, tableName, views) {
  for (const viewDef of views) {
    // Skip the default "Grid view" that Airtable creates automatically
    if (viewDef.name === 'Grid view') continue;

    console.log(`    Creating view "${viewDef.name}" on "${tableName}"...`);
    try {
      await airtableRequest(`/meta/bases/${baseId}/tables/${tableId}/views`, 'POST', {
        name: viewDef.name,
        type: viewDef.type || 'grid',
      });
      console.log(`      View "${viewDef.name}" created.`);
    } catch (err) {
      // View creation may not be available on all API tiers
      console.warn(`      WARNING: Could not create view "${viewDef.name}": ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

/**
 * Insert seed records into a table using the Airtable records API.
 * POST /v0/{baseId}/{tableIdOrName}
 * Body: { records: [ { fields: { ... } }, ... ] }
 *
 * Airtable allows up to 10 records per request.
 */
async function seedRecords(baseId, tableId, tableName, records) {
  if (!records || records.length === 0) return;

  console.log(`  Seeding ${records.length} records into "${tableName}"...`);

  // Airtable accepts up to 10 records per batch
  const batchSize = 10;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const body = {
      records: batch.map((fields) => ({ fields })),
    };

    await airtableRequest(`/${baseId}/${tableId}`, 'POST', body);
    console.log(`    Inserted batch of ${batch.length} records.`);
  }
}

// ---------------------------------------------------------------------------
// Save configuration
// ---------------------------------------------------------------------------

/**
 * Save the base ID and all table IDs to airtable-config.json so other
 * scripts can reference them without re-querying the API.
 */
function saveConfig(baseId, tableIdMap) {
  const config = {
    baseId,
    tables: tableIdMap,
    createdAt: new Date().toISOString(),
  };

  const configPath = path.join(__dirname, 'airtable-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  console.log(`\nConfiguration saved to: ${configPath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('='.repeat(70));
  console.log('  GLE EHS Management Hub — Airtable Schema Creator');
  console.log('='.repeat(70));
  console.log();

  // -------------------------------------------------------------------------
  // Step 1: Get or create the base
  // -------------------------------------------------------------------------
  const baseId = await getOrCreateBase();
  console.log();

  // -------------------------------------------------------------------------
  // Step 2: Get table definitions
  // -------------------------------------------------------------------------
  const tableDefs = getTableDefinitions();

  // Maps: tableName -> tableId
  const tableIdMap = {};
  // Maps: tableName -> { fieldName -> fieldId }
  const tableFieldMaps = {};

  // -------------------------------------------------------------------------
  // Step 3: Phase 1 — Create all tables with non-link fields
  // -------------------------------------------------------------------------
  console.log('Phase 1: Creating tables with non-link fields...');
  console.log('-'.repeat(50));

  for (const tableDef of tableDefs) {
    const { tableId, fieldMap } = await createTable(baseId, tableDef);
    tableIdMap[tableDef.name] = tableId;
    tableFieldMaps[tableDef.name] = fieldMap;
  }

  console.log();
  console.log('All tables created. Table ID map:');
  for (const [name, id] of Object.entries(tableIdMap)) {
    console.log(`  ${name}: ${id}`);
  }
  console.log();

  // -------------------------------------------------------------------------
  // Step 4: Phase 2 — Add linked record fields
  // -------------------------------------------------------------------------
  console.log('Phase 2: Adding linked record fields...');
  console.log('-'.repeat(50));

  for (const tableDef of tableDefs) {
    if (tableDef.linkFields.length === 0) continue;
    const tableId = tableIdMap[tableDef.name];
    await addLinkFields(baseId, tableId, tableDef.name, tableDef.linkFields, tableIdMap);
  }

  console.log();

  // -------------------------------------------------------------------------
  // Step 5: Create views for each table
  // -------------------------------------------------------------------------
  console.log('Phase 3: Creating views...');
  console.log('-'.repeat(50));

  for (const tableDef of tableDefs) {
    if (!tableDef.views || tableDef.views.length === 0) continue;
    const tableId = tableIdMap[tableDef.name];
    await createViews(baseId, tableId, tableDef.name, tableDef.views);
  }

  console.log();

  // -------------------------------------------------------------------------
  // Step 6: Seed data
  // -------------------------------------------------------------------------
  console.log('Phase 4: Seeding data...');
  console.log('-'.repeat(50));

  for (const tableDef of tableDefs) {
    if (!tableDef.seedData || tableDef.seedData.length === 0) continue;
    const tableId = tableIdMap[tableDef.name];
    await seedRecords(baseId, tableId, tableDef.name, tableDef.seedData);
  }

  console.log();

  // -------------------------------------------------------------------------
  // Step 7: Save configuration
  // -------------------------------------------------------------------------
  saveConfig(baseId, tableIdMap);

  // -------------------------------------------------------------------------
  // Done
  // -------------------------------------------------------------------------
  console.log();
  console.log('='.repeat(70));
  console.log('  Schema creation complete!');
  console.log('='.repeat(70));
  console.log();
  console.log(`Base ID: ${baseId}`);
  console.log(`Tables created: ${Object.keys(tableIdMap).length}`);
  console.log();
  console.log('Next steps:');
  console.log('  1. Open Airtable and verify the base: https://airtable.com');
  console.log('  2. Set up view filters/sorts manually (API creates grid views only)');
  console.log('  3. Add AIRTABLE_BASE_ID to your .env file for future script runs');
  console.log();
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error();
  console.error('FATAL ERROR:');
  console.error(err.message);
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
