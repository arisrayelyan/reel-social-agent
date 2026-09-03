import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { GenerateFromUrlBody, GenerateStoryBody, TopicIdeas, Video } from '@reel-agent/shared';
import { api } from '@/lib/api';

export interface GenerateStoryResponse {
  video: Video;
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
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const generateFromUrl = useMutation({
    mutationFn: (body: GenerateFromUrlBody) =>
      api.post<GenerateStoryResponse>('/api/generate/from-url', body).then((r) => r.data),
    onSuccess: (data) => {
      invalidate(data.video.id);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const suggestTopics = useMutation({
    mutationFn: (body: { provider: string; model?: string; count: number }) =>
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

  const upgradeClips = useMutation({
    mutationFn: (params: { id: number; beat_indexes: number[] }) =>
      api.post(`/api/videos/${params.id}/upgrade-clips`, { beat_indexes: params.beat_indexes }),
    onSuccess: (_data, params) => {
      invalidate(params.id);
      toast.success(`Re-rendering ${params.beat_indexes.length} beat(s) on the premium model`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const updateOverlay = useMutation({
    mutationFn: (params: { id: number; overlay_hook?: string; evidence_stamp?: string }) => {
      const { id, ...body } = params;
      return api.patch(`/api/videos/${id}/overlay`, body);
    },
    onSuccess: (data, params) => {
      invalidate(params.id);
      const rerendering = (data.data as { rerendering?: boolean } | undefined)?.rerendering;
      toast.success(rerendering ? 'Re-rendering captions with the new overlay' : 'Overlay saved');
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

  return {
    generateStory,
    generateFromUrl,
    suggestTopics,
    approveStory,
    approveRender,
    upgradeClips,
    updateOverlay,
    retry,
    deleteVideo,
    selectTake,
  };
}
