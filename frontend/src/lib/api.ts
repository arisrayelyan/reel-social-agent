import axios from 'axios';

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4041';

export const api = axios.create({ baseURL: API_URL });

/** URL for a stored media file (paths in the DB are relative to storage/). */
export function mediaUrl(filePath: string): string {
  return `${API_URL}/media/${filePath}`;
}
