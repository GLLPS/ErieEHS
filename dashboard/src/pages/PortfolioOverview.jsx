import { useState, useEffect, useMemo } from 'react';
import { useAirtableQuery } from '../hooks/useAirtable';
import * as api from '../services/airtable';
import StatCard from '../components/StatCard';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { daysUntil } from '../utils/dates';
import { format, parseISO, startOfMonth, addMonths } from 'date-fns';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------

const COLORS = {
  envBlue: '#3B82F6',
  envBlueDark: '#1E3A5F',
  safetyPurple: '#7C3AED',
  safetyPurpleDark: '#5B21B6',
  visitOrange: '#EA580C',
  red: '#EF4444',
  yellow: '#F59E0B',
  green: '#10B981',
  slate: '#64748B',
  slateHeader: '#1E293B',
};

const GENERATOR_COLORS = {
  VSQG: '#93C5FD',
  CESQG: '#60A5FA',
  SQG: '#3B82F6',
  LQG: '#1D4ED8',
};

const OBLIGATION_COLORS = [
  '#3B82F6', // Air Permit
  '#2563EB', // PBS/SPCC
  '#1D4ED8', // RCRA
  '#1E40AF', // Tier II
  '#1E3A8A', // TRI
  '#60A5FA', // CBS/SPR
  '#93C5FD', // SWPPP/SPDES
];

const MONTH_BAR_COLOR = '#3B82F6';

// ---------------------------------------------------------------------------
// Chart wrapper component
// ---------------------------------------------------------------------------

