import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CandidateFeedbackBody,
  ResearchRun,
  StartResearchBody,
  StoryCandidate,
} from '@reel-agent/shared';
import { api } from '@/lib/api';

export interface ResearchRunDetail extends ResearchRun {
  candidates: StoryCandidate[];
}

function errorMessage(err: unknown): string {
  const axiosErr = err as { response?: { data?: { error?: string } }; message?: string };
  return axiosErr.response?.data?.error ?? axiosErr.message ?? 'Request failed';
}

export function useResearchRuns() {
  return useQuery<ResearchRun[]>({
    queryKey: ['research'],
    queryFn: () => api.get<ResearchRun[]>('/api/research/runs').then((r) => r.data),
    refetchInterval: (query) => (query.state.data?.some((r) => r.status === 'running') ? 3_000 : false),
  });
}

export function useResearchRun(id: number | null) {
  return useQuery<ResearchRunDetail>({
    queryKey: ['research', String(id)],
    queryFn: () => api.get<ResearchRunDetail>(`/api/research/runs/${id}`).then((r) => r.data),
    enabled: id !== null && Number.isFinite(id),
    // a reasoning model takes minutes; poll until the run settles
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 3_000 : false),
  });
}

export function useResearchMutations() {
  const queryClient = useQueryClient();
  const invalidate = (runId?: number) => {
    void queryClient.invalidateQueries({ queryKey: ['research'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
    if (runId) void queryClient.invalidateQueries({ queryKey: ['research', String(runId)] });
  };

  const startResearch = useMutation({
    mutationFn: (body: StartResearchBody) =>
      api.post<{ run: ResearchRun }>('/api/research/runs', body).then((r) => r.data),
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const setFeedback = useMutation({
    mutationFn: (params: { candidateId: number; runId: number } & CandidateFeedbackBody) => {
      const { candidateId, runId: _runId, ...body } = params;
      return api.patch<StoryCandidate>(`/api/research/candidates/${candidateId}/feedback`, body).then((r) => r.data);
    },
    onSuccess: (_data, params) => invalidate(params.runId),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const deleteRun = useMutation({
    mutationFn: (id: number) => api.delete(`/api/research/runs/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success('Research run deleted');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return { startResearch, setFeedback, deleteRun };
}
