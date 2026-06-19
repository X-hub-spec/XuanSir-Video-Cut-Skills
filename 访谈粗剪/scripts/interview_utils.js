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
  const decoded = decodeXmlEntities(value);
  try {
    if (decoded.startsWith('file://')) return fileURLToPath(decoded);
  } catch (err) {
    return decodeURIComponent(decoded.replace(/^file:\/+/, '/'));
  }
  return decodeURIComponent(decoded);
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseXmlAssets(xmlText) {
  const assets = new Map();
  const assetRe = /<asset\b([^>]*?)(?:\/>|>([\s\S]*?)<\/asset>)/g;
  let match;
  while ((match = assetRe.exec(xmlText))) {
    const attrs = parseXmlAttrs(match[1]);
    if (!attrs.id) continue;
    const body = match[2] || '';
    const mediaRepMatch = body.match(/<media-rep\b([^>]*)>/);
    const mediaAttrs = mediaRepMatch ? parseXmlAttrs(mediaRepMatch[1]) : {};
    const srcPath = normalizeUrlPath(attrs.src || mediaAttrs.src || '');
    const hasVideo = attrs.hasVideo === '1' || (attrs.hasVideo == null && Boolean(attrs.format));
    const hasAudio = attrs.hasAudio === '1' || Boolean(attrs.audioChannels || attrs.audioSources);
    assets.set(attrs.id, {
      id: attrs.id,
      name: decodeXmlEntities(attrs.name || attrs.id),
      src: srcPath,
      basename: srcPath ? path.basename(srcPath) : '',
      start: parseTimeToSeconds(attrs.start || '0s') || 0,
      duration: parseTimeToSeconds(attrs.duration),
      hasVideo,
      hasAudio,
      audioChannels: attrs.audioChannels ? Number(attrs.audioChannels) : null,
      audioSampleRate: attrs.audioRate || '',
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

function getNearestClipContext(stack) {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].timelineContext) return stack[i];
  }
  return null;
}

function makeClipContext(attrs, parentContext, sequenceTcStart, { clampChildren = true, tagName = 'clip' } = {}) {
  const offset = parseTimeToSeconds(attrs.offset || '0s') || 0;
  const start = parseTimeToSeconds(attrs.start || '0s') || 0;
  const duration = parseTimeToSeconds(attrs.duration) || 0;
  const timelineStart = parentContext
    ? parentContext.timelineStart + (offset - parentContext.start)
    : offset - sequenceTcStart;
  return {
    tag: tagName,
    timelineContext: true,
    offset,
    start,
    duration,
    timelineStart,
    clampChildren,
    lane: Number.isFinite(Number(attrs.lane)) ? Number(attrs.lane) : 0,
    enabled: attrs.enabled !== '0' && (!parentContext || parentContext.enabled !== false),
    name: decodeXmlEntities(attrs.name || ''),
  };
}

function createTimelineClipFromAttrs({ tag, attrs, asset, sourceId, clipId, parentContext, sequenceTcStart }) {
  const childOffset = parseTimeToSeconds(attrs.offset || '0s') || 0;
  const childStart = parseTimeToSeconds(attrs.start || '0s') || 0;
  const childDuration = parseTimeToSeconds(attrs.duration);
  if (!Number.isFinite(childDuration) || childDuration <= 0) return null;

  let globalStart = childOffset - sequenceTcStart;
  let localStart = childStart;
  let duration = childDuration;
  let lane = Number.isFinite(Number(attrs.lane)) ? Number(attrs.lane) : 0;
  const enabled = attrs.enabled !== '0' && (!parentContext || parentContext.enabled !== false);

  if (parentContext && parentContext.clampChildren) {
    const parentWindowStart = parentContext.start;
    const parentWindowEnd = parentContext.start + parentContext.duration;
    const childWindowStart = childOffset;
    const childWindowEnd = childOffset + childDuration;
    const overlapStart = Math.max(parentWindowStart, childWindowStart);
    const overlapEnd = Math.min(parentWindowEnd, childWindowEnd);
    if (overlapEnd <= overlapStart) return null;
    globalStart = parentContext.timelineStart + (overlapStart - parentWindowStart);
    localStart = childStart + (overlapStart - childWindowStart);
    duration = overlapEnd - overlapStart;
    if (!Number.isFinite(Number(attrs.lane))) lane = parentContext.lane || 0;
  } else if (parentContext) {
    globalStart = parentContext.timelineStart + (childOffset - parentContext.start);
  }

  return {
    id: `clip_${clipId}`,
    sourceId,
    xmlAssetId: attrs.ref,
    name: decodeXmlEntities(attrs.name || asset.name || sourceId),
    kind: tag === 'audio' ? 'audio' : (tag === 'video' ? 'video' : (asset.hasVideo ? 'video' : 'audio')),
    lane,
    role: decodeXmlEntities(attrs.role || ''),
    enabled,
    globalStart: multicamUtils.roundTime(globalStart),
    localStart: multicamUtils.roundTime(localStart),
    duration: multicamUtils.roundTime(duration),
  };
}

function createTimelineContextFromClip(timelineClip, attrs, parentContext) {
  if (!timelineClip) return null;
  const offset = parseTimeToSeconds(attrs.offset || '0s') || 0;
  const start = parseTimeToSeconds(attrs.start || '0s') || 0;
  const duration = parseTimeToSeconds(attrs.duration) || timelineClip.duration || 0;
  return {
    tag: attrs.__tagName || 'clip',
    timelineContext: true,
    offset,
    start,
    duration,
    timelineStart: timelineClip.globalStart,
    clampChildren: false,
    lane: timelineClip.lane || 0,
    enabled: timelineClip.enabled !== false && (!parentContext || parentContext.enabled !== false),
    name: timelineClip.name || decodeXmlEntities(attrs.name || ''),
  };
}

function capTimelineClipsToSourceDurations(timelineClips, sources) {
  const byId = new Map((sources || []).map(source => [source.id, source]));
  return (timelineClips || [])
    .map(clip => {
      const source = byId.get(clip.sourceId);
      const sourceDuration = Number(source?.duration);
      const sourceStart = Number(source?.assetStart || 0);
      if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) return clip;
      const maxLocalEnd = sourceStart + sourceDuration;
      const localStart = Number(clip.localStart || 0);
      const maxDuration = maxLocalEnd - localStart;
      if (!Number.isFinite(maxDuration) || maxDuration <= 0) return null;
      const duration = Math.min(Number(clip.duration || 0), maxDuration);
      if (!Number.isFinite(duration) || duration <= 0) return null;
      return {
        ...clip,
        duration: multicamUtils.roundTime(duration),
      };
    })
    .filter(Boolean);
}

