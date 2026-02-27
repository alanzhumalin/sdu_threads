export type MediaItem = {
  url: string;
  width: number;
  height: number;
  type?: "image" | "video";
};

export type PostMusic = {
  source?: string;
  track_id?: string;
  title?: string;
  artist?: string;
  cover_url?: string;
  audio_url: string;
  duration_sec?: number;
  clip_start_sec?: number;
  clip_end_sec?: number;
};
