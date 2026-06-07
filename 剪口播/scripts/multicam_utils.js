#!/usr/bin/env node
/**
 * 多机位模式共用工具。
 *
 * 这里保持纯数据逻辑，供准备脚本、审核页服务器和测试复用。
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_SPEAKER_COLORS = [
  '#2f6fe4',
  '#c9433b',
  '#2f8f5b',
  '#9a6a17',
  '#7c4dff',
  '#0f7f8f',
  '#b94f8f',
  '#5d6b20',
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function roundTime(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function sanitizeId(value, fallback = 'item') {
  const text = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return text || fallback;
}

function normalizeKind(value) {
  return value === 'audio' ? 'audio' : 'video';
}

function normalizeManifest(manifest, baseDir = process.cwd()) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('多机位清单格式错误：必须是对象');
  }
  if (manifest.mode && manifest.mode !== 'multicam') {
    throw new Error(`不支持的模式: ${manifest.mode}`);
  }
  if (!Array.isArray(manifest.sources) || !manifest.sources.length) {
    throw new Error('多机位清单缺少 sources');
  }

  const seenSourceIds = new Set();
  const sources = manifest.sources.map((source, index) => {
    const id = sanitizeId(source.id || source.name || `source_${index + 1}`, `source_${index + 1}`);
    if (seenSourceIds.has(id)) throw new Error(`重复的 source id: ${id}`);
    seenSourceIds.add(id);
    if (!source.path) throw new Error(`source ${id} 缺少 path`);
    const absPath = path.resolve(baseDir, source.path);
    const kind = normalizeKind(source.kind);
    return {
      id,
      kind,
      path: absPath,
      name: String(source.name || id),
      speakerId: source.speakerId ? sanitizeId(source.speakerId) : null,
      offset: Number.isFinite(Number(source.offset)) ? Number(source.offset) : 0,
      primary: Boolean(source.primary),
      reviewPath: source.reviewPath || '',
      wordsFile: source.wordsFile ? path.resolve(baseDir, source.wordsFile) : '',
      duration: Number.isFinite(Number(source.duration)) ? Number(source.duration) : null,
      width: Number.isFinite(Number(source.width)) ? Number(source.width) : null,
      height: Number.isFinite(Number(source.height)) ? Number(source.height) : null,
      frameRate: source.frameRate || '',
      audioChannels: Number.isFinite(Number(source.audioChannels)) ? Number(source.audioChannels) : null,
      audioSampleRate: source.audioSampleRate || '',
    };
  });

  if (!sources.some(source => source.primary && source.kind === 'video')) {
    const firstVideo = sources.find(source => source.kind === 'video');
    if (firstVideo) firstVideo.primary = true;
  }

  const speakerInput = Array.isArray(manifest.speakers) ? manifest.speakers : [];
  const speakerMap = new Map();
  speakerInput.forEach((speaker, index) => {
    const id = sanitizeId(speaker.id || speaker.name || `speaker_${index + 1}`, `speaker_${index + 1}`);
    if (!speakerMap.has(id)) {
      speakerMap.set(id, {
        id,
        name: String(speaker.name || id),
        color: speaker.color || DEFAULT_SPEAKER_COLORS[index % DEFAULT_SPEAKER_COLORS.length],
      });
    }
  });

  sources.forEach(source => {
    if (!source.speakerId || speakerMap.has(source.speakerId)) return;
    speakerMap.set(source.speakerId, {
      id: source.speakerId,
      name: source.name || source.speakerId,
      color: DEFAULT_SPEAKER_COLORS[speakerMap.size % DEFAULT_SPEAKER_COLORS.length],
    });
  });

  return {
    version: Number.isFinite(Number(manifest.version)) ? Number(manifest.version) : 1,
    mode: 'multicam',
    projectTitle: String(manifest.projectTitle || '多机位粗剪校样'),
    sources,
    speakers: Array.from(speakerMap.values()),
  };
}

function normalizeSourceWords(words, source) {
  if (!Array.isArray(words)) throw new Error(`${source.id} 的 words 必须是数组`);
  return words
    .filter(word => word && !word.isGap && Number.isFinite(Number(word.start)) && Number.isFinite(Number(word.end)))
    .map((word, index) => {
      const start = Number(word.start) + source.offset;
      const end = Number(word.end) + source.offset;
      return {
        text: String(word.text || ''),
        start: roundTime(start),
        end: roundTime(end),
        rawStart: roundTime(Number(word.start)),
        rawEnd: roundTime(Number(word.end)),
        isGap: false,
        sourceId: source.id,
        speakerId: source.speakerId,
        sourceWordIndex: Number.isInteger(word.index) ? word.index : index,
        segmentId: word.segmentId,
        segmentStart: Boolean(word.segmentStart),
        segmentEnd: Boolean(word.segmentEnd),
        segmentText: word.segmentText || '',
        punctuationAfter: word.punctuationAfter || '',
      };
    })
    .filter(word => word.text && word.end > word.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function addSharedGapTokens(sortedWords) {
  const tokens = [];
  let lastEnd = 0;

  sortedWords.forEach(word => {
    const gapDuration = word.start - lastEnd;
    if (gapDuration > 0.1) {
      let gapStart = lastEnd;
      while (gapStart < word.start) {
        const gapEnd = gapDuration > 0.5 ? Math.min(gapStart + 1, word.start) : word.start;
        tokens.push({
          text: '',
          start: roundTime(gapStart),
          end: roundTime(gapEnd),
          isGap: true,
          speakerId: null,
          sourceId: null,
        });
        gapStart = gapEnd;
      }
    }
    tokens.push(word);
    lastEnd = Math.max(lastEnd, word.end);
  });

  return tokens;
}

function buildProjectFromSourceWords(manifest, sourceWordsById, baseDir = process.cwd()) {
  const project = normalizeManifest(manifest, baseDir);
  const wordTokens = [];

  project.sources.forEach(source => {
    const words = sourceWordsById[source.id];
    if (!source.speakerId || !words) return;
    wordTokens.push(...normalizeSourceWords(words, source));
  });

  wordTokens.sort((a, b) => a.start - b.start || a.end - b.end);
  const words = addSharedGapTokens(wordTokens);
  const wordDuration = words.reduce((max, word) => Math.max(max, word.end || 0), 0);
  const sourceDuration = project.sources.reduce((max, source) => {
    if (!Number.isFinite(Number(source.duration))) return max;
    return Math.max(max, Number(source.duration) + Number(source.offset || 0));
  }, 0);

  return {
    ...project,
    duration: roundTime(Math.max(wordDuration, sourceDuration)),
    words,
  };
}

function normalizeDeleteSegments(deleteList, duration, mergeGap = 0.2) {
  const safeDuration = Math.max(0, Number(duration) || 0);
  const normalized = (Array.isArray(deleteList) ? deleteList : [])
    .map(seg => ({
      start: Math.max(0, Math.min(safeDuration, Number(seg.start))),
      end: Math.max(0, Math.min(safeDuration, Number(seg.end))),
    }))
    .filter(seg => Number.isFinite(seg.start) && Number.isFinite(seg.end) && seg.end > seg.start)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  normalized.forEach(seg => {
    const last = merged[merged.length - 1];
    if (!last || seg.start > last.end + mergeGap) {
      merged.push({ ...seg });
    } else {
      last.end = Math.max(last.end, seg.end);
    }
  });
  return merged;
}

function subtractDeletesFromInterval(interval, deleteSegments) {
  const clips = [];
  let cursor = interval.start;
  deleteSegments.forEach(del => {
    if (del.end <= cursor || del.start >= interval.end) return;
    if (del.start > cursor) {
      clips.push({ start: cursor, end: Math.min(del.start, interval.end), paragraphId: interval.id || null });
    }
    cursor = Math.max(cursor, del.end);
  });
  if (cursor < interval.end) clips.push({ start: cursor, end: interval.end, paragraphId: interval.id || null });
  return clips.filter(seg => seg.end - seg.start > 0.001);
}

function computeKeepSegments(deleteList, duration) {
  const deleteSegments = normalizeDeleteSegments(deleteList, duration);
  return subtractDeletesFromInterval({ start: 0, end: Math.max(0, Number(duration) || 0) }, deleteSegments);
}

function normalizeParagraphs(paragraphs, duration) {
  const safeDuration = Math.max(0, Number(duration) || 0);
  if (!Array.isArray(paragraphs)) return [];
  return paragraphs
    .map((paragraph, index) => ({
      id: String(paragraph.id || `paragraph_${index + 1}`),
      start: Math.max(0, Math.min(safeDuration, Number(paragraph.start))),
      end: Math.max(0, Math.min(safeDuration, Number(paragraph.end))),
    }))
    .filter(paragraph => Number.isFinite(paragraph.start) && Number.isFinite(paragraph.end) && paragraph.end > paragraph.start)
    .sort((a, b) => a.start - b.start);
}

function buildOrderedKeepSegments({ deleteList = [], duration = 0, paragraphOrder = [], paragraphs = [] } = {}) {
  const normalizedParagraphs = normalizeParagraphs(paragraphs, duration);
  if (!normalizedParagraphs.length || !Array.isArray(paragraphOrder) || !paragraphOrder.length) {
    return computeKeepSegments(deleteList, duration);
  }

  const paragraphMap = new Map(normalizedParagraphs.map(paragraph => [paragraph.id, paragraph]));
  const seen = new Set();
  const ordered = [];
  paragraphOrder.forEach(id => {
    const paragraphId = String(id);
    const paragraph = paragraphMap.get(paragraphId);
    if (!paragraph || seen.has(paragraphId)) return;
    seen.add(paragraphId);
    ordered.push(paragraph);
  });
  normalizedParagraphs.forEach(paragraph => {
    if (!seen.has(paragraph.id)) ordered.push(paragraph);
  });

  const deleteSegments = normalizeDeleteSegments(deleteList, duration);
  const clips = [];
  ordered.forEach(paragraph => {
    clips.push(...subtractDeletesFromInterval(paragraph, deleteSegments));
  });

  return clips.length ? clips : computeKeepSegments(deleteList, duration);
}

function mapGlobalSegmentToSource(globalSegment, source, offsetOverride = null) {
  const hasOverride = offsetOverride !== null && offsetOverride !== undefined && offsetOverride !== '';
  const offset = hasOverride && Number.isFinite(Number(offsetOverride)) ? Number(offsetOverride) : Number(source.offset || 0);
  const duration = Number.isFinite(Number(source.duration)) ? Number(source.duration) : null;
  let localStart = globalSegment.start - offset;
  let localEnd = globalSegment.end - offset;
  let timelineShift = 0;

  if (duration != null) {
    if (localEnd <= 0 || localStart >= duration) return null;
    if (localStart < 0) {
      timelineShift = -localStart;
      localStart = 0;
    }
    localEnd = Math.min(duration, localEnd);
  }

  if (localEnd <= localStart) return null;
  return {
    sourceId: source.id,
    start: roundTime(localStart),
    end: roundTime(localEnd),
    duration: roundTime(localEnd - localStart),
    timelineShift: roundTime(timelineShift),
  };
}

function estimateProjectDuration(project) {
  const sourceMax = (project.sources || []).reduce((max, source) => {
    if (!Number.isFinite(Number(source.duration))) return max;
    return Math.max(max, Number(source.offset || 0) + Number(source.duration));
  }, 0);
  const wordMax = (project.words || []).reduce((max, word) => Math.max(max, Number(word.end || 0)), 0);
  return roundTime(Math.max(Number(project.duration || 0), sourceMax, wordMax));
}

module.exports = {
  DEFAULT_SPEAKER_COLORS,
  readJson,
  roundTime,
  sanitizeId,
  normalizeManifest,
  buildProjectFromSourceWords,
  normalizeDeleteSegments,
  computeKeepSegments,
  buildOrderedKeepSegments,
  mapGlobalSegmentToSource,
  estimateProjectDuration,
};
