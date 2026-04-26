import test from 'node:test';
import assert from 'node:assert/strict';
import { __articleAdapterTestables } from '../dist/testing/article-adapter-test-entry.js';

const {
  buildFallbackUrls,
  isBrowserErrorPage,
  isHostLookupFailure,
  openCliEnv,
} = __articleAdapterTestables;

test('buildFallbackUrls keeps original url first and adds www fallback for apex domains', () => {
  assert.deepEqual(
    buildFallbackUrls('https://garrytan.com'),
    ['https://garrytan.com/', 'https://www.garrytan.com/'],
  );
});

test('buildFallbackUrls adds apex fallback for www domains', () => {
  assert.deepEqual(
    buildFallbackUrls('https://www.garrytan.com/about'),
    ['https://www.garrytan.com/about', 'https://garrytan.com/about'],
  );
});

test('isHostLookupFailure detects nested resolver failures', () => {
  const nested = new Error('article fetch failed');
  nested.cause = new Error('getaddrinfo ENOTFOUND garrytan.com');
  assert.equal(isHostLookupFailure(nested), true);
  assert.equal(isHostLookupFailure(new Error('timeout while reading page')), false);
});

test('isBrowserErrorPage rejects chromium failure pages', () => {
  assert.equal(isBrowserErrorPage('# 无法访问此网站\n\nERR_CONNECTION_CLOSED'), true);
  assert.equal(isBrowserErrorPage("# This site can't be reached\n\nERR_NAME_NOT_RESOLVED"), true);
  assert.equal(isBrowserErrorPage('# Real Article\n\nGarry Tan writes about founders and software.'), false);
});

test('openCliEnv extends PATH and enforces browser timeout floor', () => {
  const env = openCliEnv();
  assert.match(env.PATH, /\/usr\/local\/bin/);
  assert.match(env.PATH, /\/opt\/homebrew\/bin/);
  assert.equal(Number(env.OPENCLI_BROWSER_COMMAND_TIMEOUT) >= 180, true);
});
