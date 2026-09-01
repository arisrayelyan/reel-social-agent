import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { GenerateStoryBody, TopicIdeas, Video } from '@reel-agent/shared';
import { api } from '@/lib/api';

export interface GenerateStoryResponse {
  video: Video;
  warnings: string[];
  totals: { words: number; seconds: number };
}

function errorMessage(err: unknown): string {
  const axiosErr = err as { response?: { data?: { error?: string } }; message?: string };
  return axiosErr.response?.data?.error ?? axiosErr.message ?? 'Request failed';
}

export function useVideoMutations() {
  const queryClient = useQueryClient();
  const invalidate = (id?: number) => {
    void queryClient.invalidateQueries({ queryKey: ['videos'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
    if (id) void queryClient.invalidateQueries({ queryKey: ['videos', String(id)] });
  };

  const generateStory = useMutation({
    mutationFn: (body: GenerateStoryBody) =>
      api.post<GenerateStoryResponse>('/api/generate/story', body).then((r) => r.data),
    onSuccess: (data) => {
      invalidate(data.video.id);
      data.warnings.forEach((w) => toast.warning(w));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const suggestTopics = useMutation({
    mutationFn: (body: { provider: string; count: number }) =>
      api.post<TopicIdeas>('/api/generate/topics', body).then((r) => r.data),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const approveStory = useMutation({
    mutationFn: (id: number) => api.post(`/api/videos/${id}/approve-story`),
    onSuccess: (_data, id) => {
      invalidate(id);
      toast.success('Story approved — render started');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const approveRender = useMutation({
    mutationFn: (id: number) => api.post(`/api/videos/${id}/approve-render`),
    onSuccess: (_data, id) => {
      invalidate(id);
      toast.success('Publishing to TikTok drafts');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const retry = useMutation({
    mutationFn: (id: number) => api.post(`/api/videos/${id}/retry`),
    onSuccess: (_data, id) => {
      invalidate(id);
      toast.success('Retrying failed step (existing assets are reused)');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const deleteVideo = useMutation({
    mutationFn: (id: number) => api.delete(`/api/videos/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success('Video deleted');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const selectTake = useMutation({
    mutationFn: (params: { assetId: number; videoId: number }) =>
      api.post(`/api/assets/${params.assetId}/select`),
    onSuccess: (_data, params) => invalidate(params.videoId),
    onError: (err) => toast.error(errorMessage(err)),
  });

  return { generateStory, suggestTopics, approveStory, approveRender, retry, deleteVideo, selectTake };
}
