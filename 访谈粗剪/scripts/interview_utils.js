#!/usr/bin/env node
/**
 * 访谈粗剪入口的轻量工具层。
 *
 * 这里刻意复用「剪口播」里的多机位时间线能力，同时把访谈版需要的
 * XML/timecode/manual 对轨、保守 AI 建议和分析产物独立出来。
 */

const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const { spawnSync } = require('child_process');

const multicamUtils = require('../../剪口播/scripts/multicam_utils');

const DEFAULT_FPS = 30;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseFractionSeconds(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(-?\d+)\/(\d+)s$/);
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function parseTimeToSeconds(value, fps = DEFAULT_FPS) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value).trim();
  const fraction = parseFractionSeconds(text);
  if (fraction != null) return fraction;
  if (/^-?\d+(\.\d+)?s$/.test(text)) return Number(text.slice(0, -1));
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);

  const timecode = text.match(/^(\d{1,2}):(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/);
  if (!timecode) return null;
  const hours = Number(timecode[1]);
  const minutes = Number(timecode[2]);
  const seconds = Number(timecode[3]);
  const frame = timecode[4] != null ? Number(timecode[4]) : 0;
  const millis = timecode[5] != null ? Number(`0.${timecode[5]}`) : 0;
  return hours * 3600 + minutes * 60 + seconds + frame / fps + millis;
}

function probeMedia(source) {
  const result = spawnSync('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    `file:${source.path}`,
  ], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) return {};
  const info = JSON.parse(result.stdout);
  const video = (info.streams || []).find(stream => stream.codec_type === 'video') || {};
  const audio = (info.streams || []).find(stream => stream.codec_type === 'audio') || {};
  return {
    duration: Number(info.format?.duration) || source.duration || null,
    width: video.width || source.width || null,
    height: video.height || source.height || null,
    frameRate: video.r_frame_rate || video.avg_frame_rate || source.frameRate || '',
    audioChannels: audio.channels || source.audioChannels || null,
    audioSampleRate: audio.sample_rate || source.audioSampleRate || '',
    timecode: video.tags?.timecode || info.format?.tags?.timecode || source.timecode || '',
  };
}

function detectEmbeddedTimecode(file, fps = DEFAULT_FPS) {
  const source = { path: path.resolve(file) };
  const info = probeMedia(source);
  const timecode = info.timecode || '';
  const seconds = parseTimeToSeconds(timecode, fps);
  return {
    path: source.path,
    timecode,
    seconds,
    hasTimecode: Number.isFinite(seconds),
    fps,
  };
}

function normalizeUrlPath(value) {
  if (!value) return '';
  try {
    if (value.startsWith('file://')) return fileURLToPath(value);
  } catch (err) {
    return decodeURIComponent(value.replace(/^file:\/+/, '/'));
  }
  return decodeURIComponent(value);
}

function parseXmlAssets(xmlText) {
  const assets = new Map();
  const assetRe = /<asset\b([^>]*)>/g;
  let match;
  while ((match = assetRe.exec(xmlText))) {
    const attrs = parseXmlAttrs(match[1]);
    if (!attrs.id) continue;
    const srcPath = normalizeUrlPath(attrs.src || '');
    assets.set(attrs.id, {
      id: attrs.id,
      name: attrs.name || attrs.id,
      src: srcPath,
      basename: srcPath ? path.basename(srcPath) : '',
    });
  }
  return assets;
}

