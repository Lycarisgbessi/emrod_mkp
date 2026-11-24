import React from 'react';

export const SkeletonGrid: React.FC<{ count?: number }> = ({ count = 3 }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="rounded-[var(--radius-m)] border border-[var(--color-line)] bg-[var(--color-surface)] overflow-hidden"
        >
          <div className="aspect-[4/3] emrod-skeleton" />
          <div className="p-5 space-y-3">
            <div className="h-3 w-1/2 rounded emrod-skeleton" />
            <div className="h-5 w-4/5 rounded emrod-skeleton" />
            <div className="h-3 w-2/3 rounded emrod-skeleton" />
            <div className="pt-3 border-t border-[var(--color-line)] flex justify-between items-center">
              <div className="h-4 w-28 rounded emrod-skeleton" />
              <div className="h-9 w-24 rounded emrod-skeleton" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
