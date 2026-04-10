// TEMPORARY PATCH — delete this file when agregarr/agregarr#569 is merged and released.
// Compiled from the fix proposed in that PR. Mounted over /app/dist/api/maintainerr.js
// via the agregarr-maintainerr-patch ConfigMap.
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("../logger"));
const axios_1 = __importDefault(require("axios"));
class MaintainerrAPI {
    constructor(settings) {
        const protocol = settings.useSsl ? 'https' : 'http';
        const port = settings.port ? `:${settings.port}` : '';
        const urlBase = settings.urlBase ?? '';
        this.axios = axios_1.default.create({
            baseURL: `${protocol}://${settings.hostname}${port}${urlBase}`,
            headers: { 'X-Api-Key': settings.apiKey },
            timeout: 30000,
        });
    }
    async getCollections() {
        try {
            const response = await this.axios.get('/api/collections/overlay-data');
            return response.data;
        }
        catch (e) {
            if (e.response?.status === 404) {
                logger_1.default.warn('Maintainerr /api/collections/overlay-data not found, falling back to /api/collections. Upgrade Maintainerr to >= 3.4.0 for full overlay support.', {
                    label: 'Maintainerr API',
                });
                try {
                    const fallback = await this.axios.get('/api/collections');
                    return fallback.data;
                }
                catch (fallbackError) {
                    logger_1.default.error('Something went wrong fetching Maintainerr collections (fallback)', {
                        label: 'Maintainerr API',
                        errorMessage: fallbackError.message,
                    });
                    throw fallbackError;
                }
            }
            logger_1.default.error('Something went wrong fetching Maintainerr collections', {
                label: 'Maintainerr API',
                errorMessage: e.message,
            });
            throw e;
        }
    }
}
exports.default = MaintainerrAPI;