function parseXmlAttrs(attrText) {
  const attrs = {};
  const attrRe = /([:\w-]+)="([^"]*)"/g;
  let match;
  while ((match = attrRe.exec(attrText))) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function parseSyncedXmlOffsets(xmlFile, sources, fps = DEFAULT_FPS) {
  const xmlText = fs.readFileSync(xmlFile, 'utf8');
  const assets = parseXmlAssets(xmlText);
  const offsetsBySourceId = {};
  const clipRe = /<(?:asset-clip|clip|sync-clip)\b([^>]*)>/g;
  let match;
  while ((match = clipRe.exec(xmlText))) {
    const attrs = parseXmlAttrs(match[1]);
    const asset = attrs.ref ? assets.get(attrs.ref) : null;
    if (!asset) continue;
    const globalOffset = parseTimeToSeconds(attrs.offset || attrs.tcStart || '0s', fps);
    const localStart = parseTimeToSeconds(attrs.start || '0s', fps) || 0;
    if (!Number.isFinite(globalOffset)) continue;
    const matchedSource = matchSourceByAsset(sources, asset);
    if (!matchedSource || offsetsBySourceId[matchedSource.id] != null) continue;
    offsetsBySourceId[matchedSource.id] = multicamUtils.roundTime(globalOffset - localStart);
  }
  return offsetsBySourceId;
}

function matchSourceByAsset(sources, asset) {
  const assetBase = path.basename(asset.src || asset.basename || '').toLowerCase();
  const assetName = String(asset.name || '').toLowerCase();
  return sources.find(source => {
    const sourceBase = path.basename(source.path || '').toLowerCase();
    const sourceName = String(source.name || source.id || '').toLowerCase();
    return (assetBase && sourceBase && assetBase === sourceBase)
      || (assetName && (assetName === sourceName || assetName.includes(sourceBase) || sourceName.includes(assetName)));
  }) || null;
}

function applyXmlOffsets(manifest, xmlFile) {
  const offsets = parseSyncedXmlOffsets(xmlFile, manifest.sources || []);
  return {
    ...manifest,
    syncMethod: 'xml',
    syncConfidence: 1,
    sources: (manifest.sources || []).map(source => {
      if (offsets[source.id] == null) return source;
      return {
        ...source,
        offset: offsets[source.id],
        syncMethod: 'xml',
        syncConfidence: 1,
      };
    }),
  };
}

function applyTimecodeOffsets(manifest, fps = DEFAULT_FPS) {
  const detections = (manifest.sources || []).map(source => ({
    source,
    detection: detectEmbeddedTimecode(source.path, fps),
  }));
  const valid = detections.filter(item => item.detection.hasTimecode);
  if (!valid.length) {
    return {
      ...manifest,
      sources: (manifest.sources || []).map(source => ({
        ...source,
        offset: Number(source.offset || 0),
        syncMethod: source.syncMethod || 'manual',
        syncConfidence: source.syncConfidence ?? 0.8,
      })),
    };
  }
  const minTimecode = Math.min(...valid.map(item => item.detection.seconds));
  return {
    ...manifest,
    syncMethod: 'timecode',
    syncConfidence: 0.95,
    sources: detections.map(({ source, detection }) => {
      if (!detection.hasTimecode) {
        return {
          ...source,
          offset: Number(source.offset || 0),
          syncMethod: source.syncMethod || 'manual',
          syncConfidence: source.syncConfidence ?? 0.8,
          timecode: '',
        };
      }
      return {
        ...source,
        offset: multicamUtils.roundTime(detection.seconds - minTimecode),
        syncMethod: 'timecode',
        syncConfidence: 0.95,
        timecode: detection.timecode,
      };
    }),
  };
}

function ensureManualSyncDefaults(manifest) {
  return {
    ...manifest,
    syncMethod: manifest.syncMethod || 'manual',
    syncConfidence: manifest.syncConfidence ?? 0.8,
    sources: (manifest.sources || []).map(source => ({
      ...source,
      offset: Number(source.offset || 0),
      syncMethod: source.syncMethod || 'manual',
      syncConfidence: source.syncConfidence ?? 0.8,
    })),
  };
}