function ChartPanel({ title, subtitle, children }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wide">
          {title}
        </h3>
        {subtitle && (
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom tooltip for recharts
// ---------------------------------------------------------------------------

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-slate-800 text-white text-xs rounded-md px-3 py-2 shadow-lg">
      <p className="font-medium mb-0.5">{label}</p>
      {payload.map((entry, idx) => (
        <p key={idx} style={{ color: entry.color || '#fff' }}>
          {entry.name || 'Count'}: {entry.value}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ message = 'No data available' }) {
  return (
    <div className="flex items-center justify-center py-12 text-slate-400 text-sm">
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function PortfolioOverview() {
  // -----------------------------------------------------------------------
  // Data fetching — all tables in parallel
  // -----------------------------------------------------------------------

  const {
    data: clients,
    loading: loadingClients,
    error: errorClients,
  } = useAirtableQuery(() => api.getClients(), []);

  const {
    data: staff,
    loading: loadingStaff,
    error: errorStaff,
  } = useAirtableQuery(() => api.getStaff(), []);

  const {
    data: envProfiles,
    loading: loadingEnv,
    error: errorEnv,
  } = useAirtableQuery(() => api.getEnvironmentalProfiles(), []);

  const {
    data: deadlines,
    loading: loadingDeadlines,
    error: errorDeadlines,
  } = useAirtableQuery(() => api.getComplianceDeadlines(), []);

  const {
    data: safetyPrograms,
    loading: loadingSafety,
    error: errorSafety,
  } = useAirtableQuery(() => api.getSafetyPrograms(), []);

  const {
    data: employees,
    loading: loadingEmployees,
    error: errorEmployees,
  } = useAirtableQuery(() => api.getClientEmployees(), []);

  const {
    data: activities,
    loading: loadingActivities,
    error: errorActivities,
  } = useAirtableQuery(() => api.getServiceActivities(), []);

  const loading =
    loadingClients ||
    loadingStaff ||
    loadingEnv ||
    loadingDeadlines ||
    loadingSafety ||
    loadingEmployees ||
    loadingActivities;

  const errors = [
    errorClients,
    errorStaff,
    errorEnv,
    errorDeadlines,
    errorSafety,
    errorEmployees,
    errorActivities,
  ].filter(Boolean);

  // -----------------------------------------------------------------------
  // Derived stats
  // -----------------------------------------------------------------------

  const activeClients = useMemo(
    () => clients.filter((c) => c.fields?.Status === 'Active'),
    [clients]
  );

  // Overdue: deadlines with Status = "Overdue" OR past due date with non-completed status
  const overdueDeadlines = useMemo(() => {
    return deadlines.filter((d) => {
      const status = d.fields?.Status;
      if (status === 'Overdue') return true;
      if (status === 'Completed' || status === 'N/A') return false;
      const days = daysUntil(d.fields?.['Due Date']);
      return days !== null && days < 0;
    });
  }, [deadlines]);

  // Overdue training records
  const overdueTraining = useMemo(() => {
    // We treat safety programs with "Needs Update" status as overdue for safety count
    return safetyPrograms.filter(
      (p) => p.fields?.['Program Status'] === 'Needs Update'
    );
  }, [safetyPrograms]);

  const totalOverdue = overdueDeadlines.length + overdueTraining.length;

  // Active employee count
  const activeEmployees = useMemo(
    () => employees.filter((e) => e.fields?.Status === 'Active'),
    [employees]
  );

  // LQG client count: clients that have an Environmental Profile with
  // Obligation Type containing "RCRA" and Generator Class = "LQG"
  const lqgClientCount = useMemo(() => {
    const lqgClientIds = new Set();
    envProfiles.forEach((p) => {
      const obligation = p.fields?.['Obligation Type'] || '';
      const genClass = p.fields?.['Generator Class'] || '';
      if (obligation.includes('RCRA') && genClass === 'LQG') {
        const linkedClients = p.fields?.Client || [];
        linkedClients.forEach((id) => lqgClientIds.add(id));
      }
    });
    return lqgClientIds.size;
  }, [envProfiles]);

  // -----------------------------------------------------------------------
  // Generator Classification Breakdown
  // -----------------------------------------------------------------------

  const generatorData = useMemo(() => {
    const counts = { VSQG: 0, CESQG: 0, SQG: 0, LQG: 0 };
    envProfiles.forEach((p) => {
      const obligation = p.fields?.['Obligation Type'] || '';
      const genClass = p.fields?.['Generator Class'] || '';
      if (obligation.includes('RCRA') && counts.hasOwnProperty(genClass)) {
        counts[genClass]++;
      }
    });
    return Object.entries(counts).map(([name, count]) => ({
      name,
      count,
      fill: GENERATOR_COLORS[name],
    }));
  }, [envProfiles]);

  // -----------------------------------------------------------------------
  // Environmental Obligations Managed
  // -----------------------------------------------------------------------

  const OBLIGATION_LABELS = {
    'Air Permit (AFR/ASF)': 'Air Permit',
    'PBS/SPCC': 'PBS/SPCC',
    'RCRA/Haz Waste': 'RCRA',
    'Tier II': 'Tier II',
    TRI: 'TRI',
    'CBS/SPR': 'CBS/SPR',
    'SWPPP/SPDES': 'SWPPP/SPDES',
  };

  const obligationData = useMemo(() => {
    const counts = {};
    Object.values(OBLIGATION_LABELS).forEach((label) => {
      counts[label] = 0;
    });

    envProfiles.forEach((p) => {
      const raw = p.fields?.['Obligation Type'] || '';
      const label = OBLIGATION_LABELS[raw];
      if (label) {
        counts[label]++;
      }
    });

    return Object.entries(counts)
      .map(([name, count], idx) => ({
        name,
        count,
        fill: OBLIGATION_COLORS[idx % OBLIGATION_COLORS.length],
      }))
      .filter((d) => d.count > 0);
  }, [envProfiles]);

  // -----------------------------------------------------------------------
  // Safety Programs Managed
  // -----------------------------------------------------------------------

  const safetyProgramData = useMemo(() => {
    const counts = {};
    safetyPrograms.forEach((p) => {
      const type = p.fields?.['Program Type'] || 'Other';
      // Shorten long labels
      const label =
        type.length > 30 ? type.substring(0, 28) + '...' : type;
      counts[label] = (counts[label] || 0) + 1;
    });

    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [safetyPrograms]);

  // -----------------------------------------------------------------------
  // Staff Workload Distribution
  // -----------------------------------------------------------------------

  const staffWorkload = useMemo(() => {
    // Build staff lookup: id -> name
    const staffMap = new Map();
    staff.forEach((s) => {
      if (s.fields?.Active) {
        staffMap.set(s.id, s.fields?.Name || 'Unknown');
      }
    });

    // Initialize workload per staff member
    const workload = new Map();
    staffMap.forEach((name, id) => {
      workload.set(id, {
        name,
        clientCount: 0,
        deadlineCount: 0,
        overdueCount: 0,
        upcomingVisits: 0,
      });
    });

    // Count assigned clients (via GLE Account Manager link)
    activeClients.forEach((c) => {
      const managerIds = c.fields?.['GLE Account Manager'] || [];
      managerIds.forEach((id) => {
        if (workload.has(id)) {
          workload.get(id).clientCount++;
        }
      });
    });

    // Count assigned deadlines and overdue deadlines
    deadlines.forEach((d) => {
      const assignees = d.fields?.['Assigned To'] || [];
      const status = d.fields?.Status;
      const days = daysUntil(d.fields?.['Due Date']);
      const isOverdue =
        status === 'Overdue' ||
        (status !== 'Completed' && status !== 'N/A' && days !== null && days < 0);

      assignees.forEach((id) => {
        if (workload.has(id)) {
          workload.get(id).deadlineCount++;
          if (isOverdue) {
            workload.get(id).overdueCount++;
          }
        }
      });
    });

    // Count upcoming visits (scheduled activities with future date)
    activities.forEach((a) => {
      const status = a.fields?.Status;
      const visitDate = a.fields?.['Visit Date'];
      const days = daysUntil(visitDate);

      if (status === 'Scheduled' && days !== null && days >= 0) {
        const assignees = a.fields?.['Assigned To'] || [];
        assignees.forEach((id) => {
          if (workload.has(id)) {
            workload.get(id).upcomingVisits++;
          }
        });
      }
    });

    return Array.from(workload.values()).sort(
      (a, b) => b.clientCount - a.clientCount
    );
  }, [staff, activeClients, deadlines, activities]);

  // -----------------------------------------------------------------------
  // Deadlines by Month Timeline (next 12 months)
  // -----------------------------------------------------------------------

  const deadlineTimeline = useMemo(() => {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const months = [];

    for (let i = 0; i < 12; i++) {
      const monthDate = addMonths(monthStart, i);
      months.push({
        month: format(monthDate, 'MMM yyyy'),
        monthKey: format(monthDate, 'yyyy-MM'),
        count: 0,
      });
    }

    deadlines.forEach((d) => {
      const dueDate = d.fields?.['Due Date'];
      if (!dueDate) return;
      const status = d.fields?.Status;
      if (status === 'Completed' || status === 'N/A') return;

      try {
        const parsed = parseISO(dueDate);
        const key = format(parsed, 'yyyy-MM');
        const monthEntry = months.find((m) => m.monthKey === key);
        if (monthEntry) {
          monthEntry.count++;
        }
      } catch {
        // skip invalid dates
      }
    });

    return months;
  }, [deadlines]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (loading) {
    return <LoadingSpinner message="Loading portfolio data..." />;
  }

  if (errors.length > 0) {
    return (
      <ErrorMessage
        message={`Failed to load data: ${errors[0]}`}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-slate-800">
          Portfolio Overview
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          High-level analytics across all managed clients and programs
        </p>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Top Stat Cards Row                                                 */}
      {/* ----------------------------------------------------------------- */}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Overdue Items"
          value={totalOverdue}
          sublabel={`${overdueDeadlines.length} env / ${overdueTraining.length} safety`}
          color="red"
        />
        <StatCard
          label="Active Clients"
          value={activeClients.length}
          sublabel={`${clients.length} total`}
          color="blue"
        />
        <StatCard
          label="Employees Tracked"
          value={activeEmployees.length}
          sublabel={`${employees.length} total`}
          color="purple"
        />
        <StatCard
          label="LQG Clients"
          value={lqgClientCount}
          sublabel="RCRA Large Quantity Generators"
          color="yellow"
        />
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Row: Generator Classification + Environmental Obligations          */}
      {/* ----------------------------------------------------------------- */}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Generator Classification Breakdown */}
        <ChartPanel
          title="Generator Classification Breakdown"
          subtitle="RCRA/Haz Waste obligation profiles by generator class"
        >
          {generatorData.every((d) => d.count === 0) ? (
            <EmptyState message="No RCRA profiles found" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={generatorData}
                layout="vertical"
                margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  horizontal={false}
                  stroke="#E2E8F0"
                />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: '#64748B' }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={55}
                  tick={{ fontSize: 12, fill: '#334155', fontWeight: 600 }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" name="Clients" radius={[0, 4, 4, 0]} barSize={28}>
                  {generatorData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>

        {/* Environmental Obligations Managed */}
        <ChartPanel
          title="Environmental Obligations Managed"
          subtitle="Count by obligation type across all clients"
        >
          {obligationData.length === 0 ? (
            <EmptyState message="No environmental profiles found" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={obligationData}
                margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#E2E8F0"
                />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={55}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748B' }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" name="Profiles" radius={[4, 4, 0, 0]} barSize={32}>
                  {obligationData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Safety Programs Managed                                            */}
      {/* ----------------------------------------------------------------- */}

      <ChartPanel
        title="Safety Programs Managed"
        subtitle="Count by program type across all clients"
      >
        {safetyProgramData.length === 0 ? (
          <EmptyState message="No safety programs found" />
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(250, safetyProgramData.length * 32)}>
            <BarChart
              data={safetyProgramData}
              layout="vertical"
              margin={{ top: 5, right: 30, left: 5, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                horizontal={false}
                stroke="#E2E8F0"
              />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: '#64748B' }} />
              <YAxis
                type="category"
                dataKey="name"
                width={210}
                tick={{ fontSize: 11, fill: '#334155' }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar
                dataKey="count"
                name="Programs"
                fill={COLORS.safetyPurple}
                radius={[0, 4, 4, 0]}
                barSize={22}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartPanel>

      {/* ----------------------------------------------------------------- */}
      {/* Staff Workload Distribution                                        */}
      {/* ----------------------------------------------------------------- */}

      <ChartPanel
        title="Staff Workload Distribution"
        subtitle="Assignment summary for each active staff member"
      >
        {staffWorkload.length === 0 ? (
          <EmptyState message="No active staff found" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Staff Member
                  </th>
                  <th className="text-center py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Clients
                  </th>
                  <th className="text-center py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Deadlines
                  </th>
                  <th className="text-center py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Overdue
                  </th>
                  <th className="text-center py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Upcoming Visits
                  </th>
                </tr>
              </thead>
              <tbody>
                {staffWorkload.map((member, idx) => (
                  <tr
                    key={idx}
                    className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                  >
                    <td className="py-2.5 px-3 font-medium text-slate-800">
                      {member.name}
                    </td>
                    <td className="py-2.5 px-3 text-center text-slate-700">
                      <span className="inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">
                        {member.clientCount}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center text-slate-700">
                      <span className="inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                        {member.deadlineCount}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {member.overdueCount > 0 ? (
                        <span className="inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
                          {member.overdueCount}
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-600">
                          0
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center text-slate-700">
                      <span className="inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-50 text-orange-700">
                        {member.upcomingVisits}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartPanel>

      {/* ----------------------------------------------------------------- */}
      {/* Deadlines by Month Timeline                                        */}
      {/* ----------------------------------------------------------------- */}

      <ChartPanel
        title="Deadlines by Month"
        subtitle="Upcoming compliance deadline counts across the next 12 months"
      >
        {deadlineTimeline.every((m) => m.count === 0) ? (
          <EmptyState message="No upcoming deadlines found" />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={deadlineTimeline}
              margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="#E2E8F0"
              />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: '#64748B' }}
                interval={0}
                angle={-35}
                textAnchor="end"
                height={55}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748B' }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar
                dataKey="count"
                name="Deadlines"
                fill={MONTH_BAR_COLOR}
                radius={[4, 4, 0, 0]}
                barSize={28}
              >
                {deadlineTimeline.map((entry, idx) => (
                  <Cell
                    key={idx}
                    fill={entry.count > 5 ? COLORS.red : entry.count > 2 ? COLORS.yellow : MONTH_BAR_COLOR}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartPanel>
    </div>
  );
}
