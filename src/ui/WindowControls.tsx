import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ReactNode } from "react";
import logo from "../../assets/logo/app-icon-24.png";

export const windowsShell = /\bWindows\b/.test(navigator.userAgent);

function IconButton({
  label,
  pressed,
  children,
  click,
  disabled,
}: {
  label: string;
  pressed?: boolean;
  children: ReactNode;
  click: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="window-control"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={click}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="17"
        height="17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  );
}

export function WindowControls({
  pinned,
  dark,
  busy,
  togglePin,
  toggleTheme,
  report,
}: {
  pinned: boolean;
  dark: boolean;
  busy: boolean;
  togglePin: () => void;
  toggleTheme: () => void;
  report: (error: unknown) => void;
}) {
  return (
    <div className="window-controls">
      <IconButton
        label={pinned ? "取消置顶" : "置顶窗口"}
        pressed={pinned}
        click={togglePin}
        disabled={busy}
      >
        <path
          fill={pinned ? "currentColor" : "none"}
          d="M8 4h8l-1 6 3 4v2H6v-2l3-4-1-6Z"
        />
        <path d="M12 16v5" />
      </IconButton>
      <IconButton
        label={dark ? "切换到浅色主题" : "切换到深色主题"}
        pressed={dark}
        click={toggleTheme}
        disabled={busy}
      >
        {dark ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
          </>
        ) : (
          <path d="M20.6 14.1A9 9 0 0 1 9.9 3.4a9 9 0 1 0 10.7 10.7Z" />
        )}
      </IconButton>
      {windowsShell && (
        <>
          <IconButton
            label="最小化"
            click={() => void getCurrentWindow().minimize().catch(report)}
          >
            <path d="M5 12h14" />
          </IconButton>
          <IconButton
            label="关闭窗口"
            click={() => void getCurrentWindow().close().catch(report)}
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </IconButton>
        </>
      )}
    </div>
  );
}

export function WindowsTitleBar({
  children,
  report,
}: {
  children?: ReactNode;
  report: (error: unknown) => void;
}) {
  return (
    <header className="windows-titlebar">
      <div
        className="window-drag"
        onMouseDown={(event) => {
          if (event.button === 0)
            void getCurrentWindow().startDragging().catch(report);
        }}
      >
        <img src={logo} alt="" />
        <span>上班鼓励器</span>
      </div>
      {children}
    </header>
  );
}
