import type { ReactNode } from 'react';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterGroup {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}

/** Filter chips for the category browser (plan section 8). */
export function FilterBar({ groups }: { groups: FilterGroup[] }): ReactNode {
  const visible = groups.filter((group) => group.options.length > 0);
  if (visible.length === 0) return null;
  return (
    <div className="filters">
      {visible.map((group) => (
        <div className="filters__group" key={group.label}>
          <span className="filters__label">{group.label}</span>
          <div className="chips">
            <button
              type="button"
              className={`chip ${group.value === '' ? 'chip--active' : ''}`}
              onClick={() => group.onChange('')}
            >
              All
            </button>
            {group.options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`chip ${group.value === option.value ? 'chip--active' : ''}`}
                onClick={() => group.onChange(group.value === option.value ? '' : option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
