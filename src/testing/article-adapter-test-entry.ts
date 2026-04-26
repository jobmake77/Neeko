import {
  ArticleAdapter,
  buildFallbackUrls,
  isBrowserErrorPage,
  isHostLookupFailure,
  openCliEnv,
  resolveOpenCliCommand,
} from '../core/pipeline/ingestion/article.js';

export const __articleAdapterTestables = {
  ArticleAdapter,
  buildFallbackUrls,
  isBrowserErrorPage,
  isHostLookupFailure,
  openCliEnv,
  resolveOpenCliCommand,
};
