#!/usr/bin/env node
/**
 * 准备多机位审核项目。
 *
 * 用法:
 *   node prepare_multicam_project.js <multicam_sources.json>
 *
 * 输出:
 *   multicam_project.json
 *   media/<source-id>.<ext>  指向原素材的符号链接
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  buildProjectFromSourceWords,
  normalizeManifest,
  readJson,
} = require('./multicam_utils');

const manifestFile = process.argv[2];
if (!manifestFile) {
  console.error('❌ 用法: node prepare_multicam_project.js <multicam_sources.json>');
  process.exit(1);
}

const baseDir = path.dirname(path.resolve(manifestFile));
const manifest = readJson(manifestFile);
const project = normalizeManifest(manifest, baseDir);
const scriptDir = __dirname;
const mediaDir = path.resolve('media');
const transcribeRoot = path.resolve('1_转录', 'multicam');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} 执行失败`);
  }
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
  };
}

function ensureMediaLink(source) {
  fs.mkdirSync(mediaDir, { recursive: true });
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
  const sourceDir = path.join(transcribeRoot, source.id);
  fs.mkdirSync(sourceDir, { recursive: true });
  const audioFile = path.join(sourceDir, 'audio.mp3');
  const resultFile = path.join(sourceDir, 'volcengine_result.json');
  const wordsFile = path.join(sourceDir, 'subtitles_words.json');

  if (fs.existsSync(wordsFile)) {
    console.log(`♻️ 复用转录: ${source.id}`);
    return readJson(wordsFile);
  }

  console.log(`🎙️ 提取音频: ${source.name}`);
  run('ffmpeg', ['-y', '-i', `file:${source.path}`, '-vn', '-acodec', 'libmp3lame', audioFile]);

  console.log(`🧠 本地 Whisper 转录: ${source.name}`);
  const python = path.resolve(scriptDir, '..', '..', '.venv', 'bin', 'python');
  const pythonCommand = fs.existsSync(python) ? python : 'python3';
  run(pythonCommand, [
    path.join(scriptDir, 'local_whisper_mlx_transcribe.py'),
    audioFile,
    '--model',
    'mlx-community/whisper-small-mlx',
    '-o',
    resultFile,
  ]);

  console.log(`📝 生成字级 token: ${source.name}`);
  run('node', [path.join(scriptDir, 'generate_subtitles.js'), resultFile], { cwd: sourceDir });
  return readJson(wordsFile);
}

function loadSourceWords(source) {
  if (source.wordsFile) {
    if (!fs.existsSync(source.wordsFile)) throw new Error(`找不到 wordsFile: ${source.wordsFile}`);
    return readJson(source.wordsFile);
  }
  return transcribeSource(source);
}

try {
  const enrichedManifest = {
    ...project,
    sources: project.sources.map(source => {
      if (!fs.existsSync(source.path)) throw new Error(`找不到素材: ${source.path}`);
      return {
        ...source,
        ...probeMedia(source),
        reviewPath: ensureMediaLink(source),
      };
    }),
  };

  const sourceWordsById = {};
  enrichedManifest.sources.forEach(source => {
    if (!source.speakerId) return;
    sourceWordsById[source.id] = loadSourceWords(source);
  });

  const outputProject = buildProjectFromSourceWords(enrichedManifest, sourceWordsById, process.cwd());
  fs.writeFileSync('multicam_project.json', JSON.stringify(outputProject, null, 2));
  console.log(`✅ 已生成 multicam_project.json`);
  console.log(`📎 素材链接: ${mediaDir}`);
  console.log(`👥 说话人: ${outputProject.speakers.map(speaker => speaker.name).join('、') || '无'}`);
  console.log(`🧩 token: ${outputProject.words.length}`);
} catch (err) {
  console.error('❌ 多机位项目准备失败:', err.message);
  process.exit(1);
}
