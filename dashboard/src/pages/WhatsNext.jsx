import { useState, useMemo } from 'react';
import { useAirtableQuery } from '../hooks/useAirtable';
import { getServiceActivities, getClients, getStaff, TABLES } from '../services/airtable';
import StatusBadge from '../components/StatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { formatDate, daysUntil, countdownText } from '../utils/dates';

// ---------- constants ----------

const SECTION_CONFIG = {
  overdue: {
    key: 'overdue',
    label: 'Overdue',
    headerBg: 'bg-red-600',
    headerText: 'text-white',
    countBg: 'bg-red-200',
    countText: 'text-red-800',
    emptyMsg: 'No overdue visits',
  },
  thisWeek: {
    key: 'thisWeek',
    label: 'This Week',
    headerBg: 'bg-orange-600',
    headerText: 'text-white',
    countBg: 'bg-orange-200',
    countText: 'text-orange-800',
    emptyMsg: 'No visits this week',
  },
  nextWeek: {
    key: 'nextWeek',
    label: 'Next Week',
    headerBg: 'bg-amber-500',
    headerText: 'text-white',
    countBg: 'bg-amber-200',
    countText: 'text-amber-800',
    emptyMsg: 'No visits next week',
  },
  comingUp: {
    key: 'comingUp',
    label: 'Coming Up',
    headerBg: 'bg-slate-500',
    headerText: 'text-white',
    countBg: 'bg-slate-200',
    countText: 'text-slate-800',
    emptyMsg: 'No upcoming visits',
  },
};

// ---------- helpers ----------

function buildLookup(records, nameField) {
  const map = new Map();
  for (const r of records) {
    map.set(r.id, r.fields[nameField] || r.id);
  }
  return map;
}

function resolveLinkedName(linkedIds, lookup) {
  if (!linkedIds || linkedIds.length === 0) return '—';
  return linkedIds.map((id) => lookup.get(id) || id).join(', ');
}

function classifyActivity(fields) {
  const days = daysUntil(fields['Visit Date']);
  if (days === null) return 'comingUp'; // no date — show in coming up
  if (days < 0) return 'overdue';
  if (days <= 7) return 'thisWeek';
  if (days <= 14) return 'nextWeek';
  return 'comingUp';
}

// ---------- sub-components ----------

function VisitTypeBadge({ type }) {
  if (!type) return null;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-orange-100 text-orange-700 border border-orange-200">
      {type}
    </span>
  );
}

function CountdownChip({ dateStr }) {
  const days = daysUntil(dateStr);
  if (days === null) return null;

  let classes = 'text-xs font-bold px-2 py-0.5 rounded-full';
  if (days < 0) {
    classes += ' bg-red-100 text-red-700';
  } else if (days === 0) {
    classes += ' bg-orange-100 text-orange-700';
  } else if (days <= 7) {
    classes += ' bg-amber-100 text-amber-700';
  } else {
    classes += ' bg-slate-100 text-slate-600';
  }

  return <span className={classes}>{countdownText(dateStr)}</span>;
}

function ActivityCard({ activity, clientLookup, staffLookup, onClick }) {
  const f = activity.fields;
  const clientName = resolveLinkedName(f.Client, clientLookup);
  const staffName = resolveLinkedName(f['Assigned To'], staffLookup);
  const visitDate = f['Visit Date'];
  const visitType = f['Visit Type'] || f['Activity Type'] || null;
  const description = f['Activity'] || f['Task'] || f['Description'] || f['Notes'] || '';
  const clientId = f.Client && f.Client.length > 0 ? f.Client[0] : null;

  return (
    <button
      type="button"
      onClick={() => clientId && onClick(clientId)}
      className={`w-full text-left bg-white rounded-lg border border-slate-200 shadow-sm
        hover:shadow-md hover:-translate-y-0.5 transition-all duration-150
        p-4 flex flex-col gap-2 ${clientId ? 'cursor-pointer' : 'cursor-default'}`}
    >
      {/* top row: client name + countdown */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-bold text-slate-900 leading-tight truncate">
          {clientName}
        </h3>
        <CountdownChip dateStr={visitDate} />
      </div>

      {/* description */}
      {description && (
        <p className="text-sm text-slate-600 line-clamp-2">{description}</p>
      )}

      {/* meta row */}
      <div className="flex flex-wrap items-center gap-2 mt-auto pt-1">
        <span className="text-xs text-slate-500">
          {formatDate(visitDate)}
        </span>
        {visitType && <VisitTypeBadge type={visitType} />}
      </div>

      {/* staff */}
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
        <span className="truncate">{staffName}</span>
      </div>
    </button>
  );
}

function SectionHeader({ config, count }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-2 rounded-lg ${config.headerBg} ${config.headerText}`}>
      <h2 className="text-sm font-semibold uppercase tracking-wide">{config.label}</h2>
      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${config.countBg} ${config.countText}`}>
        {count}
      </span>
    </div>
  );
}

