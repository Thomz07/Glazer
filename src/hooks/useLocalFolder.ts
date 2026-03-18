import { useMemo, useState } from "react";

export function useLocalFolder() {
  const [playlistFolderPath, setPlaylistFolderPath] = useState("");
  const [playlistFolderAvailable, setPlaylistFolderAvailable] = useState(true);

  const hasAvailableLocalFolder = useMemo(
    () => Boolean(playlistFolderPath.trim()) && playlistFolderAvailable,
    [playlistFolderAvailable, playlistFolderPath],
  );

  return {
    playlistFolderPath,
    setPlaylistFolderPath,
    playlistFolderAvailable,
    setPlaylistFolderAvailable,
    hasAvailableLocalFolder,
  };
}