function parseTimelineClips(xmlText, assets, assetIdToSourceId) {
  const sequenceMatch = xmlText.match(/<sequence\b([^>]*)>/);
  const sequenceAttrs = sequenceMatch ? parseXmlAttrs(sequenceMatch[1]) : {};
  const sequenceTcStart = parseTimeToSeconds(sequenceAttrs.tcStart || '0s') || 0;
  const sequenceDuration = parseTimeToSeconds(sequenceAttrs.duration);
  const timelineClips = [];
  const stack = [];
  const tagRe = /<(\/?)([A-Za-z0-9_-]+)\b([^>]*)>/g;
  let match;
  let clipId = 0;

  while ((match = tagRe.exec(xmlText))) {
    const closing = Boolean(match[1]);
    const tag = match[2];
    const attrText = match[3] || '';
    const selfClosing = /\/\s*$/.test(attrText);

    if (closing) {
      if (tag === 'clip') {
        const index = stack.map(item => item.tag).lastIndexOf('clip');
        if (index >= 0) stack.splice(index, 1);
      } else {
        const index = stack.map(item => item.tag).lastIndexOf(tag);
        if (index >= 0) stack.splice(index, 1);
      }
      continue;
    }

    if (tag === 'sequence' || tag === 'spine') {
      if (!selfClosing) stack.push({ tag });
      continue;
    }

    if (!stack.some(item => item.tag === 'sequence')) continue;

    const attrs = parseXmlAttrs(attrText);
    const parentContext = getNearestClipContext(stack);

    if (tag === 'clip' && !attrs.ref) {
      const context = makeClipContext(attrs, parentContext, sequenceTcStart, {
        clampChildren: true,
        tagName: tag,
      });
      if (!selfClosing) stack.push(context);
      continue;
    }

    if (['asset-clip', 'clip', 'video', 'audio'].includes(tag) && attrs.ref && assets.has(attrs.ref)) {
      attrs.__tagName = tag;
      const asset = assets.get(attrs.ref);
      const sourceId = assetIdToSourceId.get(attrs.ref);
      if (sourceId) {
        const timelineClip = createTimelineClipFromAttrs({
          tag,
          attrs,
          asset,
          sourceId,
          clipId: ++clipId,
          parentContext,
          sequenceTcStart,
        });
        if (timelineClip) {
          timelineClips.push(timelineClip);
          if (!selfClosing && ['asset-clip', 'clip'].includes(tag)) {
            stack.push(createTimelineContextFromClip(timelineClip, attrs, parentContext));
          }
          continue;
        }
      }
    }

    if (!selfClosing && ['asset-clip', 'clip'].includes(tag)) {
      const context = makeClipContext(attrs, parentContext, sequenceTcStart, {
        clampChildren: false,
        tagName: tag,
      });
      stack.push(context);
    }
  }

  return {
    sequenceDuration,
    timelineClips,
  };
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
    const xmlAssetId = String(source.xmlAssetId || '').toLowerCase();
    return (assetBase && sourceBase && assetBase === sourceBase)
      || (asset.id && xmlAssetId && String(asset.id).toLowerCase() === xmlAssetId)
      || (assetName && (assetName === sourceName || assetName.includes(sourceBase) || sourceName.includes(assetName)));
  }) || null;
}