function Section({ config, activities, clientLookup, staffLookup, onClientSelect }) {
  return (
    <div>
      <SectionHeader config={config} count={activities.length} />

      {activities.length === 0 ? (
        <p className="text-sm text-slate-400 italic py-4 text-center">{config.emptyMsg}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mt-3">
          {activities.map((a) => (
            <ActivityCard
              key={a.id}
              activity={a}
              clientLookup={clientLookup}
              staffLookup={staffLookup}
              onClick={onClientSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RecentlyCompletedSection({ activities, clientLookup, staffLookup, onClientSelect }) {
  const [expanded, setExpanded] = useState(false);

  if (activities.length === 0) return null;

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">
            Recently Completed
          </h2>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
            {activities.length}
          </span>
        </div>
        <svg
          className={`w-5 h-5 text-slate-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {activities.map((a) => (
              <ActivityCard
                key={a.id}
                activity={a}
                clientLookup={clientLookup}
                staffLookup={staffLookup}
                onClick={onClientSelect}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- main component ----------

export default function WhatsNext({ onClientSelect }) {
  const { data: activities, loading: loadingActivities, error: errorActivities, refetch: refetchActivities } =
    useAirtableQuery(getServiceActivities, []);
  const { data: clients, loading: loadingClients, error: errorClients } =
    useAirtableQuery(getClients, []);
  const { data: staff, loading: loadingStaff, error: errorStaff } =
    useAirtableQuery(getStaff, []);

  const [staffFilter, setStaffFilter] = useState('');

  // build lookup maps
  const clientLookup = useMemo(() => buildLookup(clients, 'Client Name'), [clients]);
  const staffLookup = useMemo(() => buildLookup(staff, 'Name'), [staff]);

  // unique staff names for filter dropdown
  const staffOptions = useMemo(() => {
    const names = new Set();
    for (const s of staff) {
      const name = s.fields['Name'];
      if (name) names.add(name);
    }
    return Array.from(names).sort();
  }, [staff]);

  // reverse lookup: staff name -> set of record IDs
  const staffNameToIds = useMemo(() => {
    const map = new Map();
    for (const s of staff) {
      const name = s.fields['Name'];
      if (name) {
        if (!map.has(name)) map.set(name, new Set());
        map.get(name).add(s.id);
      }
    }
    return map;
  }, [staff]);

  // group activities into sections
  const { overdue, thisWeek, nextWeek, comingUp, recentlyCompleted } = useMemo(() => {
    const buckets = {
      overdue: [],
      thisWeek: [],
      nextWeek: [],
      comingUp: [],
      recentlyCompleted: [],
    };

    for (const activity of activities) {
      const f = activity.fields;
      const status = f['Status'];

      // filter by staff if active
      if (staffFilter) {
        const assignedIds = f['Assigned To'] || [];
        const matchIds = staffNameToIds.get(staffFilter);
        if (!matchIds || !assignedIds.some((id) => matchIds.has(id))) {
          continue;
        }
      }

      if (status === 'Completed') {
        // only include recently completed (last 14 days)
        const days = daysUntil(f['Visit Date']);
        if (days !== null && days >= -14) {
          buckets.recentlyCompleted.push(activity);
        }
        continue;
      }

      if (status !== 'Scheduled') continue;

      const bucket = classifyActivity(f);
      buckets[bucket].push(activity);
    }

    // sort each bucket by visit date ascending
    const sortByDate = (a, b) => {
      const da = a.fields['Visit Date'] || '';
      const db = b.fields['Visit Date'] || '';
      return da.localeCompare(db);
    };

    buckets.overdue.sort(sortByDate);
    buckets.thisWeek.sort(sortByDate);
    buckets.nextWeek.sort(sortByDate);
    buckets.comingUp.sort(sortByDate);
    buckets.recentlyCompleted.sort((a, b) => {
      // most recent first
      const da = a.fields['Visit Date'] || '';
      const db = b.fields['Visit Date'] || '';
      return db.localeCompare(da);
    });

    return buckets;
  }, [activities, staffFilter, staffNameToIds]);

  // total scheduled count
  const totalScheduled = overdue.length + thisWeek.length + nextWeek.length + comingUp.length;

  // loading / error states
  const loading = loadingActivities || loadingClients || loadingStaff;
  const error = errorActivities || errorClients || errorStaff;

  if (loading) {
    return <LoadingSpinner message="Loading visit schedule..." />;
  }

  if (error) {
    return <ErrorMessage message={error} onRetry={refetchActivities} />;
  }

  return (
    <div className="space-y-6">
      {/* page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <span
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-white text-sm"
              style={{ backgroundColor: '#EA580C' }}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </span>
            What&apos;s Next
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Client visit schedule &mdash; {totalScheduled} scheduled {totalScheduled === 1 ? 'visit' : 'visits'}
          </p>
        </div>

        {/* staff filter */}
        <div className="flex items-center gap-2">
          <label
            htmlFor="staff-filter"
            className="text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap"
          >
            Staff
          </label>
          <select
            id="staff-filter"
            value={staffFilter}
            onChange={(e) => setStaffFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-orange-400 min-w-[180px]"
          >
            <option value="">All Staff</option>
            {staffOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* summary stat chips */}
      <div className="flex flex-wrap gap-3">
        <SummaryChip label="Overdue" count={overdue.length} color="red" />
        <SummaryChip label="This Week" count={thisWeek.length} color="orange" />
        <SummaryChip label="Next Week" count={nextWeek.length} color="amber" />
        <SummaryChip label="Coming Up" count={comingUp.length} color="slate" />
      </div>

      {/* sections */}
      {overdue.length > 0 && (
        <Section
          config={SECTION_CONFIG.overdue}
          activities={overdue}
          clientLookup={clientLookup}
          staffLookup={staffLookup}
          onClientSelect={onClientSelect}
        />
      )}

      <Section
        config={SECTION_CONFIG.thisWeek}
        activities={thisWeek}
        clientLookup={clientLookup}
        staffLookup={staffLookup}
        onClientSelect={onClientSelect}
      />

      <Section
        config={SECTION_CONFIG.nextWeek}
        activities={nextWeek}
        clientLookup={clientLookup}
        staffLookup={staffLookup}
        onClientSelect={onClientSelect}
      />

      <Section
        config={SECTION_CONFIG.comingUp}
        activities={comingUp}
        clientLookup={clientLookup}
        staffLookup={staffLookup}
        onClientSelect={onClientSelect}
      />

      {/* recently completed (collapsed by default) */}
      <RecentlyCompletedSection
        activities={recentlyCompleted}
        clientLookup={clientLookup}
        staffLookup={staffLookup}
        onClientSelect={onClientSelect}
      />

      {/* empty state */}
      {totalScheduled === 0 && recentlyCompleted.length === 0 && (
        <div className="text-center py-16">
          <svg className="w-12 h-12 mx-auto text-slate-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="text-slate-400 text-sm">No service activities found.</p>
          <p className="text-slate-400 text-xs mt-1">Scheduled visits will appear here once added to Airtable.</p>
        </div>
      )}
    </div>
  );
}

// ---------- small helpers ----------

function SummaryChip({ label, count, color }) {
  const colorMap = {
    red: 'bg-red-50 text-red-700 border-red-200',
    orange: 'bg-orange-50 text-orange-700 border-orange-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    slate: 'bg-slate-50 text-slate-600 border-slate-200',
  };

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium ${colorMap[color] || colorMap.slate}`}>
      <span>{label}</span>
      <span className="font-bold">{count}</span>
    </div>
  );
}