function buildInterviewAutoSelected(words) {
  const autoSelected = new Set();
  const notes = [];
  const filler = new Set(['啊', '呃', '嗯', '额', '然后然后', '这个这个']);
  let lastWord = null;
  (Array.isArray(words) ? words : []).forEach((word, index) => {
    if (!word) return;
    if (word.isGap) {
      const duration = Number(word.end || 0) - Number(word.start || 0);
      if (duration >= 0.25) {
        autoSelected.add(index);
        if (duration >= 1.2) notes.push({ index, start: word.start, reason: `长停顿 ${duration.toFixed(1)}s` });
      }
      return;
    }
    const text = String(word.text || '').trim();
    const duration = Number(word.end || 0) - Number(word.start || 0);
    if (filler.has(text) || (text.length <= 1 && /[啊呃嗯额]/.test(text))) {
      autoSelected.add(index);
      notes.push({ index, start: word.start, reason: `语气词/残词：${text}` });
    }
    if (lastWord && lastWord.text === text && Number(word.start || 0) - Number(lastWord.end || 0) < 1.2 && duration < 1) {
      autoSelected.add(index);
      notes.push({ index, start: word.start, reason: `相邻重复：${text}` });
    }
    if (text) lastWord = { text, end: Number(word.end || 0) };
  });
  return {
    autoSelected: Array.from(autoSelected).sort((a, b) => a - b),
    notes,
  };
}

function speakerLabelForWord(word, project) {
  const speaker = (project.speakers || []).find(item => item.id === word.speakerId);
  return speaker?.name || word.speakerId || '';
}

function buildReadableTranscript(project) {
  const lines = [];
  let currentSpeaker = '';
  let current = '';
  (project.words || []).forEach(word => {
    if (!word || word.isGap) {
      if (word && Number(word.end || 0) - Number(word.start || 0) >= 1.2 && current.trim()) {
        lines.push(current.trim());
        current = '';
      }
      return;
    }
    const speaker = speakerLabelForWord(word, project);
    if (speaker && speaker !== currentSpeaker) {
      if (current.trim()) lines.push(current.trim());
      currentSpeaker = speaker;
      current = `${speaker}：`;
    }
    current += String(word.text || '');
    if (word.punctuationAfter) current += word.punctuationAfter;
  });
  if (current.trim()) lines.push(current.trim());
  return lines.join('\n\n');
}

function writeInterviewAnalysis(project, analysisDir = '2_分析') {
  ensureDir(analysisDir);
  const { autoSelected, notes } = buildInterviewAutoSelected(project.words || []);
  writeJson(path.join(analysisDir, 'auto_selected.json'), autoSelected);
  fs.writeFileSync(path.join(analysisDir, 'readable.txt'), buildReadableTranscript(project), 'utf8');
  fs.writeFileSync(path.join(analysisDir, 'sentences.txt'), buildReadableTranscript(project).replace(/\n\n/g, '\n'), 'utf8');
  const summary = [
    '# 访谈粗剪分析',
    '',
    `- 模式：${project.mode || 'interview'}`,
    `- 素材：${(project.sources || []).length} 条`,
    `- 说话人：${(project.speakers || []).map(speaker => speaker.name).join('、') || '未标注'}`,
    `- Token：${(project.words || []).length}`,
    `- AI 预选：${autoSelected.length}`,
    '',
    '## 保守建议',
    '',
    ...(notes.slice(0, 80).map(note => `- ${formatClock(note.start || 0)} ${note.reason}`)),
    notes.length > 80 ? `- 还有 ${notes.length - 80} 条建议未列出。` : '',
  ].filter(Boolean).join('\n');
  fs.writeFileSync(path.join(analysisDir, '访谈粗剪分析.md'), summary, 'utf8');
  return { autoSelected, notes };
}

function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

module.exports = {
  ...multicamUtils,
  DEFAULT_FPS,
  readJson,
  writeJson,
  ensureDir,
  parseTimeToSeconds,
  probeMedia,
  detectEmbeddedTimecode,
  parseSyncedXmlOffsets,
  applyXmlOffsets,
  applyTimecodeOffsets,
  ensureManualSyncDefaults,
  buildInterviewAutoSelected,
  writeInterviewAnalysis,
  buildReadableTranscript,
};
