import { useMemo, useRef, useState } from "react";
import type { PlaylistDetails, PlaylistDetailsCacheEntry, PlaylistTrack } from "../types";

const MAX_PLAYLIST_DETAILS_CACHE_SIZE = 4;

export function usePlaylistDetails() {
  const [selectedPlaylistDetails, setSelectedPlaylistDetails] = useState<PlaylistDetails | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(null);
  const playlistDetailsCacheRef = useRef<Map<number, PlaylistDetailsCacheEntry>>(new Map());

  const selectedTrackInfo = useMemo<PlaylistTrack | null>(() => {
    if (!selectedPlaylistDetails || selectedTrackId === null) {
      return null;
    }

    return selectedPlaylistDetails.tracks.find((track) => track.id === selectedTrackId) ?? null;
  }, [selectedPlaylistDetails, selectedTrackId]);

  function upsertPlaylistDetailsCache(details: PlaylistDetails) {
    playlistDetailsCacheRef.current.delete(details.id);
    playlistDetailsCacheRef.current.set(details.id, {
      details,
      cached_at_ms: Date.now(),
    });

    while (playlistDetailsCacheRef.current.size > MAX_PLAYLIST_DETAILS_CACHE_SIZE) {
      const oldest = playlistDetailsCacheRef.current.keys().next().value as number | undefined;
      if (oldest === undefined) {
        break;
      }
      playlistDetailsCacheRef.current.delete(oldest);
    }
  }

  function setSelectedPlaylistDetailsWithCache(details: PlaylistDetails | null) {
    if (details) {
      upsertPlaylistDetailsCache(details);
    }
    setSelectedPlaylistDetails(details);
  }

  function updateSelectedPlaylistDetailsWithCache(
    updater: (current: PlaylistDetails | null) => PlaylistDetails | null,
  ) {
    setSelectedPlaylistDetails((current) => {
      const next = updater(current);
      if (next) {
        upsertPlaylistDetailsCache(next);
      }
      return next;
    });
  }

  return {
    selectedPlaylistDetails,
    setSelectedPlaylistDetails,
    setSelectedPlaylistDetailsWithCache,
    updateSelectedPlaylistDetailsWithCache,
    selectedTrackId,
    setSelectedTrackId,
    selectedTrackInfo,
    playlistDetailsCacheRef,
  };
}
