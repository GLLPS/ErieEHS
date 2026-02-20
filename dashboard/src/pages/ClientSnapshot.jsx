import { useState, useEffect, useMemo } from 'react';
import { useAirtableQuery } from '../hooks/useAirtable';
import * as api from '../services/airtable';
import StatusBadge from '../components/StatusBadge';
import CategoryBadge from '../components/CategoryBadge';
import StatCard from '../components/StatCard';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { formatDate, countdownText, daysUntil } from '../utils/dates';
import { TRAINING_STATUS_COLORS } from '../utils/status';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SectionHeading({ title, accent = 'blue', children }) {
  const accents = {
    blue: 'border-blue-500 text-blue-800',
    purple: 'border-purple-500 text-purple-800',
    orange: 'border-orange-500 text-orange-800',
    slate: 'border-slate-400 text-slate-700',
  };
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className={`text-sm font-bold uppercase tracking-wide border-l-4 pl-2 ${accents[accent] || accents.blue}`}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function Pill({ label, value, color = 'slate' }) {
  const colors = {
    red: 'bg-red-100 text-red-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    orange: 'bg-orange-100 text-orange-700',
    green: 'bg-green-100 text-green-700',
    blue: 'bg-blue-100 text-blue-700',
    slate: 'bg-slate-100 text-slate-600',
  };
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${colors[color] || colors.slate}`}>
      <span className="font-bold">{value}</span> {label}
    </span>
  );
}

function resolveStaffName(staffMap, ids) {
  if (!ids || ids.length === 0) return '—';
  return ids.map((id) => staffMap.get(id) || 'Unknown').join(', ');
}

function Panel({ children, className = '' }) {
  return (
    <div className={`bg-white rounded-lg border border-slate-200 shadow-sm p-5 ${className}`}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ClientSidebar({ clients, activeId, onSelect, search, onSearchChange }) {
  const overdueByClient = useMemo(() => {
    // The sidebar simply shows a list — the overdue count is computed externally
    // and passed through the clients array. We keep it simple.
    return {};
  }, []);

  const filtered = useMemo(() => {
    if (!clients || clients.length === 0) return [];
    let list = [...clients].sort((a, b) =>
      (a.fields['Client Name'] || '').localeCompare(b.fields['Client Name'] || '')
    );
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((c) =>
        (c.fields['Client Name'] || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [clients, search]);

  return (
    <aside className="w-64 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col h-full overflow-hidden">
      <div className="p-3 border-b border-slate-100">
        <input
          type="text"
          placeholder="Search clients..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-slate-50"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.map((c) => {
          const isActive = c.id === activeId;
          const name = c.fields['Client Name'] || 'Unnamed';
          const status = c.fields['Status'];
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={`w-full text-left px-3 py-2 border-b border-slate-50 transition-colors ${
                isActive
                  ? 'bg-blue-50 border-l-2 border-l-blue-500'
                  : 'hover:bg-slate-50 border-l-2 border-l-transparent'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className={`text-sm truncate ${isActive ? 'font-semibold text-blue-800' : 'text-slate-700'}`}>
                  {name}
                </span>
                {status && status !== 'Active' && (
                  <span className="text-[10px] text-slate-400 flex-shrink-0">{status}</span>
                )}
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-xs text-slate-400 p-4 text-center">No clients found</p>
        )}
      </div>
    </aside>
  );
}

