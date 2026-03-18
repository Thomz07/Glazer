import { useState } from "react";
import type { Playlist } from "../types";

export function usePlaylists() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  return {
    playlists,
    setPlaylists,
  };
}
