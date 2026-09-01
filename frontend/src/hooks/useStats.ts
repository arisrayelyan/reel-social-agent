import { useQuery } from '@tanstack/react-query';
import type { Health, Stats } from '@reel-agent/shared';
import { api } from '@/lib/api';

export function useStats() {
  return useQuery<Stats>({
    queryKey: ['stats'],
    queryFn: () => api.get<Stats>('/api/stats').then((r) => r.data),
    refetchInterval: 10_000,
  });
}

export function useHealth() {
  return useQuery<Health>({
    queryKey: ['health'],
    queryFn: () => api.get<Health>('/api/settings/health').then((r) => r.data),
    refetchInterval: 15_000,
  });
}
