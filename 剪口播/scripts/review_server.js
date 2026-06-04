#!/usr/bin/env node
/**
 * 审核服务器
 *
 * 功能：
 * 1. 提供静态文件服务（review.html, video.mp4）
 * 2. POST /api/cut - 接收删除列表，执行渲染
 *
 * 用法: node review_server.js [port] [video_file]
 * 默认: port=8899, video_file=自动检测目录下的 .mp4
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const { pathToFileURL } = require('url');

const PORT = process.argv[2] || 8899;
let VIDEO_FILE = process.argv[3] || findVideoFile();
const PROJECT_STATE_FILE = 'review_project_state.json';
const SKILL_ROOT = path.resolve(__dirname, '..', '..');
const DICTIONARY_FILE = path.join(SKILL_ROOT, '字幕', '词典.txt');

function findVideoFile() {
  const files = fs.readdirSync('.').filter(f => f.endsWith('.mp4'));
  return files[0] || 'source.mp4';
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.fcpxml': 'application/xml',
  '.xml': 'application/xml',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
};

const RANGE_EXTENSIONS = new Set(['.mp3', '.m4a', '.mp4']);

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req, onDone) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => onDone(body));
}

function normalizeSelectedIndices(indices) {
  if (!Array.isArray(indices)) throw new Error('项目状态格式错误：selectedIndices 必须是数组');
  return Array.from(new Set(indices
    .map(i => Number(i))
    .filter(i => Number.isInteger(i) && i >= 0)))
    .sort((a, b) => a - b);
}

function normalizeProjectTitle(value) {
  const text = String(value || '').replace(/^稿件[:：]\s*/, '').replace(/\s+/g, ' ').trim();
  return text || '口播粗剪校样';
}

