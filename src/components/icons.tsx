/** Minimal line icons (stroke = currentColor). No icon library needed. */
export type IconName =
  | 'home' | 'grid' | 'list' | 'briefcase' | 'inbox' | 'check'
  | 'chart' | 'device' | 'gear' | 'folder' | 'shield' | 'plus' | 'sliders'

const PATHS: Record<IconName, string> = {
  home: 'M3 10.5 12 3l9 7.5M5.5 8.8V20h13V8.8',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  briefcase: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  inbox: 'M4 4h16v16H4zM4 14h5l1.5 2h3L15 14h5',
  check: 'M20 6 9 17l-5-5',
  chart: 'M4 20V10M10 20V4M16 20v-8M20 20H2',
  device: 'M3 5h18v11H3zM8 20h8M12 16v4',
  gear: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1',
  folder: 'M3 6h6l2 2h10v11H3zM3 8v11',
  shield: 'M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3zM9 12l2 2 4-4',
  plus: 'M4 4h16v16H4zM12 8.5v7M8.5 12h7',
  sliders: 'M4 7h16M4 12h16M4 17h16M9 5v4M15 10v4M7 15v4',
}

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" style={{ flexShrink: 0 }}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
