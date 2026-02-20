import { getStatusColor } from '../utils/status';

export default function StatusBadge({ status }) {
  if (!status) return null;
  const color = getStatusColor(status);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${color.bg} ${color.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${color.dot}`} />
      {status}
    </span>
  );
}
