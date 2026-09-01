import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PipelineEvent } from '@reel-agent/shared';
import { API_URL } from '@/lib/api';

/**
 * Subscribes to the video's SSE progress stream and invalidates the detail
 * query on every event, so the pipeline strip and asset grid update live.
 * Returns the latest event for the status line.
 */
export function useVideoEvents(videoId: number, enabled: boolean) {
  const queryClient = useQueryClient();
  const [lastEvent, setLastEvent] = useState<PipelineEvent | null>(null);

  useEffect(() => {
    if (!enabled || !Number.isFinite(videoId)) return;
    const source = new EventSource(`${API_URL}/api/videos/${videoId}/events`);
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as PipelineEvent;
        setLastEvent(event);
        void queryClient.invalidateQueries({ queryKey: ['videos', String(videoId)] });
        void queryClient.invalidateQueries({ queryKey: ['videos'] });
      } catch {
        // ignore malformed frames
      }
    };
    return () => source.close();
  }, [videoId, enabled, queryClient]);

  return lastEvent;
}