function HeaderBar({ client, staffMap, overdueDeadlines, expiringTraining, upcomingVisits }) {
  const f = client.fields;
  const name = f['Client Name'] || 'Unknown Client';
  const status = f['Status'] || '—';
  const accountMgr = resolveStaffName(staffMap, f['Account Manager']);
  const envLevel = f['Environmental Service Level'] || f['Env Service Level'] || '—';
  const safetyLevel = f['Safety Service Level'] || '—';

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 mb-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        {/* Left: Name & info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-bold text-slate-800 truncate">{name}</h1>
            <StatusBadge status={status} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>Account Manager: <strong className="text-slate-700">{accountMgr}</strong></span>
            <span className="flex items-center gap-1">
              <CategoryBadge category="ENV" />
              {envLevel}
            </span>
            <span className="flex items-center gap-1">
              <CategoryBadge category="SAFE" />
              {safetyLevel}
            </span>
          </div>
        </div>

        {/* Right: Quick stat pills */}
        <div className="flex flex-wrap items-center gap-2">
          <Pill
            value={overdueDeadlines}
            label="overdue deadlines"
            color={overdueDeadlines > 0 ? 'red' : 'green'}
          />
          <Pill
            value={expiringTraining}
            label="expiring training"
            color={expiringTraining > 0 ? 'yellow' : 'green'}
          />
          <Pill
            value={upcomingVisits}
            label="upcoming visits"
            color={upcomingVisits > 0 ? 'blue' : 'slate'}
          />
        </div>
      </div>
    </div>
  );
}

