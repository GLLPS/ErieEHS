export default function StatCard({ label, value, sublabel, color = 'blue', icon }) {
  const colorMap = {
    blue: 'border-blue-500 bg-blue-50 text-blue-700',
    red: 'border-red-500 bg-red-50 text-red-700',
    green: 'border-green-500 bg-green-50 text-green-700',
    yellow: 'border-yellow-500 bg-yellow-50 text-yellow-700',
    purple: 'border-purple-500 bg-purple-50 text-purple-700',
    orange: 'border-orange-500 bg-orange-50 text-orange-700',
    slate: 'border-slate-400 bg-slate-50 text-slate-700',
  };

  return (
    <div className={`bg-white rounded-lg border-l-4 ${colorMap[color] || colorMap.blue} p-4 shadow-sm`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          {sublabel && <p className="text-xs text-slate-500 mt-0.5">{sublabel}</p>}
        </div>
        {icon && <div className="text-2xl opacity-60">{icon}</div>}
      </div>
    </div>
  );
}
