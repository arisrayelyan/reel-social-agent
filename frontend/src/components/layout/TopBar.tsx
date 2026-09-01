import { useLocation } from 'react-router-dom';
import { useStats } from '@/hooks/useStats';

function pageTitle(pathname: string): string {
  if (pathname === '/') return 'Dashboard';
  if (pathname.startsWith('/generate')) return 'Generate story';
  if (pathname.startsWith('/videos/')) return 'Video';
  if (pathname.startsWith('/settings')) return 'Settings';
  return '';
}

export function TopBar() {
  const { pathname } = useLocation();
  const { data: stats } = useStats();

  return (
    <header
      style={{
        height: 44,
        flexShrink: 0,
        borderBottom: '1px solid var(--line)',
        background: 'var(--bg-1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600 }}>{pageTitle(pathname)}</div>
      {stats && (
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text-2)',
            display: 'flex',
            gap: 18,
          }}
        >
          <span>{stats.total_videos} videos</span>
          <span style={{ color: 'var(--accent)' }}>${stats.total_cost_usd.toFixed(2)} spent</span>
        </div>
      )}
    </header>
  );
}
