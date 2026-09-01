import { useQuery } from '@tanstack/react-query';
import type { Asset, GenerationRun, Publication, Video } from '@reel-agent/shared';
import { api } from '@/lib/api';

export interface VideoDetail extends Video {
  assets: Asset[];
  runs: GenerationRun[];
  publications: Publication[];
}

export function useVideo(id: number) {
  return useQuery<VideoDetail>({
    queryKey: ['videos', String(id)],
    queryFn: () => api.get<VideoDetail>(`/api/videos/${id}`).then((r) => r.data),
    enabled: Number.isFinite(id),
  });
}
