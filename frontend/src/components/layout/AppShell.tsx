import { Outlet } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppSidebar } from './AppSidebar';
import { TopBar } from './TopBar';

export function AppShell() {
  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <AppSidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar />
        <main style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          <Outlet />
        </main>
      </div>
      <Toaster theme="dark" position="bottom-right" richColors />
    </div>
  );
}
