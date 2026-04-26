import test from 'node:test';
import assert from 'node:assert/strict';
import { __trainTestables } from '../dist/testing/train-test-entry.js';

const {
  isProjectFactQuery,
  buildProjectEvidenceHits,
  buildProjectFactFallbackReply,
  shouldUseProjectFactFallback,
  isPersonaMetaDeflection,
} = __trainTestables;

test('detects project and open-source questions', () => {
  assert.equal(isProjectFactQuery('你有什么开源项目？'), true);
  assert.equal(isProjectFactQuery('Can you explain your GitHub projects?'), true);
  assert.equal(isProjectFactQuery('你怎么看长期主义？'), false);
});

test('buildProjectEvidenceHits promotes project-bearing raw docs', () => {
  const hits = buildProjectEvidenceHits('你有什么开源项目？', [
    {
      id: '11111111-1111-1111-1111-111111111111',
      source_type: 'twitter',
      content: '#妙言 - 一个简洁好看的开源的 Mac Markdown 编辑器，使用原生 Swift 开发。',
      author: 'hitw93',
      fetched_at: '2026-01-01T00:00:00.000Z',
      published_at: '2025-12-31T00:00:00.000Z',
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      source_type: 'twitter',
      content: '我更关心复杂度税，而不是表面的新鲜感。',
      author: 'hitw93',
      fetched_at: '2026-01-01T00:00:00.000Z',
      published_at: '2025-12-30T00:00:00.000Z',
    },
  ]);

  assert.equal(hits.length, 1);
  assert.equal(hits[0].label, '妙言');
});

test('buildProjectEvidenceHits excludes recommended third-party tools for self project queries', () => {
  const hits = buildProjectEvidenceHits('你有什么开源项目？请基于你公开提到过的内容直接列出来。', [
    {
      id: '11111111-1111-1111-1111-111111111111',
      source_type: 'twitter',
      content: '周刊之前想弄个网站，发现没有好看的，国庆假期和周末用 Astro 自己独立设计开发了一个，当然也欢迎收藏「潮流周刊」，最近的工具推荐均来源于此。',
      author: 'hitw93',
      fetched_at: '2026-01-01T00:00:00.000Z',
      published_at: '2025-12-31T00:00:00.000Z',
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      source_type: 'twitter',
      content: '在 Github 上面看到一个智能的通用数据库 SQL 客户端和报表工具「Chat2DB」，这个思路挺好的，有兴趣可以玩玩看。',
      author: 'hitw93',
      fetched_at: '2026-01-01T00:00:00.000Z',
      published_at: '2025-12-30T00:00:00.000Z',
    },
  ]);

  assert.equal(hits.some((item) => item.label === '潮流周刊'), true);
  assert.equal(hits.some((item) => item.label === 'Chat2DB'), false);
});

test('fallback reply lists supported project facts instead of meta denial', () => {
  const reply = buildProjectFactFallbackReply([
    {
      label: 'Pake',
      snippet: 'Pake 开源建设来源于这两块，第一次真实体会中文圈的开源氛围。',
      sourceType: 'twitter',
      score: 5,
    },
    {
      label: '妙言',
      snippet: '妙言是一个简洁好看的开源 Mac Markdown 编辑器。',
      sourceType: 'twitter',
      score: 4.5,
    },
  ]);

  assert.match(reply, /Pake/);
  assert.match(reply, /妙言/);
  assert.doesNotMatch(reply, /虚拟|模拟/u);
});

test('detects persona meta deflection phrases', () => {
  assert.equal(isPersonaMetaDeflection('作为一个模拟，我并没有自己实际的开源项目。'), true);
  assert.equal(isPersonaMetaDeflection('基于我公开提到过的内容，我做过 Pake 和妙言。'), false);
});

test('project fallback triggers when self-project answer omits all matched project labels', () => {
  const hits = [
    {
      label: 'Pake',
      snippet: 'Pake 是我做过的桌面打包工具。',
      sourceType: 'twitter',
      score: 5,
    },
  ];

  assert.equal(
    shouldUseProjectFactFallback('你有什么开源项目？', '我比较看重成熟可靠的开源生态。', hits),
    true,
  );
  assert.equal(
    shouldUseProjectFactFallback('你有什么开源项目？', '我做过 Pake，它是一个桌面打包工具。', hits),
    false,
  );
  assert.equal(
    shouldUseProjectFactFallback(
      '你有什么开源项目？请基于你公开提到过的内容直接列出来。',
      '我做过 Pake。另外我还推荐过 Chat2DB，但那是别人的项目。',
      hits,
    ),
    true,
  );
});
