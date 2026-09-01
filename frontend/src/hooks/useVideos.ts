import { useQuery } from '@tanstack/react-query';
import type { Video } from '@reel-agent/shared';
import { api } from '@/lib/api';

const LIVE_STATUSES = new Set(['draft', 'rendering', 'publishing', 'approved']);

export function useVideos() {
  return useQuery<Video[]>({
    queryKey: ['videos'],
    queryFn: () => api.get<Video[]>('/api/videos').then((r) => r.data),
    // cheap polling insurance while anything is rendering (SSE covers detail view)
    refetchInterval: (query) =>
      query.state.data?.some((v) => LIVE_STATUSES.has(v.status)) ? 3_000 : false,
  });
}
