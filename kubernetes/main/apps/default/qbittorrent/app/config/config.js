module.exports = {
  delay: 30,

  action: "inject",
  matchMode: "safe",
  skipRecheck: true,
  includeEpisodes: true,
  includeNonVideos: true,
  duplicateCategories: true,
  torrentDir: "/config/qBittorrent/BT_backup",
  qbittorrentUrl: "http://localhost",
  rssCadence: "15 minutes", // autobrr doesnt get every announcement
};
