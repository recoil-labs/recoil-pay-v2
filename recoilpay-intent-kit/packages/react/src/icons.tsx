// Inline icons so the package has no icon-library dependency. 16px grid,
// stroked with currentColor so they take the surrounding text colour.

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const ArrowRight = () => (
  <svg {...base}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
);

export const Check = () => (
  <svg {...base}>
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);

export const Cross = () => (
  <svg {...base}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const Alert = () => (
  <svg {...base}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v3.5M8 11h.01" />
  </svg>
);

export const Spinner = () => (
  <svg {...base} className="rp-spin">
    <path d="M8 2a6 6 0 1 0 6 6" />
  </svg>
);

export const Route = () => (
  <svg {...base}>
    <circle cx="4" cy="12" r="1.5" />
    <circle cx="12" cy="4" r="1.5" />
    <path d="M5.5 12H10a2 2 0 0 0 0-4H6a2 2 0 0 1 0-4h4.5" />
  </svg>
);

export const External = () => (
  <svg {...base} width={12} height={12}>
    <path d="M6 3H3v10h10v-3M9 3h4v4M13 3L7 9" />
  </svg>
);
