/** The icons under a chat message (copy, listen, stop, retry, edit). One rounded set, 16px
 *  with a 2px stroke like the rest of the small controls. */

type IconProps = { size?: number };

function Icon({ size = 16, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function CopyIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="8.5" y="8.5" width="12.5" height="12.5" rx="3.5" />
      <path d="M15.5 8.5V6.5A3.5 3.5 0 0 0 12 3H6.5A3.5 3.5 0 0 0 3 6.5V12a3.5 3.5 0 0 0 3.5 3.5h2" />
    </Icon>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Icon>
  );
}

export function SpeakerIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4.5 9H7l4.2-3.6a.8.8 0 0 1 1.3.6v12a.8.8 0 0 1-1.3.6L7 15H4.5A1.5 1.5 0 0 1 3 13.5v-3A1.5 1.5 0 0 1 4.5 9z" />
      <path d="M16 9.2a4 4 0 0 1 0 5.6" />
      <path d="M19 6.5a8 8 0 0 1 0 11" />
    </Icon>
  );
}

export function StopIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="6" y="6" width="12" height="12" rx="3" fill="currentColor" />
    </Icon>
  );
}

export function RetryIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9L20 8.5" />
      <path d="M20 3.5v5h-5" />
    </Icon>
  );
}

export function EditIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M16.6 4.2a2.1 2.1 0 0 1 3 3L8.5 18.3 4 19.5l1.2-4.5z" />
      <path d="M14.5 6.3l3 3" />
    </Icon>
  );
}
