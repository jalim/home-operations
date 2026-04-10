"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const plexapi_1 = __importDefault(require("../api/plexapi"));
const datasource_1 = require("../datasource");
const OverlayLibraryConfig_1 = require("../entity/OverlayLibraryConfig");
const OverlayTemplate_1 = require("../entity/OverlayTemplate");
const OverlayContextBuilder_1 = require("../lib/overlays/OverlayContextBuilder");
const OverlayTemplateRenderer_1 = require("../lib/overlays/OverlayTemplateRenderer");
const settings_1 = require("../lib/settings");
const logger_1 = __importDefault(require("../logger"));
const express_1 = require("express");
const overlayTestRouter = (0, express_1.Router)();
/**
 * Test overlay application on a single Plex item
 * POST /api/v1/overlay-test
 * Body: { ratingKey: string }
 */
overlayTestRouter.post('/', async (req, res) => {
    try {
        const { ratingKey } = req.body;
        if (!ratingKey || typeof ratingKey !== 'string') {
            return res.status(400).json({ error: 'ratingKey is required' });
        }
        logger_1.default.info('Starting overlay test', {
            label: 'OverlayTest',
            ratingKey,
        });
        // Get admin user for Plex API access
        const { getAdminUser } = await Promise.resolve().then(() => __importStar(require('../lib/collections/core/CollectionUtilities')));
        const admin = await getAdminUser();
        if (!admin) {
            return res.status(500).json({ error: 'No admin user found' });
        }
        const plexApi = new plexapi_1.default({ plexToken: admin.plexToken });
        // Fetch item metadata
        const item = await plexApi.getMetadata(ratingKey);
        if (!item) {
            return res.status(404).json({ error: 'Item not found in Plex' });
        }
        // Skip episodes and seasons
        if (item.type === 'episode' || item.type === 'season') {
            return res.status(400).json({
                error: 'Overlays only apply to movies and shows, not episodes or seasons',
            });
        }
        // Get library information
        const libraryId = item.librarySectionID?.toString();
        if (!libraryId) {
            return res.status(400).json({ error: 'Could not determine library ID' });
        }
        let libraryName = item.librarySectionTitle ||
            'Unknown Library';
        if (!item.librarySectionTitle) {
            try {
                const libraries = await plexApi.getLibraries();
                const library = libraries.find((lib) => lib.key === libraryId);
                libraryName = library?.title || 'Unknown Library';
            }
            catch (error) {
                logger_1.default.warn('Failed to fetch library name', {
                    label: 'OverlayTest',
                    libraryId,
                });
            }
        }
        // Get library configuration
        const configRepository = (0, datasource_1.getRepository)(OverlayLibraryConfig_1.OverlayLibraryConfig);
        const config = await configRepository.findOne({
            where: { libraryId },
        });
        if (!config || config.enabledOverlays.length === 0) {
            return res.status(400).json({
                error: `No overlays enabled for library "${libraryName}"`,
                item: {
                    ratingKey: item.ratingKey,
                    title: item.title,
                    year: item.year,
                    type: item.type,
                    libraryId,
                    libraryName,
                },
            });
        }
        // Get enabled overlay templates
        const templateRepository = (0, datasource_1.getRepository)(OverlayTemplate_1.OverlayTemplate);
        const enabledTemplateIds = config.enabledOverlays
            .filter((o) => o.enabled)
            .map((o) => o.templateId);
        const templates = await templateRepository.findByIds(enabledTemplateIds);
        if (templates.length === 0) {
            return res.status(400).json({
                error: `No templates found for library "${libraryName}"`,
            });
        }
        // Sort templates by layer order
        const sortedTemplates = templates.sort((a, b) => {
            const orderA = config.enabledOverlays.find((o) => o.templateId === a.id)?.layerOrder ||
                0;
            const orderB = config.enabledOverlays.find((o) => o.templateId === b.id)?.layerOrder ||
                0;
            return orderA - orderB;
        });
        // Derive actual media type from item.type
        const actualMediaType = item.type === 'movie' ? 'movie' : 'show';
        // Extract TMDB ID from item GUIDs
        let tmdbId;
        if (item.Guid && Array.isArray(item.Guid)) {
            const tmdbGuid = item.Guid.find((g) => g.id?.includes('tmdb://'));
            if (tmdbGuid) {
                const match = tmdbGuid.id.match(/tmdb:\/\/(\d+)/);
                if (match) {
                    tmdbId = parseInt(match[1]);
                }
            }
        }
        // Check if this is a placeholder
        const { placeholderContextService } = await Promise.resolve().then(() => __importStar(require('../lib/placeholders/services/PlaceholderContextService')));
        const plexMetadata = item;
        const isPlaceholder = await placeholderContextService.isPlaceholderItemAsync(plexMetadata, plexApi['plexClient']);
        logger_1.default.debug('Placeholder detection result', {
            label: 'OverlayTest',
            itemTitle: item.title,
            ratingKey: item.ratingKey,
            isPlaceholder,
        });
        // Fetch Maintainerr collections for daysUntilAction context
        const settings = (0, settings_1.getSettings)();
        let maintainerrCollections;
        if (settings.maintainerr?.hostname && settings.maintainerr?.apiKey) {
            try {
                const MaintainerrAPI = (await Promise.resolve().then(() => __importStar(require('../api/maintainerr'))))
                    .default;
                const maintainerrClient = new MaintainerrAPI(settings.maintainerr);
                maintainerrCollections = await maintainerrClient.getCollections();
                // Patch: /api/collections only returns 2 items in media[]; fetch full lists
                for (const collection of maintainerrCollections) {
                    if (collection.deleteAfterDays && collection.mediaCount > collection.media.length) {
                        const fullMedia = await maintainerrClient.getAllCollectionMedia(collection.id);
                        if (fullMedia.length > 0) {
                            collection.media = fullMedia;
                        }
                    }
                }
                logger_1.default.debug('Fetched Maintainerr collections for overlay test', {
                    label: 'OverlayTest',
                    collectionsCount: maintainerrCollections.length,
                });
            }
            catch (error) {
                logger_1.default.debug('Failed to fetch Maintainerr collections', {
                    label: 'OverlayTest',
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        // Build base context (includes Maintainerr daysUntilAction if configured)
        const baseContext = await (0, OverlayContextBuilder_1.buildRenderContext)(item, actualMediaType, isPlaceholder, maintainerrCollections);
        // Fetch release date information if TMDB ID available
        let releaseDateContext = {};
        if (tmdbId) {
            const releaseDateInfo = await (0, OverlayContextBuilder_1.fetchReleaseDateInfo)(tmdbId, actualMediaType);
            if (releaseDateInfo) {
                const { calculateDaysSince } = await Promise.resolve().then(() => __importStar(require('../utils/dateHelpers')));
                let daysUntilRelease;
                let daysAgo;
                let daysUntilNextEpisode;
                let daysUntilNextSeason;
                let daysAgoNextSeason;
                if (releaseDateInfo.releaseDate) {
                    const daysSince = calculateDaysSince(releaseDateInfo.releaseDate);
                    if (daysSince < 0) {
                        daysUntilRelease = -daysSince;
                    }
                    else {
                        daysAgo = daysSince;
                    }
                }
                if (releaseDateInfo.nextEpisodeAirDate) {
                    const daysSince = calculateDaysSince(releaseDateInfo.nextEpisodeAirDate);
                    if (daysSince <= 0) {
                        daysUntilNextEpisode = -daysSince;
                    }
                }
                if (releaseDateInfo.nextSeasonAirDate) {
                    const daysSince = calculateDaysSince(releaseDateInfo.nextSeasonAirDate);
                    if (daysSince <= 0) {
                        daysUntilNextSeason = -daysSince;
                    }
                    else {
                        daysAgoNextSeason = daysSince;
                    }
                }
                releaseDateContext = {
                    releaseDate: releaseDateInfo.releaseDate,
                    daysUntilRelease,
                    daysAgo,
                    nextEpisodeAirDate: releaseDateInfo.nextEpisodeAirDate,
                    daysUntilNextEpisode,
                    nextSeasonAirDate: releaseDateInfo.nextSeasonAirDate,
                    daysUntilNextSeason,
                    daysAgoNextSeason,
                    seasonNumber: releaseDateInfo.seasonNumber,
                    episodeNumber: releaseDateInfo.episodeNumber,
                };
            }
        }
        // Check monitoring status if TMDB ID available
        let monitoringContext = {};
        if (tmdbId) {
            monitoringContext = await (0, OverlayContextBuilder_1.checkMonitoringStatus)(tmdbId, actualMediaType, undefined, undefined);
        }
        // Merge contexts
        let actualIsPlaceholder = isPlaceholder;
        if (monitoringContext.hasFile === true) {
            actualIsPlaceholder = false; // *arr has files, so it's definitely not a placeholder
        }
        let downloaded;
        if (actualIsPlaceholder) {
            downloaded = false;
        }
        else if (typeof monitoringContext.hasFile === 'boolean') {
            downloaded = monitoringContext.hasFile;
        }
        else {
            downloaded = true;
        }
        // Build collection membership for condition evaluation
        const allConfigs = [
            ...(settings.plex.collectionConfigs || []),
        ];
        const { preExistingCollectionConfigService } = await Promise.resolve().then(() => __importStar(require('../lib/collections/services/PreExistingCollectionConfigService')));
        allConfigs.push(...preExistingCollectionConfigService.getConfigs());
        const collectionsWithKeys = allConfigs.filter((cfg) => !!cfg.collectionRatingKey);
        const collectionIds = [];
        const concurrency = 10;
        for (let i = 0; i < collectionsWithKeys.length; i += concurrency) {
            const batch = collectionsWithKeys.slice(i, i + concurrency);
            const results = await Promise.all(batch.map(async (cfg) => {
                try {
                    const itemKeys = await plexApi.getCollectionItems(cfg.collectionRatingKey);
                    return itemKeys.includes(ratingKey) ? cfg.id : null;
                }
                catch {
                    return null;
                }
            }));
            for (const id of results) {
                if (id)
                    collectionIds.push(id);
            }
        }
        logger_1.default.debug('Collection membership for test item', {
            label: 'OverlayTest',
            ratingKey,
            collectionIds,
            totalCollectionsChecked: allConfigs.filter((c) => c.collectionRatingKey)
                .length,
        });
        const context = {
            ...baseContext,
            isPlaceholder: actualIsPlaceholder,
            downloaded,
            ...releaseDateContext,
            ...monitoringContext,
            collection: collectionIds,
        };
        // Evaluate all templates with detailed results
        const templateResults = sortedTemplates.map((template) => {
            const condition = template.getApplicationCondition();
            const detailedResult = (0, OverlayTemplateRenderer_1.evaluateConditionDetailed)(condition, context);
            return {
                id: template.id,
                name: template.name,
                matched: detailedResult.matched,
                appliedCondition: condition,
                conditionResults: {
                    sectionResults: detailedResult.sectionResults,
                },
            };
        });
        // Get poster source preference (reuse settings from earlier)
        const posterSource = settings.overlays?.defaultPosterSource || 'tmdb';
        // Fetch base poster
        const { plexBasePosterManager } = await Promise.resolve().then(() => __importStar(require('../lib/overlays/PlexBasePosterManager')));
        let basePosterResult;
        try {
            basePosterResult = await plexBasePosterManager.getBasePosterForOverlay(plexApi, item, libraryId, libraryName, config.mediaType, posterSource, {}, tmdbId);
        }
        catch (error) {
            logger_1.default.error('Failed to get base poster', {
                label: 'OverlayTest',
                itemTitle: item.title,
                ratingKey: item.ratingKey,
                error: error instanceof Error ? error.message : String(error),
            });
            return res.status(500).json({
                error: 'Failed to fetch base poster',
                message: error instanceof Error ? error.message : String(error),
            });
        }
        let posterBuffer = basePosterResult.posterBuffer;
        // Apply matching overlays in order via batch rendering
        const matchingTemplates = sortedTemplates.filter((template) => templateResults.find((tr) => tr.id === template.id)?.matched);
        const { width: posterWidth, height: posterHeight } = await OverlayTemplateRenderer_1.overlayTemplateRenderer.getPosterDimensions(posterBuffer);
        const allOverlays = [];
        for (const template of matchingTemplates) {
            const templateData = template.getTemplateData();
            const templateOverlays = await OverlayTemplateRenderer_1.overlayTemplateRenderer.renderOverlayElements(posterWidth, posterHeight, templateData, context);
            if (templateOverlays) {
                allOverlays.push(...templateOverlays);
            }
        }
        posterBuffer = await OverlayTemplateRenderer_1.overlayTemplateRenderer.compositeOverlays(posterBuffer, allOverlays);
        // Return all context variables as a flat list (no grouping)
        const allContext = {};
        for (const key in context) {
            allContext[key] = context[key];
        }
        logger_1.default.info('Overlay test completed successfully', {
            label: 'OverlayTest',
            ratingKey,
            itemTitle: item.title,
            templatesEvaluated: templateResults.length,
            templatesMatched: matchingTemplates.length,
        });
        return res.status(200).json({
            poster: posterBuffer.toString('base64'),
            item: {
                ratingKey: item.ratingKey,
                title: item.title,
                year: item.year,
                type: item.type,
                libraryId,
                libraryName,
            },
            templates: templateResults,
            context: allContext,
        });
    }
    catch (error) {
        logger_1.default.error('Failed to test overlay', {
            label: 'OverlayTest',
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });
        return res.status(500).json({
            error: 'Failed to test overlay',
            message: error instanceof Error ? error.message : String(error),
        });
    }
});
exports.default = overlayTestRouter;
