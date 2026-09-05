import { Link, useLocation } from 'react-router-dom';
import { Clapperboard, LayoutDashboard, Settings, Sparkles, Telescope } from 'lucide-react';
import { useVideos } from '@/hooks/useVideos';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/research', label: 'Research', icon: Telescope, exact: false },
  { to: '/generate', label: 'Generate', icon: Sparkles, exact: false },
  { to: '/settings', label: 'Settings', icon: Settings, exact: false },
];

export function AppSidebar() {
  const { pathname } = useLocation();
  const { data: videos } = useVideos();
  const needsReview =
    videos?.filter((v) => v.status === 'story_review' || v.status === 'render_review') ?? [];

  return (
    <aside
      style={{
        width: 232,
        flexShrink: 0,
        borderRight: '1px solid var(--line)',
        background: 'var(--bg-1)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Clapperboard size={18} color="var(--accent)" />
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em' }}>Reel Agent</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>
            @oneminutewtf
          </div>
        </div>
      </div>

      <nav style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map(({ to, label, icon: Icon, exact }) => {
          const active = exact ? pathname === to : pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--text-1)' : 'var(--text-2)',
                background: active ? 'var(--bg-2)' : 'transparent',
              }}
            >
              <Icon size={15} color={active ? 'var(--accent)' : 'var(--text-3)'} />
              {label}
            </Link>
          );
        })}
      </nav>

      {needsReview.length > 0 && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)', marginTop: 'auto' }}>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--text-3)',
              marginBottom: 8,
            }}
          >
            Awaiting review
          </div>
          {needsReview.slice(0, 5).map((v) => (
            <Link
              key={v.id}
              to={`/videos/${v.id}`}
              style={{
                display: 'block',
                fontSize: 12,
                color: 'var(--info)',
                padding: '3px 0',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {v.topic}
            </Link>
          ))}
        </div>
      )}
    </aside>
  );
}
