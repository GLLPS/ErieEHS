import { useState, useEffect, useMemo } from 'react';
import { useAirtableQuery } from '../hooks/useAirtable';
import {
  getClients,
  getComplianceDeadlines,
  getTrainingRecords,
  getEnvironmentalProfiles,
  getClientEmployees,
  getStaff,
} from '../services/airtable';
import StatCard from '../components/StatCard';
import StatusBadge from '../components/StatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { formatDate, countdownText, daysUntil } from '../utils/dates';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveNames(ids, lookup) {
  if (!ids || ids.length === 0) return '—';
  return ids.map((id) => lookup.get(id) || 'Unknown').join(', ');
}

// ---------------------------------------------------------------------------
// Client Sidebar
// ---------------------------------------------------------------------------

function ClientSidebar({ clients, activeId, onSelect, search, onSearchChange, overdueCounts }) {
  return (
    <aside className="w-64 flex-shrink-0 border-r border-slate-200 flex flex-col bg-slate-50/80">
      <div className="p-3 border-b border-slate-200">
        <input
          type="text"
          placeholder="Search clients..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white placeholder-slate-400"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {clients.map((c) => {
          const isActive = c.id === activeId;
          const name = c.fields['Client Name'] || 'Unnamed';
          const overdue = overdueCounts.get(c.id) || 0;
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={`w-full text-left px-3 py-2.5 border-b border-slate-100 transition-colors flex items-center justify-between gap-2 ${
                isActive
                  ? 'bg-blue-50 border-l-[3px] border-l-blue-500'
                  : 'hover:bg-white border-l-[3px] border-l-transparent'
              }`}
            >
              <span
                className={`text-sm truncate ${
                  isActive ? 'font-semibold text-blue-800' : 'text-slate-700'
                }`}
              >
                {name}
              </span>
              {overdue > 0 && (
                <span className="flex-shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold">
                  {overdue}
                </span>
              )}
            </button>
          );
        })}
        {clients.length === 0 && (
          <p className="text-xs text-slate-400 p-4 text-center">No clients found</p>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Client Detail — Header
// ---------------------------------------------------------------------------

function ClientHeader({ client, staffMap, employeeCount, profiles, overdueCount, expiringCount }) {
  const f = client.fields;
  const name = f['Client Name'] || 'Unknown Client';
  const status = f['Status'] || '—';
  const manager = resolveNames(f['Account Manager'] || f['GLE Account Manager'], staffMap);

  // Determine generator class from RCRA profile
  const genClass = useMemo(() => {
    for (const p of profiles) {
      const obl = p.fields['Obligation Type'] || '';
      if (obl.includes('RCRA')) {
        return p.fields['Generator Class'] || null;
      }
    }
    return null;
  }, [profiles]);

  const envLevel = f['Environmental Service Level'] || f['Env Service Level'] || null;
  const safetyLevel = f['Safety Service Level'] || null;

  return (
    <div className="border-b border-slate-200 px-6 py-4 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-1.5">
            <h2 className="text-xl font-bold text-slate-800 truncate">{name}</h2>
            <StatusBadge status={status} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>
              Manager: <strong className="text-slate-700">{manager}</strong>
            </span>
            {genClass && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold text-[10px]">
                {genClass}
              </span>
            )}
            <span>{employeeCount} employees</span>
            {envLevel && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-600 font-medium text-[10px] border border-blue-200">
                ENV: {envLevel}
              </span>
            )}
            {safetyLevel && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-50 text-purple-600 font-medium text-[10px] border border-purple-200">
                SAFE: {safetyLevel}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {overdueCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-700">
              <span className="font-bold">{overdueCount}</span> overdue
            </span>
          )}
          {expiringCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-700">
              <span className="font-bold">{expiringCount}</span> expiring
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Environmental Section
// ---------------------------------------------------------------------------

function EnvironmentalSection({ profiles, deadlines }) {
  const overdueDeadlines = deadlines.filter((d) => {
    const days = daysUntil(d.fields['Due Date']);
    return d.fields['Status'] === 'Overdue' || (days !== null && days < 0);
  });
  const upcomingDeadlines = deadlines.filter((d) => {
    const days = daysUntil(d.fields['Due Date']);
    return days !== null && days >= 0;
  });
  const sortedDeadlines = [...overdueDeadlines, ...upcomingDeadlines];

  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wide text-blue-700 border-l-4 border-blue-500 pl-2 mb-3">
        Environmental
      </h3>

      {/* Obligation type cards */}
      {profiles.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 mb-4">
          {profiles.map((p) => {
            const pf = p.fields;
            const oblType = pf['Obligation Type'] || pf['Profile Type'] || 'Profile';
            const status = pf['Status'] || '—';
            const isActive = status === 'Active' || status === 'Current';
            return (
              <div
                key={p.id}
                className={`rounded-lg border px-3 py-2 ${
                  isActive
                    ? 'border-blue-200 bg-blue-50/50'
                    : 'border-slate-200 bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-slate-700 truncate">{oblType}</span>
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      isActive ? 'bg-green-500' : 'bg-slate-300'
                    }`}
                  />
                </div>
                {pf['Generator Class'] && (
                  <span className="text-[10px] text-slate-500">{pf['Generator Class']}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {profiles.length === 0 && (
        <p className="text-sm text-slate-400 italic mb-4">No environmental profiles on file.</p>
      )}

      {/* Deadlines */}
      {sortedDeadlines.length > 0 && (
        <>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Deadlines
          </h4>
          <div className="space-y-1.5 mb-2">
            {sortedDeadlines.slice(0, 8).map((d) => {
              const df = d.fields;
              const days = daysUntil(df['Due Date']);
              const isOverdue = days !== null && days < 0;
              return (
                <div
                  key={d.id}
                  className={`flex items-center gap-3 text-xs rounded-md px-3 py-2 ${
                    isOverdue ? 'bg-red-50 border border-red-100' : 'bg-slate-50 border border-slate-100'
                  }`}
                >
                  <span className="font-medium text-slate-700 flex-1 truncate">
                    {df['Deadline Name'] || df['Name'] || '—'}
                  </span>
                  <span className="text-slate-500 flex-shrink-0">{formatDate(df['Due Date'])}</span>
                  <StatusBadge status={df['Status']} />
                  <span
                    className={`font-semibold flex-shrink-0 ${
                      isOverdue ? 'text-red-600' : days !== null && days <= 7 ? 'text-orange-600' : 'text-slate-500'
                    }`}
                  >
                    {countdownText(df['Due Date'])}
                  </span>
                </div>
              );
            })}
          </div>
          {sortedDeadlines.length > 8 && (
            <p className="text-[10px] text-slate-400 pl-3">
              +{sortedDeadlines.length - 8} more deadlines
            </p>
          )}
        </>
      )}

      {sortedDeadlines.length === 0 && profiles.length > 0 && (
        <p className="text-xs text-slate-400 italic">No pending deadlines.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Safety Section
// ---------------------------------------------------------------------------

function SafetySection({ training }) {
  // Get unique training categories
  const categories = useMemo(() => {
    const cats = new Set();
    for (const t of training) {
      const type = t.fields['Program Type'] || t.fields['Type'] || null;
      if (type) cats.add(type);
    }
    return [...cats];
  }, [training]);

  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wide text-purple-700 border-l-4 border-purple-500 pl-2 mb-3">
        Safety
      </h3>

      {/* Training category badges */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {categories.map((cat) => (
            <span
              key={cat}
              className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-700 border border-purple-200"
            >
              {cat}
            </span>
          ))}
        </div>
      )}

      {/* Overdue/expiring training items */}
      {training.length > 0 ? (
        <>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Overdue / Expiring Training ({training.length})
          </h4>
          <div className="space-y-1.5">
            {training.slice(0, 10).map((t) => {
              const tf = t.fields;
              const status = tf['Status'] || '—';
              const isOverdue =
                status === 'Expired/Overdue' || status === 'Overdue' || status === 'Expired';
              const empName = tf['Employee Name'] || tf['Employee'] || '—';
              const progName =
                tf['Program Name'] || tf['Training Program'] || tf['Name'] || '—';
              const expDate = tf['Expiration Date'] || tf['Due Date'] || tf['Next Due Date'];
              return (
                <div
                  key={t.id}
                  className={`flex items-center gap-3 text-xs rounded-md px-3 py-2 ${
                    isOverdue
                      ? 'bg-red-50 border border-red-100'
                      : 'bg-yellow-50 border border-yellow-100'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      isOverdue ? 'bg-red-500' : 'bg-yellow-500'
                    }`}
                  />
                  <span className="font-medium text-slate-700 truncate">
                    {Array.isArray(empName) ? empName.join(', ') : empName}
                  </span>
                  <span className="text-slate-500 truncate flex-1">{progName}</span>
                  <StatusBadge status={status} />
                  {expDate && (
                    <span className="text-slate-400 flex-shrink-0">{formatDate(expDate)}</span>
                  )}
                </div>
              );
            })}
          </div>
          {training.length > 10 && (
            <p className="text-[10px] text-slate-400 pl-3 mt-1">
              +{training.length - 10} more items
            </p>
          )}
        </>
      ) : (
        <p className="text-xs text-slate-400 italic">No overdue or expiring training items.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Client Detail Panel
// ---------------------------------------------------------------------------

function ClientDetail({
  client,
  deadlines,
  training,
  profiles,
  employeeCount,
  staffMap,
  overdueCount,
  expiringCount,
  onViewFull,
}) {
  return (
    <div className="h-full flex flex-col">
      <ClientHeader
        client={client}
        staffMap={staffMap}
        employeeCount={employeeCount}
        profiles={profiles}
        overdueCount={overdueCount}
        expiringCount={expiringCount}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <EnvironmentalSection profiles={profiles} deadlines={deadlines} staffMap={staffMap} />
        <SafetySection training={training} />

        {/* View Full Profile link */}
        {onViewFull && (
          <div className="pt-2">
            <button
              onClick={onViewFull}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium hover:underline transition-colors"
            >
              View Full Client Profile &rarr;
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function ActionRequired({ onClientSelect }) {
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [sidebarSearch, setSidebarSearch] = useState('');

  // ---- Data fetching ----
  const { data: clients, loading: l1, error: e1 } = useAirtableQuery(() => getClients(), []);
  const { data: deadlines, loading: l2, error: e2 } = useAirtableQuery(
    () => getComplianceDeadlines(),
    []
  );
  const { data: trainingRecords, loading: l3, error: e3 } = useAirtableQuery(
    () => getTrainingRecords(),
    []
  );
  const { data: envProfiles, loading: l4, error: e4 } = useAirtableQuery(
    () => getEnvironmentalProfiles(),
    []
  );
  const { data: employees, loading: l5, error: e5 } = useAirtableQuery(
    () => getClientEmployees(),
    []
  );
  const { data: staff, loading: l6, error: e6 } = useAirtableQuery(() => getStaff(), []);

  // ---- Staff lookup ----
  const staffMap = useMemo(() => {
    const map = new Map();
    for (const s of staff) map.set(s.id, s.fields['Name'] || 'Unknown');
    return map;
  }, [staff]);

  // ---- Overdue counts per client ----
  const clientOverdueCounts = useMemo(() => {
    const counts = new Map();

    for (const d of deadlines) {
      const clientIds = d.fields['Client'] || [];
      const status = d.fields['Status'];
      const days = daysUntil(d.fields['Due Date']);
      const isOverdue =
        status === 'Overdue' ||
        (status !== 'Completed' && status !== 'N/A' && days !== null && days < 0);
      if (isOverdue) {
        for (const cid of clientIds) {
          counts.set(cid, (counts.get(cid) || 0) + 1);
        }
      }
    }

    for (const t of trainingRecords) {
      const clientIds = t.fields['Client'] || [];
      const status = t.fields['Status'];
      if (status === 'Expired/Overdue' || status === 'Overdue' || status === 'Expired') {
        for (const cid of clientIds) {
          counts.set(cid, (counts.get(cid) || 0) + 1);
        }
      }
    }

    return counts;
  }, [deadlines, trainingRecords]);

  // ---- Expiring counts per client ----
  const clientExpiringCounts = useMemo(() => {
    const counts = new Map();
    for (const t of trainingRecords) {
      const clientIds = t.fields['Client'] || [];
      const status = t.fields['Status'];
      if (status === 'Expiring Soon') {
        for (const cid of clientIds) {
          counts.set(cid, (counts.get(cid) || 0) + 1);
        }
      }
    }
    return counts;
  }, [trainingRecords]);

  // ---- Active clients sorted by overdue count ----
  const activeClients = useMemo(() => {
    return clients
      .filter((c) => c.fields['Status'] === 'Active')
      .sort((a, b) => {
        const countA = clientOverdueCounts.get(a.id) || 0;
        const countB = clientOverdueCounts.get(b.id) || 0;
        if (countB !== countA) return countB - countA;
        return (a.fields['Client Name'] || '').localeCompare(b.fields['Client Name'] || '');
      });
  }, [clients, clientOverdueCounts]);

  // ---- Filtered clients for sidebar ----
  const filteredClients = useMemo(() => {
    if (!sidebarSearch) return activeClients;
    const q = sidebarSearch.toLowerCase();
    return activeClients.filter((c) =>
      (c.fields['Client Name'] || '').toLowerCase().includes(q)
    );
  }, [activeClients, sidebarSearch]);

  // ---- Auto-select first client ----
  useEffect(() => {
    if (!selectedClientId && activeClients.length > 0) {
      setSelectedClientId(activeClients[0].id);
    }
  }, [activeClients, selectedClientId]);

  // ---- Selected client record ----
  const selectedClient = clients.find((c) => c.id === selectedClientId);

  // ---- Data filtered for selected client ----
  const clientDeadlines = useMemo(() => {
    if (!selectedClientId) return [];
    return deadlines
      .filter((d) => (d.fields['Client'] || []).includes(selectedClientId))
      .filter((d) => d.fields['Status'] !== 'Completed' && d.fields['Status'] !== 'N/A')
      .sort((a, b) => {
        const da = daysUntil(a.fields['Due Date']);
        const db = daysUntil(b.fields['Due Date']);
        if (da === null && db === null) return 0;
        if (da === null) return 1;
        if (db === null) return -1;
        return da - db;
      });
  }, [selectedClientId, deadlines]);

  const clientTraining = useMemo(() => {
    if (!selectedClientId) return [];
    return trainingRecords.filter((t) => {
      if (!(t.fields['Client'] || []).includes(selectedClientId)) return false;
      const s = t.fields['Status'];
      return s === 'Expired/Overdue' || s === 'Expiring Soon' || s === 'Overdue' || s === 'Expired';
    });
  }, [selectedClientId, trainingRecords]);

  const clientProfiles = useMemo(() => {
    if (!selectedClientId) return [];
    return envProfiles.filter((p) => (p.fields['Client'] || []).includes(selectedClientId));
  }, [selectedClientId, envProfiles]);

  const clientEmployeeCount = useMemo(() => {
    if (!selectedClientId) return 0;
    return employees.filter(
      (e) =>
        (e.fields['Client'] || []).includes(selectedClientId) && e.fields['Status'] === 'Active'
    ).length;
  }, [selectedClientId, employees]);

  // ---- Summary stats ----
  const stats = useMemo(() => {
    const totalOverdue = [...clientOverdueCounts.values()].reduce((a, b) => a + b, 0);
    const activeCount = activeClients.length;
    const activeEmpCount = employees.filter((e) => e.fields['Status'] === 'Active').length;

    const lqgClientIds = new Set();
    envProfiles.forEach((p) => {
      const obligation = p.fields?.['Obligation Type'] || '';
      const genClass = p.fields?.['Generator Class'] || '';
      if (obligation.includes('RCRA') && genClass === 'LQG') {
        const linked = p.fields?.Client || [];
        linked.forEach((id) => lqgClientIds.add(id));
      }
    });

    return { totalOverdue, activeCount, activeEmpCount, lqgCount: lqgClientIds.size };
  }, [clientOverdueCounts, activeClients, employees, envProfiles]);

  // ---- Loading / Error ----
  const isLoading = l1 || l2 || l3 || l4 || l5 || l6;
  const errors = [e1, e2, e3, e4, e5, e6].filter(Boolean);

  if (isLoading) {
    return <LoadingSpinner message="Loading dashboard..." />;
  }

  if (errors.length > 0) {
    return <ErrorMessage message={`Failed to load data: ${errors[0]}`} />;
  }

  return (
    <div className="space-y-4">
      {/* Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Overdue" value={stats.totalOverdue} sublabel="Action items" color="red" />
        <StatCard
          label="Active Clients"
          value={stats.activeCount}
          sublabel="Under management"
          color="blue"
        />
        <StatCard
          label="Employees Tracked"
          value={stats.activeEmpCount}
          sublabel="Active employees"
          color="purple"
        />
        <StatCard
          label="LQG Facilities"
          value={stats.lqgCount}
          sublabel="Large Quantity Generators"
          color="yellow"
        />
      </div>

      {/* Main Layout: Sidebar + Detail */}
      <div
        className="flex bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden"
        style={{ height: 'calc(100vh - 280px)', minHeight: '500px' }}
      >
        {/* Client Sidebar */}
        <ClientSidebar
          clients={filteredClients}
          activeId={selectedClientId}
          onSelect={setSelectedClientId}
          search={sidebarSearch}
          onSearchChange={setSidebarSearch}
          overdueCounts={clientOverdueCounts}
        />

        {/* Client Detail */}
        <div className="flex-1 overflow-hidden">
          {selectedClient ? (
            <ClientDetail
              client={selectedClient}
              deadlines={clientDeadlines}
              training={clientTraining}
              profiles={clientProfiles}
              employeeCount={clientEmployeeCount}
              staffMap={staffMap}
              overdueCount={clientOverdueCounts.get(selectedClientId) || 0}
              expiringCount={clientExpiringCounts.get(selectedClientId) || 0}
              onViewFull={
                onClientSelect ? () => onClientSelect(selectedClientId) : null
              }
            />
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400">
              <div className="text-center">
                <svg
                  className="w-12 h-12 mx-auto text-slate-300 mb-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
                  />
                </svg>
                <p className="text-sm font-medium">Select a client to view action items</p>
                <p className="text-xs mt-1">Choose a client from the sidebar</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
