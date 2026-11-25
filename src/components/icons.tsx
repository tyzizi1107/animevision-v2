import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function StrokeIcon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M8.4 4.6a1 1 0 0 1 1.52-.85l9.1 6.4a1 1 0 0 1 0 1.7l-9.1 6.4a1 1 0 0 1-1.52-.85z" />
    </svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <rect x="6" y="4.5" width="4" height="15" rx="1.3" />
      <rect x="14" y="4.5" width="4" height="15" rx="1.3" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M12 5v14M5 12h14" />
    </StrokeIcon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="m20 6-11 11-5-5" />
    </StrokeIcon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20.5 20.5-4.2-4.2" />
    </StrokeIcon>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M3.5 10.5 12 3.5l8.5 7V20a1.5 1.5 0 0 1-1.5 1.5h-4.5v-6h-5v6H5A1.5 1.5 0 0 1 3.5 20z" />
    </StrokeIcon>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </StrokeIcon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </StrokeIcon>
  );
}

export function EditIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="m14.5 6.5 3 3M4 20l4.4-.9L19 8.5a2.1 2.1 0 0 0-3-3L5.4 16.1 4 20Z" />
    </StrokeIcon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="m15 18-6-6 6-6" />
    </StrokeIcon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="m9 18 6-6-6-6" />
    </StrokeIcon>
  );
}

export function BookmarkIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M19 21 12 16.8 5 21V5.4A2.4 2.4 0 0 1 7.4 3h9.2A2.4 2.4 0 0 1 19 5.4z" />
    </StrokeIcon>
  );
}

export function StarIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M12 3.2l2.65 5.5 6.05.86-4.4 4.25 1.06 6.02L12 16.96l-5.36 2.87 1.06-6.02L3.3 9.56l6.05-.86z" />
    </svg>
  );
}

export function VolumeIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M11 5 6.5 8.8H3v6.4h3.5L11 19z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </StrokeIcon>
  );
}

export function VolumeOffIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M11 5 6.5 8.8H3v6.4h3.5L11 19z" />
      <path d="m16 9 5 6M21 9l-5 6" />
    </StrokeIcon>
  );
}

export function FullscreenIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
    </StrokeIcon>
  );
}

export function ExitFullscreenIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M8 21v-3a2 2 0 0 0-2-2H3M16 21v-3a2 2 0 0 1 2-2h3" />
    </StrokeIcon>
  );
}

export function RewindIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M3 10a9 9 0 1 1 2.6 8.4" />
      <path d="M3 4.5V10h5.5" />
    </StrokeIcon>
  );
}

export function ForwardIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M21 10a9 9 0 1 0-2.6 8.4" />
      <path d="M21 4.5V10h-5.5" />
    </StrokeIcon>
  );
}

export function SkipNextIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M5 5.6a1 1 0 0 1 1.55-.83L14 10v-3.4a1 1 0 0 1 1.55-.83l6 4.6a1 1 0 0 1 0 1.66l-6 4.6A1 1 0 0 1 14 16.8V14l-7.45 5.23A1 1 0 0 1 5 18.4z" />
    </svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
      <circle cx="16" cy="8" r="2" />
      <circle cx="10" cy="16" r="2" />
    </StrokeIcon>
  );
}

export function PipIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <rect x="12" y="12" width="7" height="5" rx="1.2" fill="currentColor" stroke="none" />
    </StrokeIcon>
  );
}

export function LoaderIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </StrokeIcon>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </StrokeIcon>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </StrokeIcon>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13h10l1-13" />
    </StrokeIcon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3.2 2" />
    </StrokeIcon>
  );
}

export function SparklesIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9z" />
      <path d="M19 16.5v3M17.5 18h3" />
    </StrokeIcon>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </StrokeIcon>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
      <path d="M16 17l5-5-5-5M21 12H10" />
    </StrokeIcon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="m6 9 6 6 6-6" />
    </StrokeIcon>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M18 8a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 14 18 8" />
      <path d="M10.3 20a2 2 0 0 0 3.4 0" />
    </StrokeIcon>
  );
}

export function MegaphoneIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M3 11v3a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z" />
      <path d="M14 8a5 5 0 0 1 0 8M17 5a9 9 0 0 1 0 14" />
    </StrokeIcon>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M12 3 5 6v6c0 4.4 3 7.4 7 9 4-1.6 7-4.6 7-9V6z" />
      <path d="m9 12 2 2 4-4" />
    </StrokeIcon>
  );
}

export function MonitorIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </StrokeIcon>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </StrokeIcon>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A10.9 10.9 0 0 1 12 6c6.4 0 10 6 10 6a17.7 17.7 0 0 1-3.4 4.1M6.3 7.6A17.4 17.4 0 0 0 2 12s3.6 6.5 10 6.5a10.9 10.9 0 0 0 4.1-.8" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </StrokeIcon>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </StrokeIcon>
  );
}

export function ExternalLinkIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </StrokeIcon>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M8 3v4M16 3v4M3 10h18" />
      <path d="M8 14h2M14 14h2M8 17.5h2M14 17.5h2" />
    </StrokeIcon>
  );
}

export function AlertTriangleIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </StrokeIcon>
  );
}

export function ListVideoIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="3" y="4.5" width="12" height="9" rx="2" />
      <path d="M7.5 17.5h13M7.5 21h9" />
      <path d="M7.2 7v4l3.2-2z" fill="currentColor" stroke="none" />
    </StrokeIcon>
  );
}
