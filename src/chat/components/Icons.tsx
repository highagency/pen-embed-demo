/** Inline icon set — 1.5px stroke, 16px grid, minimal. */
import type { SVGProps } from "react";

const base = (props: SVGProps<SVGSVGElement>): SVGProps<SVGSVGElement> => ({
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  ...props,
});

export const PlusIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
);

export const HistoryIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.8v2.7h2.7" />
    <path d="M8 5.2V8l2 1.4" />
  </svg>
);

export const GearIcon = (p: SVGProps<SVGSVGElement>) => (
  /* proper cog (lucide-style), not a sun */
  <svg {...base({ viewBox: "0 0 24 24", ...p })} strokeWidth={2}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const SunIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2.6" />
    <path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1" />
  </svg>
);

export const MoonIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M13.2 9.4A5.6 5.6 0 1 1 6.6 2.8a4.5 4.5 0 0 0 6.6 6.6z" />
  </svg>
);

export const MonitorIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="2" y="3" width="12" height="8.5" rx="1.5" />
    <path d="M6 14h4M8 11.5V14" />
  </svg>
);

export const BackIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M9.5 3.5 5 8l4.5 4.5" />
  </svg>
);

export const SendIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M8 12.5v-9M3.8 7.2 8 3l4.2 4.2" />
  </svg>
);

export const StopIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="4.5" y="4.5" width="7" height="7" rx="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const ToolIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M9.8 2.6a3.4 3.4 0 0 0-4.5 4.1L2 10a1.6 1.6 0 1 0 2.3 2.3l3.9-3.4a3.4 3.4 0 0 0 4.6-4.4l-2 2-2.1-.6-.5-2.1 1.6-1.2z" />
  </svg>
);

export const ChevronDownIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m4 6 4 4 4-4" />
  </svg>
);

export const CheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m3 8.5 3.2 3L13 4.5" />
  </svg>
);

export const TrashIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8" />
  </svg>
);

export const CopyIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="5.5" y="5.5" width="7" height="7" rx="1.2" />
    <path d="M3.5 10.5v-6a1 1 0 0 1 1-1h6" />
  </svg>
);

export const SparkIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M8 2.2 9.3 6 13 7.3 9.3 8.6 8 12.4 6.7 8.6 3 7.3 6.7 6z" />
  </svg>
);

export const GlobeIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="5.6" />
    <path d="M2.4 8h11.2M8 2.4c-3.4 3.4-3.4 7.8 0 11.2M8 2.4c3.4 3.4 3.4 7.8 0 11.2" />
  </svg>
);

export const FilePlusIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M9 2H4.8a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h6.4a1 1 0 0 0 1-1V5.2z" />
    <path d="M9 2v3.2h3.2M8 7.8v3.4M6.3 9.5h3.4" />
  </svg>
);

export const FolderIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.4l1.5 1.6h5.1A1.5 1.5 0 0 1 14 6.1v5.4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
  </svg>
);