function resolveMaybeRelativePath(file, baseDir) {
  if (!file) return '';
  return path.isAbsolute(file) ? file : path.resolve(baseDir, file);
}

function sourceMatchesIdentifier(source, identifier) {
  const needle = String(identifier || '').trim().toLowerCase();
  if (!needle) return false;
  const candidates = [
    source.id,
    source.xmlAssetId,
    source.name,
    source.path ? path.basename(source.path, path.extname(source.path)) : '',
    source.path ? path.basename(source.path) : '',
  ].filter(Boolean).map(value => String(value).trim().toLowerCase());
  return candidates.includes(needle);
}

function resolveSourceIdentifier(sources, identifier) {
  return (sources || []).find(source => sourceMatchesIdentifier(source, identifier)) || null;
}

function parseFcpxmlTimeline(xmlFile, manifest = {}, baseDir = path.dirname(path.resolve(xmlFile))) {
  const resolvedXml = resolveMaybeRelativePath(xmlFile, baseDir);
  const xmlText = fs.readFileSync(resolvedXml, 'utf8');
  const xmlDir = path.dirname(resolvedXml);
  const assets = parseXmlAssets(xmlText);
  const assetIdToSourceId = new Map();
  const seenSourceIds = new Set();
  const explicitSourceOverrides = new Map();

  (manifest.sources || []).forEach(source => {
    const keys = [source.id, source.xmlAssetId, source.name, source.path ? path.basename(source.path) : '']
      .filter(Boolean)
      .map(value => String(value).trim().toLowerCase());
    keys.forEach(key => explicitSourceOverrides.set(key, source));
  });

  function uniqueSourceId(asset) {
    const fallback = asset.name || asset.basename || asset.id;
    let id = multicamUtils.sanitizeId(fallback, asset.id);
    let suffix = 2;
    while (seenSourceIds.has(id)) id = `${multicamUtils.sanitizeId(fallback, asset.id)}_${suffix++}`;
    seenSourceIds.add(id);
    return id;
  }

  const sources = Array.from(assets.values()).map(asset => {
    const override = explicitSourceOverrides.get(String(asset.id).toLowerCase())
      || explicitSourceOverrides.get(String(asset.name).toLowerCase())
      || explicitSourceOverrides.get(String(asset.basename).toLowerCase());
    const id = override?.id ? multicamUtils.sanitizeId(override.id, asset.id) : uniqueSourceId(asset);
    assetIdToSourceId.set(asset.id, id);
    const assetPath = override?.path
      ? resolveMaybeRelativePath(override.path, baseDir)
      : (asset.src ? resolveMaybeRelativePath(asset.src, xmlDir) : '');
    return {
      id,
      xmlAssetId: asset.id,
      kind: override?.kind || (asset.hasVideo ? 'video' : 'audio'),
      path: assetPath,
      name: override?.name || asset.name || asset.basename || id,
      offset: 0,
      syncMethod: 'xml',
      syncConfidence: 1,
      primary: false,
      wordsFile: override?.wordsFile ? resolveMaybeRelativePath(override.wordsFile, baseDir) : '',
      assetStart: Number.isFinite(asset.start) ? asset.start : 0,
      duration: Number.isFinite(Number(override?.duration))
        ? Number(override.duration)
        : (Number.isFinite(asset.duration) ? asset.duration : null),
      audioChannels: asset.audioChannels,
      audioSampleRate: asset.audioSampleRate,
    };
  });

  const primarySource = resolveSourceIdentifier(sources, manifest.primaryPreviewSourceId)
    || sources.find(source => source.kind === 'video');
  if (primarySource) primarySource.primary = true;

  const { sequenceDuration, timelineClips: rawTimelineClips } = parseTimelineClips(xmlText, assets, assetIdToSourceId);
  const timelineClips = capTimelineClipsToSourceDurations(rawTimelineClips, sources);

  const inferredDuration = timelineClips.reduce((max, clip) => Math.max(max, clip.globalStart + clip.duration), 0);
  return {
    timelineXml: resolvedXml,
    sources,
    timelineClips,
    duration: multicamUtils.roundTime(inferredDuration || (Number.isFinite(sequenceDuration) ? sequenceDuration : 0)),
  };
}

