import { CATEGORY_COLORS } from '../utils/status';

export default function CategoryBadge({ category }) {
  const color = CATEGORY_COLORS[category] || CATEGORY_COLORS.ENV;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${color.bg} ${color.text} border ${color.border}`}>
      {category}
    </span>
  );
}
