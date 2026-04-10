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
            const response = await this.axios.get('/api/collections');
            return response.data;
        }
        catch (e) {
            logger_1.default.error('Something went wrong fetching Maintainerr collections', {
                label: 'Maintainerr API',
                errorMessage: e.message,
            });
            throw e;
        }
    }
    async getAllCollectionMedia(collectionId) {
        try {
            const response = await this.axios.get(`/api/collections/media?collectionId=${collectionId}`);
            return response.data;
        }
        catch (e) {
            logger_1.default.error('Something went wrong fetching Maintainerr collection media', {
                label: 'Maintainerr API',
                collectionId,
                errorMessage: e.message,
            });
            return [];
        }
    }
}
exports.default = MaintainerrAPI;