function findTimelineClipForLocalTime(timelineClips, sourceIds, localStart, localEnd) {
  const allowed = new Set(Array.isArray(sourceIds) ? sourceIds : [sourceIds]);
  const center = (Number(localStart) + Number(localEnd)) / 2;
  return (timelineClips || []).find(clip => {
    if (!allowed.has(clip.sourceId)) return false;
    const clipLocalStart = Number(clip.localStart || 0);
    const clipLocalEnd = clipLocalStart + Number(clip.duration || 0);
    return center >= clipLocalStart && center <= clipLocalEnd;
  }) || null;
}

function mapTranscriptWordsToTimeline(words, transcriptSourceIds, timelineClips) {
  const mapped = [];
  const sourceIds = Array.isArray(transcriptSourceIds) ? transcriptSourceIds : [transcriptSourceIds];
  (Array.isArray(words) ? words : []).forEach((word, index) => {
    const localStart = Number(word.start);
    const localEnd = Number(word.end);
    if (!Number.isFinite(localStart) || !Number.isFinite(localEnd) || localEnd <= localStart) return;
    const clip = findTimelineClipForLocalTime(timelineClips, sourceIds, localStart, localEnd);
    if (!clip) return;
    const clipLocalStart = Number(clip.localStart || 0);
    const globalStart = Number(clip.globalStart || 0) + (localStart - clipLocalStart);
    const globalEnd = Number(clip.globalStart || 0) + (localEnd - clipLocalStart);
    if (!Number.isFinite(globalStart) || !Number.isFinite(globalEnd) || globalEnd <= globalStart) return;
    mapped.push({
      text: String(word.text || ''),
      start: multicamUtils.roundTime(globalStart),
      end: multicamUtils.roundTime(globalEnd),
      rawStart: multicamUtils.roundTime(localStart),
      rawEnd: multicamUtils.roundTime(localEnd),
      isGap: Boolean(word.isGap),
      sourceId: clip.sourceId,
      sourceWordIndex: Number.isInteger(word.index) ? word.index : index,
      segmentId: word.segmentId,
      segmentStart: Boolean(word.segmentStart),
      segmentEnd: Boolean(word.segmentEnd),
      segmentText: word.segmentText || '',
      punctuationAfter: word.punctuationAfter || '',
    });
  });
  return mapped.sort((a, b) => a.start - b.start || a.end - b.end);
}

