// Note: Cross-Seed vars should be escaped with $${VAR_NAME} to avoid any interpolation by Flux
module.exports = {
  delay: 20,
  qbittorrentUrl: "http://qbittorrent.default.svc.cluster.local",
  torznab: [
    `http://prowlarr.default.svc.cluster.local/1/api?apikey=$${process.env.PROWLARR_API_KEY}`,  // ipt
    `http://prowlarr.default.svc.cluster.local/36/api?apikey=$${process.env.PROWLARR_API_KEY}`,  // milkie
    `http://prowlarr.default.svc.cluster.local/3/api?apikey=$${process.env.PROWLARR_API_KEY}`, // TD
    `http://prowlarr.default.svc.cluster.local/70/api?apikey=$${process.env.PROWLARR_API_KEY}`, // TL
    `http://prowlarr.default.svc.cluster.local/72/api?apikey=$${process.env.PROWLARR_API_KEY}` // FNP
  ],
  port: Number(process.env.CROSS_SEED_PORT),
  apiAuth: true,
  api
  action: "inject",
  includeEpisodes: false,
  includeSingleEpisodes: true,
  includeNonVideos: true,
  duplicateCategories: true,
  rssCadence: "10 minutes",
  matchMode: "safe",
  skipRecheck: true,
  outputDir: "/config",
  useClientTorrents: true
};
