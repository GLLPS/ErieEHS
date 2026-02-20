import { useState, useMemo, useCallback } from 'react';
import { useAirtableQuery } from '../hooks/useAirtable';
import {
  getComplianceDeadlines,
  getTrainingRecords,
  getStaff,
  getClients,
} from '../services/airtable';
import StatusBadge from '../components/StatusBadge';
import CategoryBadge from '../components/CategoryBadge';
import StatCard from '../components/StatCard';
import FilterBar from '../components/FilterBar';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { formatDate, countdownText, daysUntil } from '../utils/dates';
import { getPriorityColor } from '../utils/status';

// Airtable filter formulas
const COMPLIANCE_FILTER =
  'OR({Status} = "Upcoming", {Status} = "Overdue", {Status} = "In Progress")';
const TRAINING_FILTER =
  'OR({Status} = "Expired/Overdue", {Status} = "Expiring Soon")';

export default function ActionRequired({ onClientSelect }) {
  // ---- Data fetching ----
  const {
    data: deadlines,
    loading: deadlinesLoading,
    error: deadlinesError,
    refetch: refetchDeadlines,
  } = useAirtableQuery(() => getComplianceDeadlines(COMPLIANCE_FILTER), []);

  const {
    data: trainingRecords,
    loading: trainingLoading,
    error: trainingError,
    refetch: refetchTraining,
  } = useAirtableQuery(() => getTrainingRecords(TRAINING_FILTER), []);

  const {
    data: clients,
    loading: clientsLoading,
    error: clientsError,
  } = useAirtableQuery(() => getClients(), []);

  const {
    data: staff,
    loading: staffLoading,
    error: staffError,
  } = useAirtableQuery(() => getStaff(), []);

  // ---- Filter state ----
  const [filterValues, setFilterValues] = useState({
    category: '',
    status: '',
    staff: '',
    type: '',
  });

  const handleFilterChange = useCallback((key, value) => {
    setFilterValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ---- Build lookup maps ----
  const clientMap = useMemo(() => {
    const map = new Map();
    for (const c of clients) {
      map.set(c.id, c.fields['Client Name'] || 'Unknown Client');
    }
    return map;
  }, [clients]);

  const staffMap = useMemo(() => {
    const map = new Map();
    for (const s of staff) {
      map.set(s.id, s.fields['Name'] || 'Unknown');
    }
    return map;
  }, [staff]);

  // ---- Resolve linked record IDs to display names ----
  function resolveClientName(linkedIds) {
    if (!linkedIds || linkedIds.length === 0) return 'No Client';
    return linkedIds.map((id) => clientMap.get(id) || 'Unknown Client').join(', ');
  }

  function resolveClientId(linkedIds) {
    if (!linkedIds || linkedIds.length === 0) return null;
    return linkedIds[0];
  }

  function resolveStaffName(linkedIds) {
    if (!linkedIds || linkedIds.length === 0) return '—';
    return linkedIds.map((id) => staffMap.get(id) || 'Unknown').join(', ');
  }

  // ---- Normalize into a unified list ----
  const unifiedItems = useMemo(() => {
    const items = [];

    // Environmental compliance deadlines
    for (const rec of deadlines) {
      const f = rec.fields;
      const dueDate = f['Due Date'] || f['Deadline Date'] || null;
      items.push({
        id: rec.id,
        category: 'ENV',
        clientName: resolveClientName(f['Client']),
        clientId: resolveClientId(f['Client']),
        description: f['Deadline Name'] || f['Name'] || 'Unnamed Deadline',
        type: f['Obligation Type'] || f['Type'] || '—',
        dueDate,
        status: f['Status'] || 'Unknown',
        priority: f['Priority'] || null,
        assignedTo: resolveStaffName(f['Assigned To']),
        assignedStaffIds: f['Assigned To'] || [],
        daysUntilDue: daysUntil(dueDate),
      });
    }

    // Safety training records
    for (const rec of trainingRecords) {
      const f = rec.fields;
      const dueDate =
        f['Expiration Date'] || f['Due Date'] || f['Next Due Date'] || null;
      items.push({
        id: rec.id,
        category: 'SAFE',
        clientName: resolveClientName(f['Client']),
        clientId: resolveClientId(f['Client']),
        description:
          f['Program Name'] || f['Training Program'] || f['Name'] || 'Unnamed Training',
        type: f['Program Type'] || f['Type'] || '—',
        dueDate,
        status: f['Status'] || 'Unknown',
        priority: null,
        assignedTo: resolveStaffName(f['Assigned To']),
        assignedStaffIds: f['Assigned To'] || [],
        daysUntilDue: daysUntil(dueDate),
      });
    }

    return items;
  }, [deadlines, trainingRecords, clientMap, staffMap]);

  // ---- Derive filter options from the data ----
  const filterOptions = useMemo(() => {
    const statuses = new Set();
    const types = new Set();
    const staffNames = new Set();

    for (const item of unifiedItems) {
      statuses.add(item.status);
      if (item.type && item.type !== '—') types.add(item.type);
      if (item.assignedStaffIds.length > 0) {
        for (const sid of item.assignedStaffIds) {
          const name = staffMap.get(sid);
          if (name) staffNames.add(name);
        }
      }
    }

    return {
      statuses: [...statuses].sort(),
      types: [...types].sort(),
      staffNames: [...staffNames].sort(),
    };
  }, [unifiedItems, staffMap]);

  const filterConfig = useMemo(
    () => [
      {
        key: 'category',
        label: 'Category',
        options: ['Environmental', 'Safety'],
      },
      {
        key: 'status',
        label: 'Status',
        options: filterOptions.statuses,
      },
      {
        key: 'staff',
        label: 'Assigned To',
        options: filterOptions.staffNames,
      },
      {
        key: 'type',
        label: 'Type',
        options: filterOptions.types,
      },
    ],
    [filterOptions]
  );

  // ---- Apply filters ----
  const filteredItems = useMemo(() => {
    return unifiedItems.filter((item) => {
      if (filterValues.category) {
        if (filterValues.category === 'Environmental' && item.category !== 'ENV')
          return false;
        if (filterValues.category === 'Safety' && item.category !== 'SAFE')
          return false;
      }
      if (filterValues.status && item.status !== filterValues.status) return false;
      if (filterValues.staff && item.assignedTo.indexOf(filterValues.staff) === -1)
        return false;
      if (filterValues.type && item.type !== filterValues.type) return false;
      return true;
    });
  }, [unifiedItems, filterValues]);

  // ---- Sort: overdue first, then by due date ascending ----
  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      const aOverdue = a.daysUntilDue !== null && a.daysUntilDue < 0;
      const bOverdue = b.daysUntilDue !== null && b.daysUntilDue < 0;

      // Overdue items first
      if (aOverdue && !bOverdue) return -1;
      if (!aOverdue && bOverdue) return 1;

      // Among overdue, most overdue first (most negative daysUntilDue)
      if (aOverdue && bOverdue) {
        return (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0);
      }

      // Among upcoming, soonest due first
      if (a.daysUntilDue === null && b.daysUntilDue === null) return 0;
      if (a.daysUntilDue === null) return 1;
      if (b.daysUntilDue === null) return 1;
      return a.daysUntilDue - b.daysUntilDue;
    });
  }, [filteredItems]);

  // ---- Summary stats ----
  const stats = useMemo(() => {
    const totalOverdue = unifiedItems.filter(
      (i) =>
        i.status === 'Overdue' ||
        i.status === 'Expired/Overdue' ||
        (i.daysUntilDue !== null && i.daysUntilDue < 0)
    ).length;

    const envOverdue = unifiedItems.filter(
      (i) =>
        i.category === 'ENV' &&
        (i.status === 'Overdue' || (i.daysUntilDue !== null && i.daysUntilDue < 0))
    ).length;

    const safeOverdue = unifiedItems.filter(
      (i) =>
        i.category === 'SAFE' &&
        (i.status === 'Expired/Overdue' || (i.daysUntilDue !== null && i.daysUntilDue < 0))
    ).length;

    const dueThisWeek = unifiedItems.filter(
      (i) => i.daysUntilDue !== null && i.daysUntilDue >= 0 && i.daysUntilDue <= 7
    ).length;

    return { totalOverdue, envOverdue, safeOverdue, dueThisWeek };
  }, [unifiedItems]);

  // ---- Loading / Error states ----
  const isLoading = deadlinesLoading || trainingLoading || clientsLoading || staffLoading;
  const errors = [deadlinesError, trainingError, clientsError, staffError].filter(
    Boolean
  );
  const hasError = errors.length > 0;

  function handleRetry() {
    refetchDeadlines();
    refetchTraining();
  }

  function handleRowClick(item) {
    if (onClientSelect && item.clientId) {
      onClientSelect(item.clientId);
    }
  }

  // ---- Countdown badge color ----
  function countdownColor(days) {
    if (days === null) return 'text-slate-400';
    if (days < 0) return 'text-red-600 font-semibold';
    if (days === 0) return 'text-red-600 font-semibold';
    if (days <= 7) return 'text-orange-600 font-medium';
    if (days <= 30) return 'text-yellow-600';
    return 'text-slate-500';
  }

  // ---- Render ----
  if (isLoading) {
    return <LoadingSpinner message="Loading action items..." />;
  }

  if (hasError) {
    return (
      <ErrorMessage
        message={`Failed to load data: ${errors.join('; ')}`}
        onRetry={handleRetry}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Action Required</h1>
        <p className="text-sm text-slate-500 mt-1">
          Overdue and upcoming items across environmental compliance and safety training.
        </p>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Overdue"
          value={stats.totalOverdue}
          sublabel="All categories"
          color="red"
        />
        <StatCard
          label="Environmental Overdue"
          value={stats.envOverdue}
          sublabel="Compliance deadlines"
          color="blue"
        />
        <StatCard
          label="Safety Overdue"
          value={stats.safeOverdue}
          sublabel="Training records"
          color="purple"
        />
        <StatCard
          label="Due This Week"
          value={stats.dueThisWeek}
          sublabel="Next 7 days"
          color="orange"
        />
      </div>

      {/* Filters */}
      <FilterBar
        filters={filterConfig}
        values={filterValues}
        onChange={handleFilterChange}
      />

      {/* Results count */}
      <p className="text-xs text-slate-400">
        Showing {sortedItems.length} of {unifiedItems.length} items
      </p>

      {/* Empty state */}
      {unifiedItems.length === 0 && (
        <div className="bg-white rounded-lg border border-slate-200 p-12 text-center">
          <div className="text-4xl mb-3 text-slate-300">&#10003;</div>
          <h3 className="text-lg font-semibold text-slate-600 mb-1">
            No Action Items
          </h3>
          <p className="text-sm text-slate-400">
            There are no overdue or upcoming items at this time. All compliance
            deadlines and training records are current.
          </p>
        </div>
      )}

      {/* Filtered empty state */}
      {unifiedItems.length > 0 && sortedItems.length === 0 && (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center">
          <h3 className="text-base font-semibold text-slate-600 mb-1">
            No Matching Items
          </h3>
          <p className="text-sm text-slate-400">
            No items match the current filters. Try adjusting your filter criteria.
          </p>
        </div>
      )}

      {/* Data Table */}
      {sortedItems.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Category
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Client
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Due Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Priority
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Countdown
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedItems.map((item) => {
                  const priorityColor = item.priority
                    ? getPriorityColor(item.priority)
                    : null;
                  return (
                    <tr
                      key={item.id}
                      onClick={() => handleRowClick(item)}
                      className={`transition-colors duration-100 ${
                        item.clientId
                          ? 'cursor-pointer hover:bg-slate-50'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <CategoryBadge category={item.category} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-slate-800">
                        {item.clientName}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700 max-w-xs truncate">
                        {item.description}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-500">
                        {item.type}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-600">
                        {formatDate(item.dueDate)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {item.priority ? (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${priorityColor.bg} ${priorityColor.text}`}
                          >
                            {item.priority}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`text-sm ${countdownColor(item.daysUntilDue)}`}
                        >
                          {countdownText(item.dueDate)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