function buildTimelineInterviewProject(manifest, transcriptWords, baseDir = process.cwd()) {
  const timelineXml = manifest.timelineXml || manifest.xml || manifest.fcpxml;
  if (!timelineXml) throw new Error('访谈清单缺少 timelineXml');
  if (!manifest.transcriptSourceId) throw new Error('访谈清单缺少 transcriptSourceId，请指定混音总轨');

  const parsed = parseFcpxmlTimeline(timelineXml, manifest, baseDir);
  if (!parsed.timelineClips.length) throw new Error('FCPXML 中没有解析到可用的时间线片段');
  const transcriptSource = resolveSourceIdentifier(parsed.sources, manifest.transcriptSourceId);
  if (!transcriptSource) throw new Error(`找不到 transcriptSourceId 对应素材: ${manifest.transcriptSourceId}`);
  const transcriptSourceIds = parsed.sources
    .filter(source => source.id === transcriptSource.id
      || (source.path && transcriptSource.path && path.resolve(source.path) === path.resolve(transcriptSource.path)))
    .map(source => source.id);
  const primarySource = resolveSourceIdentifier(parsed.sources, manifest.primaryPreviewSourceId)
    || parsed.sources.find(source => source.primary && source.kind === 'video')
    || parsed.sources.find(source => source.kind === 'video');
  parsed.sources.forEach(source => {
    source.primary = Boolean(primarySource && source.id === primarySource.id);
  });
  const missing = parsed.sources.filter(source => source.path && !fs.existsSync(source.path));
  if (missing.length) {
    throw new Error(`FCPXML 素材路径不存在: ${missing.map(source => `${source.name}(${source.path})`).join('、')}`);
  }

  return {
    version: Number.isFinite(Number(manifest.version)) ? Number(manifest.version) : 2,
    mode: 'interview',
    projectTitle: String(manifest.projectTitle || '访谈粗剪'),
    syncMethod: 'xml',
    syncConfidence: 1,
    timelineXml: parsed.timelineXml,
    transcriptSourceId: transcriptSource.id,
    transcriptSourceIds,
    primaryPreviewSourceId: primarySource?.id || '',
    sources: parsed.sources,
    speakers: [],
    timelineClips: parsed.timelineClips,
    duration: parsed.duration,
    words: mapTranscriptWordsToTimeline(transcriptWords, transcriptSourceIds, parsed.timelineClips),
  };
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
  parseFcpxmlTimeline,
  resolveSourceIdentifier,
  mapTranscriptWordsToTimeline,
  buildTimelineInterviewProject,
  parseSyncedXmlOffsets,
  applyXmlOffsets,
  applyTimecodeOffsets,
  ensureManualSyncDefaults,
  buildInterviewAutoSelected,
  writeInterviewAnalysis,
  buildReadableTranscript,
};
