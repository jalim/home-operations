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
exports.overlayLibraryService = void 0;
const plexapi_1 = __importDefault(require("../../api/plexapi"));
const datasource_1 = require("../../datasource");
const OverlayLibraryConfig_1 = require("../../entity/OverlayLibraryConfig");
const OverlayTemplate_1 = require("../../entity/OverlayTemplate");
const settings_1 = require("../../lib/settings");
const logger_1 = __importDefault(require("../../logger"));
const promises_1 = __importDefault(require("fs/promises"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const OverlayContextBuilder_1 = require("./OverlayContextBuilder");
const OverlayTemplateRenderer_1 = require("./OverlayTemplateRenderer");
/**
 * Service for applying overlay templates to Plex library items
 */
class OverlayLibraryService {
    constructor() {
        // Track running libraries with mutex-like behavior
        // Prevents concurrent processing of the same library
        this.runningLibraries = new Map();
    }
    /**
     * Get status for a specific library
     */
    getLibraryStatus(libraryId) {
        const status = this.runningLibraries.get(libraryId);
        if (!status) {
            return { running: false };
        }
        return {
            running: true,
            libraryName: status.libraryName,
            startTime: status.startTime,
            runningFor: Math.round((Date.now() - status.startTime) / 1000),
        };
    }
    /**
     * Get all running libraries
     */
    getAllRunningLibraries() {
        return Array.from(this.runningLibraries.entries()).map(([libraryId, status]) => ({
            libraryId,
            libraryName: status.libraryName,
            startTime: status.startTime,
            runningFor: Math.round((Date.now() - status.startTime) / 1000),
        }));
    }
    /**
     * Clear library caches (call at start of overlay job)
     */
    clearLibraryCaches() {
        this.radarrMoviesCache = new Map();
        this.sonarrSeriesCache = new Map();
        this.maintainerrCollectionsCache = undefined;
        this.collectionMembershipCache = undefined;
    }
    /**
     * Build a map of item ratingKey → collection IDs for all agregarr and pre-existing collections.
     * Called once at the start of an overlay job for efficient per-item lookups.
     */
    async buildCollectionMembershipMap(plexApi) {
        const membershipMap = new Map();
        const settings = (0, settings_1.getSettings)();
        // Gather all collections with ratingKeys: agregarr-created + pre-existing
        const collectionsToCheck = [];
        const agregarrConfigs = settings.plex.collectionConfigs || [];
        for (const config of agregarrConfigs) {
            if (config.collectionRatingKey) {
                collectionsToCheck.push({
                    id: config.id,
                    ratingKey: config.collectionRatingKey,
                });
            }
        }
        const { preExistingCollectionConfigService } = await Promise.resolve().then(() => __importStar(require('../../lib/collections/services/PreExistingCollectionConfigService')));
        const preExistingConfigs = preExistingCollectionConfigService.getConfigs();
        for (const config of preExistingConfigs) {
            if (config.collectionRatingKey) {
                collectionsToCheck.push({
                    id: config.id,
                    ratingKey: config.collectionRatingKey,
                });
            }
        }
        logger_1.default.info('Building collection membership map for overlay conditions', {
            label: 'OverlayLibrary',
            totalCollections: collectionsToCheck.length,
        });
        for (const { id, ratingKey } of collectionsToCheck) {
            try {
                const itemRatingKeys = await plexApi.getCollectionItems(ratingKey);
                for (const itemKey of itemRatingKeys) {
                    const existing = membershipMap.get(itemKey);
                    if (existing) {
                        existing.push(id);
                    }
                    else {
                        membershipMap.set(itemKey, [id]);
                    }
                }
            }
            catch (error) {
                logger_1.default.debug('Failed to fetch items for collection', {
                    label: 'OverlayLibrary',
                    collectionId: id,
                    collectionRatingKey: ratingKey,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        logger_1.default.info('Collection membership map built', {
            label: 'OverlayLibrary',
            collectionsChecked: collectionsToCheck.length,
            itemsWithMembership: membershipMap.size,
        });
        return membershipMap;
    }
    /**
     * Apply overlays to all items in a library
     * Uses mutex to prevent concurrent processing of the same library
     */
    async applyOverlaysToLibrary(libraryId, checkCancelled) {
        // Check if library is already being processed (mutex check)
        // Reject duplicate requests to prevent corruption and match API layer behavior
        const existing = this.runningLibraries.get(libraryId);
        if (existing) {
            const runningFor = Math.round((Date.now() - existing.startTime) / 1000);
            logger_1.default.warn('Library already being processed, rejecting duplicate request', {
                label: 'OverlayLibrary',
                libraryId,
                libraryName: existing.libraryName,
                startedAt: new Date(existing.startTime).toISOString(),
                runningFor: `${runningFor}s`,
            });
            throw new Error(`Library "${existing.libraryName}" is already being processed (running for ${runningFor}s)`);
        }
        // Create a deferred promise to set in the map immediately
        // This prevents race conditions where two calls pass the check before either awaits
        let resolveDeferred;
        let rejectDeferred;
        const deferredPromise = new Promise((resolve, reject) => {
            resolveDeferred = resolve;
            rejectDeferred = reject;
        });
        // Verify promise initialization succeeded
        if (!resolveDeferred || !rejectDeferred) {
            throw new Error('Failed to initialize deferred promise');
        }
        // Mark as running BEFORE any await (to prevent race condition)
        this.runningLibraries.set(libraryId, {
            libraryName: libraryId,
            startTime: Date.now(),
            promise: deferredPromise,
        });
        try {
            // Get library configuration
            const configRepository = (0, datasource_1.getRepository)(OverlayLibraryConfig_1.OverlayLibraryConfig);
            const config = await configRepository.findOne({
                where: { libraryId },
            });
            // Update libraryName now that we have config
            const runningEntry = this.runningLibraries.get(libraryId);
            if (runningEntry) {
                runningEntry.libraryName = config?.libraryName || libraryId;
            }
            // Process the library
            await this.processLibraryOverlays(libraryId, config, checkCancelled);
            resolveDeferred();
        }
        catch (error) {
            rejectDeferred(error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
        finally {
            // Clean up
            this.runningLibraries.delete(libraryId);
        }
    }
    /**
     * Internal method to process library overlays
     */
    async processLibraryOverlays(libraryId, config, checkCancelled) {
        try {
            // Clear library caches at start of job
            this.clearLibraryCaches();
            // Clear TMDB URL cache to avoid stale data from previous runs
            const { plexBasePosterManager } = await Promise.resolve().then(() => __importStar(require('../../lib/overlays/PlexBasePosterManager')));
            plexBasePosterManager.clearTmdbUrlCache();
            // Also clean up expired TMDB poster files
            await plexBasePosterManager.cleanTmdbCache();
            logger_1.default.info('Starting overlay application for library', {
                label: 'OverlayLibrary',
                libraryId,
            });
            if (!config || config.enabledOverlays.length === 0) {
                logger_1.default.info('No overlays enabled for library', {
                    label: 'OverlayLibrary',
                    libraryId,
                });
                return;
            }
            // Get enabled overlay templates
            const templateRepository = (0, datasource_1.getRepository)(OverlayTemplate_1.OverlayTemplate);
            const enabledTemplateIds = config.enabledOverlays
                .filter((o) => o.enabled)
                .map((o) => o.templateId);
            const templates = await templateRepository.findByIds(enabledTemplateIds);
            if (templates.length === 0) {
                logger_1.default.info('No templates found for library', {
                    label: 'OverlayLibrary',
                    libraryId,
                });
                return;
            }
            // Sort templates by layer order
            const sortedTemplates = templates.sort((a, b) => {
                const orderA = config.enabledOverlays.find((o) => o.templateId === a.id)
                    ?.layerOrder || 0;
                const orderB = config.enabledOverlays.find((o) => o.templateId === b.id)
                    ?.layerOrder || 0;
                return orderA - orderB;
            });
            logger_1.default.info('Applying overlays to library', {
                label: 'OverlayLibrary',
                libraryId,
                templateCount: sortedTemplates.length,
                templates: sortedTemplates.map((t) => t.name),
            });
            // Fetch Maintainerr collections once for the entire job
            const settings = (0, settings_1.getSettings)();
            if (settings.maintainerr?.hostname && settings.maintainerr?.apiKey) {
                try {
                    const MaintainerrAPI = (await Promise.resolve().then(() => __importStar(require('../../api/maintainerr'))))
                        .default;
                    const maintainerrClient = new MaintainerrAPI(settings.maintainerr);
                    this.maintainerrCollectionsCache =
                        await maintainerrClient.getCollections();
                    // Patch: /api/collections only returns 2 items in media[]; fetch full lists
                    for (const collection of this.maintainerrCollectionsCache) {
                        if (collection.deleteAfterDays && collection.mediaCount > collection.media.length) {
                            const fullMedia = await maintainerrClient.getAllCollectionMedia(collection.id);
                            if (fullMedia.length > 0) {
                                collection.media = fullMedia;
                            }
                        }
                    }
                    logger_1.default.info('Fetched Maintainerr collections for overlay job', {
                        label: 'OverlayLibrary',
                        collectionsCount: this.maintainerrCollectionsCache.length,
                    });
                }
                catch (error) {
                    logger_1.default.error('Failed to fetch Maintainerr collections', {
                        label: 'OverlayLibrary',
                        error: error instanceof Error ? error.message : String(error),
                    });
                    this.maintainerrCollectionsCache = [];
                }
            }
            // Get library items from Plex
            const { getAdminUser } = await Promise.resolve().then(() => __importStar(require('../../lib/collections/core/CollectionUtilities')));
            const admin = await getAdminUser();
            if (!admin) {
                throw new Error('No admin user found');
            }
            const plexApi = new plexapi_1.default({ plexToken: admin.plexToken });
            // Build collection membership map for condition evaluation
            // Only build if any enabled template uses a 'collection' condition field
            const hasCollectionConditions = sortedTemplates.some((template) => {
                const condition = template.getApplicationCondition();
                return condition?.sections?.some((s) => s.rules.some((r) => r.field === 'collection'));
            });
            if (hasCollectionConditions) {
                this.collectionMembershipCache =
                    await this.buildCollectionMembershipMap(plexApi);
            }
            // Fetch all items (handle pagination)
            let allItems = [];
            let offset = 0;
            const pageSize = 50;
            let hasMore = true;
            // Paginate through all library items
            while (hasMore) {
                const response = await plexApi.getLibraryContents(libraryId, {
                    offset,
                    size: pageSize,
                });
                allItems = allItems.concat(response.items);
                if (offset + pageSize >= response.totalSize) {
                    hasMore = false;
                }
                offset += pageSize;
            }
            logger_1.default.info('Processing library items', {
                label: 'OverlayLibrary',
                libraryId,
                itemCount: allItems.length,
            });
            // Process each item
            let successCount = 0;
            let errorCount = 0;
            for (const item of allItems) {
                // CRITICAL: Skip episodes and seasons - overlays only apply to movies and shows
                if (item.type === 'episode' || item.type === 'season') {
                    continue;
                }
                // Check for cancellation
                if (checkCancelled && checkCancelled()) {
                    logger_1.default.info('Overlay application cancelled during library processing', {
                        label: 'OverlayLibrary',
                        libraryId,
                        processedItems: successCount + errorCount,
                        totalItems: allItems.length,
                    });
                    break;
                }
                try {
                    // Fetch full metadata including Stream details (needed for HDR, bitDepth, etc.)
                    const fullMetadata = await plexApi.getMetadata(item.ratingKey);
                    // Merge full metadata with library item
                    const itemWithFullMetadata = {
                        ...item,
                        Media: fullMetadata.Media,
                        Label: fullMetadata.Label,
                    };
                    await this.applyOverlaysToItem(plexApi, itemWithFullMetadata, sortedTemplates, config.mediaType, libraryId, config.libraryName);
                    successCount++;
                }
                catch (error) {
                    errorCount++;
                    logger_1.default.error('Failed to apply overlays to item', {
                        label: 'OverlayLibrary',
                        itemTitle: item.title,
                        error: error instanceof Error ? error.message : String(error),
                        stack: error instanceof Error ? error.stack : undefined,
                        errorDetails: error,
                    });
                    // Continue with next item
                }
            }
            logger_1.default.info('Completed overlay application for library', {
                label: 'OverlayLibrary',
                libraryId,
                successCount,
                errorCount,
            });
        }
        catch (error) {
            logger_1.default.error('Failed to apply overlays to library', {
                label: 'OverlayLibrary',
                libraryId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
        // Note: runningLibraries cleanup is handled by the caller (applyOverlaysToLibrary)
    }
    /**
     * Apply overlays to specific collection items only
     * Used by "Apply overlays during sync" feature
     *
     * @param items - Either an array of rating keys (string[]) or items with context overrides (OverlayItemInput[])
     * @param libraryId - The Plex library ID
     */
    async applyOverlaysToCollectionItems(items, libraryId) {
        try {
            // Clear library caches at start of job
            this.clearLibraryCaches();
            // Normalize input to OverlayItemInput[]
            const normalizedItems = items.map((item) => typeof item === 'string' ? { ratingKey: item } : item);
            logger_1.default.info('Applying overlays to collection items', {
                label: 'OverlayLibrary',
                itemCount: normalizedItems.length,
                libraryId,
            });
            // Get library configuration for templates
            const configRepository = (0, datasource_1.getRepository)(OverlayLibraryConfig_1.OverlayLibraryConfig);
            const config = await configRepository.findOne({
                where: { libraryId },
            });
            // Early return if no overlays configured (same logic as applyOverlaysToLibrary)
            if (!config || config.enabledOverlays.length === 0) {
                logger_1.default.info('No overlays enabled for library, skipping overlay application', {
                    label: 'OverlayLibrary',
                    libraryId,
                });
                return;
            }
            // Get enabled overlay templates
            const templateRepository = (0, datasource_1.getRepository)(OverlayTemplate_1.OverlayTemplate);
            const enabledTemplateIds = config.enabledOverlays
                .filter((o) => o.enabled)
                .map((o) => o.templateId);
            const templates = await templateRepository.findByIds(enabledTemplateIds);
            if (templates.length === 0) {
                logger_1.default.info('No templates found for library, skipping overlay application', {
                    label: 'OverlayLibrary',
                    libraryId,
                });
                return;
            }
            // Sort templates by layer order
            const sortedTemplates = templates.sort((a, b) => {
                const orderA = config.enabledOverlays.find((o) => o.templateId === a.id)
                    ?.layerOrder || 0;
                const orderB = config.enabledOverlays.find((o) => o.templateId === b.id)
                    ?.layerOrder || 0;
                return orderA - orderB;
            });
            // Get admin user for Plex API
            const { getAdminUser } = await Promise.resolve().then(() => __importStar(require('../../lib/collections/core/CollectionUtilities')));
            const admin = await getAdminUser();
            if (!admin) {
                throw new Error('No admin user found');
            }
            const plexApi = new plexapi_1.default({ plexToken: admin.plexToken });
            // Build collection membership map if any template uses collection conditions
            const hasCollectionConditions = sortedTemplates.some((template) => {
                const condition = template.getApplicationCondition();
                return condition?.sections?.some((s) => s.rules.some((r) => r.field === 'collection'));
            });
            if (hasCollectionConditions) {
                this.collectionMembershipCache =
                    await this.buildCollectionMembershipMap(plexApi);
            }
            // Determine media type from library config
            const mediaType = config.mediaType || 'movie';
            // Process each item
            let successCount = 0;
            let errorCount = 0;
            for (const { ratingKey, contextOverrides } of normalizedItems) {
                try {
                    // Fetch item metadata
                    const itemMetadata = await plexApi.getMetadata(ratingKey);
                    if (itemMetadata) {
                        // CRITICAL: Skip episodes and seasons - overlays only apply to movies and shows
                        if (itemMetadata.type === 'episode' ||
                            itemMetadata.type === 'season') {
                            continue;
                        }
                        // Convert to PlexLibraryItem format (cast to satisfy type requirements)
                        const item = {
                            ratingKey: itemMetadata.ratingKey,
                            title: itemMetadata.title,
                            year: itemMetadata.year,
                            type: itemMetadata.type,
                            guid: itemMetadata.guid || '',
                            Guid: itemMetadata.Guid,
                            Media: itemMetadata.Media,
                            Label: itemMetadata.Label,
                            parentIndex: itemMetadata.parentIndex,
                            index: itemMetadata.index,
                            addedAt: itemMetadata.addedAt || 0,
                            updatedAt: itemMetadata.updatedAt || 0,
                            editionTitle: itemMetadata
                                .editionTitle,
                        };
                        await this.applyOverlaysToItem(plexApi, item, sortedTemplates, mediaType, libraryId, config.libraryName, contextOverrides);
                        successCount++;
                    }
                }
                catch (error) {
                    errorCount++;
                    logger_1.default.error('Failed to apply overlays to collection item', {
                        label: 'OverlayLibrary',
                        ratingKey,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
            logger_1.default.info('Completed overlay application for collection items', {
                label: 'OverlayLibrary',
                successCount,
                errorCount,
                totalItems: normalizedItems.length,
            });
        }
        catch (error) {
            logger_1.default.error('Failed to apply overlays to collection items', {
                label: 'OverlayLibrary',
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    /**
     * Apply overlays to a single Plex item
     *
     * NOTE: configuredLibraryType is the library's configured type, but PlexBasePosterManager
     * will use item.type for TMDB API calls to prevent fetching wrong posters
     */
    async applyOverlaysToItem(plexApi, item, templates, configuredLibraryType, libraryId, libraryName, contextOverrides) {
        try {
            // CRITICAL: Derive actual media type from item.type, not library config
            // This prevents TMDB API namespace mismatches that cause wrong posters
            const actualMediaType = item.type === 'movie' ? 'movie' : 'show';
            // Warn if there's a mismatch between item type and library config
            if (actualMediaType !== configuredLibraryType) {
                logger_1.default.warn('Item type does not match library configuration', {
                    label: 'OverlayLibrary',
                    itemTitle: item.title,
                    ratingKey: item.ratingKey,
                    itemType: item.type,
                    configuredLibraryType,
                    usingType: actualMediaType,
                });
            }
            // Get metadata tracking for this item
            const metadataService = (await Promise.resolve().then(() => __importStar(require('../../lib/metadata/MetadataTrackingService')))).default;
            const metadata = await metadataService.getItemMetadata(item.ratingKey);
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
            // Check if this is a placeholder (async version with API call for suspicious items)
            const { placeholderContextService } = await Promise.resolve().then(() => __importStar(require('../../lib/placeholders/services/PlaceholderContextService')));
            const plexMetadata = item;
            logger_1.default.debug('Calling async placeholder detection', {
                label: 'OverlayLibrary',
                itemTitle: item.title,
                ratingKey: item.ratingKey,
                leafCount: plexMetadata.leafCount,
                type: plexMetadata.type,
            });
            const isPlaceholder = await placeholderContextService.isPlaceholderItemAsync(plexMetadata, plexApi['plexClient']);
            logger_1.default.debug('Async placeholder detection result', {
                label: 'OverlayLibrary',
                itemTitle: item.title,
                ratingKey: item.ratingKey,
                isPlaceholder,
            });
            // Build base context for dynamic fields
            const baseContext = await (0, OverlayContextBuilder_1.buildRenderContext)(item, actualMediaType, isPlaceholder, this.maintainerrCollectionsCache);
            // Fetch fresh release date information for ALL items with TMDB ID
            let releaseDateContext = {};
            if (tmdbId) {
                const releaseDateInfo = await (0, OverlayContextBuilder_1.fetchReleaseDateInfo)(tmdbId, actualMediaType);
                if (releaseDateInfo) {
                    // Calculate days until release and days ago
                    const { calculateDaysSince } = await Promise.resolve().then(() => __importStar(require('../../utils/dateHelpers')));
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
            // Check monitoring status for ALL items with TMDB ID
            let monitoringContext = {};
            if (tmdbId) {
                monitoringContext = await (0, OverlayContextBuilder_1.checkMonitoringStatus)(tmdbId, actualMediaType, this.radarrMoviesCache, this.sonarrSeriesCache);
            }
            // Merge contexts: base → release dates → monitoring → explicit overrides
            // Set isPlaceholder and downloaded at the end so they're always present
            // CRITICAL: If *arr reports hasFile=true, the item CANNOT be a placeholder
            // This overrides incorrect placeholder detection (e.g., corrupted metadata)
            let actualIsPlaceholder = isPlaceholder;
            if (monitoringContext.hasFile === true) {
                actualIsPlaceholder = false; // *arr has files, so it's definitely not a placeholder
            }
            // For downloaded: placeholders are never downloaded, real items check *arr hasFile status
            let downloaded;
            if (actualIsPlaceholder) {
                downloaded = false; // Placeholders are never downloaded
            }
            else if (typeof monitoringContext.hasFile === 'boolean') {
                downloaded = monitoringContext.hasFile; // Real monitored items use *arr hasFile status
            }
            else {
                downloaded = true; // Real items not in *arr are assumed downloaded (they exist in Plex)
            }
            // Collection membership for condition evaluation
            const collection = this.collectionMembershipCache?.get(item.ratingKey);
            const context = {
                ...baseContext,
                isPlaceholder: actualIsPlaceholder,
                downloaded,
                ...contextOverrides,
                ...releaseDateContext,
                ...monitoringContext,
                ...(collection ? { collection } : {}),
            };
            // Filter templates by conditions to get only templates that will actually be applied
            // CRITICAL: Hash must be based on MATCHING templates, not all enabled templates
            // This ensures hash changes when different templates match due to context changes
            const matchingTemplates = templates.filter((template) => {
                const condition = template.getApplicationCondition();
                return (0, OverlayTemplateRenderer_1.evaluateCondition)(condition, context);
            });
            // Calculate overlay input hash for metadata tracking
            // Extract which context fields are actually used by MATCHING templates
            // CRITICAL: Hash uses matching template IDs + variable field values + condition field values
            // Template IDs capture which templates match, field values capture all data affecting rendering
            const { calculateOverlayInputHash, extractUsedContextFields } = await Promise.resolve().then(() => __importStar(require('../../utils/metadataHashing')));
            const templateDataArray = matchingTemplates.map((t) => t.getTemplateData());
            const applicationConditions = matchingTemplates.map((t) => t.getApplicationCondition());
            const usedFields = extractUsedContextFields(templateDataArray, applicationConditions);
            const overlayInputHash = calculateOverlayInputHash({
                templateIds: matchingTemplates.map((t) => t.id).sort(),
                templateData: templateDataArray,
                usedFields: usedFields,
                context: context,
            });
            // Debug logging for hash comparison
            logger_1.default.debug('Overlay hash comparison', {
                label: 'OverlayLibrary',
                itemTitle: item.title,
                ratingKey: item.ratingKey,
                oldHash: metadata?.lastOverlayInputHash,
                newHash: overlayInputHash,
                matchingTemplateIds: matchingTemplates.map((t) => t.id).sort(),
                matchingTemplateNames: matchingTemplates.map((t) => t.name),
                usedFields: Array.from(usedFields),
                contextValues: {
                    downloaded: context.downloaded,
                    hasFile: context.hasFile,
                    isMonitored: context.isMonitored,
                    inSonarr: context.inSonarr,
                    daysAgo: context.daysAgo,
                    isPlaceholder: context.isPlaceholder,
                },
            });
            // OPTIMIZATION: Check if overlay inputs changed BEFORE downloading poster
            // This prevents expensive poster downloads when nothing has changed
            try {
                const currentPosterUrl = await plexApi.getCurrentPosterUrl(item.ratingKey);
                const overlayInputsChanged = metadata?.lastOverlayInputHash !== overlayInputHash;
                // Check if Plex poster changed using normalized comparison
                // This handles different URL formats (upload://, /library/metadata/, http://...)
                const { posterUrlsMatch, extractThumbId } = await Promise.resolve().then(() => __importStar(require('../../utils/posterUrlHelpers')));
                const plexPosterMissing = !posterUrlsMatch(metadata?.ourOverlayPosterUrl, currentPosterUrl);
                // Debug logging for poster URL comparison
                logger_1.default.debug('Poster URL comparison', {
                    label: 'OverlayLibrary',
                    itemTitle: item.title,
                    storedUrl: metadata?.ourOverlayPosterUrl,
                    currentUrl: currentPosterUrl,
                    storedThumbId: extractThumbId(metadata?.ourOverlayPosterUrl),
                    currentThumbId: extractThumbId(currentPosterUrl),
                    urlsMatch: !plexPosterMissing,
                    plexPosterMissing,
                });
                // Also check if base poster source changed (TMDB vs Plex)
                const settings = (0, settings_1.getSettings)();
                const posterSource = settings.overlays?.defaultPosterSource || 'tmdb';
                const basePosterSourceChanged = metadata?.basePosterSource !== posterSource;
                if (!overlayInputsChanged &&
                    !plexPosterMissing &&
                    !basePosterSourceChanged) {
                    logger_1.default.debug('Nothing changed, skipping overlay application', {
                        label: 'OverlayLibrary',
                        itemTitle: item.title,
                        ratingKey: item.ratingKey,
                        overlayInputsChanged: false,
                        plexPosterMissing: false,
                        basePosterSourceChanged: false,
                    });
                    return; // Skip this item - no need to download poster
                }
                logger_1.default.info('Applying overlays - changes detected', {
                    label: 'OverlayLibrary',
                    itemTitle: item.title,
                    overlayInputsChanged,
                    plexPosterMissing,
                    basePosterSourceChanged,
                });
            }
            catch (metaError) {
                logger_1.default.warn('Metadata check failed, proceeding with overlay', {
                    label: 'MetadataTracking',
                    error: metaError instanceof Error ? metaError.message : String(metaError),
                });
                // Fall through to apply overlay
            }
            // ONLY download poster if we've determined changes exist
            // Get poster source preference (global setting)
            const settings = (0, settings_1.getSettings)();
            const posterSource = settings.overlays?.defaultPosterSource || 'tmdb';
            // Get base poster with change detection
            const { plexBasePosterManager } = await Promise.resolve().then(() => __importStar(require('../../lib/overlays/PlexBasePosterManager')));
            let basePosterResult;
            try {
                basePosterResult = await plexBasePosterManager.getBasePosterForOverlay(plexApi, item, libraryId, libraryName, configuredLibraryType, posterSource, {
                    basePosterSource: metadata?.basePosterSource,
                    originalPlexPosterUrl: metadata?.originalPlexPosterUrl,
                    ourOverlayPosterUrl: metadata?.ourOverlayPosterUrl,
                    basePosterFilename: metadata?.basePosterFilename,
                    localPosterModifiedTime: metadata?.localPosterModifiedTime,
                }, tmdbId);
            }
            catch (error) {
                // Re-throw to let caller track this as a failure
                // Previously this was silently returning, causing failed items to be counted as success
                throw new Error(`Failed to get base poster for "${item.title}": ${error instanceof Error ? error.message : String(error)}`);
            }
            const posterBuffer = basePosterResult.posterBuffer;
            // Batch render: collect overlay elements from all matching templates,
            // then composite everything in a single sharp operation.
            // This avoids repeated lossy WebP decode/encode cycles between templates.
            let templatesApplied = 0;
            const allOverlays = [];
            // Get poster dimensions once (shared across all templates)
            const { width: posterWidth, height: posterHeight } = await OverlayTemplateRenderer_1.overlayTemplateRenderer.getPosterDimensions(posterBuffer);
            for (const template of templates) {
                // Check if application condition is met
                const condition = template.getApplicationCondition();
                if (!(0, OverlayTemplateRenderer_1.evaluateCondition)(condition, context)) {
                    continue;
                }
                const templateData = template.getTemplateData();
                const templateOverlays = await OverlayTemplateRenderer_1.overlayTemplateRenderer.renderOverlayElements(posterWidth, posterHeight, templateData, context);
                if (templateOverlays) {
                    allOverlays.push(...templateOverlays);
                    templatesApplied++;
                }
            }
            // Single composite + WebP encode for all templates
            const currentBuffer = await OverlayTemplateRenderer_1.overlayTemplateRenderer.compositeOverlays(posterBuffer, allOverlays);
            // Save to temporary file
            const tempDir = os_1.default.tmpdir();
            const tempFilePath = path_1.default.join(tempDir, `overlay-${item.ratingKey}-${Date.now()}.webp`);
            await promises_1.default.writeFile(tempFilePath, currentBuffer);
            try {
                // Upload modified poster back to Plex
                await plexApi.uploadPosterFromFile(item.ratingKey, tempFilePath);
                // Lock poster to prevent Plex from auto-updating it during library scans
                try {
                    await plexApi.lockPoster(item.ratingKey);
                    logger_1.default.debug('Locked poster after overlay application', {
                        label: 'OverlayLibrary',
                        itemTitle: item.title,
                        ratingKey: item.ratingKey,
                    });
                }
                catch (lockError) {
                    logger_1.default.warn('Failed to lock poster after overlay application', {
                        label: 'OverlayLibrary',
                        itemTitle: item.title,
                        ratingKey: item.ratingKey,
                        error: lockError instanceof Error
                            ? lockError.message
                            : String(lockError),
                    });
                }
                // Record overlay metadata tracking with base poster info
                try {
                    const newPosterUrl = await plexApi.getCurrentPosterUrl(item.ratingKey);
                    if (newPosterUrl) {
                        await metadataService.recordOverlayApplicationWithBasePoster(item.ratingKey, libraryId, overlayInputHash, newPosterUrl, {
                            basePosterSource: posterSource,
                            originalPlexPosterUrl: basePosterResult.sourceUrl,
                            basePosterFilename: basePosterResult.filename,
                            localPosterModifiedTime: basePosterResult.fileModTime,
                        });
                    }
                }
                catch (metaError) {
                    logger_1.default.error('Failed to record overlay metadata, upload succeeded', {
                        label: 'MetadataTracking',
                        error: metaError instanceof Error
                            ? metaError.message
                            : String(metaError),
                    });
                }
                // Manage "Overlay" label based on whether overlays were applied
                if (templatesApplied > 0) {
                    // Add "Overlay" label to indicate this item has overlays
                    try {
                        await plexApi.addLabelToItem(item.ratingKey, 'Overlay');
                        logger_1.default.debug('Added Overlay label', {
                            label: 'OverlayLibrary',
                            itemTitle: item.title,
                            ratingKey: item.ratingKey,
                            templatesApplied,
                        });
                    }
                    catch (error) {
                        // Log but don't fail the entire operation if label addition fails
                        logger_1.default.warn('Failed to add Overlay label', {
                            label: 'OverlayLibrary',
                            itemTitle: item.title,
                            ratingKey: item.ratingKey,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
                else {
                    // Remove "Overlay" label since we've reset to default poster
                    try {
                        await plexApi.removeLabelFromItem(item.ratingKey, 'Overlay');
                        logger_1.default.debug('Removed Overlay label - no templates applied', {
                            label: 'OverlayLibrary',
                            itemTitle: item.title,
                            ratingKey: item.ratingKey,
                        });
                    }
                    catch (error) {
                        // Log but don't fail the entire operation if label removal fails
                        logger_1.default.warn('Failed to remove Overlay label', {
                            label: 'OverlayLibrary',
                            itemTitle: item.title,
                            ratingKey: item.ratingKey,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
                logger_1.default.info('Applied overlays to item', {
                    label: 'OverlayLibrary',
                    itemTitle: item.title,
                    templateCount: templates.length,
                    templatesApplied,
                });
            }
            finally {
                // Clean up temp file
                await promises_1.default.unlink(tempFilePath).catch(() => {
                    // Ignore cleanup errors
                });
            }
        }
        catch (error) {
            logger_1.default.error('Failed to apply overlays to item', {
                label: 'OverlayLibrary',
                itemTitle: item.title,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                errorDetails: error,
            });
            throw error;
        }
    }
}
exports.overlayLibraryService = new OverlayLibraryService();
