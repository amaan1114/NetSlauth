import type { ReactNode, SVGProps } from "react";

export type IconName = "overview" | "agents" | "events" | "alerts" | "settings" | "menu" | "close" | "logout" | "chevron" | "layers" | "folder" | "shield" | "refresh" | "warning" | "user";

const paths: Record<IconName, ReactNode> = {
  overview: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  agents: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.2 2" /></>,
  events: <><path d="M4 5.5h16M4 12h16M4 18.5h16" /><circle cx="7" cy="5.5" r="1" fill="currentColor" /><circle cx="14" cy="12" r="1" fill="currentColor" /></>,
  alerts: <><path d="M12 3.5 21 20H3l9-16.5Z" /><path d="M12 9v4.5M12 17h.01" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" transform="translate(-1 -1) scale(.98)" /></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
  chevron: <path d="m7 10 5 5 5-5" />,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
  folder: <><path d="M3.5 6.5h6l2 2h9v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" /></>,
  shield: <><path d="M12 3 20 6v5c0 5.2-3.4 8.6-8 10-4.6-1.4-8-4.8-8-10V6l8-3Z" /><path d="m9 12 2 2 4-4" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.7 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.3-3" /></>,
  warning: <><path d="M12 3.5 21 20H3l9-16.5Z" /><path d="M12 9v4.5M12 17h.01" /></>,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
};

export function Icon({ name, size = 16, ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {paths[name]}
    </svg>
  );
}