function saveProjectState(state) {
  const selectedIndices = normalizeSelectedIndices(state.selectedIndices || []);
  const textOverrides = normalizeTextOverrides(state.textOverrides || {});
  const payload = {
    version: 1,
    videoFile: VIDEO_FILE,
    projectTitle: normalizeProjectTitle(state.projectTitle || ''),
    selectedIndices,
    textOverrides,
    currentTime: Number.isFinite(Number(state.currentTime)) ? Math.max(0, Number(state.currentTime)) : 0,
    playbackRate: Number.isFinite(Number(state.playbackRate)) ? Number(state.playbackRate) : 1,
    activeAnnotationFilter: typeof state.activeAnnotationFilter === 'string' ? state.activeAnnotationFilter : 'all',
    selectedBgm: typeof state.selectedBgm === 'string' ? state.selectedBgm : '',
    activeMainView: state.activeMainView === 'subtitle' ? 'subtitle' : 'article',
    subtitleBreakAfterIndices: normalizeSelectedIndices(state.subtitleBreakAfterIndices || []),
    subtitleMergedStartIndices: normalizeSelectedIndices(state.subtitleMergedStartIndices || []),
    wordCount: Number.isFinite(Number(state.wordCount)) ? Number(state.wordCount) : null,
    deleteSegments: Array.isArray(state.deleteSegments) ? state.deleteSegments : [],
    savedAt: new Date().toISOString(),
  };
  const tmpFile = `${PROJECT_STATE_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2));
  fs.renameSync(tmpFile, PROJECT_STATE_FILE);
  if (payload.deleteSegments.length) {
    fs.writeFileSync('delete_segments.json', JSON.stringify(payload.deleteSegments, null, 2));
  }
  fs.writeFileSync('review_text_overrides.json', JSON.stringify(textOverrides, null, 2));
  return payload;
}

function normalizeTextOverrides(overrides) {
  const normalized = {};
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return normalized;
  Object.entries(overrides).forEach(([key, value]) => {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) return;
    normalized[index] = String(value || '').slice(0, 500);
  });
  return normalized;
}

function normalizeDictionaryTerms(value) {
  return String(value || '')
    .split(/[\n\r,，、;；]+/)
    .map(term => term.replace(/\s+/g, ' ').trim())
    .filter(term => term.length > 0 && term.length <= 80);
}

function appendDictionaryTerms(terms) {
  fs.mkdirSync(path.dirname(DICTIONARY_FILE), { recursive: true });
  const existingText = fs.existsSync(DICTIONARY_FILE) ? fs.readFileSync(DICTIONARY_FILE, 'utf8') : '';
  const existing = new Set(existingText.split(/\r?\n/).map(line => line.trim()).filter(Boolean));
  const added = [];
  terms.forEach(term => {
    if (existing.has(term)) return;
    existing.add(term);
    added.push(term);
  });
  if (added.length) {
    const prefix = existingText && !existingText.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(DICTIONARY_FILE, `${prefix}${added.join('\n')}\n`);
  }
  return added;
}

const server = http.createServer((req, res) => {
  const reqPath = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // API: 读取项目状态
  if (req.method === 'GET' && reqPath === '/api/project-state') {
    try {
      if (!fs.existsSync(PROJECT_STATE_FILE)) {
        sendJson(res, 200, { success: true, exists: false, state: null });
        return;
      }
      const state = JSON.parse(fs.readFileSync(PROJECT_STATE_FILE, 'utf8'));
      sendJson(res, 200, { success: true, exists: true, state });
    } catch (err) {
      console.error('❌ 读取项目状态失败:', err.message);
      sendJson(res, 500, { success: false, error: err.message });
    }
    return;
  }

  // API: 保存项目状态
  if (req.method === 'POST' && reqPath === '/api/project-state') {
    readRequestBody(req, body => {
      try {
        const state = JSON.parse(body || '{}');
        const saved = saveProjectState(state);
        console.log(`💾 项目状态已保存: ${saved.selectedIndices.length} 个删除元素`);
        sendJson(res, 200, {
          success: true,
          state: saved,
          message: `项目状态已保存到 ${path.resolve(PROJECT_STATE_FILE)}`
        });
      } catch (err) {
        console.error('❌ 保存项目状态失败:', err.message);
        sendJson(res, 500, { success: false, error: err.message });
      }
    });
    return;
  }

  // API: 追加词库
  if (req.method === 'POST' && reqPath === '/api/dictionary') {
    readRequestBody(req, body => {
      try {
        const payload = JSON.parse(body || '{}');
        const terms = normalizeDictionaryTerms(payload.terms || payload.term || payload.text || '');
        if (!terms.length) throw new Error('没有可写入词库的词');
        const added = appendDictionaryTerms(terms);
        console.log(`📖 词库已更新: 新增 ${added.length} 个词`);
        sendJson(res, 200, {
          success: true,
          added,
          dictionaryFile: DICTIONARY_FILE,
          message: added.length ? `已加入词库: ${added.join('、')}` : '词库中已存在，无需重复添加'
        });
      } catch (err) {
        console.error('❌ 更新词库失败:', err.message);
        sendJson(res, 500, { success: false, error: err.message });
      }
    });
    return;
  }

  // API: 导出工程（同名 FCPXML + SRT）
  if (req.method === 'POST' && reqPath === '/api/export-project') {
    readRequestBody(req, body => {
      try {
        const payload = JSON.parse(body || '{}');
        const deleteList = Array.isArray(payload) ? payload : payload.segments;
        const subtitles = Array.isArray(payload.subtitles) ? payload.subtitles : [];
        if (!Array.isArray(deleteList)) {
          throw new Error('删除列表格式错误');
        }
        if (!subtitles.length) {
          throw new Error('没有可导出的字幕');
        }

        fs.writeFileSync('delete_segments.json', JSON.stringify(deleteList, null, 2));
        console.log(`📝 保存 ${deleteList.length} 个删除片段`);

        const outputDir = payload.chooseDirectory ? chooseOutputDirectory() : process.cwd();
        const baseName = findAvailableExportBaseName(outputDir, payload.projectTitle);
        const fcpxmlOutputName = `${baseName}.fcpxml`;
        const srtOutputName = `${baseName}.srt`;
        const fcpxmlOutput = path.join(outputDir, fcpxmlOutputName);
        const srtOutput = path.join(outputDir, srtOutputName);

        const fcpxmlResult = exportFinalCutXML(VIDEO_FILE, deleteList, fcpxmlOutput);
        const srtResult = exportSRT(VIDEO_FILE, deleteList, subtitles, srtOutput);

        sendJson(res, 200, {
          success: true,
          outputDir,
          baseName,
          fcpxml: {
            output: fcpxmlOutput,
            outputName: fcpxmlOutputName,
            xml: fcpxmlResult.xml
          },
          srt: {
            output: srtOutput,
            outputName: srtOutputName,
            srt: srtResult.srt
          },
          keepClips: fcpxmlResult.keepSegments.length,
          subtitleCount: srtResult.subtitleCount,
          timelineDuration: fcpxmlResult.timelineDuration.toFixed(2),
          originalDuration: fcpxmlResult.originalDuration.toFixed(2),
          message: `工程已导出: ${fcpxmlOutputName}, ${srtOutputName}`
        });
      } catch (err) {
        console.error('❌ 工程导出失败:', err.message);
        sendJson(res, 500, { success: false, error: err.message });
      }
    });
    return;
  }

  // API: 导出 Final Cut Pro XML
  if (req.method === 'POST' && reqPath === '/api/export-finalcut-xml') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const deleteList = Array.isArray(payload) ? payload : payload.segments;
        if (!Array.isArray(deleteList)) {
          throw new Error('删除列表格式错误');
        }
        fs.writeFileSync('delete_segments.json', JSON.stringify(deleteList, null, 2));
        console.log(`📝 保存 ${deleteList.length} 个删除片段`);

        const baseName = path.basename(VIDEO_FILE, path.extname(VIDEO_FILE));
        const outputName = `${baseName}_roughcut.fcpxml`;
        const outputDir = payload.chooseDirectory ? chooseOutputDirectory() : process.cwd();
        const outputFile = path.join(outputDir, outputName);
        const result = exportFinalCutXML(VIDEO_FILE, deleteList, outputFile);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          output: outputFile,
          outputName: outputName,
          xml: result.xml,
          keepClips: result.keepSegments.length,
          timelineDuration: result.timelineDuration.toFixed(2),
          originalDuration: result.originalDuration.toFixed(2),
          message: `Final Cut XML 已导出: ${outputFile}`
        }));
      } catch (err) {
        console.error('❌ Final Cut XML 导出失败:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // API: 导出 SRT（时间码对齐 FCPXML 剪后时间线）
  if (req.method === 'POST' && reqPath === '/api/export-srt') {
    readRequestBody(req, body => {
      try {
        const payload = JSON.parse(body || '{}');
        const deleteList = Array.isArray(payload) ? payload : payload.segments;
        const subtitles = Array.isArray(payload.subtitles) ? payload.subtitles : [];
        if (!Array.isArray(deleteList)) {
          throw new Error('删除列表格式错误');
        }
        if (!subtitles.length) {
          throw new Error('没有可导出的字幕');
        }

        fs.writeFileSync('delete_segments.json', JSON.stringify(deleteList, null, 2));
        console.log(`📝 保存 ${deleteList.length} 个删除片段`);

        const baseName = path.basename(VIDEO_FILE, path.extname(VIDEO_FILE));
        const outputName = `${baseName}_roughcut.srt`;
        const outputDir = payload.chooseDirectory ? chooseOutputDirectory() : process.cwd();
        const outputFile = path.join(outputDir, outputName);
        const result = exportSRT(VIDEO_FILE, deleteList, subtitles, outputFile);

        sendJson(res, 200, {
          success: true,
          output: outputFile,
          outputName,
          srt: result.srt,
          subtitleCount: result.subtitleCount,
          timelineDuration: result.timelineDuration.toFixed(2),
          originalDuration: result.originalDuration.toFixed(2),
          message: `SRT 已导出: ${outputFile}`
        });
      } catch (err) {
        console.error('❌ SRT 导出失败:', err.message);
        sendJson(res, 500, { success: false, error: err.message });
      }
    });
    return;
  }

  // API: 渲染
  if (req.method === 'POST' && reqPath === '/api/cut') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const deleteList = Array.isArray(payload) ? payload : payload.segments;
        if (!Array.isArray(deleteList)) {
          throw new Error('渲染参数错误：缺少删除片段列表');
        }
        if (deleteList.length === 0) {
          throw new Error('当前没有红线删除片段，已取消渲染，避免输出完整视频');
        }

        // 保存删除列表到当前目录
        fs.writeFileSync('delete_segments.json', JSON.stringify(deleteList, null, 2));
        console.log(`📝 保存 ${deleteList.length} 个删除片段`);

        // 生成输出文件名
        const baseName = path.basename(VIDEO_FILE, '.mp4');
        const outputName = `${baseName}_cut.mp4`;
        const outputDir = payload && !Array.isArray(payload) && payload.chooseDirectory ? chooseOutputDirectory() : process.cwd();
        const outputFile = path.join(outputDir, outputName);

        // 执行渲染
        const scriptPath = path.join(__dirname, 'cut_video.sh');

        if (!fs.existsSync(scriptPath)) {
          // 如果没有 cut_video.sh，用内置的 ffmpeg 命令
          console.log('🎬 执行渲染...');
          executeFFmpegCut(VIDEO_FILE, deleteList, outputFile);
        } else {
          console.log('🎬 调用 cut_video.sh...');
          execSync(`bash "${scriptPath}" "${VIDEO_FILE}" delete_segments.json "${outputFile}"`, {
            stdio: 'inherit'
          });
        }

        // 获取剪辑前后的时长信息
        const originalDuration = parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "file:${VIDEO_FILE}"`).toString().trim());
        const newDuration = parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "file:${outputFile}"`).toString().trim());
        const deletedDuration = originalDuration - newDuration;
        const savedPercent = ((deletedDuration / originalDuration) * 100).toFixed(1);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          output: outputFile,
          outputName,
          originalDuration: originalDuration.toFixed(2),
          newDuration: newDuration.toFixed(2),
          deletedDuration: deletedDuration.toFixed(2),
          savedPercent: savedPercent,
          message: `渲染完成: ${outputFile}`
        }));

      } catch (err) {
        console.error('❌ 渲染失败:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 静态文件服务（从当前目录读取）
  let filePath = reqPath === '/' ? '/review.html' : reqPath;
  filePath = '.' + filePath;

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  // 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const stat = fs.statSync(filePath);

  // 支持 Range 请求（音频/视频拖动）
  if (req.headers.range && RANGE_EXTENSIONS.has(ext)) {
    const range = req.headers.range.replace('bytes=', '').split('-');
    const start = parseInt(range[0], 10);
    const end = range[1] ? parseInt(range[1], 10) : stat.size - 1;

    res.writeHead(206, {
      'Content-Type': contentType,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
    });

    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  // 普通请求
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes'
  });
  fs.createReadStream(filePath).pipe(res);
});

// 检测可用的硬件编码器
function detectEncoder() {
  const platform = process.platform;
  const encoders = [];

  // 根据平台确定候选编码器
  if (platform === 'darwin') {
    encoders.push({ name: 'h264_videotoolbox', args: '-q:v 60', label: 'VideoToolbox (macOS)' });
  } else if (platform === 'win32') {
    encoders.push({ name: 'h264_nvenc', args: '-preset p4 -cq 20', label: 'NVENC (NVIDIA)' });
    encoders.push({ name: 'h264_qsv', args: '-global_quality 20', label: 'QSV (Intel)' });
    encoders.push({ name: 'h264_amf', args: '-quality balanced', label: 'AMF (AMD)' });
  } else {
    // Linux
    encoders.push({ name: 'h264_nvenc', args: '-preset p4 -cq 20', label: 'NVENC (NVIDIA)' });
    encoders.push({ name: 'h264_vaapi', args: '-qp 20', label: 'VAAPI (Linux)' });
  }

  // 软件编码兜底
  encoders.push({ name: 'libx264', args: '-preset fast -crf 18', label: 'x264 (软件)' });

  // 检测哪个可用
  for (const enc of encoders) {
    try {
      execSync(`ffmpeg -hide_banner -encoders 2>/dev/null | grep ${enc.name}`, { stdio: 'pipe' });
      console.log(`🎯 检测到编码器: ${enc.label}`);
      return enc;
    } catch (e) {
      // 该编码器不可用，继续检测下一个
    }
  }

  // 默认返回软件编码
  return { name: 'libx264', args: '-preset fast -crf 18', label: 'x264 (软件)' };
}

// 缓存编码器检测结果
let cachedEncoder = null;
function getEncoder() {
  if (!cachedEncoder) {
    cachedEncoder = detectEncoder();
  }
  return cachedEncoder;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function secondsToFcpxmlTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return ms === 0 ? '0s' : `${ms}/1000s`;
}

function parseFrameDuration(rate) {
  if (!rate || rate === '0/0') return '1/25s';
  const [num, den] = rate.split('/').map(Number);
  if (!num || !den) return '1/25s';
  return `${den}/${num}s`;
}

function probeMedia(input) {
  const raw = execSync(`ffprobe -v error -show_streams -show_format -of json "file:${input}"`).toString();
  const info = JSON.parse(raw);
  const video = info.streams.find(s => s.codec_type === 'video') || {};
  const audio = info.streams.find(s => s.codec_type === 'audio') || {};
  return {
    duration: parseFloat(info.format.duration),
    width: video.width || 1920,
    height: video.height || 1080,
    frameDuration: parseFrameDuration(video.r_frame_rate || video.avg_frame_rate),
    audioChannels: audio.channels || 2,
    audioSampleRate: audio.sample_rate || '48000',
  };
}

function computeKeepSegments(deleteList, duration) {
  const MERGE_GAP = 0.2;
  const mergedDelete = [];
  const normalized = deleteList
    .map(seg => ({
      start: Math.max(0, Math.min(duration, Number(seg.start))),
      end: Math.max(0, Math.min(duration, Number(seg.end)))
    }))
    .filter(seg => Number.isFinite(seg.start) && Number.isFinite(seg.end) && seg.end > seg.start)
    .sort((a, b) => a.start - b.start);

  for (const seg of normalized) {
    if (mergedDelete.length === 0 || seg.start > mergedDelete[mergedDelete.length - 1].end + MERGE_GAP) {
      mergedDelete.push({ ...seg });
    } else {
      mergedDelete[mergedDelete.length - 1].end = Math.max(mergedDelete[mergedDelete.length - 1].end, seg.end);
    }
  }

  const keepSegments = [];
  let cursor = 0;
  for (const del of mergedDelete) {
    if (del.start > cursor) keepSegments.push({ start: cursor, end: del.start });
    cursor = Math.max(cursor, del.end);
  }
  if (cursor < duration) keepSegments.push({ start: cursor, end: duration });

  return keepSegments.filter(seg => seg.end - seg.start > 0.001);
}

function formatSrtTime(seconds) {
  const totalMs = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

function mapSourceTimeToTimeline(time, keepSegments) {
  const sourceTime = Number(time);
  if (!Number.isFinite(sourceTime)) return null;
  let timelineOffset = 0;
  for (const seg of keepSegments) {
    const duration = seg.end - seg.start;
    if (sourceTime >= seg.start - 0.001 && sourceTime <= seg.end + 0.001) {
      return timelineOffset + Math.max(0, Math.min(duration, sourceTime - seg.start));
    }
    if (sourceTime < seg.start) return null;
    timelineOffset += duration;
  }
  return null;
}

function normalizeSubtitleCues(subtitles, keepSegments) {
  return subtitles
    .map(item => {
      let text = String(item.text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
      if (!text) return null;
      let start = null;
      let end = null;
      if (Array.isArray(item.words) && item.words.length) {
        const mappedWords = item.words
          .map(word => ({
            start: mapSourceTimeToTimeline(word.start, keepSegments),
            end: mapSourceTimeToTimeline(word.end, keepSegments),
            text: String(word.text || ''),
          }))
          .filter(word => word.start != null && word.end != null && word.end > word.start);
        if (mappedWords.length) {
          start = mappedWords[0].start;
          end = mappedWords[mappedWords.length - 1].end;
          const rebuiltText = mappedWords.map(word => word.text).join('').trim();
          if (rebuiltText) text = rebuiltText;
        }
      } else {
        start = mapSourceTimeToTimeline(item.start, keepSegments);
        end = mapSourceTimeToTimeline(item.end, keepSegments);
      }

      if (start == null || end == null || end <= start) return null;
      return { start, end, text };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start)
    .map((cue, index, cues) => {
      const next = cues[index + 1];
      if (next && cue.end > next.start) cue.end = Math.max(cue.start + 0.04, next.start - 0.001);
      return cue;
    })
    .filter(cue => cue.end > cue.start);
}

function generateSRT(cues) {
  return cues.map((cue, index) => [
    String(index + 1),
    `${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}`,
    cue.text,
    ''
  ].join('\n')).join('\n');
}

function exportSRT(input, deleteList, subtitles, output) {
  const media = probeMedia(input);
  const keepSegments = computeKeepSegments(deleteList, media.duration);
  const timelineDuration = keepSegments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
  const cues = normalizeSubtitleCues(subtitles, keepSegments);
  const srt = generateSRT(cues);
  fs.writeFileSync(output, srt);
  console.log(`✅ SRT: ${output}`);
  console.log(`💬 字幕条数: ${cues.length}, 时间线时长: ${timelineDuration.toFixed(2)}s`);
  return { srt, subtitleCount: cues.length, timelineDuration, originalDuration: media.duration };
}

function sanitizeFilePart(value) {
  return normalizeProjectTitle(value)
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '')
    .slice(0, 80) || '口播粗剪校样';
}

function currentExportMonthPrefix() {
  const now = new Date();
  return `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function copyLabelFromIndex(index) {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    value--;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function findAvailableExportBaseName(outputDir, projectTitle) {
  const title = sanitizeFilePart(projectTitle);
  for (let i = 0; i < 702; i++) {
    const label = copyLabelFromIndex(i);
    const baseName = `${currentExportMonthPrefix()}_${title}_粗剪_Copy_${label}`;
    const fcpxmlPath = path.join(outputDir, `${baseName}.fcpxml`);
    const srtPath = path.join(outputDir, `${baseName}.srt`);
    if (!fs.existsSync(fcpxmlPath) && !fs.existsSync(srtPath)) return baseName;
  }
  throw new Error('当前目录已有过多同名导出文件，请调整稿件名后重试');
}

function chooseOutputDirectory() {
  if (process.platform !== 'darwin') return process.cwd();

  const script = [
    'set chosenFolder to choose folder with prompt "选择导出保存目录"',
    'POSIX path of chosenFolder'
  ].join('\n');

  try {
    const output = execFileSync('osascript', ['-e', script], { encoding: 'utf8' }).trim();
    if (!output) throw new Error('未选择保存目录');
    return output;
  } catch (err) {
    throw new Error('已取消选择保存目录');
  }
}

function exportFinalCutXML(input, deleteList, output) {
  const media = probeMedia(input);
  const keepSegments = computeKeepSegments(deleteList, media.duration);
  const timelineDuration = keepSegments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
  const assetName = path.basename(input);
  const projectName = path.basename(output, path.extname(output));
  const srcUrl = pathToFileURL(path.resolve(input)).href;

  let timelineOffset = 0;
  const clips = keepSegments.map((seg, index) => {
    const duration = seg.end - seg.start;
    const clip = `            <asset-clip name="${escapeXml(`${String(index + 1).padStart(3, '0')} ${assetName}`)}" ref="r2" offset="${secondsToFcpxmlTime(timelineOffset)}" start="${secondsToFcpxmlTime(seg.start)}" duration="${secondsToFcpxmlTime(duration)}"/>`;
    timelineOffset += duration;
    return clip;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r1" name="FFVideoFormat${media.height}p" frameDuration="${media.frameDuration}" width="${media.width}" height="${media.height}"/>
    <asset id="r2" name="${escapeXml(assetName)}" start="0s" duration="${secondsToFcpxmlTime(media.duration)}" hasVideo="1" hasAudio="1" audioSources="1" audioChannels="${media.audioChannels}" audioRate="${media.audioSampleRate}" format="r1" src="${escapeXml(srcUrl)}"/>
  </resources>
  <library>
    <event name="videocut">
      <project name="${escapeXml(projectName)}">
        <sequence format="r1" duration="${secondsToFcpxmlTime(timelineDuration)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="${media.audioSampleRate}">
          <spine>
${clips}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;

  fs.writeFileSync(output, xml);
  console.log(`✅ Final Cut XML: ${output}`);
  console.log(`🎞️ 保留片段: ${keepSegments.length}, 时间线时长: ${timelineDuration.toFixed(2)}s`);
  return { keepSegments, timelineDuration, originalDuration: media.duration, xml };
}

// 内置 FFmpeg 剪辑逻辑（filter_complex 精确剪辑 + buffer + crossfade）
function executeFFmpegCut(input, deleteList, output) {
  // 配置参数
  const BUFFER_MS = 120;    // 删除范围前后各扩展 120ms（吃掉尾音和气口）
  const CROSSFADE_MS = 30;  // 音频淡入淡出 30ms

  console.log(`⚙️ 优化参数: 扩展范围=${BUFFER_MS}ms, 音频crossfade=${CROSSFADE_MS}ms`);

  // 检测音频偏移量（MP3编码引入的延迟）
  let audioOffset = 0;
  const audioPath = path.resolve(path.dirname(path.dirname(process.cwd())), '1_转录', 'audio.mp3');
  if (fs.existsSync(audioPath)) {
    try {
      audioOffset = parseFloat(execSync(`ffprobe -v error -show_entries format=start_time -of csv=p=0 "${audioPath}"`).toString().trim()) || 0;
      if (audioOffset > 0) {
        console.log(`🔧 检测到音频偏移: ${audioOffset.toFixed(3)}s，自动补偿`);
      }
    } catch (e) { /* 忽略 */ }
  }

  // 获取视频总时长
  const probeCmd = `ffprobe -v error -show_entries format=duration -of csv=p=0 "file:${input}"`;
  const duration = parseFloat(execSync(probeCmd).toString().trim());

  const bufferSec = BUFFER_MS / 1000;
  const crossfadeSec = CROSSFADE_MS / 1000;

  // 不扩展删除范围，使用精确边界（防止吃掉相邻保留字的头尾音）
  const expandedDelete = deleteList
    .map(seg => ({
      start: Math.max(0, seg.start - audioOffset),
      end: Math.min(duration, seg.end - audioOffset)
    }))
    .sort((a, b) => a.start - b.start);

  // 合并重叠 + 间隙小于 200ms 的相邻删除段（避免产生无意义碎片）
  const MERGE_GAP = 0.2;
  const mergedDelete = [];
  for (const seg of expandedDelete) {
    if (mergedDelete.length === 0 || seg.start > mergedDelete[mergedDelete.length - 1].end + MERGE_GAP) {
      mergedDelete.push({ ...seg });
    } else {
      mergedDelete[mergedDelete.length - 1].end = Math.max(mergedDelete[mergedDelete.length - 1].end, seg.end);
    }
  }

  // 计算保留片段
  const keepSegments = [];
  let cursor = 0;

  for (const del of mergedDelete) {
    if (del.start > cursor) {
      keepSegments.push({ start: cursor, end: del.start });
    }
    cursor = del.end;
  }
  if (cursor < duration) {
    keepSegments.push({ start: cursor, end: duration });
  }

  console.log(`保留 ${keepSegments.length} 个片段，删除 ${mergedDelete.length} 个片段`);

  // 生成 filter_complex（带 crossfade）
  let filters = [];
  let vconcat = '';

  for (let i = 0; i < keepSegments.length; i++) {
    const seg = keepSegments[i];
    filters.push(`[0:v]trim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
    filters.push(`[0:a]atrim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
    vconcat += `[v${i}]`;
  }

  // 视频直接 concat
  filters.push(`${vconcat}concat=n=${keepSegments.length}:v=1:a=0[outv]`);

  // 音频使用 acrossfade 逐个拼接（消除接缝咔声）
  if (keepSegments.length === 1) {
    filters.push(`[a0]anull[outa]`);
  } else {
    let currentLabel = 'a0';
    for (let i = 1; i < keepSegments.length; i++) {
      const nextLabel = `a${i}`;
      const outLabel = (i === keepSegments.length - 1) ? 'outa' : `amid${i}`;
      filters.push(`[${currentLabel}][${nextLabel}]acrossfade=d=${crossfadeSec.toFixed(3)}:c1=tri:c2=tri[${outLabel}]`);
      currentLabel = outLabel;
    }
  }

  const filterComplex = filters.join(';');

  const encoder = getEncoder();
  console.log(`✂️ 执行 FFmpeg 精确剪辑（${encoder.label}）...`);

  const cmd = `ffmpeg -y -i "file:${input}" -filter_complex "${filterComplex}" -map "[outv]" -map "[outa]" -c:v ${encoder.name} ${encoder.args} -c:a aac -b:a 192k "file:${output}"`;

  try {
    execSync(cmd, { stdio: 'pipe' });
    console.log(`✅ 输出: ${output}`);

    const newDuration = parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "file:${output}"`).toString().trim());
    console.log(`📹 新时长: ${newDuration.toFixed(2)}s`);
  } catch (err) {
    console.error('FFmpeg 执行失败，尝试分段方案...');
    executeFFmpegCutFallback(input, keepSegments, output);
  }
}

// 备用方案：分段切割 + concat（当 filter_complex 失败时使用）
function executeFFmpegCutFallback(input, keepSegments, output) {
  const tmpDir = `tmp_cut_${Date.now()}`;
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const partFiles = [];
    keepSegments.forEach((seg, i) => {
      const partFile = path.join(tmpDir, `part${i.toString().padStart(4, '0')}.mp4`);
      const segDuration = seg.end - seg.start;

      const encoder = getEncoder();
      const cmd = `ffmpeg -y -ss ${seg.start.toFixed(3)} -i "file:${input}" -t ${segDuration.toFixed(3)} -c:v ${encoder.name} ${encoder.args} -c:a aac -b:a 128k -avoid_negative_ts make_zero "${partFile}"`;

      console.log(`切割片段 ${i + 1}/${keepSegments.length}: ${seg.start.toFixed(2)}s - ${seg.end.toFixed(2)}s`);
      execSync(cmd, { stdio: 'pipe' });
      partFiles.push(partFile);
    });

    const listFile = path.join(tmpDir, 'list.txt');
    const listContent = partFiles.map(f => `file '${path.resolve(f)}'`).join('\n');
    fs.writeFileSync(listFile, listContent);

    const concatCmd = `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${output}"`;
    console.log('合并片段...');
    execSync(concatCmd, { stdio: 'pipe' });

    console.log(`✅ 输出: ${output}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

server.listen(PORT, () => {
  console.log(`
🎬 审核服务器已启动
📍 地址: http://localhost:${PORT}
📹 视频: ${VIDEO_FILE}

操作说明:
1. 在网页中审核选择要删除的片段
2. 点击「渲染」按钮
3. 选择渲染目录并等待渲染完成
  `);
});
