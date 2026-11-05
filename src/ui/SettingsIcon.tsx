import type { ReactNode } from "react";
/** Consistent 20px stroke icons: no emoji, font glyphs or platform-dependent symbols. */
export type SettingsIconName = "wallet" | "clock" | "target" | "power" | "database" | "book" | "chevron";
export function SettingsIcon({ name, size = 20 }: { name: SettingsIconName; size?: number }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<SettingsIconName, ReactNode> = {
    wallet: <><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M5 6V4a2 2 0 0 1 2-2h11"/><path d="M16 12h5v5h-5a2.5 2.5 0 0 1 0-5Z"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
    power: <><path d="M12 2v10"/><path d="M7.2 4.8a9 9 0 1 0 9.6 0"/></>,
    database: <><ellipse cx="12" cy="5" rx="8.5" ry="3"/><path d="M3.5 5v14c0 1.65 3.8 3 8.5 3s8.5-1.35 8.5-3V5"/><path d="M3.5 12c0 1.65 3.8 3 8.5 3s8.5-1.35 8.5-3"/></>,
    book: <><path d="M3 5.5c3-1.5 6-1.5 9 0 3-1.5 6-1.5 9 0v14c-3-1.5-6-1.5-9 0-3-1.5-6-1.5-9 0Z"/><path d="M12 5.5v14"/></>,
    chevron: <path d="m9 6 6 6-6 6"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" {...common} aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
