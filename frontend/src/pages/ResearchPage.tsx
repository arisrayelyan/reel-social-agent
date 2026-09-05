import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/design';
import { ResearchDesk } from '@/components/research/ResearchDesk';
import { RunsTable } from '@/components/research/RunsTable';
import { useResearchRuns } from '@/hooks/useResearch';

/** Research desk: start a run at the top, every run ever made in the table below. */
export function ResearchPage() {
  const navigate = useNavigate();
  const { data: runs, isLoading } = useResearchRuns();
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <ResearchDesk onStarted={(id) => navigate(`/research/${id}`)} />
      {isLoading ? <Card>Loading…</Card> : <RunsTable runs={runs ?? []} />}
    </div>
  );
}
