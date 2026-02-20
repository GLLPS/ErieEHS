export default function FilterBar({ filters, values, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      {filters.map((filter) => (
        <div key={filter.key} className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            {filter.label}
          </label>
          <select
            value={values[filter.key] || ''}
            onChange={(e) => onChange(filter.key, e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-2 py-1 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="">All</option>
            {filter.options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}