function EnvironmentalPanel({ profiles, deadlines, staffMap }) {
  const sortedDeadlines = useMemo(() => {
    return [...deadlines].sort((a, b) => {
      const da = a.fields['Due Date'] || '9999-12-31';
      const db = b.fields['Due Date'] || '9999-12-31';
      return da.localeCompare(db);
    });
  }, [deadlines]);

  return (
    <Panel>
      <SectionHeading title="Environmental Profiles" accent="blue" />

      {profiles.length === 0 ? (
        <p className="text-sm text-slate-400 italic">No environmental profiles on file.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-5">
          {profiles.map((p) => {
            const f = p.fields;
            return (
              <div
                key={p.id}
                className="border border-blue-100 bg-blue-50/30 rounded-lg p-3"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-blue-700 uppercase">
                    {f['Obligation Type'] || f['Profile Type'] || 'Profile'}
                  </span>
                  <StatusBadge status={f['Status']} />
                </div>
                {f['Permit Number'] && (
                  <p className="text-xs text-slate-500 mb-1">
                    Permit: <span className="font-mono text-slate-700">{f['Permit Number']}</span>
                  </p>
                )}
                <p className="text-xs text-slate-600 line-clamp-2">
                  {f['Description'] || f['Notes'] || '—'}
                </p>
                {f['Document URL'] && (
                  <a
                    href={f['Document URL']}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-blue-500 hover:underline mt-1 inline-block"
                  >
                    View Document
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}

      <SectionHeading title="Compliance Deadlines" accent="blue" />

      {sortedDeadlines.length === 0 ? (
        <p className="text-sm text-slate-400 italic">No compliance deadlines found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500 uppercase tracking-wide">
                <th className="py-2 pr-3 font-semibold">Deadline</th>
                <th className="py-2 pr-3 font-semibold">Due Date</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 pr-3 font-semibold">Assigned To</th>
                <th className="py-2 font-semibold">Countdown</th>
              </tr>
            </thead>
            <tbody>
              {sortedDeadlines.map((d) => {
                const f = d.fields;
                const days = daysUntil(f['Due Date']);
                const rowUrgency =
                  days !== null && days < 0
                    ? 'bg-red-50'
                    : days !== null && days <= 7
                    ? 'bg-yellow-50'
                    : '';
                return (
                  <tr key={d.id} className={`border-b border-slate-100 ${rowUrgency}`}>
                    <td className="py-1.5 pr-3 font-medium text-slate-700">
                      {f['Deadline Name'] || f['Name'] || '—'}
                    </td>
                    <td className="py-1.5 pr-3 text-slate-600">{formatDate(f['Due Date'])}</td>
                    <td className="py-1.5 pr-3">
                      <StatusBadge status={f['Status']} />
                    </td>
                    <td className="py-1.5 pr-3 text-slate-600">
                      {resolveStaffName(staffMap, f['Assigned To'])}
                    </td>
                    <td className="py-1.5 font-semibold">
                      <span
                        className={
                          days !== null && days < 0
                            ? 'text-red-600'
                            : days !== null && days <= 7
                            ? 'text-yellow-600'
                            : 'text-slate-600'
                        }
                      >
                        {countdownText(f['Due Date'])}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function SafetyPanel({ programs, expiringTrainingCount }) {
  return (
    <Panel>
      <SectionHeading title="Safety Programs" accent="purple" />

      {programs.length === 0 ? (
        <p className="text-sm text-slate-400 italic">No safety programs on file.</p>
      ) : (
        <div className="space-y-2 mb-4">
          {programs.map((p) => {
            const f = p.fields;
            return (
              <div
                key={p.id}
                className="flex items-center justify-between border border-purple-100 bg-purple-50/30 rounded-lg px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-slate-700">
                    {f['Program Name'] || f['Name'] || '—'}
                  </span>
                  {f['Description'] && (
                    <p className="text-xs text-slate-500 truncate">{f['Description']}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                  <StatusBadge status={f['Status']} />
                  {f['Document URL'] && (
                    <a
                      href={f['Document URL']}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-purple-500 hover:underline"
                    >
                      Doc
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2 bg-purple-50 border border-purple-100 rounded-lg px-3 py-2">
        <span className="text-xs text-purple-700 font-medium">
          Training summary:
        </span>
        <Pill
          value={expiringTrainingCount}
          label="overdue / expiring"
          color={expiringTrainingCount > 0 ? 'red' : 'green'}
        />
      </div>
    </Panel>
  );
}

function WhatsNextPanel({ activities, staffMap }) {
  const today = new Date().toISOString().slice(0, 10);

  const sorted = useMemo(() => {
    return [...activities].sort((a, b) => {
      const da = a.fields['Date'] || a.fields['Activity Date'] || '';
      const db = b.fields['Date'] || b.fields['Activity Date'] || '';
      return da.localeCompare(db);
    });
  }, [activities]);

  const pastVisits = sorted.filter((a) => {
    const d = a.fields['Date'] || a.fields['Activity Date'] || '';
    return d && d <= today;
  });
  const futureVisits = sorted.filter((a) => {
    const d = a.fields['Date'] || a.fields['Activity Date'] || '';
    return d && d > today;
  });

  const lastVisit = pastVisits.length > 0 ? pastVisits[pastVisits.length - 1] : null;
  const nextVisit = futureVisits.length > 0 ? futureVisits[0] : null;
  const futureVisit = futureVisits.length > 1 ? futureVisits[1] : null;

  function VisitCard({ label, visit, accent }) {
    if (!visit) {
      return (
        <div className={`flex-1 border rounded-lg p-4 bg-slate-50 border-slate-200`}>
          <p className="text-xs font-bold text-slate-400 uppercase mb-1">{label}</p>
          <p className="text-sm text-slate-400 italic">None found</p>
        </div>
      );
    }
    const f = visit.fields;
    const dateStr = f['Date'] || f['Activity Date'] || '';
    const task = f['Task'] || f['Activity Type'] || f['Description'] || '—';
    const staff = resolveStaffName(staffMap, f['Assigned To'] || f['Staff']);
    const days = daysUntil(dateStr);
    const accentMap = {
      blue: 'border-blue-300 bg-blue-50',
      orange: 'border-orange-300 bg-orange-50',
      slate: 'border-slate-200 bg-slate-50',
    };

    return (
      <div className={`flex-1 border rounded-lg p-4 ${accentMap[accent] || accentMap.slate}`}>
        <p className="text-xs font-bold text-slate-500 uppercase mb-2">{label}</p>
        <p className="text-lg font-bold text-slate-800">{formatDate(dateStr)}</p>
        <p className="text-sm text-slate-600 mt-1">{task}</p>
        <p className="text-xs text-slate-500 mt-1">Staff: {staff}</p>
        <p className="text-xs font-semibold mt-2">
          <span
            className={
              days !== null && days < 0
                ? 'text-slate-400'
                : days !== null && days <= 7
                ? 'text-orange-600'
                : 'text-blue-600'
            }
          >
            {days !== null
              ? days < 0
                ? `${Math.abs(days)} days ago`
                : days === 0
                ? 'Today'
                : `In ${days} days`
              : '—'}
          </span>
        </p>
      </div>
    );
  }

  return (
    <Panel>
      <SectionHeading title="What's Next" accent="orange" />
      <div className="flex flex-col md:flex-row gap-3">
        <VisitCard label="Last Visit" visit={lastVisit} accent="slate" />
        <VisitCard label="Next Visit" visit={nextVisit} accent="orange" />
        <VisitCard label="Future Visit" visit={futureVisit} accent="blue" />
      </div>
    </Panel>
  );
}

function TrainingMatrixPanel({ employees, programs, trainingRecords }) {
  // Build a mapping of program names that are required, from the safety programs list
  const requiredPrograms = useMemo(() => {
    const names = [];
    const seen = new Set();
    for (const p of programs) {
      const name = p.fields['Program Name'] || p.fields['Name'];
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push({ id: p.id, name });
      }
    }
    return names;
  }, [programs]);

  // Build a lookup: { employeeRecordId: { programName: trainingRecord } }
  const trainingLookup = useMemo(() => {
    const lookup = {};
    for (const tr of trainingRecords) {
      const f = tr.fields;
      // Employee link is typically an array of record IDs
      const empIds = f['Employee'] || f['Client Employee'] || [];
      const progName =
        f['Program Name'] ||
        f['Training Program'] ||
        f['Program'] ||
        '';
      const status = f['Status'] || '';

      for (const empId of empIds) {
        if (!lookup[empId]) lookup[empId] = {};
        // Keep the most relevant record (prioritize non-expired over expired if duplicates)
        const existing = lookup[empId][progName];
        if (
          !existing ||
          statusPriority(status) > statusPriority(existing.fields['Status'])
        ) {
          lookup[empId][progName] = tr;
        }
      }
    }
    return lookup;
  }, [trainingRecords]);

  // Compute compliance stats
  const { totalCells, compliantCells } = useMemo(() => {
    let total = 0;
    let compliant = 0;
    for (const emp of employees) {
      for (const prog of requiredPrograms) {
        total++;
        const tr = trainingLookup[emp.id]?.[prog.name];
        const status = tr?.fields['Status'] || '';
        if (status === 'Current' || status === 'Scheduled') {
          compliant++;
        }
      }
    }
    return { totalCells: total, compliantCells: compliant };
  }, [employees, requiredPrograms, trainingLookup]);

  const complianceRate = totalCells > 0 ? Math.round((compliantCells / totalCells) * 100) : 0;

  if (employees.length === 0 || requiredPrograms.length === 0) {
    return (
      <Panel>
        <SectionHeading title="Training Matrix" accent="purple" />
        <p className="text-sm text-slate-400 italic">
          {employees.length === 0
            ? 'No employees on file for this client.'
            : 'No required programs found.'}
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      <SectionHeading title="Training Matrix" accent="purple">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Compliance:</span>
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
        </div>
      </SectionHeading>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-left py-1.5 pr-2 font-semibold text-slate-600 sticky left-0 bg-white min-w-[140px]">
                Employee
              </th>
              {requiredPrograms.map((prog) => (
                <th
                  key={prog.id}
                  className="py-1.5 px-1 font-semibold text-slate-600 text-center min-w-[80px]"
                  title={prog.name}
                >
                  <span className="block truncate max-w-[80px]">{prog.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => {
              const empName = emp.fields['Employee Name'] || emp.fields['Name'] || '—';
              return (
                <tr key={emp.id} className="border-t border-slate-100">
                  <td className="py-1 pr-2 font-medium text-slate-700 sticky left-0 bg-white">
                    {empName}
                  </td>
                  {requiredPrograms.map((prog) => {
                    const tr = trainingLookup[emp.id]?.[prog.name];
                    const status = tr?.fields['Status'] || 'Not Required';
                    const cellColor = getCellColor(status);
                    return (
                      <td key={prog.id} className="py-1 px-1 text-center">
                        <span
                          className={`inline-block w-full rounded px-1 py-0.5 text-[10px] font-semibold ${cellColor}`}
                          title={`${empName} - ${prog.name}: ${status}`}
                        >
                          {statusAbbrev(status)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-slate-100">
        {[
          { label: 'Current', color: 'bg-emerald-500 text-white' },
          { label: 'Expiring', color: 'bg-yellow-400 text-yellow-900' },
          { label: 'Expired', color: 'bg-red-500 text-white' },
          { label: 'Scheduled', color: 'bg-purple-500 text-white' },
          { label: 'N/R', color: 'bg-gray-100 text-gray-400' },
        ].map((item) => (
          <span key={item.label} className="flex items-center gap-1 text-[10px] text-slate-500">
            <span className={`inline-block w-3 h-3 rounded ${item.color}`} />
            {item.label}
          </span>
        ))}
      </div>
    </Panel>
  );
}

function DocumentsPanel({ client, profiles, programs, deadlines }) {
  const sharePointUrl =
    client.fields['SharePoint Folder'] ||
    client.fields['SharePoint URL'] ||
    client.fields['SharePoint Link'] ||
    null;

  // Collect all document links from related records
  const documentLinks = useMemo(() => {
    const links = [];

    for (const p of profiles) {
      const url = p.fields['Document URL'] || p.fields['Document Link'];
      if (url) {
        links.push({
          source: 'Environmental Profile',
          name: p.fields['Obligation Type'] || p.fields['Profile Type'] || 'Profile',
          url,
        });
      }
    }

    for (const p of programs) {
      const url = p.fields['Document URL'] || p.fields['Document Link'];
      if (url) {
        links.push({
          source: 'Safety Program',
          name: p.fields['Program Name'] || p.fields['Name'] || 'Program',
          url,
        });
      }
    }

    for (const d of deadlines) {
      const url = d.fields['Document URL'] || d.fields['Document Link'];
      if (url) {
        links.push({
          source: 'Compliance Deadline',
          name: d.fields['Deadline Name'] || d.fields['Name'] || 'Deadline',
          url,
        });
      }
    }

    return links;
  }, [profiles, programs, deadlines]);

  return (
    <Panel>
      <SectionHeading title="Documents" accent="slate" />

      {sharePointUrl ? (
        <a
          href={sharePointUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-4 hover:bg-blue-100 transition-colors"
        >
          <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span className="text-sm font-medium text-blue-700">Open SharePoint Folder</span>
          <svg className="w-3.5 h-3.5 text-blue-400 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      ) : (
        <p className="text-sm text-slate-400 italic mb-4">No SharePoint folder linked.</p>
      )}

      {documentLinks.length > 0 ? (
        <div className="space-y-1">
          {documentLinks.map((doc, i) => (
            <a
              key={i}
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 text-xs px-3 py-2 rounded-md hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-colors"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="text-slate-400 flex-shrink-0">{doc.source}</span>
                <span className="text-slate-300">|</span>
                <span className="text-slate-700 font-medium truncate">{doc.name}</span>
              </span>
              <svg className="w-3 h-3 text-slate-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400 italic">No linked documents found.</p>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Training status helpers
// ---------------------------------------------------------------------------

function statusPriority(status) {
  const map = {
    Current: 5,
    Scheduled: 4,
    'Expiring Soon': 3,
    'Expired/Overdue': 2,
    Overdue: 1,
  };
  return map[status] || 0;
}

function getCellColor(status) {
  if (TRAINING_STATUS_COLORS[status]) return TRAINING_STATUS_COLORS[status];
  // Fallback matching
  if (status === 'Current') return 'bg-emerald-500 text-white';
  if (status === 'Expiring Soon') return 'bg-yellow-400 text-yellow-900';
  if (status === 'Expired/Overdue' || status === 'Overdue' || status === 'Expired')
    return 'bg-red-500 text-white';
  if (status === 'Scheduled') return 'bg-purple-500 text-white';
  if (status === 'Waived') return 'bg-gray-300 text-gray-600';
  return 'bg-gray-100 text-gray-400';
}

function statusAbbrev(status) {
  const map = {
    Current: 'OK',
    'Expiring Soon': 'EXP',
    'Expired/Overdue': 'OD',
    Overdue: 'OD',
    Expired: 'OD',
    Scheduled: 'SCH',
    Waived: 'W',
    'Not Required': '—',
  };
  return map[status] || '—';
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function ClientSnapshot({ clientId, onBack, clients }) {
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [activeClientId, setActiveClientId] = useState(clientId);

  // Update active client when prop changes
  useEffect(() => {
    setActiveClientId(clientId);
  }, [clientId]);

  // --- Data fetching ---

  const {
    data: clientRecord,
    loading: clientLoading,
    error: clientError,
    refetch: refetchClient,
  } = useAirtableQuery(() => api.getClient(activeClientId), [activeClientId]);

  const {
    data: profiles,
    loading: profilesLoading,
    error: profilesError,
  } = useAirtableQuery(
    () => api.getEnvironmentalProfiles(`FIND("${activeClientId}", ARRAYJOIN({Client}))`),
    [activeClientId]
  );

  const {
    data: deadlines,
    loading: deadlinesLoading,
    error: deadlinesError,
  } = useAirtableQuery(
    () => api.getComplianceDeadlines(`FIND("${activeClientId}", ARRAYJOIN({Client}))`),
    [activeClientId]
  );

  const {
    data: programs,
    loading: programsLoading,
    error: programsError,
  } = useAirtableQuery(
    () => api.getSafetyPrograms(`FIND("${activeClientId}", ARRAYJOIN({Client}))`),
    [activeClientId]
  );

  const {
    data: employees,
    loading: employeesLoading,
    error: employeesError,
  } = useAirtableQuery(
    () => api.getClientEmployees(`FIND("${activeClientId}", ARRAYJOIN({Client}))`),
    [activeClientId]
  );

  const {
    data: trainingRecords,
    loading: trainingLoading,
    error: trainingError,
  } = useAirtableQuery(
    () => api.getTrainingRecords(`FIND("${activeClientId}", ARRAYJOIN({Client}))`),
    [activeClientId]
  );

  const {
    data: activities,
    loading: activitiesLoading,
    error: activitiesError,
  } = useAirtableQuery(
    () =>
      api.getServiceActivities(`FIND("${activeClientId}", ARRAYJOIN({Client}))`).catch(() =>
        // Fallback: the unfiltered variant uses the correct table name
        api.getServiceActivities()
          .then((all) =>
            all.filter((r) => (r.fields['Client'] || []).includes(activeClientId))
          )
      ),
    [activeClientId]
  );

  const {
    data: staff,
    loading: staffLoading,
  } = useAirtableQuery(() => api.getStaff(), []);

  // Build staff name map
  const staffMap = useMemo(() => {
    const map = new Map();
    if (Array.isArray(staff)) {
      for (const s of staff) {
        map.set(s.id, s.fields['Name']);
      }
    }
    return map;
  }, [staff]);

  // --- Derived metrics ---

  const overdueDeadlines = useMemo(() => {
    if (!Array.isArray(deadlines)) return 0;
    return deadlines.filter((d) => {
      const status = d.fields['Status'];
      const days = daysUntil(d.fields['Due Date']);
      return status === 'Overdue' || status === 'Expired/Overdue' || (days !== null && days < 0);
    }).length;
  }, [deadlines]);

  const expiringTrainingCount = useMemo(() => {
    if (!Array.isArray(trainingRecords)) return 0;
    return trainingRecords.filter((t) => {
      const s = t.fields['Status'];
      return s === 'Expiring Soon' || s === 'Expired/Overdue' || s === 'Overdue' || s === 'Expired';
    }).length;
  }, [trainingRecords]);

  const upcomingVisitCount = useMemo(() => {
    if (!Array.isArray(activities)) return 0;
    const today = new Date().toISOString().slice(0, 10);
    return activities.filter((a) => {
      const d = a.fields['Date'] || a.fields['Activity Date'] || '';
      return d > today;
    }).length;
  }, [activities]);

  // --- Loading & Error states ---

  const isLoading =
    clientLoading ||
    profilesLoading ||
    deadlinesLoading ||
    programsLoading ||
    employeesLoading ||
    trainingLoading ||
    activitiesLoading ||
    staffLoading;

  const criticalError = clientError;

  // clientRecord from getClient is a single record object, not an array
  const client = clientRecord && clientRecord.id ? clientRecord : null;

  // Handle sidebar client switching
  function handleSelectClient(id) {
    setActiveClientId(id);
  }

  // --- Render ---

  return (
    <div className="flex h-full min-h-screen bg-slate-50">
      {/* Left sidebar */}
      {clients && clients.length > 0 && (
        <ClientSidebar
          clients={clients}
          activeId={activeClientId}
          onSelect={handleSelectClient}
          search={sidebarSearch}
          onSearchChange={setSidebarSearch}
        />
      )}

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        {/* Top bar with back button */}
        <div className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 px-6 py-3 flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <span className="text-xs text-slate-400">Client Snapshot</span>
        </div>

        <div className="p-6 max-w-7xl mx-auto">
          {/* Critical error */}
          {criticalError && (
            <ErrorMessage message={`Failed to load client: ${criticalError}`} onRetry={refetchClient} />
          )}

          {/* Loading state */}
          {isLoading && !client && !criticalError && (
            <LoadingSpinner message="Loading client snapshot..." />
          )}

          {/* Content */}
          {client && (
            <>
              {/* Header */}
              <HeaderBar
                client={client}
                staffMap={staffMap}
                overdueDeadlines={overdueDeadlines}
                expiringTraining={expiringTrainingCount}
                upcomingVisits={upcomingVisitCount}
              />

              {/* Loading indicator for sub-data */}
              {isLoading && (
                <div className="flex items-center gap-2 text-xs text-slate-400 mb-4">
                  <div className="w-3 h-3 border border-slate-300 border-t-blue-500 rounded-full animate-spin" />
                  Loading additional data...
                </div>
              )}

              {/* Errors for sub-sections (non-critical) */}
              {(profilesError || deadlinesError) && (
                <div className="mb-4">
                  <ErrorMessage message={`Environmental data error: ${profilesError || deadlinesError}`} />
                </div>
              )}
              {(programsError || employeesError || trainingError) && (
                <div className="mb-4">
                  <ErrorMessage message={`Safety data error: ${programsError || employeesError || trainingError}`} />
                </div>
              )}
              {activitiesError && (
                <div className="mb-4">
                  <ErrorMessage message={`Service activities error: ${activitiesError}`} />
                </div>
              )}

              {/* Environmental Panel */}
              <div className="mb-4">
                <EnvironmentalPanel
                  profiles={Array.isArray(profiles) ? profiles : []}
                  deadlines={Array.isArray(deadlines) ? deadlines : []}
                  staffMap={staffMap}
                />
              </div>

              {/* Safety + What's Next side by side on large screens */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                <SafetyPanel
                  programs={Array.isArray(programs) ? programs : []}
                  expiringTrainingCount={expiringTrainingCount}
                />
                <WhatsNextPanel
                  activities={Array.isArray(activities) ? activities : []}
                  staffMap={staffMap}
                />
              </div>

              {/* Training Matrix */}
              <div className="mb-4">
                <TrainingMatrixPanel
                  employees={Array.isArray(employees) ? employees : []}
                  programs={Array.isArray(programs) ? programs : []}
                  trainingRecords={Array.isArray(trainingRecords) ? trainingRecords : []}
                />
              </div>

              {/* Documents */}
              <div className="mb-4">
                <DocumentsPanel
                  client={client}
                  profiles={Array.isArray(profiles) ? profiles : []}
                  programs={Array.isArray(programs) ? programs : []}
                  deadlines={Array.isArray(deadlines) ? deadlines : []}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
