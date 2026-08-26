/** Satir ici SVG simgeler — harici simge paketi yok. */
type Props = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const IconUpload = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m17 8-5-5-5 5" />
    <path d="M12 3v13" />
  </svg>
);

export const IconBox = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="m21 16-9 5-9-5V8l9-5 9 5z" />
    <path d="M3.3 7 12 12l8.7-5" />
    <path d="M12 22V12" />
  </svg>
);

export const IconSettings = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
  </svg>
);

export const IconQr = ({ size = 16, className }: Props) => (
  <svg {...base(size)} className={className}>
    <rect width="7" height="7" x="3" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="3" rx="1" />
    <rect width="7" height="7" x="3" y="14" rx="1" />
    <path d="M14 14h3v3h-3zM18 18h3v3h-3z" />
  </svg>
);

export const IconLink = ({ size = 16, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </svg>
);

export const IconCopy = ({ size = 16, className }: Props) => (
  <svg {...base(size)} className={className}>
    <rect width="13" height="13" x="9" y="9" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const IconCheck = ({ size = 16, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const IconTrash = ({ size = 16, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

export const IconClock = ({ size = 16, className }: Props) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const IconBan = ({ size = 16, className }: Props) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="m5.6 5.6 12.8 12.8" />
  </svg>
);

export const IconLock = ({ size = 14, className }: Props) => (
  <svg {...base(size)} className={className}>
    <rect width="16" height="11" x="4" y="11" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export const IconEye = ({ size = 14, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconDownload = ({ size = 14, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 10 5 5 5-5" />
    <path d="M12 15V3" />
  </svg>
);

export const IconWarn = ({ size = 18, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

export const IconLogout = ({ size = 16, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

export const IconClose = ({ size = 16, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

export const IconNote = ({ size = 16, className }: Props) => (
  <svg {...base(size)} className={className}>
    <rect width="16" height="18" x="4" y="3" rx="2" />
    <path d="M8 8h8" />
    <path d="M8 12h8" />
    <path d="M8 16h4" />
  </svg>
);

/** Acilir-kapanir alanlarin oku; kapali durumda asagi bakar, acikken CSS ile donderilir. */
export const IconChevron = ({ size = 16, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const IconApple = ({ size = 22, className }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M17.05 12.54c-.02-2.2 1.8-3.26 1.88-3.31-1.02-1.5-2.61-1.7-3.18-1.72-1.35-.14-2.64.79-3.33.79-.68 0-1.74-.77-2.87-.75-1.47.02-2.83.86-3.59 2.17-1.53 2.66-.39 6.6 1.1 8.75.73 1.06 1.6 2.24 2.74 2.2 1.1-.05 1.52-.71 2.85-.71s1.7.71 2.87.69c1.19-.02 1.94-1.07 2.66-2.13.84-1.22 1.19-2.4 1.2-2.46-.03-.01-2.3-.88-2.33-3.52zM14.9 5.9c.6-.73 1.01-1.75.9-2.76-.87.03-1.92.58-2.55 1.31-.56.64-1.05 1.68-.92 2.67.97.07 1.96-.49 2.57-1.22z" />
  </svg>
);

/**
 * Android robot basi: yarim disk kafa, iki goz (evenodd ile delik) ve iki anten.
 * 12 px'te de okunsun diye geometri kaba tutuldu.
 *
 * Kutuyu dolduracak sekilde olceklendi: yan yana durdugu IconApple 24'luk
 * kutuda ~18 birim yuksekliginde, robot basi ise dogasi geregi genis ve
 * basiktir — kucuk cizilirse markanin yaninda sonradan eklenmis gibi durur.
 */
export const IconAndroid = ({ size = 22, className }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path
      fillRule="evenodd"
      d="M3.2 18.6a8.8 8.8 0 0 1 17.6 0v1H3.2zM7.7 13.8a1.3 1.3 0 1 0 2.6 0 1.3 1.3 0 1 0-2.6 0zm6 0a1.3 1.3 0 1 0 2.6 0 1.3 1.3 0 1 0-2.6 0z"
    />
    <path
      d="M6.9 11.4 4.6 6.4M17.1 11.4l2.3-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
  </svg>
);
