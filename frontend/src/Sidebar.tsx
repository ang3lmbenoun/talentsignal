import { Menu } from "lucide-react";
import type { ReactNode } from "react";

interface SidebarProps {
  // App.tsx still builds each RoleGate-wrapped nav button exactly as it did
  // before this redesign — Sidebar only supplies the persistent left-hand
  // frame (logo header + vertical list) around whatever nav items it's
  // handed. No role logic lives here.
  children: ReactNode;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function Sidebar({ children, collapsed, onToggleCollapsed }: SidebarProps) {
  return (
    <aside className={collapsed ? "sidebar collapsed" : "sidebar"} aria-label="main navigation">
      <div className="sidebar-brand">
        <svg className="sidebar-brand-mark" viewBox="0 0 32 32" aria-hidden="true">
          <rect x="1" y="1" width="30" height="30" rx="9" fill="currentColor" />
          <path d="M6 18h5l3-7 4 11 3-7h5" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="26" cy="15" r="1.5" fill="white" />
        </svg>
        <span className="sidebar-brand-name">TalentSignal</span>
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="sidebar-collapse-toggle"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <Menu size={15} aria-hidden="true" />
        </button>
      </div>
      <nav className="sidebar-nav">{children}</nav>
    </aside>
  );
}
