// The crowd keeps time with a playing track (plaza/crowd.ts). The new tab plays nothing, so only
// the shape of a track is needed here, matching the site's src/data/music.ts.
export interface Track {
  videoId: string;
  beats?: [number, number][] | null;
}
