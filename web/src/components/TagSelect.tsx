import type { Member } from '../lib/api';
import { Select } from './ui';

// Picks a family member or cost centre; renders nothing until at least one exists.
export function TagSelect({
  label,
  items,
  value,
  onChange,
  className = '!min-h-9',
}: {
  label: string;
  items: Member[];
  value: string | null;
  onChange: (id: string | null) => void;
  className?: string;
}) {
  const options = items.filter((m) => !m.archived || m.id === value);
  if (options.length === 0) return null;
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={className} aria-label={label}>
      <option value="">{label}: –</option>
      {options.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </Select>
  );
}
