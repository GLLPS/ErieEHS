import { useState, useEffect, useMemo } from 'react';
import { useAirtableQuery } from '../hooks/useAirtable';
import { getClients, getClientEmployees, getSafetyPrograms, getTrainingRecords, TABLES } from '../services/airtable';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { formatDate, daysUntil } from '../utils/dates';
import { TRAINING_STATUS_COLORS } from '../utils/status';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Determine the training status for a single cell based on dates. */
function deriveStatus(record) {
  if (!record) return null;

  const status = record.fields['Status'];
  // If an explicit status is stored, honour it when it is "Scheduled" or "Waived".
  if (status === 'Scheduled') return 'Scheduled';
  if (status === 'Waived') return 'Waived';

  const expiration = record.fields['Expiration Date'] || record.fields['Expiry Date'];
  if (!expiration) {
    // No expiration recorded -- treat as current if there is a completion date.
    return record.fields['Completion Date'] ? 'Current' : 'Scheduled';
  }

  const days = daysUntil(expiration);
  if (days === null) return 'Current';
  if (days < 0) return 'Expired/Overdue';
  if (days <= 60) return 'Expiring Soon';
  return 'Current';
}

/** Return the most recent record from an array of training records. */
function mostRecent(records) {
  if (!records || records.length === 0) return null;
  return records.reduce((latest, r) => {
    const dateA = latest.fields['Completion Date'] || latest.fields['Training Date'] || '';
    const dateB = r.fields['Completion Date'] || r.fields['Training Date'] || '';
    return dateB > dateA ? r : latest;
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Colour-coded legend row. */
function Legend() {
  const items = [
    { label: 'Current', cls: TRAINING_STATUS_COLORS['Current'] },
    { label: 'Expiring Soon', cls: TRAINING_STATUS_COLORS['Expiring Soon'] },
    { label: 'Expired / Overdue', cls: TRAINING_STATUS_COLORS['Expired/Overdue'] },
    { label: 'Scheduled', cls: TRAINING_STATUS_COLORS['Scheduled'] },
    { label: 'Not Required', cls: TRAINING_STATUS_COLORS['Not Required'] },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span className={`inline-block w-4 h-4 rounded ${item.cls}`} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/** Tooltip wrapper for matrix cells. */
function CellTooltip({ record, children }) {
  if (!record) return children;

  const trainingType = record.fields['Training Type'] || record.fields['Type'] || '—';
  const completionDate = formatDate(record.fields['Completion Date'] || record.fields['Training Date']);
  const expirationDate = formatDate(record.fields['Expiration Date'] || record.fields['Expiry Date']);
  const trainer = record.fields['Trainer'] || record.fields['Instructor'] || '—';
  const certNumber = record.fields['Certification Number'] || record.fields['Cert Number'] || record.fields['Certificate #'] || '—';

  return (
    <div className="group relative">
      {children}
      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 hidden group-hover:block">
        <div className="bg-slate-800 text-white text-xs rounded-lg shadow-lg px-3 py-2 whitespace-nowrap">
          <p className="font-semibold mb-1">{trainingType}</p>
          <p>Completed: {completionDate}</p>
          <p>Expires: {expirationDate}</p>
          <p>Trainer: {Array.isArray(trainer) ? trainer.join(', ') : trainer}</p>
          <p>Cert #: {certNumber}</p>
          {/* small arrow */}
          <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-slate-800" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function TrainingMatrix() {
  // ------ state ------
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [trainingRecords, setTrainingRecords] = useState([]);
  const [clientDataLoading, setClientDataLoading] = useState(false);
  const [clientDataError, setClientDataError] = useState(null);

  // ------ fetch active clients ------
  const {
    data: clients,
    loading: clientsLoading,
    error: clientsError,
    refetch: refetchClients,
  } = useAirtableQuery(() => getClients('{Status} = "Active"'), []);

  // ------ fetch client-specific data when selection changes ------
  useEffect(() => {
    if (!selectedClientId) {
      setEmployees([]);
      setPrograms([]);
      setTrainingRecords([]);
      return;
    }

    let cancelled = false;
    async function load() {
      setClientDataLoading(true);
      setClientDataError(null);
      try {
        const clientFilter = `FIND("${selectedClientId}", ARRAYJOIN({Client}))`;

        const [empResult, progResult, trResult] = await Promise.all([
          getClientEmployees(clientFilter),
          getSafetyPrograms(clientFilter),
          getTrainingRecords(clientFilter),
        ]);

        if (!cancelled) {
          setEmployees(empResult);
          setPrograms(progResult);
          setTrainingRecords(trResult);
        }
      } catch (err) {
        if (!cancelled) setClientDataError(err.message);
      } finally {
        if (!cancelled) setClientDataLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [selectedClientId]);

  // ------ build matrix data ------
  const { matrix, complianceRate } = useMemo(() => {
    if (employees.length === 0 || programs.length === 0) {
      return { matrix: [], complianceRate: null };
    }

    // Build a lookup: (employeeId, programId) -> [records]
    const recordMap = new Map();
    for (const rec of trainingRecords) {
      const empIds = rec.fields['Employee'] || [];
      const progIds = rec.fields['Safety Program'] || [];
      for (const eId of empIds) {
        for (const pId of progIds) {
          const key = `${eId}::${pId}`;
          if (!recordMap.has(key)) recordMap.set(key, []);
          recordMap.get(key).push(rec);
        }
      }
    }

    // Build a set of program IDs for quick lookup
    const programIdSet = new Set(programs.map((p) => p.id));

    let totalRequired = 0;
    let totalCurrent = 0;

    const rows = employees.map((emp) => {
      const requiredProgramIds = (emp.fields['Required Programs'] || []).filter((id) =>
        programIdSet.has(id)
      );
      const requiredSet = new Set(requiredProgramIds);

      const cells = programs.map((prog) => {
        const isRequired = requiredSet.has(prog.id);
        const key = `${emp.id}::${prog.id}`;
        const matchingRecords = recordMap.get(key) || [];
        const latest = mostRecent(matchingRecords);
        const status = latest ? deriveStatus(latest) : (isRequired ? null : 'Not Required');

        // For compliance counting, only count required programs
        if (isRequired) {
          totalRequired++;
          if (status === 'Current') totalCurrent++;
        }

        return {
          programId: prog.id,
          isRequired,
          record: latest,
          status: status, // null means required but no record
        };
      });

      return {
        employeeId: emp.id,
        name: emp.fields['Employee Name'] || emp.fields['Name'] || 'Unnamed',
        jobTitle: emp.fields['Job Title'] || emp.fields['Position'] || '',
        cells,
      };
    });

    const rate = totalRequired > 0 ? Math.round((totalCurrent / totalRequired) * 100) : 0;

    return { matrix: rows, complianceRate: rate };
  }, [employees, programs, trainingRecords]);

  // ------ helpers ------
  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const clientName = selectedClient?.fields['Client Name'] || '';

  function getCellClasses(status) {
    if (!status) {
      // Required but no record -- show as a muted red to draw attention
      return 'bg-red-100 text-red-400';
    }
    return TRAINING_STATUS_COLORS[status] || TRAINING_STATUS_COLORS['Not Required'];
  }

  function getCellLabel(status) {
    if (!status) return '—';
    const labels = {
      Current: '\u2713',
      'Expiring Soon': '!',
      'Expired/Overdue': '\u2717',
      Scheduled: '\u25CB',
      Waived: 'W',
      'Not Required': '',
    };
    return labels[status] ?? '';
  }

  // ------ render ------

  // Loading clients
  if (clientsLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <LoadingSpinner message="Loading clients..." />
      </div>
    );
  }

  // Error loading clients
  if (clientsError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
        <ErrorMessage message={clientsError} onRetry={refetchClients} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* ---- Header ---- */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Training Compliance Matrix</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Track employee training status across all required safety programs
            </p>
          </div>
          {complianceRate !== null && (
            <div className="text-right">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Compliance Rate</p>
              <p
                className={`text-3xl font-bold ${
                  complianceRate >= 90
                    ? 'text-emerald-600'
                    : complianceRate >= 70
                    ? 'text-yellow-600'
                    : 'text-red-600'
                }`}
              >
                {complianceRate}%
              </p>
              {clientName && (
                <p className="text-xs text-slate-400 mt-0.5">{clientName}</p>
              )}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="mb-4">
          <Legend />
        </div>

        {/* Client selector pills */}
        <div className="flex flex-wrap gap-2">
          {clients.length === 0 && (
            <p className="text-sm text-slate-400 italic">No active clients found.</p>
          )}
          {clients.map((client) => {
            const isActive = client.id === selectedClientId;
            return (
              <button
                key={client.id}
                onClick={() => setSelectedClientId(client.id)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-offset-1 ${
                  isActive
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-purple-100 hover:text-purple-700'
                }`}
              >
                {client.fields['Client Name'] || client.id}
              </button>
            );
          })}
        </div>
      </header>

      {/* ---- Body ---- */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* No client selected empty state */}
        {!selectedClientId && (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-12">
            <svg className="w-16 h-16 mb-4 text-purple-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
            </svg>
            <p className="text-lg font-medium">Select a client to view the training matrix</p>
            <p className="text-sm mt-1">Choose a client tab above to get started</p>
          </div>
        )}

        {/* Client data loading */}
        {selectedClientId && clientDataLoading && (
          <div className="flex-1 flex items-center justify-center">
            <LoadingSpinner message="Loading training data..." />
          </div>
        )}

        {/* Client data error */}
        {selectedClientId && clientDataError && (
          <div className="flex-1 flex items-center justify-center p-8">
            <ErrorMessage
              message={clientDataError}
              onRetry={() => setSelectedClientId(selectedClientId)}
            />
          </div>
        )}

        {/* No data after load */}
        {selectedClientId && !clientDataLoading && !clientDataError && matrix.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-12">
            <svg className="w-14 h-14 mb-3 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            <p className="text-lg font-medium">No training data available</p>
            <p className="text-sm mt-1">
              {employees.length === 0
                ? 'No employees found for this client.'
                : 'No safety programs found for this client.'}
            </p>
          </div>
        )}

        {/* ---- Matrix grid ---- */}
        {selectedClientId && !clientDataLoading && !clientDataError && matrix.length > 0 && (
          <div className="flex-1 overflow-auto relative">
            <table className="border-collapse min-w-full">
              {/* ---- Header row ---- */}
              <thead>
                <tr>
                  {/* Top-left corner cell -- sticky both ways */}
                  <th
                    className="sticky top-0 left-0 z-30 bg-white border-b-2 border-r-2 border-slate-200 px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide min-w-[200px]"
                  >
                    Employee
                  </th>
                  {programs.map((prog) => (
                    <th
                      key={prog.id}
                      className="sticky top-0 z-20 bg-white border-b-2 border-slate-200 px-1 py-2 text-center min-w-[56px] max-w-[72px]"
                    >
                      <div
                        className="transform -rotate-45 origin-center whitespace-nowrap text-[10px] font-medium text-slate-600 leading-tight truncate max-w-[90px]"
                        title={prog.fields['Program Name'] || prog.fields['Name'] || ''}
                      >
                        {prog.fields['Program Name'] || prog.fields['Name'] || 'Program'}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              {/* ---- Body rows ---- */}
              <tbody>
                {matrix.map((row, rowIdx) => (
                  <tr
                    key={row.employeeId}
                    className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}
                  >
                    {/* Sticky employee name column */}
                    <td
                      className={`sticky left-0 z-10 border-r-2 border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 whitespace-nowrap min-w-[200px] ${
                        rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50'
                      }`}
                    >
                      <div>{row.name}</div>
                      {row.jobTitle && (
                        <div className="text-[10px] text-slate-400 font-normal">{row.jobTitle}</div>
                      )}
                    </td>

                    {/* Data cells */}
                    {row.cells.map((cell) => {
                      const cellClasses = getCellClasses(cell.status);
                      const label = getCellLabel(cell.status);

                      return (
                        <td
                          key={cell.programId}
                          className="px-0 py-0 border border-slate-100 text-center"
                        >
                          <CellTooltip record={cell.record}>
                            <div
                              className={`w-full h-full min-h-[36px] flex items-center justify-center text-xs font-bold cursor-default transition-opacity duration-100 hover:opacity-80 ${cellClasses}`}
                            >
                              {label}
                            </div>
                          </CellTooltip>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* ---- Footer summary bar ---- */}
      {selectedClientId && !clientDataLoading && !clientDataError && matrix.length > 0 && (
        <footer className="flex-shrink-0 bg-white border-t border-slate-200 px-6 py-3 flex items-center justify-between text-xs text-slate-500">
          <div className="flex gap-6">
            <span>
              <span className="font-semibold text-slate-700">{employees.length}</span> Employees
            </span>
            <span>
              <span className="font-semibold text-slate-700">{programs.length}</span> Programs
            </span>
            <span>
              <span className="font-semibold text-slate-700">{trainingRecords.length}</span> Training Records
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span>Overall Compliance:</span>
            <span
              className={`text-sm font-bold ${
                complianceRate >= 90
                  ? 'text-emerald-600'
                  : complianceRate >= 70
                  ? 'text-yellow-600'
                  : 'text-red-600'
              }`}
            >
              {complianceRate}%
            </span>
            <div className="w-32 h-2 bg-slate-200 rounded-full overflow-hidden ml-1">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  complianceRate >= 90
                    ? 'bg-emerald-500'
                    : complianceRate >= 70
                    ? 'bg-yellow-400'
                    : 'bg-red-500'
                }`}
                style={{ width: `${complianceRate}%` }}
              />
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
