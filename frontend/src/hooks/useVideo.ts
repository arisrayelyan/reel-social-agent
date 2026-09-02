import { useQuery } from '@tanstack/react-query';
import type { Asset, GenerationRun, Publication, Video, VideoEvent } from '@reel-agent/shared';
import { api } from '@/lib/api';

export interface VideoDetail extends Video {
  assets: Asset[];
  runs: GenerationRun[];
  publications: Publication[];
  events: VideoEvent[];
}

const LIVE_STATUSES = new Set(['draft', 'approved', 'rendering', 'publishing']);

export function useVideo(id: number) {
  return useQuery<VideoDetail>({
    queryKey: ['videos', String(id)],
    queryFn: () => api.get<VideoDetail>(`/api/videos/${id}`).then((r) => r.data),
    enabled: Number.isFinite(id),
    // polling insurance while the script writes or the pipeline runs (SSE is primary)
    refetchInterval: (query) =>
      query.state.data && LIVE_STATUSES.has(query.state.data.status) ? 3_000 : false,
  });
}
