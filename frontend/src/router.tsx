import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { GeneratePage } from './pages/GeneratePage';
import { VideoDetailPage } from './pages/VideoDetailPage';
import { SettingsPage } from './pages/SettingsPage';
import { ResearchPage } from './pages/ResearchPage';
import { ResearchRunPage } from './pages/ResearchRunPage';

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/research', element: <ResearchPage /> },
      { path: '/research/:id', element: <ResearchRunPage /> },
      { path: '/generate', element: <GeneratePage /> },
      { path: '/videos/:id', element: <VideoDetailPage /> },
      { path: '/settings', element: <SettingsPage /> },
    ],
  },
]);
