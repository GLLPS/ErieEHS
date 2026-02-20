// Status badge colors
export const STATUS_COLORS = {
  // Compliance deadline statuses
  Overdue: { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' },
  'Expired/Overdue': { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' },
  Upcoming: { bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-500' },
  'Expiring Soon': { bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-500' },
  'In Progress': { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' },
  Completed: { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  Current: { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  Scheduled: { bg: 'bg-purple-100', text: 'text-purple-700', dot: 'bg-purple-500' },
  Active: { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  Inactive: { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  Closed: { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  Waived: { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-400' },
  Cancelled: { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-400' },
  'N/A': { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-400' },
};

const DEFAULT_COLOR = { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' };

export function getStatusColor(status) {
  return STATUS_COLORS[status] || DEFAULT_COLOR;
}

// Priority colors
export const PRIORITY_COLORS = {
  High: { bg: 'bg-red-100', text: 'text-red-700' },
  Medium: { bg: 'bg-yellow-100', text: 'text-yellow-700' },
  Low: { bg: 'bg-green-100', text: 'text-green-700' },
};

export function getPriorityColor(priority) {
  return PRIORITY_COLORS[priority] || DEFAULT_COLOR;
}

// Category badge colors (Environmental vs Safety)
export const CATEGORY_COLORS = {
  ENV: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-200' },
  SAFE: { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-200' },
};

// Training matrix cell colors
export const TRAINING_STATUS_COLORS = {
  Current: 'bg-emerald-500 text-white',
  'Expiring Soon': 'bg-yellow-400 text-yellow-900',
  'Expired/Overdue': 'bg-red-500 text-white',
  Scheduled: 'bg-purple-500 text-white',
  Waived: 'bg-gray-300 text-gray-600',
  'Not Required': 'bg-gray-100 text-gray-400',
};
