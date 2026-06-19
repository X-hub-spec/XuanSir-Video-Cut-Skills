#!/usr/bin/env node
/**
 * 准备访谈粗剪项目。
 *
 * 用法:
 *   node prepare_interview_project.js <interview_sources.json> [--xml synced.fcpxml] [--timecode]
 *
 * 输出:
 *   interview_project.json
 *   1_转录/interview/<source-id>/subtitles_words.json
 *   2_分析/auto_selected.json
 *   media/<source-id>.<ext>
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  applyTimecodeOffsets,
  applyXmlOffsets,
  buildTimelineInterviewProject,
  buildProjectFromSourceWords,
  ensureDir,
  ensureManualSyncDefaults,
  normalizeManifest,
  parseFcpxmlTimeline,
  probeMedia,
  readJson,
  resolveSourceIdentifier,
  writeInterviewAnalysis,
} = require('./interview_utils');

const manifestFile = process.argv[2];
if (!manifestFile) {
  console.error('❌ 用法: node prepare_interview_project.js <interview_sources.json> [--xml synced.fcpxml] [--timecode]');
  process.exit(1);
}

const xmlArgIndex = process.argv.indexOf('--xml');
const xmlFile = xmlArgIndex >= 0 ? process.argv[xmlArgIndex + 1] : '';
const useTimecode = process.argv.includes('--timecode');
const noTranscribe = process.argv.includes('--no-transcribe');

const repoRoot = path.resolve(__dirname, '..', '..');
const oralScriptsDir = path.join(repoRoot, '剪口播', 'scripts');
const baseDir = path.dirname(path.resolve(manifestFile));
const mediaDir = path.resolve('media');
const transcribeRoot = path.resolve('1_转录', 'interview');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} 执行失败`);
}

function ensureMediaLink(source) {
  if (!source.path) return '';
  ensureDir(mediaDir);
  const ext = path.extname(source.path) || (source.kind === 'audio' ? '.wav' : '.mp4');
  const linkPath = path.join(mediaDir, `${source.id}${ext}`);
  fs.rmSync(linkPath, { force: true });
  try {
    fs.symlinkSync(source.path, linkPath);
  } catch (err) {
    fs.copyFileSync(source.path, linkPath);
  }
  return path.relative(process.cwd(), linkPath).split(path.sep).join('/');
}

function transcribeSource(source) {
  if (source.wordsFile) {
    if (!fs.existsSync(source.wordsFile)) throw new Error(`找不到 wordsFile: ${source.wordsFile}`);
    console.log(`♻️ 复用转录: ${source.name}`);
    return readJson(source.wordsFile);
  }
  if (noTranscribe) return [];

  const sourceDir = path.join(transcribeRoot, source.id);
  ensureDir(sourceDir);
  const audioFile = path.join(sourceDir, 'audio.mp3');
  const resultFile = path.join(sourceDir, 'volcengine_result.json');
  const wordsFile = path.join(sourceDir, 'subtitles_words.json');
  if (fs.existsSync(wordsFile)) {
    console.log(`♻️ 复用转录: ${source.id}`);
    return readJson(wordsFile);
  }

  console.log(`🎙️ 提取音频: ${source.name}`);
  run('ffmpeg', ['-y', '-i', `file:${source.path}`, '-vn', '-acodec', 'libmp3lame', audioFile]);

  console.log(`🧠 火山引擎转录: ${source.name}`);
  const python = path.resolve(repoRoot, '.venv', 'bin', 'python');
  const pythonCommand = fs.existsSync(python) ? python : 'python3';
  run(pythonCommand, [
    path.join(oralScriptsDir, 'volcengine_bigmodel_flash_transcribe.py'),
    audioFile,
    '-o',
    resultFile,
  ]);

  console.log(`📝 生成字级 token: ${source.name}`);
  run('node', [path.join(oralScriptsDir, 'generate_subtitles.js'), resultFile], { cwd: sourceDir });
  return readJson(wordsFile);
}

try {
  let manifest = {
    ...readJson(manifestFile),
    mode: 'interview',
  };
  if (xmlFile && !manifest.timelineXml) manifest.timelineXml = xmlFile;

  if (manifest.timelineXml && !manifest.transcriptSourceId) {
    throw new Error('访谈清单缺少 transcriptSourceId，请指定用于转写的混音总轨');
  }

  if (manifest.timelineXml && manifest.transcriptSourceId) {
    const parsed = parseFcpxmlTimeline(path.resolve(baseDir, manifest.timelineXml), manifest, baseDir);
    const transcriptSource = resolveSourceIdentifier(parsed.sources, manifest.transcriptSourceId);
    if (!transcriptSource) throw new Error(`找不到 transcriptSourceId 对应素材: ${manifest.transcriptSourceId}`);
    const enrichedSources = parsed.sources.map(source => {
      if (source.path && !fs.existsSync(source.path)) throw new Error(`找不到素材: ${source.name} (${source.path})`);
      const media = source.path ? probeMedia(source) : {};
      return {
        ...source,
        ...media,
        reviewPath: ensureMediaLink(source),
      };
    });
    const enrichedTranscriptSource = enrichedSources.find(source => source.id === transcriptSource.id);
    const transcriptWords = transcribeSource(enrichedTranscriptSource);
    const outputProject = buildTimelineInterviewProject({
      ...manifest,
      timelineXml: path.resolve(baseDir, manifest.timelineXml),
      sources: enrichedSources,
    }, transcriptWords, baseDir);
    const sourceById = new Map(enrichedSources.map(source => [source.id, source]));
    outputProject.sources = outputProject.sources.map(source => ({
      ...source,
      ...(sourceById.get(source.id) || {}),
      primary: source.primary,
    }));
    fs.writeFileSync('interview_project.json', JSON.stringify(outputProject, null, 2));
    writeInterviewAnalysis(outputProject, '2_分析');
    if (!fs.existsSync('interview_review_state.json')) {
      fs.writeFileSync('interview_review_state.json', JSON.stringify({ mode: 'interview' }, null, 2));
    }
    console.log('✅ 已生成 interview_project.json');
    console.log(`📎 FCPXML 时间线: ${outputProject.timelineXml}`);
    console.log(`🎙️ 转写源: ${outputProject.transcriptSourceId}`);
    console.log(`🎞️ 时间线片段: ${outputProject.timelineClips.length}`);
    console.log(`🧩 token: ${outputProject.words.length}`);
    process.exit(0);
  }

  if (xmlFile) {
    manifest = applyXmlOffsets(manifest, path.resolve(baseDir, xmlFile));
  } else if (useTimecode || manifest.syncMethod === 'timecode') {
    manifest = applyTimecodeOffsets(manifest);
  } else {
    manifest = ensureManualSyncDefaults(manifest);
  }

  const normalized = normalizeManifest(manifest, baseDir);
  const enrichedManifest = {
    ...normalized,
    sources: normalized.sources.map(source => {
      if (!fs.existsSync(source.path)) throw new Error(`找不到素材: ${source.path}`);
      const media = probeMedia(source);
      return {
        ...source,
        ...media,
        reviewPath: ensureMediaLink(source),
      };
    }),
  };

  const sourceWordsById = {};
  enrichedManifest.sources.forEach(source => {
    if (!source.speakerId) return;
    sourceWordsById[source.id] = transcribeSource(source);
  });

  const outputProject = buildProjectFromSourceWords(enrichedManifest, sourceWordsById, process.cwd());
  fs.writeFileSync('interview_project.json', JSON.stringify(outputProject, null, 2));
  writeInterviewAnalysis(outputProject, '2_分析');
  if (!fs.existsSync('interview_review_state.json')) {
    fs.writeFileSync('interview_review_state.json', JSON.stringify({ mode: 'interview' }, null, 2));
  }

  console.log('✅ 已生成 interview_project.json');
  console.log(`📎 素材链接: ${mediaDir}`);
  console.log(`👥 说话人: ${outputProject.speakers.map(speaker => speaker.name).join('、') || '无'}`);
  console.log(`🧩 token: ${outputProject.words.length}`);
} catch (err) {
  console.error('❌ 访谈项目准备失败:', err.message);
  process.exit(1);
}
