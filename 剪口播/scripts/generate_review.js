#!/usr/bin/env node
/**
 * 生成审核网页（视频版本）
 *
 * 用法:
 *   node generate_review.js <subtitles_words.json> [auto_selected.json] [video_file]
 *   node generate_review.js <multicam_project.json> [auto_selected.json]
 *
 * 输出: review.html, video.mp4（单机位符号链接）或 media/*（多机位符号链接）
 */

const fs = require('fs');
const path = require('path');
const { estimateProjectDuration } = require('./multicam_utils');

const subtitlesFile = process.argv[2] || 'subtitles_words.json';
const autoSelectedFile = process.argv[3] || 'auto_selected.json';
const videoFile = process.argv[4] || 'video.mp4';

const BGM_EXTENSIONS = new Set(['.mp3', '.m4a']);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeLabel(fileName) {
  return path.basename(fileName, path.extname(fileName)).replace(/\s+/g, ' ').trim();
}

if (!fs.existsSync(subtitlesFile)) {
  console.error('❌ 找不到字幕文件:', subtitlesFile);
  process.exit(1);
}

const inputPayload = JSON.parse(fs.readFileSync(subtitlesFile, 'utf8'));
const isMulticamProject = inputPayload
  && !Array.isArray(inputPayload)
  && inputPayload.mode === 'multicam'
  && Array.isArray(inputPayload.words);
const multicamProject = isMulticamProject ? {
  ...inputPayload,
  duration: estimateProjectDuration(inputPayload),
  sources: Array.isArray(inputPayload.sources) ? inputPayload.sources : [],
  speakers: Array.isArray(inputPayload.speakers) ? inputPayload.speakers : [],
} : null;
const words = isMulticamProject ? multicamProject.words : inputPayload;
if (!Array.isArray(words)) {
  console.error('❌ 字幕文件格式错误：需要 token 数组或 multicam_project.json');
  process.exit(1);
}

function ensureReviewMediaLink(source) {
  if (!source || !source.path) return '';
  if (source.reviewPath && fs.existsSync(source.reviewPath)) return source.reviewPath;
  const sourcePath = path.resolve(source.path);
  if (!fs.existsSync(sourcePath)) return source.reviewPath || '';
  const mediaDir = path.resolve('media');
  fs.mkdirSync(mediaDir, { recursive: true });
  const ext = path.extname(sourcePath) || (source.kind === 'audio' ? '.wav' : '.mp4');
  const reviewPath = path.join(mediaDir, `${source.id}${ext}`);
  fs.rmSync(reviewPath, { force: true });
  try {
    fs.symlinkSync(sourcePath, reviewPath);
  } catch (err) {
    fs.copyFileSync(sourcePath, reviewPath);
  }
  source.reviewPath = path.relative(process.cwd(), reviewPath).split(path.sep).join('/');
  return source.reviewPath;
}

if (multicamProject) {
  multicamProject.sources.forEach(ensureReviewMediaLink);
}

// 创建视频文件的符号链接到当前目录（避免复制大文件）
let videoBaseName = 'video.mp4';
if (multicamProject) {
  const primarySource = multicamProject.sources.find(source => source.primary && source.kind === 'video')
    || multicamProject.sources.find(source => source.kind === 'video')
    || multicamProject.sources[0];
  videoBaseName = primarySource?.reviewPath || ensureReviewMediaLink(primarySource) || videoBaseName;
  console.log('🎛️ 多机位模式:', multicamProject.sources.length, '个素材');
} else if (videoFile !== videoBaseName && fs.existsSync(videoFile)) {
  const absVideoPath = path.resolve(videoFile);
  if (fs.existsSync(videoBaseName)) fs.unlinkSync(videoBaseName);
  fs.symlinkSync(absVideoPath, videoBaseName);
  console.log('📁 已链接视频到当前目录:', videoBaseName, '→', absVideoPath);
}

let autoSelected = [];

if (fs.existsSync(autoSelectedFile)) {
  autoSelected = JSON.parse(fs.readFileSync(autoSelectedFile, 'utf8'));
  console.log('AI 预选:', autoSelected.length, '个元素');
}

function prepareBgmTracks() {
  const sourceDir = path.join(__dirname, '..', 'BGM');
  const reviewBgmDir = path.resolve('bgm');
  if (!fs.existsSync(sourceDir)) return [];

  const files = fs.readdirSync(sourceDir)
    .filter(file => BGM_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));

  fs.rmSync(reviewBgmDir, { recursive: true, force: true });
  fs.mkdirSync(reviewBgmDir, { recursive: true });

  return files.map(fileName => {
    const sourceFile = path.join(sourceDir, fileName);
    const linkedFile = path.join(reviewBgmDir, fileName);
    try {
      fs.symlinkSync(sourceFile, linkedFile);
    } catch (err) {
      fs.copyFileSync(sourceFile, linkedFile);
    }
    return {
      label: safeLabel(fileName),
      fileName,
      url: `bgm/${encodeURIComponent(fileName)}`
    };
  });
}

const bgmTracks = prepareBgmTracks();
if (bgmTracks.length) {
  console.log('BGM:', bgmTracks.length, '首');
}
const bgmOptionsHtml = bgmTracks
  .map(track => `<option value="${escapeHtml(track.fileName)}">${escapeHtml(track.label)}</option>`)
  .join('');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>审核稿</title>
  <style>
    * { box-sizing: border-box; }
    :root {
      --desk-bg: #141414;
      --desk-panel: #1d1d1c;
      --desk-panel-2: #252421;
      --desk-line: rgba(255,255,255,0.12);
      --paper: #f6efe2;
      --paper-2: #fbf6ec;
      --ink: #2f2923;
      --ink-soft: #6f665d;
      --blue: #2f6fe4;
      --orange: #d99a2b;
      --red: #c9433b;
      --purple: #7c4dff;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Noto Sans SC", sans-serif;
      margin: 0;
      padding: 0;
      background: var(--desk-bg);
      color: #e7e1d8;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .toolbar {
      min-height: 64px;
      background: linear-gradient(180deg, #1c1b19, #151514);
      padding: 10px 22px;
      border-bottom: 1px solid var(--desk-line);
      flex-shrink: 0;
      display: grid;
      grid-template-columns: minmax(220px, auto) 1fr auto;
      align-items: center;
      gap: 18px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .brand-title {
      font-family: "Songti SC", "Noto Serif SC", serif;
      font-size: 18px;
      font-weight: 700;
      color: #f3eadc;
      letter-spacing: 0;
      white-space: nowrap;
    }
    .brand-badge {
      padding: 4px 9px;
      border-radius: 999px;
      background: rgba(246, 239, 226, 0.10);
      color: #d8c9b6;
      font-size: 12px;
      border: 1px solid rgba(246, 239, 226, 0.12);
      white-space: nowrap;
    }
    .buttons {
      display: flex;
      gap: 10px;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
    }
    button, select {
      height: 38px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0;
    }
    button {
      padding: 0 14px;
      color: #f4eee5;
      border: 1px solid rgba(255,255,255,0.13);
      background: rgba(255,255,255,0.055);
      cursor: pointer;
      transition: background 0.14s, border-color 0.14s, transform 0.14s;
    }
    button:hover {
      background: rgba(255,255,255,0.095);
      border-color: rgba(255,255,255,0.22);
    }
    button:active { transform: translateY(1px); }
    button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
      transform: none;
    }
    button.primary-action {
      background: rgba(255,255,255,0.055);
      border-color: rgba(255,255,255,0.13);
      color: #f4eee5;
      box-shadow: none;
    }
    button.danger {
      color: #f4eee5;
      background: rgba(255,255,255,0.055);
      border-color: rgba(255,255,255,0.13);
    }
    select {
      min-width: 86px;
      padding: 0 12px;
      background: rgba(255,255,255,0.055);
      color: #f4eee5;
      border: 1px solid rgba(255,255,255,0.13);
      cursor: pointer;
    }
    #bgmSelect {
      width: 132px;
      min-width: 132px;
      max-width: 132px;
    }
    .time-readout {
      font-family: "SF Mono", Menlo, Consolas, monospace;
      font-size: 15px;
      color: #b8afa4;
      white-space: nowrap;
      justify-self: end;
    }

    .main {
      display: grid;
      grid-template-columns: 430px minmax(0, 1fr);
      flex: 1;
      overflow: hidden;
      min-height: 0;
    }
    .left-panel {
      min-width: 0;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: #171717;
      border-right: 1px solid var(--desk-line);
      overflow-y: auto;
    }
    .monitor-card {
      flex: 0 0 clamp(260px, 46vh, 390px);
      height: clamp(260px, 46vh, 390px);
      background: var(--desk-panel);
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 7px;
      overflow: hidden;
      box-shadow: 0 16px 36px rgba(0,0,0,0.25);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #player {
      width: 100%;
      height: 100%;
      display: block;
      background: #000;
      object-fit: contain;
    }
    .left-section {
      padding: 12px;
      background: var(--desk-panel);
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 7px;
    }
    .section-title {
      color: #f3eadc;
      font-size: 12px;
      font-weight: 700;
      margin: 0 0 10px;
    }
    .stats {
      display: grid;
      gap: 8px;
      font-size: 12px;
    }
    .stat-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      color: #b9b0a6;
    }
    .stat-value {
      font-family: "SF Mono", Menlo, Consolas, monospace;
      color: #f4eee5;
      white-space: nowrap;
    }
    .help {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px 14px;
      color: #a9a199;
      font-size: 12px;
      line-height: 1.35;
    }
    .help kbd {
      color: #eee4d8;
      font-family: "SF Mono", Menlo, Consolas, monospace;
      font-size: 11px;
      font-weight: 600;
    }
    .legend {
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      font-size: 12px;
      color: #a9a199;
    }
    .legend-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      display: inline-block;
      margin-right: 6px;
      vertical-align: 0;
    }
    .dot-delete { background: var(--red); }
    .dot-ai { background: var(--orange); }
    .dot-current { background: var(--blue); }
    .multicam-section {
      display: none;
    }
    body.is-multicam .multicam-section {
      display: block;
    }
    .multicam-controls {
      display: grid;
      gap: 10px;
      font-size: 12px;
      color: #b9b0a6;
    }
    .multicam-field {
      display: grid;
      gap: 5px;
    }
    .multicam-field label,
    .source-row label,
    .speaker-row label {
      color: #d9cdbc;
      font-size: 11px;
      font-weight: 700;
    }
    .multicam-field select,
    .source-row input,
    .speaker-row input {
      width: 100%;
      min-width: 0;
      height: 32px;
      border-radius: 5px;
      border: 1px solid rgba(255,255,255,0.13);
      background: rgba(255,255,255,0.055);
      color: #f4eee5;
      padding: 0 9px;
      font-size: 12px;
      font-weight: 600;
    }
    .source-list,
    .speaker-list {
      display: grid;
      gap: 8px;
    }
    .source-row,
    .speaker-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 82px;
      gap: 8px;
      align-items: end;
    }
    .speaker-row {
      grid-template-columns: 14px minmax(0, 1fr);
    }
    .speaker-swatch {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      align-self: center;
      border: 1px solid rgba(255,255,255,0.28);
    }

    .right-panel {
      min-width: 0;
      background:
        radial-gradient(circle at top left, rgba(255,255,255,0.22), transparent 280px),
        linear-gradient(180deg, #e8dcc9, #d7c9b4);
      padding: 10px 16px 0;
      display: grid;
      grid-template-rows: minmax(0, 1fr) 44px;
      overflow: hidden;
    }
    .paper-shell {
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 258px;
      background: var(--paper);
      border: 1px solid rgba(92, 75, 55, 0.20);
      box-shadow:
        0 20px 45px rgba(31, 24, 16, 0.28),
        inset 0 0 0 1px rgba(255,255,255,0.55);
      overflow: hidden;
    }
    .paper-main {
      min-width: 0;
      overflow-y: auto;
      padding: 0 46px 40px 64px;
      background:
        linear-gradient(90deg, rgba(92,75,55,0.055) 0, transparent 18px),
        var(--paper-2);
    }
    .paper-header {
      position: sticky;
      top: 0;
      z-index: 8;
      display: grid;
      grid-template-columns: minmax(0, 1fr) max-content;
      align-items: center;
      column-gap: 18px;
      row-gap: 10px;
      padding: 30px 0 18px;
      margin-bottom: 26px;
      border-bottom: 1px solid rgba(92, 75, 55, 0.22);
      background: var(--paper-2);
      color: #766958;
      font-size: 13px;
      min-width: 0;
    }
    .paper-title-group {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
    }
    .paper-title {
      font-family: "Songti SC", "Noto Serif SC", serif;
      color: #5b4d3e;
      font-weight: 700;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .view-switch {
      display: inline-flex;
      flex: 0 0 auto;
      padding: 3px;
      border-radius: 999px;
      background: rgba(92,75,55,0.09);
      border: 1px solid rgba(92,75,55,0.16);
    }
    .view-switch button {
      height: 28px;
      padding: 0 12px;
      border-radius: 999px;
      color: #7b6d5d;
      background: transparent;
      border: 0;
      box-shadow: none;
      font-size: 12px;
    }
    .view-switch button.active {
      color: #2f2923;
      background: rgba(255,255,255,0.78);
    }
    .split-mode-btn {
      height: 30px;
      padding: 0 12px;
      border-radius: 999px;
      border: 1px solid rgba(92,75,55,0.18);
      background: rgba(255,255,255,0.42);
      color: #766958;
      box-shadow: none;
      font-size: 12px;
    }
    .split-mode-btn.active {
      color: #1f5fbf;
      border-color: rgba(47,111,228,0.36);
      background: rgba(64,128,255,0.12);
    }
    .daily-quote {
      max-width: min(42vw, 520px);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: "Songti SC", "Noto Serif SC", serif;
      color: #6f6254;
      font-size: 13px;
      line-height: 1.5;
      justify-self: end;
      text-align: right;
    }
    .daily-quote::before {
      content: "帛书一语";
      margin-right: 10px;
      color: #a0907c;
      font-family: -apple-system, BlinkMacSystemFont, "Noto Sans SC", sans-serif;
      font-size: 12px;
      font-weight: 700;
    }
    @media (max-width: 1120px) {
      .paper-header {
        grid-template-columns: minmax(0, 1fr);
      }
      .daily-quote {
        grid-column: 1 / -1;
        justify-self: end;
        max-width: 100%;
      }
    }
    .content {
      max-width: 1020px;
      margin: 0 auto;
      color: var(--ink);
      font-family: "Songti SC", "Noto Serif SC", "Noto Serif CJK SC", "LXGW WenKai", serif;
      font-size: 20px;
      line-height: 2.05;
      letter-spacing: 0;
      user-select: text;
    }
    .paper-main.is-cut-mode .content,
    .paper-main.is-cut-mode .subtitle-content {
      user-select: none;
    }
    .content.is-dragging,
    .subtitle-content.is-dragging { cursor: crosshair; }
    .content.is-hidden,
    .subtitle-content.is-hidden {
      display: none;
    }
    .article-paragraph {
      position: relative;
      margin: 0 0 30px;
      padding: 0;
      text-align: left;
      border: 1px solid transparent;
      border-radius: 4px;
    }
    .article-paragraph.is-dragging {
      opacity: 0.42;
    }
    .article-paragraph.is-drop-target {
      border-color: rgba(47,111,228,0.26);
      background: rgba(64,128,255,0.045);
    }
    .paragraph-handle {
      position: absolute;
      left: -34px;
      top: 0.34em;
      width: 24px;
      height: 24px;
      min-width: 24px;
      padding: 0;
      border-radius: 7px;
      border: 1px solid rgba(47,111,228,0.22);
      background: rgba(64,128,255,0.08);
      color: #2f6fe4;
      font-size: 14px;
      line-height: 1;
      opacity: 0;
      pointer-events: none;
      cursor: grab;
      box-shadow: 0 2px 8px rgba(47,111,228,0.08);
      transition: opacity 0.16s, background 0.16s, border-color 0.16s;
    }
    .article-paragraph:hover .paragraph-handle,
    .paragraph-handle:focus-visible {
      opacity: 1;
      pointer-events: auto;
    }
    .paragraph-handle:active {
      cursor: grabbing;
    }
    .paper-main.is-cut-mode .paragraph-handle {
      opacity: 0;
      pointer-events: none;
    }
    body.is-multicam .article-paragraph {
      padding-right: 58px;
    }
    .paragraph-tools {
      display: none;
      position: absolute;
      top: 3px;
      right: 0;
      gap: 4px;
    }
    body.is-multicam .paragraph-tools {
      display: inline-flex;
    }
    .paragraph-tools button {
      width: 25px;
      height: 25px;
      min-width: 25px;
      padding: 0;
      border-radius: 5px;
      color: #695846;
      background: rgba(92,75,55,0.07);
      border: 1px solid rgba(92,75,55,0.16);
      font-size: 13px;
      line-height: 1;
    }
    .paragraph-tools button:disabled {
      opacity: 0.3;
    }
    .article-sentence { display: inline; }
    .article-break-slot,
    .subtitle-break-slot {
      display: inline-block;
      position: relative;
      width: 0;
      height: 1em;
      margin: 0;
      vertical-align: -0.08em;
      cursor: pointer;
      transition: width 0.16s ease, margin 0.16s ease;
    }
    .paper-main.is-cut-mode .article-break-slot,
    .paper-main.is-cut-mode .subtitle-break-slot {
      width: 14px;
      margin: 0 1px;
    }
    .paper-main.is-cut-mode .article-break-slot:hover,
    .paper-main.is-cut-mode .subtitle-break-slot:hover,
    .paper-main.is-cut-mode .article-break-slot.is-ready,
    .paper-main.is-cut-mode .subtitle-break-slot.is-ready {
      width: 14px;
      margin: 0 1px;
    }
    .article-break-toggle,
    .subtitle-break-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      z-index: 2;
      width: 22px;
      height: 2.65em;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: #2f6fe4;
      font-family: -apple-system, BlinkMacSystemFont, "Noto Sans SC", sans-serif;
      font-size: 13px;
      line-height: 1;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease;
    }
    .article-break-toggle::before,
    .subtitle-break-toggle::before {
      content: "";
      width: 3px;
      height: 2.45em;
      border-radius: 999px;
      background: #2f7dff;
      box-shadow: 0 0 0 1px rgba(47,125,255,0.22), 0 0 16px rgba(47,125,255,0.48);
    }
    .article-break-toggle::after,
    .subtitle-break-toggle::after {
      content: attr(data-label);
      position: absolute;
      left: 50%;
      top: calc(100% + 8px);
      transform: translateX(-50%);
      min-width: 88px;
      padding: 9px 12px;
      border-radius: 10px;
      color: #f8f3ea;
      background: rgba(48, 45, 41, 0.96);
      border: 1px solid rgba(255,255,255,0.08);
      box-shadow: 0 10px 24px rgba(25,22,18,0.22);
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
    }
    .article-break-slot::before,
    .subtitle-break-slot::before {
      content: "";
      position: absolute;
      left: -6px;
      top: -0.5em;
      width: 26px;
      height: 3.25em;
      pointer-events: none;
      z-index: 1;
    }
    .paper-main.is-cut-mode .article-break-slot::before,
    .paper-main.is-cut-mode .subtitle-break-slot::before {
      pointer-events: auto;
    }
    .paper-main.is-cut-mode .article-break-slot:hover .article-break-toggle,
    .paper-main.is-cut-mode .subtitle-break-slot:hover .subtitle-break-toggle,
    .paper-main.is-cut-mode .article-break-slot.is-ready .article-break-toggle,
    .paper-main.is-cut-mode .subtitle-break-slot.is-ready .subtitle-break-toggle,
    .article-break-toggle:focus-visible,
    .subtitle-break-toggle:focus-visible {
      opacity: 1;
      pointer-events: auto;
    }
    .speaker-pill {
      display: inline-flex;
      align-items: center;
      height: 20px;
      padding: 0 7px;
      margin: 0 6px 0 0;
      border-radius: 999px;
      font-family: -apple-system, BlinkMacSystemFont, "Noto Sans SC", sans-serif;
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
      color: var(--speaker-color, #2f6fe4);
      background: color-mix(in srgb, var(--speaker-color, #2f6fe4) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--speaker-color, #2f6fe4) 30%, transparent);
      vertical-align: 3px;
    }
    .token {
      display: inline;
      padding: 1px 1px 2px;
      margin: 0 1px;
      border-radius: 3px;
      color: var(--ink);
      cursor: text;
      transition: background 0.12s, color 0.12s, text-decoration-color 0.12s;
      text-underline-offset: 5px;
      text-decoration-skip-ink: none;
    }
    .token:hover { background: rgba(47, 41, 35, 0.07); }
    .token.has-speaker {
      text-decoration-line: underline;
      text-decoration-color: color-mix(in srgb, var(--speaker-color, #2f6fe4) 48%, transparent);
      text-decoration-thickness: 1px;
    }
    .token.is-current {
      background: rgba(64, 128, 255, 0.16);
      color: #1f5fbf;
      box-shadow: inset 0 -2px 0 rgba(47, 111, 228, 0.38);
    }
    .token.ai-suggested {
      background: rgba(225, 164, 56, 0.08);
      text-decoration-line: underline;
      text-decoration-style: dotted;
      text-decoration-color: var(--orange);
      text-decoration-thickness: 1.5px;
    }
    .token.confirmed-delete {
      color: #7f2d28;
      background: rgba(203, 74, 65, 0.10);
      text-decoration-line: line-through;
      text-decoration-color: var(--red);
      text-decoration-thickness: 2px;
      text-decoration-skip-ink: none;
    }
    .token.is-edited {
      background: rgba(53, 151, 109, 0.12);
      box-shadow: inset 0 -2px 0 rgba(53, 151, 109, 0.35);
    }
    .token.edited-empty {
      display: none;
    }
    .token.drag-preview {
      background: rgba(203, 74, 65, 0.08);
      text-decoration-line: line-through;
      text-decoration-color: rgba(201, 67, 59, 0.8);
    }
    .token.drag-remove-preview {
      color: var(--ink);
      background: rgba(53, 151, 109, 0.10);
      text-decoration-line: none;
      box-shadow: inset 0 -2px 0 rgba(53, 151, 109, 0.28);
    }
    .pause-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 22px;
      padding: 0 8px;
      margin: 0 4px;
      border-radius: 999px;
      font-family: -apple-system, BlinkMacSystemFont, "Noto Sans SC", sans-serif;
      font-size: 12px;
      line-height: 1;
      color: #6f665d;
      background: rgba(80, 70, 55, 0.08);
      border: 1px solid rgba(80, 70, 55, 0.12);
      vertical-align: 2px;
      cursor: pointer;
    }
    .pause-chip:hover { background: rgba(80, 70, 55, 0.13); }
    .pause-chip.confirmed-delete {
      color: #7f2d28;
      background: rgba(203, 74, 65, 0.12);
      border-color: rgba(203, 74, 65, 0.28);
      text-decoration-line: line-through;
      text-decoration-color: var(--red);
      text-decoration-thickness: 2px;
      text-decoration-skip-ink: none;
    }
    .pause-chip.drag-preview {
      text-decoration-line: line-through;
      text-decoration-color: rgba(201, 67, 59, 0.8);
      text-decoration-thickness: 2px;
      text-decoration-skip-ink: none;
    }
    .pause-chip.drag-remove-preview {
      color: #356b50;
      background: rgba(53, 151, 109, 0.12);
      border-color: rgba(53, 151, 109, 0.28);
      text-decoration-line: none;
      box-shadow: inset 0 -2px 0 rgba(53, 151, 109, 0.22);
    }
    .pause-chip.ai-suggested {
      background: rgba(225, 164, 56, 0.12);
      border-color: rgba(217, 154, 43, 0.25);
    }
    .pause-chip.tiny-gap {
      width: 0.28em;
      min-width: 0.28em;
      height: 1em;
      padding: 0;
      margin: 0;
      background: transparent;
      border: 0;
      color: transparent;
      overflow: hidden;
    }
    .punctuation {
      color: #7b7065;
      margin-right: 0.22em;
      user-select: none;
    }
    .subtitle-content {
      max-width: 1020px;
      margin: 0 auto;
      display: grid;
      gap: 2px;
      color: var(--ink);
      font-family: "Songti SC", "Noto Serif SC", "Noto Serif CJK SC", "LXGW WenKai", serif;
      font-size: 20px;
      line-height: 2.05;
      user-select: text;
    }
    .subtitle-row {
      display: grid;
      grid-template-columns: 46px 112px 30px minmax(0, 1fr) max-content;
      align-items: start;
      gap: 14px;
      padding: 8px 8px 8px 0;
      border-radius: 4px;
      border: 1px solid transparent;
      background: transparent;
      cursor: pointer;
    }
    .subtitle-row:hover,
    .subtitle-row.active {
      background: rgba(255,255,255,0.34);
      border-color: rgba(47,111,228,0.18);
    }
    .subtitle-row.is-empty {
      opacity: 0.58;
    }
    .subtitle-index,
    .subtitle-time {
      font-family: "SF Mono", Menlo, Consolas, monospace;
      font-size: 12px;
      line-height: 1.65;
      color: rgba(118, 105, 88, 0.74);
      white-space: nowrap;
      padding-top: 8px;
    }
    .subtitle-index { text-align: right; }
    .subtitle-merge-cell {
      min-width: 0;
      padding-top: 5px;
    }
    .subtitle-merge-btn {
      width: 26px;
      height: 26px;
      padding: 0;
      border-radius: 7px;
      border: 1px solid rgba(47,111,228,0.22);
      background: rgba(64,128,255,0.08);
      color: #2f6fe4;
      font-size: 18px;
      font-weight: 700;
      line-height: 1;
      opacity: 0;
      pointer-events: none;
      box-shadow: 0 2px 8px rgba(47,111,228,0.08);
      transition: opacity 0.16s, background 0.16s, border-color 0.16s;
    }
    .subtitle-row.is-mergeable:hover .subtitle-merge-btn,
    .subtitle-merge-btn:focus-visible {
      opacity: 1;
      pointer-events: auto;
    }
    .subtitle-merge-btn:hover {
      background: rgba(64,128,255,0.16);
      border-color: rgba(47,111,228,0.42);
    }
    .subtitle-line {
      min-width: 0;
      font-family: "Songti SC", "Noto Serif SC", "Noto Serif CJK SC", "LXGW WenKai", serif;
      font-size: inherit;
      line-height: inherit;
      color: var(--ink);
      position: relative;
    }
    .subtitle-badges {
      display: flex;
      align-items: flex-start;
      justify-content: flex-end;
      gap: 6px;
      min-width: 74px;
      padding-top: 8px;
      pointer-events: none;
    }
    .subtitle-badge {
      display: inline-flex;
      align-items: center;
      height: 22px;
      padding: 0 8px;
      border-radius: 999px;
      font-family: -apple-system, BlinkMacSystemFont, "Noto Sans SC", sans-serif;
      font-size: 12px;
      line-height: 1;
      white-space: nowrap;
      color: #6f665d;
      border: 1px solid rgba(92,75,55,0.14);
      background: rgba(255,255,255,0.44);
    }
    .subtitle-badge.is-long {
      color: #fff;
      border-color: rgba(185,48,42,0.42);
      background: #c9433b;
      box-shadow: 0 4px 12px rgba(201,67,59,0.18);
    }
    .subtitle-badge.is-short {
      color: #7a5a1c;
      border-color: rgba(217,154,43,0.28);
      background: rgba(225,164,56,0.10);
    }
    .subtitle-break-toggle:not(.active)::after {
      content: attr(data-label);
    }
    .subtitle-break-toggle.active {
      color: #1f5fbf;
    }
    .subtitle-break-toggle.active::after {
      content: attr(data-label);
      opacity: 0;
      transition: opacity 0.16s;
    }
    .subtitle-break-slot:hover .subtitle-break-toggle.active::after,
    .subtitle-break-toggle.active:focus-visible::after {
      opacity: 1;
    }
    .annotation-rail {
      min-width: 0;
      background: rgba(246, 239, 226, 0.72);
      border-left: 1px solid rgba(92, 75, 55, 0.18);
      padding: 28px 16px 18px;
      overflow-y: auto;
    }
    .selection-menu {
      position: fixed;
      z-index: 50;
      display: none;
      gap: 4px;
      padding: 6px;
      border-radius: 8px;
      background: rgba(35, 33, 30, 0.96);
      border: 1px solid rgba(255,255,255,0.14);
      box-shadow: 0 12px 30px rgba(0,0,0,0.28);
      backdrop-filter: blur(12px);
    }
    .selection-menu.is-visible {
      display: flex;
    }
    .selection-menu button {
      height: 30px;
      padding: 0 10px;
      font-size: 12px;
      border-radius: 6px;
      white-space: nowrap;
    }
    .annotation-header {
      margin-bottom: 14px;
    }
    .annotation-heading {
      margin: 0 0 4px;
      color: #3f352b;
      font-size: 15px;
      font-weight: 800;
      letter-spacing: 0;
    }
    .annotation-subhead {
      margin: 0;
      color: #8a7a67;
      font-size: 12px;
      line-height: 1.45;
    }
    .annotation-placeholder {
      display: grid;
      gap: 9px;
      margin-top: 20px;
      padding: 12px;
      border-radius: 6px;
      border-color: rgba(92,75,55,0.12);
      border: 1px solid rgba(92,75,55,0.12);
      background: rgba(255,255,255,0.24);
    }
    .annotation-placeholder-line {
      height: 9px;
      border-radius: 999px;
      background: rgba(92,75,55,0.10);
    }
    .annotation-placeholder-line:nth-child(2) { width: 72%; }
    .annotation-placeholder-line:nth-child(3) { width: 48%; }
    .bottom-status {
      display: grid;
      grid-template-columns: repeat(5, auto) 1fr auto;
      gap: 18px;
      align-items: center;
      padding: 0 22px;
      background: rgba(251, 246, 236, 0.95);
      border: 1px solid rgba(92,75,55,0.18);
      border-top: 0;
      color: #766958;
      font-size: 13px;
      white-space: nowrap;
    }
    .bottom-status strong {
      font-family: "SF Mono", Menlo, Consolas, monospace;
      color: #3d5fa8;
      font-weight: 700;
    }
    .save-state[data-status="saving"] { color: #8b5b11; }
    .save-state[data-status="saved"] { color: #2f6f47; }
    .save-state[data-status="dirty"] { color: #8b5b11; }
    .save-state[data-status="error"] { color: #9c3933; }
    .status-actions {
      display: flex;
      gap: 8px;
      justify-content: end;
    }
    .status-actions button {
      height: 30px;
      color: #6d6257;
      background: transparent;
      border-color: transparent;
      padding: 0 8px;
      box-shadow: none;
    }

    /* Loading 遮罩 */
    .loading-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.85);
      z-index: 9999;
      justify-content: center;
      align-items: center;
      flex-direction: column;
    }
    .loading-overlay.show { display: flex; }
    .loading-spinner {
      width: 60px;
      height: 60px;
      border: 4px solid #333;
      border-top-color: #9C27B0;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loading-text {
      margin-top: 20px;
      font-size: 18px;
      color: #fff;
    }
    .loading-progress-container {
      margin-top: 20px;
      width: 300px;
      height: 8px;
      background: #333;
      border-radius: 4px;
      overflow: hidden;
    }
    .loading-progress-bar {
      height: 100%;
      background: linear-gradient(90deg, #9C27B0, #E91E63);
      width: 0%;
      transition: width 0.3s ease;
    }
    .loading-time {
      margin-top: 15px;
      font-size: 14px;
      color: #888;
    }
    .loading-estimate {
      margin-top: 8px;
      font-size: 13px;
      color: #666;
    }
  </style>
</head>
<body>
  <!-- Loading 遮罩 -->
  <div class="loading-overlay" id="loadingOverlay">
    <div class="loading-spinner"></div>
    <div class="loading-text">🎬 正在渲染中...</div>
    <div class="loading-progress-container">
      <div class="loading-progress-bar" id="loadingProgress"></div>
    </div>
    <div class="loading-time" id="loadingTime">已等待 0 秒</div>
    <div class="loading-estimate" id="loadingEstimate">预估剩余: 计算中...</div>
  </div>

  <div class="toolbar">
    <div class="brand">
      <div class="brand-title">AI 粗剪审核工具</div>
    </div>
    <div class="buttons">
      <button id="playBtn">播放 / 暂停</button>
      <select id="speed">
        <option value="0.5">0.5x</option>
        <option value="0.75">0.75x</option>
        <option value="1" selected>1x</option>
        <option value="1.25">1.25x</option>
        <option value="1.5">1.5x</option>
        <option value="2">2x</option>
      </select>
      <select id="bgmSelect">
        <option value="">选择 BGM</option>
        ${bgmOptionsHtml}
      </select>
      <button id="copyBtn">复制删除列表</button>
      <button id="exportProjectBtn">导出工程</button>
      <button id="saveProjectBtn">保存项目</button>
      <button id="selectAiBtn">选择 AI 建议</button>
      <button class="primary-action" id="cutBtn">渲染</button>
      <button class="danger" id="clearBtn">清空选择</button>
    </div>
    <span class="time-readout" id="time">00:00 / 00:00</span>
  </div>
  <div class="selection-menu" id="selectionMenu">
    <button id="selectionToggleBtn">标记删除</button>
    <button id="selectionCopyBtn">复制</button>
    <button id="selectionEditBtn">修改</button>
  </div>

  <div class="main">
    <aside class="left-panel">
      <div class="monitor-card">
        <video id="player" src="${videoBaseName}" preload="auto"></video>
        <audio id="bgmPlayer" preload="auto" loop></audio>
      </div>
      <section class="left-section">
        <div class="section-title">审核统计</div>
        <div class="stats" id="stats"></div>
      </section>
      <section class="left-section multicam-section">
        <div class="section-title">多机位</div>
        <div class="multicam-controls" id="multicamPanel"></div>
      </section>
      <section class="left-section">
        <div class="section-title">快捷键</div>
        <div class="help">
          <span>播放 / 暂停</span><kbd>Space / K</kbd>
          <span>上一句 / 下一句</span><kbd>↑ / ↓</kbd>
          <span>文章 / 字幕</span><kbd>Tab</kbd>
          <span>分段模式</span><kbd>B</kbd>
          <span>撤销 / 重做</span><kbd>⌘ Z / ⇧⌘ Z</kbd>
        </div>
      </section>
      <section class="left-section">
        <div class="section-title">批注图例</div>
        <div class="legend">
          <span><i class="legend-dot dot-delete"></i>已删除</span>
          <span><i class="legend-dot dot-ai"></i>AI 建议</span>
          <span><i class="legend-dot dot-current"></i>当前播放</span>
        </div>
      </section>
    </aside>
    <section class="right-panel">
      <div class="paper-shell">
        <main class="paper-main" id="paperMain">
          <div class="paper-header">
            <div class="paper-title-group">
              <div class="paper-title" id="paperTitle">稿件：口播粗剪校样</div>
              <div class="view-switch" id="viewSwitch">
                <button type="button" class="active" data-view="article" aria-pressed="true">文章</button>
                <button type="button" data-view="subtitle" aria-pressed="false">字幕</button>
              </div>
              <button type="button" class="split-mode-btn" id="splitModeBtn">分段</button>
            </div>
            <div class="daily-quote" id="dailyQuote"></div>
          </div>
          <div class="content" id="content"></div>
          <div class="subtitle-content is-hidden" id="subtitleContent"></div>
        </main>
        <aside class="annotation-rail">
          <div class="annotation-header">
            <h2 class="annotation-heading">审核导航</h2>
            <p class="annotation-subhead">保留侧栏空间，主操作集中在文稿与字幕视图。</p>
          </div>
          <div class="annotation-placeholder" aria-hidden="true">
            <span class="annotation-placeholder-line"></span>
            <span class="annotation-placeholder-line"></span>
            <span class="annotation-placeholder-line"></span>
          </div>
        </aside>
      </div>
      <footer class="bottom-status">
        <span>当前播放 <strong id="bottomCurrent">00:00</strong></span>
        <span>删除时长 <strong id="bottomSelectedDuration">00:00</strong></span>
        <span>已删除 <strong id="bottomDeleted">0 / 0.00s</strong></span>
        <span>AI 建议 <strong id="bottomAi">0 / 0.00s</strong></span>
        <span>保存 <strong class="save-state" id="saveStatus" data-status="idle">读取中</strong></span>
        <span></span>
        <span class="status-actions">
          <button id="undoBtn">撤销</button>
          <button id="redoBtn">重做</button>
        </span>
      </footer>
    </section>
  </div>

  <script>
    const words = ${JSON.stringify(words)};
    const autoSelected = new Set(${JSON.stringify(autoSelected)});
    const selected = new Set(autoSelected);
    const projectVideo = ${JSON.stringify(videoBaseName)};
    const multicamProject = ${JSON.stringify(multicamProject)};
    const isMulticam = Boolean(multicamProject && multicamProject.mode === 'multicam');
    const bgmTracks = ${JSON.stringify(bgmTracks)};
    document.body.classList.toggle('is-multicam', isMulticam);

    const player = document.getElementById('player');
    const bgmPlayer = document.getElementById('bgmPlayer');
    const bgmSelect = document.getElementById('bgmSelect');
    const timeDisplay = document.getElementById('time');
    const paperMain = document.getElementById('paperMain');
    const paperTitle = document.getElementById('paperTitle');
    const exportProjectBtn = document.getElementById('exportProjectBtn');
    const dailyQuote = document.getElementById('dailyQuote');
    const bottomCurrent = document.getElementById('bottomCurrent');
    const bottomSelectedDuration = document.getElementById('bottomSelectedDuration');
    const bottomDeleted = document.getElementById('bottomDeleted');
    const bottomAi = document.getElementById('bottomAi');
    const saveStatus = document.getElementById('saveStatus');
    const selectionMenu = document.getElementById('selectionMenu');
    const selectionToggleBtn = document.getElementById('selectionToggleBtn');
    const viewSwitch = document.getElementById('viewSwitch');
    const splitModeBtn = document.getElementById('splitModeBtn');
    const subtitleContent = document.getElementById('subtitleContent');
    const multicamPanel = document.getElementById('multicamPanel');
    const BGM_VOLUME = 0.20;
    bgmPlayer.volume = BGM_VOLUME;

    function togglePlay() {
      if (player.paused) player.play();
      else player.pause();
    }

    function setPlaybackRate(value) {
      player.playbackRate = parseFloat(value);
    }
    const content = document.getElementById('content');
    const statsDiv = document.getElementById('stats');
    let elements = [];
    let isSelecting = false;
    let selectStart = -1;
    let selectMode = 'add'; // 'add' or 'remove'
    let dragPreviewSet = new Set();
    let undoStack = [];
    let redoStack = [];
    let paragraphStartIndices = [];
    let sentenceStartIndices = [];
    let articleBlocks = [];
    let articleBreakableIndices = new Set();
    let subtitleRows = [];
    let subtitleRowElements = [];
    let subtitleBreakAfterIndices = new Set();
    let subtitleMergedStartIndices = new Set();
    let manualParagraphBreakAfterIndices = new Set();
    let paragraphOrderStartIndices = [];
    let isCutMode = false;
    let draggingParagraphStartIndex = null;
    let activeMainView = 'article';
    let currentIndex = -1;
    let hasLoadedProjectState = false;
    let saveTimer = null;
    let pendingRestoreTime = null;
    let lastSaveSignature = '';
    let selectedBgm = '';
    let textOverrides = {};
    let activeSelectionIndices = [];
    let projectTitle = multicamProject?.projectTitle || '口播粗剪校样';
    const multicamSources = isMulticam ? (multicamProject.sources || []) : [];
    const multicamSpeakers = isMulticam ? (multicamProject.speakers || []) : [];
    const baseSourceOffsets = Object.fromEntries(multicamSources.map(source => [source.id, Number(source.offset || 0)]));
    let sourceOffsets = { ...baseSourceOffsets };
    let speakerNames = Object.fromEntries(multicamSpeakers.map(speaker => [speaker.id, speaker.name || speaker.id]));
    let activeCameraId = (multicamSources.find(source => source.primary && source.kind === 'video')
      || multicamSources.find(source => source.kind === 'video')
      || multicamSources[0]
      || {}).id || '';
    let paragraphOrder = [];
    let paragraphEntries = [];
    const aiDuration = Array.from(autoSelected).reduce((sum, i) => {
      const word = words[i];
      return word ? sum + Math.max(0, word.end - word.start) : sum;
    }, 0);

    function getSourceById(sourceId) {
      return multicamSources.find(source => source.id === sourceId) || null;
    }

    function getActiveSource() {
      return getSourceById(activeCameraId) || getSourceById(multicamSources[0]?.id) || null;
    }

    function getSourceOffset(sourceId) {
      if (!sourceId) return 0;
      return Number.isFinite(Number(sourceOffsets[sourceId])) ? Number(sourceOffsets[sourceId]) : Number(baseSourceOffsets[sourceId] || 0);
    }

    function getActiveOffset() {
      const source = getActiveSource();
      return source ? getSourceOffset(source.id) : 0;
    }

    function getGlobalTime() {
      return (player.currentTime || 0) + (isMulticam ? getActiveOffset() : 0);
    }

    function setGlobalTime(time) {
      const globalTime = Math.max(0, Number(time) || 0);
      const localTime = isMulticam ? Math.max(0, globalTime - getActiveOffset()) : globalTime;
      if (player.duration) {
        player.currentTime = Math.min(localTime, Math.max(0, player.duration - 0.05));
      } else {
        pendingRestoreTime = globalTime;
      }
    }

    function getSpeakerById(speakerId) {
      return multicamSpeakers.find(speaker => speaker.id === speakerId) || null;
    }

    function getSpeakerLabel(speakerId) {
      if (!speakerId) return '';
      return speakerNames[speakerId] || getSpeakerById(speakerId)?.name || speakerId;
    }

    function getSpeakerColor(speakerId) {
      return getSpeakerById(speakerId)?.color || '#2f6fe4';
    }

    function setSaveStatus(text, status = 'idle') {
      saveStatus.textContent = text;
      saveStatus.dataset.status = status;
    }

    function normalizeProjectTitle(value) {
      const text = String(value || '').replace(/^稿件[:：]\s*/, '').replace(/\s+/g, ' ').trim();
      return text || '口播粗剪校样';
    }

    function sanitizeFilePart(value) {
      return normalizeProjectTitle(value)
        .replace(/[\\\\/:*?"<>|]/g, '')
        .replace(/\s+/g, '')
        .slice(0, 80) || '口播粗剪校样';
    }

    function currentExportMonthPrefix() {
      const now = new Date();
      return \`\${now.getFullYear()}_\${String(now.getMonth() + 1).padStart(2, '0')}\`;
    }

    function getPreviewExportBaseName(copyLabel = 'A') {
      return \`\${currentExportMonthPrefix()}_\${sanitizeFilePart(projectTitle)}_粗剪_Copy_\${copyLabel}\`;
    }

    function updateExportProjectHint() {
      const baseName = getPreviewExportBaseName('A');
      exportProjectBtn.title = \`将导出：\${baseName}.fcpxml 和 \${baseName}.srt\\n若保存目录已有同名文件，会自动递增 Copy 字母序号。\`;
    }

    function renderProjectTitle() {
      paperTitle.textContent = \`稿件：\${projectTitle}\`;
      updateExportProjectHint();
    }

    const daoQuotes = [
      '道可道也，非恒道也。',
      '名可名也，非恒名也。',
      '知人者智也，自知者明也。',
      '胜人者有力也，自胜者强也。',
      '知足者富也，强行者有志也。',
      '大成若缺，其用不弊。',
      '大直若诎，大巧若拙。',
      '祸兮福之所倚，福兮祸之所伏。',
      '为学者日益，为道者日损。',
      '知不知，尚矣；不知知，病矣。',
      '天之道，利而不害。',
      '圣人之道，为而弗争。',
      '合抱之木，生于毫末。',
      '九层之台，作于累土。',
      '千里之行，始于足下。',
      '重为轻根，静为躁君。'
    ];

    function renderDailyQuote() {
      const key = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
      let hash = 0;
      for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
      dailyQuote.textContent = daoQuotes[hash % daoQuotes.length];
    }

    function normalizeIndexList(indices) {
      return (Array.isArray(indices) ? indices : [])
        .map(i => Number(i))
        .filter(i => Number.isInteger(i) && i >= 0 && i < words.length);
    }

    function paragraphIdFromStartIndex(index) {
      return Number.isInteger(index) && index >= 0 ? 'p-' + index : '';
    }

    function getParagraphOrderFromState(state) {
      if (Array.isArray(state?.paragraphOrder)) return state.paragraphOrder.map(String);
      return normalizeIndexList(state?.paragraphOrderStartIndices).map(paragraphIdFromStartIndex).filter(Boolean);
    }

    function getParagraphOrderStartIndices() {
      return paragraphOrder
        .map(id => {
          const match = String(id).match(/^p-(\\d+)$/);
          return match ? Number(match[1]) : null;
        })
        .filter(i => Number.isInteger(i) && i >= 0 && i < words.length);
    }

    function setActiveCamera(sourceId, { persist = true, keepGlobalTime = true } = {}) {
      if (!isMulticam) return;
      const source = getSourceById(sourceId) || getActiveSource();
      if (!source || source.kind !== 'video' || !source.reviewPath) return;
      const globalTime = keepGlobalTime ? getGlobalTime() : Number(pendingRestoreTime || 0);
      const wasPlaying = !player.paused;
      activeCameraId = source.id;
      if (player.getAttribute('src') !== source.reviewPath) {
        player.setAttribute('src', source.reviewPath);
        player.load();
        player.addEventListener('loadedmetadata', () => {
          setGlobalTime(globalTime);
          if (wasPlaying) player.play().catch(() => {});
        }, { once: true });
      } else if (keepGlobalTime) {
        setGlobalTime(globalTime);
      }
      if (persist) scheduleProjectSave();
    }

    function updateSourceOffset(sourceId, value) {
      if (!isMulticam) return;
      const globalTime = getGlobalTime();
      const next = Number(value);
      if (!Number.isFinite(next)) return;
      sourceOffsets[sourceId] = next;
      if (sourceId === activeCameraId) setGlobalTime(globalTime);
      scheduleProjectSave();
    }

    function updateSpeakerName(speakerId, value) {
      if (!isMulticam) return;
      const name = String(value || '').replace(/\\s+/g, ' ').trim();
      speakerNames[speakerId] = name || speakerId;
      render();
      scheduleProjectSave();
    }

    function renderMulticamPanel() {
      if (!isMulticam || !multicamPanel) return;
      multicamPanel.innerHTML = '';
      const videoSources = multicamSources.filter(source => source.kind === 'video' && source.reviewPath);

      const cameraField = document.createElement('div');
      cameraField.className = 'multicam-field';
      const cameraLabel = document.createElement('label');
      cameraLabel.textContent = '当前预览';
      const cameraSelect = document.createElement('select');
      videoSources.forEach(source => {
        const option = document.createElement('option');
        option.value = source.id;
        option.textContent = source.name || source.id;
        cameraSelect.appendChild(option);
      });
      cameraSelect.value = activeCameraId;
      cameraSelect.onchange = event => {
        setActiveCamera(event.target.value);
        event.target.blur();
      };
      cameraField.appendChild(cameraLabel);
      cameraField.appendChild(cameraSelect);
      multicamPanel.appendChild(cameraField);

      const sourceList = document.createElement('div');
      sourceList.className = 'source-list';
      multicamSources.forEach(source => {
        const row = document.createElement('div');
        row.className = 'source-row';
        const label = document.createElement('label');
        label.textContent = source.name || source.id;
        const input = document.createElement('input');
        input.type = 'number';
        input.step = '0.01';
        input.value = String(getSourceOffset(source.id));
        input.title = '全局时间 offset，单位秒';
        input.onchange = event => updateSourceOffset(source.id, event.target.value);
        row.appendChild(label);
        row.appendChild(input);
        sourceList.appendChild(row);
      });
      multicamPanel.appendChild(sourceList);

      const speakerList = document.createElement('div');
      speakerList.className = 'speaker-list';
      multicamSpeakers.forEach(speaker => {
        const row = document.createElement('div');
        row.className = 'speaker-row';
        const swatch = document.createElement('span');
        swatch.className = 'speaker-swatch';
        swatch.style.background = getSpeakerColor(speaker.id);
        const input = document.createElement('input');
        input.value = getSpeakerLabel(speaker.id);
        input.title = '说话人名称';
        input.onchange = event => updateSpeakerName(speaker.id, event.target.value);
        row.appendChild(swatch);
        row.appendChild(input);
        speakerList.appendChild(row);
      });
      multicamPanel.appendChild(speakerList);
    }

    function selectedSignature() {
      return JSON.stringify({
        selected: snapshotSelection(),
        textOverrides,
        projectTitle,
        currentTime: Math.round(getGlobalTime() * 10) / 10,
        playbackRate: player.playbackRate || 1,
        selectedBgm,
        activeMainView,
        subtitleBreakAfterIndices: Array.from(subtitleBreakAfterIndices).sort((a, b) => a - b),
        subtitleMergedStartIndices: Array.from(subtitleMergedStartIndices).sort((a, b) => a - b),
        manualParagraphBreakAfterIndices: Array.from(manualParagraphBreakAfterIndices).sort((a, b) => a - b),
        paragraphOrderStartIndices: getParagraphOrderStartIndices(),
        mode: isMulticam ? 'multicam' : 'single',
        sourceOffsets,
        speakerNames,
        activeCameraId,
        paragraphOrder
      });
    }

    function getProjectStatePayload() {
      return {
        version: isMulticam ? 2 : 1,
        mode: isMulticam ? 'multicam' : 'single',
        video: projectVideo,
        projectTitle,
        selectedIndices: snapshotSelection(),
        textOverrides,
        deleteSegments: getSelectedSegments(),
        currentTime: getGlobalTime(),
        playbackRate: player.playbackRate || 1,
        selectedBgm,
        activeMainView,
        subtitleBreakAfterIndices: Array.from(subtitleBreakAfterIndices).sort((a, b) => a - b),
        subtitleMergedStartIndices: Array.from(subtitleMergedStartIndices).sort((a, b) => a - b),
        manualParagraphBreakAfterIndices: Array.from(manualParagraphBreakAfterIndices).sort((a, b) => a - b),
        paragraphOrderStartIndices: getParagraphOrderStartIndices(),
        sourceOffsets,
        speakerNames,
        activeCameraId,
        paragraphOrder,
        paragraphs: getParagraphPayload(),
        wordCount: words.length
      };
    }

    async function saveProjectState({ manual = false } = {}) {
      if (!hasLoadedProjectState && !manual) return;
      const signature = selectedSignature();
      if (!manual && signature === lastSaveSignature) return;
      setSaveStatus('保存中', 'saving');
      try {
        const res = await fetch('/api/project-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(getProjectStatePayload())
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || '保存失败');
        lastSaveSignature = signature;
        const savedAt = data.state?.savedAt ? new Date(data.state.savedAt) : new Date();
        setSaveStatus(\`已保存 \${formatClock(savedAt)}\`, 'saved');
        if (manual) alert('项目状态已保存到当前审核目录。');
      } catch (err) {
        setSaveStatus('保存失败', 'error');
        if (manual) alert('保存项目失败: ' + err.message + '\\n\\n请确保使用 review_server.js 启动服务');
      }
    }

    function scheduleProjectSave() {
      if (!hasLoadedProjectState) return;
      setSaveStatus('有改动', 'dirty');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveProjectState(), 600);
    }

    async function saveProject() {
      await saveProjectState({ manual: true });
    }

    function safePlayBgm() {
      if (!selectedBgm || !bgmPlayer.src || player.paused) return;
      bgmPlayer.play().catch(() => {
        setSaveStatus('BGM 待播放', 'dirty');
      });
    }

    function pauseBgm() {
      bgmPlayer.pause();
    }

    function setSelectedBgm(fileName, { persist = true } = {}) {
      const track = bgmTracks.find(item => item.fileName === fileName);
      selectedBgm = track ? track.fileName : '';
      bgmSelect.value = selectedBgm;
      bgmSelect.title = track ? track.label : '选择 BGM';
      bgmPlayer.volume = BGM_VOLUME;

      if (!track) {
        bgmPlayer.pause();
        bgmPlayer.removeAttribute('src');
        bgmPlayer.load();
      } else if (!bgmPlayer.src.endsWith(track.url)) {
        bgmPlayer.src = track.url;
        bgmPlayer.load();
      }

      if (selectedBgm && !player.paused) safePlayBgm();
      if (persist) scheduleProjectSave();
      if (document.activeElement === bgmSelect) bgmSelect.blur();
    }

    function selectProjectTitleNameRange() {
      const node = paperTitle.firstChild;
      if (!node) return;
      const range = document.createRange();
      const prefixLength = '稿件：'.length;
      range.setStart(node, Math.min(prefixLength, node.textContent.length));
      range.setEnd(node, node.textContent.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }

    function startProjectTitleEdit() {
      paperTitle.contentEditable = 'true';
      paperTitle.focus();
      selectProjectTitleNameRange();
    }

    function cancelProjectTitleEdit() {
      paperTitle.contentEditable = 'false';
      renderProjectTitle();
      window.getSelection()?.removeAllRanges();
    }

    function commitProjectTitleEdit() {
      const nextTitle = normalizeProjectTitle(paperTitle.textContent);
      paperTitle.contentEditable = 'false';
      window.getSelection()?.removeAllRanges();
      if (nextTitle === projectTitle) {
        renderProjectTitle();
        return;
      }
      pushUndo();
      projectTitle = nextTitle;
      renderProjectTitle();
      scheduleProjectSave();
    }

    function restoreCurrentTime(time) {
      setGlobalTime(time);
    }

    async function loadProjectState() {
      try {
        const res = await fetch('/api/project-state');
        const data = await res.json();
        if (data.success && data.exists && Array.isArray(data.state?.selectedIndices)) {
          const validIndices = data.state.selectedIndices
            .map(i => Number(i))
            .filter(i => Number.isInteger(i) && i >= 0 && i < words.length);
          activeMainView = data.state.activeMainView === 'subtitle' ? 'subtitle' : 'article';
          subtitleBreakAfterIndices = new Set((data.state.subtitleBreakAfterIndices || [])
            .map(i => Number(i))
            .filter(i => Number.isInteger(i) && i >= 0 && i < words.length));
          subtitleMergedStartIndices = new Set((data.state.subtitleMergedStartIndices || [])
            .map(i => Number(i))
            .filter(i => Number.isInteger(i) && i >= 0 && i < words.length));
          manualParagraphBreakAfterIndices = new Set(normalizeIndexList(data.state.manualParagraphBreakAfterIndices));
          paragraphOrder = getParagraphOrderFromState(data.state);
          if (Number(data.state.playbackRate) > 0) {
            player.playbackRate = Number(data.state.playbackRate);
            const speed = document.getElementById('speed');
            if ([...speed.options].some(option => option.value === String(data.state.playbackRate))) {
              speed.value = String(data.state.playbackRate);
            }
          }
          setSelectedBgm(data.state.selectedBgm || '', { persist: false });
          projectTitle = normalizeProjectTitle(data.state.projectTitle || projectTitle);
          if (isMulticam) {
            sourceOffsets = { ...baseSourceOffsets, ...(data.state.sourceOffsets || {}) };
            speakerNames = { ...speakerNames, ...(data.state.speakerNames || {}) };
            activeCameraId = data.state.activeCameraId || activeCameraId;
            setActiveCamera(activeCameraId, { persist: false, keepGlobalTime: false });
            renderMulticamPanel();
          }
          renderProjectTitle();
          applyTextOverrides(data.state.textOverrides || {}, { persist: false });
          applySelectionSnapshot(validIndices, { persist: false });
          render();
          renderSubtitles();
          setActiveMainView(activeMainView, { persist: false });
          restoreCurrentTime(data.state.currentTime);
          hasLoadedProjectState = true;
          lastSaveSignature = selectedSignature();
          setSaveStatus('已恢复', 'saved');
          return;
        }
        hasLoadedProjectState = true;
        lastSaveSignature = selectedSignature();
        setSaveStatus('自动保存', 'saved');
      } catch (err) {
        hasLoadedProjectState = true;
        setSaveStatus('读取失败', 'error');
      }
    }

    // 格式化时间 (用于播放器显示)
    function formatTime(sec) {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return \`\${m.toString().padStart(2, '0')}:\${s.toString().padStart(2, '0')}\`;
    }

    function formatClock(date) {
      return \`\${date.getHours().toString().padStart(2, '0')}:\${date.getMinutes().toString().padStart(2, '0')}\`;
    }

    function formatDurationCompact(sec) {
      const safe = Math.max(0, Number(sec) || 0);
      const m = Math.floor(safe / 60);
      const s = Math.floor(safe % 60);
      return \`\${m.toString().padStart(2, '0')}:\${s.toString().padStart(2, '0')}\`;
    }

    function getWordText(index) {
      return Object.prototype.hasOwnProperty.call(textOverrides, index)
        ? textOverrides[index]
        : words[index]?.text || '';
    }

    function getSelectionDuration(sourceSet = selected) {
      let total = 0;
      sourceSet.forEach(i => {
        const word = words[i];
        if (word) total += Math.max(0, word.end - word.start);
      });
      return total;
    }

    function getFirstTimedIndex(items) {
      const found = items.find(item => words[item.index]);
      return found ? found.index : -1;
    }

    // 格式化时长 (用于剪辑结果显示，带秒数)
    function formatDuration(sec) {
      const totalSec = parseFloat(sec);
      const m = Math.floor(totalSec / 60);
      const s = (totalSec % 60).toFixed(1);
      if (m > 0) {
        return \`\${m}分\${s}秒 (\${totalSec}s)\`;
      }
      return \`\${s}秒\`;
    }

    function lookaheadText(startIndex, maxWords = 12) {
      let text = '';
      for (let i = startIndex; i < words.length && text.length < maxWords; i++) {
        if (!words[i].isGap) text += getWordText(i);
      }
      return text;
    }

    function isTopicStart(index) {
      const text = lookaheadText(index, 16);
      return /^第[一二三四五六七八九十0-9]+个?坑/.test(text)
        || /^第[一二三四五六七八九十0-9]+部分/.test(text)
        || /^大家好/.test(text);
    }

    function sentenceText(items) {
      return items
        .filter(item => item.type === 'word')
        .map(item => getWordText(item.index))
        .join('');
    }

    function inferPunctuation(items, explicitPunctuation = '') {
      if (explicitPunctuation) return explicitPunctuation;
      const text = sentenceText(items);
      if (!text) return '';
      if (/[吗呢么什么哪儿哪里为何为什么怎么回事]$/.test(text) || /^(有人问|你想想|你说|怎么办)/.test(text)) return '？';
      if (text.length <= 10 && /^第[一二三四五六七八九十0-9]+个?坑/.test(text)) return '。';
      return '。';
    }

    function isContiguousGap(prevIndex, nextIndex) {
      return prevIndex >= 0
        && nextIndex < words.length
        && words[prevIndex]?.isGap
        && words[nextIndex]?.isGap
        && Math.abs(words[nextIndex].start - words[prevIndex].end) < 0.05;
    }

    function getGapRun(index) {
      const indices = [index];
      let end = words[index].end;
      for (let i = index + 1; i < words.length && isContiguousGap(i - 1, i); i++) {
        indices.push(i);
        end = words[i].end;
      }
      return {
        indices,
        start: words[index].start,
        end,
        duration: end - words[index].start
      };
    }

    function getNextVisibleItemIndex(index) {
      for (let i = index + 1; i < words.length; i++) {
        if (!words[i]) continue;
        if (!words[i].isGap) return i;
        if (!isContiguousGap(i - 1, i) && words[i].end - words[i].start >= 0.2) return i;
      }
      return -1;
    }

    function canArticleBreakAfter(index) {
      return Number.isInteger(index) && index >= 0 && getNextVisibleItemIndex(index) >= 0;
    }

    function buildArticleBlocks(sourceWords, { includeManualParagraphBreaks = true } = {}) {
      const paragraphs = [];
      let paragraph = [];
      let sentence = [];

      function hasSentenceWords() {
        return sentence.some(item => item.type === 'word');
      }

      function closeSentence(punctuation = '') {
        if (!sentence.length) return;
        paragraph.push({
          type: 'sentence',
          items: sentence,
          punctuation: inferPunctuation(sentence, punctuation)
        });
        sentence = [];
      }

      function closeParagraph() {
        closeSentence();
        if (paragraph.length) paragraphs.push(paragraph);
        paragraph = [];
      }

      sourceWords.forEach((word, index) => {
        if (word.isGap) {
          const duration = word.end - word.start;
          if (duration >= 0.5 && hasSentenceWords()) {
            closeSentence(duration >= 1.1 ? '。' : '，');
          }
          sentence.push({ type: 'gap', index });
          if (duration >= 0.5) {
            closeSentence('');
          }
          if (duration >= 1.1 && paragraph.length) {
            closeParagraph();
          }
          if (includeManualParagraphBreaks && manualParagraphBreakAfterIndices.has(index)) {
            closeParagraph();
          }
          return;
        }

        if (hasSentenceWords() && paragraph.length && isTopicStart(index)) {
          closeParagraph();
        }

        sentence.push({ type: 'word', index });

        if (word.punctuationAfter) {
          closeSentence(word.punctuationAfter);
        }
        if (includeManualParagraphBreaks && manualParagraphBreakAfterIndices.has(index)) {
          closeParagraph();
        }
      });

      closeParagraph();
      return paragraphs;
    }

    function createSelectableElement(index, { primary = true } = {}) {
      const word = words[index];
      const el = document.createElement('span');
      el.className = word.isGap ? 'pause-chip' : 'token';
      let gapRun = null;
      if (!word.isGap && word.speakerId) {
        el.classList.add('has-speaker');
        el.dataset.speakerId = word.speakerId;
        el.style.setProperty('--speaker-color', getSpeakerColor(word.speakerId));
        el.title = getSpeakerLabel(word.speakerId);
      }

      if (selected.has(index)) el.classList.add('confirmed-delete');
      else if (autoSelected.has(index)) el.classList.add('ai-suggested');

      if (word.isGap) {
        const isContinuation = isContiguousGap(index - 1, index);
        if (isContinuation || word.end - word.start < 0.2) {
          el.classList.add('tiny-gap');
          el.textContent = '';
        } else {
          gapRun = getGapRun(index);
          el.textContent = \`⏸ \${gapRun.duration.toFixed(1)}s\`;
          el.title = \`静音 \${gapRun.duration.toFixed(1)} 秒\`;
        }
      } else {
        el.textContent = getWordText(index);
        if (Object.prototype.hasOwnProperty.call(textOverrides, index)) {
          el.classList.add('is-edited');
          if (!textOverrides[index]) el.classList.add('edited-empty');
        }
      }

      el.dataset.index = index;

      // 单击跳转播放
      el.onclick = event => {
        if (isCutMode) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (!isSelecting && !window.getSelection()?.toString()) {
          setGlobalTime(word.start);
        }
      };

      // 双击选中/取消
      el.ondblclick = event => {
        if (isCutMode) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (gapRun) toggleGroup(gapRun.indices);
        else toggle(index);
      };

      // Shift+拖动选择/取消
      el.onmousedown = (e) => {
        if (isCutMode) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (e.shiftKey) {
          isSelecting = true;
          selectStart = index;
          selectMode = selected.has(index) ? 'remove' : 'add';
          content.classList.add('is-dragging');
          subtitleContent.classList.add('is-dragging');
          setDragPreview(index);
          e.preventDefault();
        }
      };

      if (primary) elements[index] = el;
      return el;
    }

    function syncElementState(i) {
      document.querySelectorAll(\`[data-index="\${i}"]\`).forEach(el => {
        if (selected.has(i)) {
          el.classList.add('confirmed-delete');
          el.classList.remove('ai-suggested');
        } else {
          el.classList.remove('confirmed-delete');
          if (autoSelected.has(i)) el.classList.add('ai-suggested');
          else el.classList.remove('ai-suggested');
        }
        if (!words[i]?.isGap) {
          const hasOverride = Object.prototype.hasOwnProperty.call(textOverrides, i);
          el.textContent = getWordText(i);
          el.classList.toggle('is-edited', hasOverride);
          el.classList.toggle('edited-empty', hasOverride && !textOverrides[i]);
        }
      });
    }

    function snapshotSelection() {
      return Array.from(selected).sort((a, b) => a - b);
    }

    function snapshotEditState() {
      return {
        selectedIndices: snapshotSelection(),
        textOverrides: { ...textOverrides },
        projectTitle,
        subtitleBreakAfterIndices: Array.from(subtitleBreakAfterIndices).sort((a, b) => a - b),
        subtitleMergedStartIndices: Array.from(subtitleMergedStartIndices).sort((a, b) => a - b),
        manualParagraphBreakAfterIndices: Array.from(manualParagraphBreakAfterIndices).sort((a, b) => a - b),
        paragraphOrderStartIndices: getParagraphOrderStartIndices(),
        activeMainView,
        sourceOffsets: { ...sourceOffsets },
        speakerNames: { ...speakerNames },
        activeCameraId,
        paragraphOrder: paragraphOrder.slice()
      };
    }

    function editStatesEqual(a, b) {
      return JSON.stringify(a) === JSON.stringify(b);
    }

    function snapshotsEqual(a, b) {
      if (a.length !== b.length) return false;
      return a.every((value, index) => value === b[index]);
    }

    function pushUndo() {
      const snapshot = snapshotEditState();
      if (undoStack.length && editStatesEqual(undoStack[undoStack.length - 1], snapshot)) return;
      undoStack.push(snapshot);
      if (undoStack.length > 80) undoStack.shift();
      redoStack = [];
      updateUndoButtons();
    }

    function applyEditState(state, { persist = true } = {}) {
      selected.clear();
      (state?.selectedIndices || []).forEach(i => {
        if (Number.isInteger(i) && i >= 0 && i < words.length) selected.add(i);
      });

      textOverrides = {};
      if (state?.textOverrides && typeof state.textOverrides === 'object') {
        Object.entries(state.textOverrides).forEach(([key, value]) => {
          const index = Number(key);
          if (Number.isInteger(index) && index >= 0 && index < words.length && !words[index].isGap) {
            textOverrides[index] = String(value || '');
          }
        });
      }

      subtitleBreakAfterIndices = new Set((state?.subtitleBreakAfterIndices || [])
        .map(i => Number(i))
        .filter(i => Number.isInteger(i) && i >= 0 && i < words.length));
      subtitleMergedStartIndices = new Set((state?.subtitleMergedStartIndices || [])
        .map(i => Number(i))
        .filter(i => Number.isInteger(i) && i >= 0 && i < words.length));
      manualParagraphBreakAfterIndices = new Set(normalizeIndexList(state?.manualParagraphBreakAfterIndices));
      paragraphOrder = getParagraphOrderFromState(state);

      if (state?.activeMainView) {
        activeMainView = state.activeMainView === 'subtitle' ? 'subtitle' : 'article';
      }
      if (Object.prototype.hasOwnProperty.call(state || {}, 'projectTitle')) {
        projectTitle = normalizeProjectTitle(state.projectTitle);
        renderProjectTitle();
      }
      if (isMulticam) {
        sourceOffsets = { ...baseSourceOffsets, ...(state?.sourceOffsets || {}) };
        speakerNames = { ...speakerNames, ...(state?.speakerNames || {}) };
        activeCameraId = state?.activeCameraId || activeCameraId;
        setActiveCamera(activeCameraId, { persist: false });
        renderMulticamPanel();
      }

      words.forEach((_, i) => syncElementState(i));
      rebuildSkipIntervals();
      updateStats();
      render();
      setActiveMainView(activeMainView, { persist: false, pushHistory: false });
      updateUndoButtons();
      if (persist) scheduleProjectSave();
    }

    function applySelectionSnapshot(snapshot, { persist = true } = {}) {
      selected.clear();
      snapshot.forEach(i => selected.add(i));
      words.forEach((_, i) => syncElementState(i));
      rebuildSkipIntervals();
      updateStats();
      renderSubtitles();
      updateUndoButtons();
      if (persist) scheduleProjectSave();
    }

    function applyTextOverrides(overrides, { persist = true } = {}) {
      textOverrides = {};
      if (overrides && typeof overrides === 'object') {
        Object.entries(overrides).forEach(([key, value]) => {
          const index = Number(key);
          if (Number.isInteger(index) && index >= 0 && index < words.length && !words[index].isGap) {
            textOverrides[index] = String(value || '');
          }
        });
      }
      elements.forEach((_, i) => syncElementState(i));
      renderSubtitles();
      if (persist) scheduleProjectSave();
    }

    function undoSelection() {
      if (!undoStack.length) return;
      redoStack.push(snapshotEditState());
      applyEditState(undoStack.pop());
    }

    function redoSelection() {
      if (!redoStack.length) return;
      undoStack.push(snapshotEditState());
      applyEditState(redoStack.pop());
    }

    function updateUndoButtons() {
      document.querySelectorAll('.status-actions button')[0].disabled = undoStack.length === 0;
      document.querySelectorAll('.status-actions button')[1].disabled = redoStack.length === 0;
    }

    function scrollToIndex(index) {
      const el = elements[index];
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function isVisibleSubtitleItem(item) {
      const word = words[item.index];
      if (!word) return false;
      if (item.type === 'word' && !word.isGap) return true;
      if (item.type !== 'gap' || !word.isGap) return false;
      return !isContiguousGap(item.index - 1, item.index) && word.end - word.start >= 0.2;
    }

    function getSubtitleItemEnd(index) {
      const word = words[index];
      if (!word) return 0;
      if (word.isGap && !isContiguousGap(index - 1, index) && word.end - word.start >= 0.2) {
        return getGapRun(index).end;
      }
      return word.end;
    }

    function buildSubtitleRows() {
      const baseRows = [];
      const breakableIndices = new Set();
      const subtitleBlocks = buildArticleBlocks(words, { includeManualParagraphBreaks: false });

      subtitleBlocks.forEach((block, paragraphIndex) => {
        block.forEach((sentenceBlock, sentenceIndex) => {
          const displayItems = sentenceBlock.items.filter(isVisibleSubtitleItem);
          if (!displayItems.length) return;

          displayItems.slice(0, -1).forEach((item, index) => {
            const nextItem = displayItems[index + 1];
            if (nextItem?.type === 'word' && !words[nextItem.index]?.isGap) {
              breakableIndices.add(item.index);
            }
          });
          let currentItems = [];
          let splitIndex = 0;

          function closeRow({ punctuation = '' } = {}) {
            if (!currentItems.length) return;
            const first = currentItems[0].index;
            const last = currentItems[currentItems.length - 1].index;
            const start = Math.min(...currentItems.map(item => words[item.index].start));
            const end = Math.max(...currentItems.map(item => getSubtitleItemEnd(item.index)));
            baseRows.push({
              id: \`subtitle-\${paragraphIndex}-\${sentenceIndex}-\${splitIndex}\`,
              paragraphIndex,
              sentenceIndex,
              splitIndex,
              items: currentItems,
              punctuation,
              startIndex: first,
              endIndex: last,
              start,
              end
            });
            currentItems = [];
            splitIndex++;
          }

          displayItems.forEach(item => {
            currentItems.push(item);
            if (breakableIndices.has(item.index) && subtitleBreakAfterIndices.has(item.index)) {
              closeRow();
            }
          });

          closeRow({ punctuation: sentenceBlock.punctuation || '' });
        });
      });

      const rows = [];
      baseRows.forEach(row => {
        const previous = rows[rows.length - 1];
        if (previous && subtitleMergedStartIndices.has(row.startIndex)) {
          previous.id = \`\${previous.id}+\${row.id}\`;
          previous.items = previous.items.concat(row.items);
          previous.punctuation = row.punctuation;
          previous.endIndex = row.endIndex;
          previous.end = row.end;
          return;
        }
        rows.push({ ...row, items: row.items.slice() });
      });

      return { rows, breakableIndices };
    }

    let subtitleBreakableIndices = new Set();

    function getSubtitleRowText(row, { includeDeleted = true } = {}) {
      const text = row.items
        .filter(item => item.type === 'word' && !words[item.index]?.isGap)
        .filter(item => includeDeleted || !selected.has(item.index))
        .map(item => getWordText(item.index))
        .join('');
      return text ? text + (row.punctuation || '') : '';
    }

    function getSubtitleRowPlainText(row) {
      return row.items
        .filter(item => item.type === 'word' && !words[item.index]?.isGap)
        .filter(item => !selected.has(item.index))
        .map(item => getWordText(item.index))
        .join('');
    }

    function getSubtitleBadges(row) {
      const text = getSubtitleRowPlainText(row);
      if (!text) return [];
      const charCount = Array.from(text).length;
      const duration = Math.max(0, row.end - row.start);
      const badges = [];
      if (charCount > 13 || duration > 4.2) {
        badges.push({ label: '字幕过长', type: 'long' });
      } else if (charCount <= 4 || duration < 0.8) {
        badges.push({ label: '字幕过短', type: 'short' });
      }
      return badges;
    }

    function getSubtitleMergeAction(rowIndex) {
      if (rowIndex <= 0) return null;
      const row = subtitleRows[rowIndex];
      const previousRow = subtitleRows[rowIndex - 1];
      if (!row || !previousRow) return null;
      if (subtitleBreakAfterIndices.has(previousRow.endIndex)) {
        return { type: 'break', index: previousRow.endIndex };
      }
      if (Number.isInteger(row.startIndex) && row.startIndex >= 0) {
        return { type: 'merge', index: row.startIndex };
      }
      return null;
    }

    function createSubtitleMergeButton(rowIndex) {
      const action = getSubtitleMergeAction(rowIndex);
      const cell = document.createElement('div');
      cell.className = 'subtitle-merge-cell';
      if (!action) return cell;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'subtitle-merge-btn';
      button.textContent = '⇧';
      button.title = '与上一段合并';
      button.setAttribute('aria-label', '与上一段合并');
      button.onmousedown = event => {
        event.preventDefault();
        event.stopPropagation();
      };
      button.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        mergeSubtitleWithPrevious(action);
      };
      cell.appendChild(button);
      return cell;
    }

    function mergeSubtitleWithPrevious(action) {
      if (!action) return;
      pushUndo();
      if (action.type === 'break') {
        subtitleBreakAfterIndices.delete(action.index);
      } else {
        subtitleMergedStartIndices.add(action.index);
      }
      renderSubtitles();
      scheduleProjectSave();
    }

    function syncCutModeUi() {
      paperMain.classList.toggle('is-cut-mode', isCutMode);
      splitModeBtn.classList.toggle('active', isCutMode);
      splitModeBtn.setAttribute('aria-pressed', isCutMode ? 'true' : 'false');
      if (!isCutMode) {
        document.querySelectorAll('.article-break-slot.is-ready, .subtitle-break-slot.is-ready')
          .forEach(slot => slot.classList.remove('is-ready'));
      }
    }

    function setCutMode(enabled) {
      isCutMode = Boolean(enabled);
      if (isCutMode) {
        isSelecting = false;
        clearDragPreview();
        content.classList.remove('is-dragging');
        subtitleContent.classList.remove('is-dragging');
        window.getSelection()?.removeAllRanges();
        hideSelectionMenu();
      }
      syncCutModeUi();
    }

    function toggleCutMode() {
      setCutMode(!isCutMode);
    }

    function createBreakButton(index, { kind, active, label, onToggle }) {
      const slot = document.createElement('span');
      slot.className = kind + '-break-slot';
      slot.setAttribute('aria-hidden', 'false');
      const handleBreakClick = event => {
        if (!isCutMode) return;
        event.preventDefault();
        event.stopPropagation();
        onToggle(index);
      };
      slot.onmouseenter = () => {
        if (isCutMode) slot.classList.add('is-ready');
      };
      slot.onmouseleave = () => {
        slot.classList.remove('is-ready');
      };
      slot.onmousedown = event => {
        if (!isCutMode) return;
        event.preventDefault();
        event.stopPropagation();
      };
      slot.onclick = handleBreakClick;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = kind + '-break-toggle';
      button.dataset.label = label;
      button.setAttribute('aria-label', label);
      button.classList.toggle('active', active);
      button.onmousedown = event => {
        if (!isCutMode) return;
        event.preventDefault();
        event.stopPropagation();
      };
      button.onclick = handleBreakClick;
      slot.appendChild(button);
      return slot;
    }

    function createArticleBreakButton(index) {
      const isActiveBreak = manualParagraphBreakAfterIndices.has(index);
      return createBreakButton(index, {
        kind: 'article',
        active: isActiveBreak,
        label: isActiveBreak ? '取消分段' : '点击分段',
        onToggle: toggleArticleParagraphBreak
      });
    }

    function createSubtitleBreakButton(index) {
      const isActiveBreak = subtitleBreakAfterIndices.has(index);
      return createBreakButton(index, {
        kind: 'subtitle',
        active: isActiveBreak,
        label: isActiveBreak ? '取消分段' : '点击分段',
        onToggle: toggleSubtitleBreak
      });
    }

    function toggleArticleParagraphBreak(index) {
      if (!articleBreakableIndices.has(index)) return;
      pushUndo();
      if (manualParagraphBreakAfterIndices.has(index)) manualParagraphBreakAfterIndices.delete(index);
      else manualParagraphBreakAfterIndices.add(index);
      render();
      scheduleProjectSave();
    }

    function toggleSubtitleBreak(index) {
      if (!subtitleBreakableIndices.has(index)) return;
      pushUndo();
      if (subtitleBreakAfterIndices.has(index)) subtitleBreakAfterIndices.delete(index);
      else subtitleBreakAfterIndices.add(index);
      renderSubtitles();
      scheduleProjectSave();
    }

    function renderSubtitles() {
      const built = buildSubtitleRows();
      subtitleRows = built.rows;
      subtitleBreakableIndices = built.breakableIndices;
      subtitleContent.innerHTML = '';
      subtitleRowElements = [];

      subtitleRows.forEach((row, rowIndex) => {
        const visibleText = getSubtitleRowText(row, { includeDeleted: false });
        const mergeAction = getSubtitleMergeAction(rowIndex);
        const badges = getSubtitleBadges(row);
        const rowEl = document.createElement('div');
        rowEl.className = 'subtitle-row';
        rowEl.dataset.rowIndex = rowIndex;
        rowEl.classList.toggle('is-empty', !visibleText);
        rowEl.classList.toggle('is-mergeable', !!mergeAction);
        rowEl.onclick = event => {
          if (isCutMode) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (event.target.closest('button')) return;
          setGlobalTime(row.start);
          updateActiveSubtitleRow(getGlobalTime() || row.start);
        };

        const indexEl = document.createElement('div');
        indexEl.className = 'subtitle-index';
        indexEl.textContent = String(rowIndex + 1).padStart(2, '0');

        const timeEl = document.createElement('div');
        timeEl.className = 'subtitle-time';
        timeEl.textContent = \`\${formatTime(row.start)} → \${formatTime(row.end)}\`;

        const mergeEl = createSubtitleMergeButton(rowIndex);

        const lineEl = document.createElement('div');
        lineEl.className = 'subtitle-line';

        let previousSpeakerId = null;
        row.items.forEach(item => {
          const itemSpeakerId = words[item.index]?.speakerId || null;
          if (isMulticam && itemSpeakerId && itemSpeakerId !== previousSpeakerId) {
            lineEl.appendChild(createSpeakerPill(itemSpeakerId));
          }
          lineEl.appendChild(createSelectableElement(item.index, { primary: false }));
          if (subtitleBreakableIndices.has(item.index)) {
            lineEl.appendChild(createSubtitleBreakButton(item.index));
          }
          if (itemSpeakerId) previousSpeakerId = itemSpeakerId;
        });
        if (row.punctuation) {
          const punctuationEl = document.createElement('span');
          punctuationEl.className = 'punctuation';
          punctuationEl.textContent = row.punctuation;
          lineEl.appendChild(punctuationEl);
        }
        const badgesEl = document.createElement('div');
        badgesEl.className = 'subtitle-badges';
        badges.forEach(badge => {
          const badgeEl = document.createElement('span');
          badgeEl.className = \`subtitle-badge is-\${badge.type}\`;
          badgeEl.textContent = badge.label;
          badgesEl.appendChild(badgeEl);
        });
        rowEl.appendChild(indexEl);
        rowEl.appendChild(timeEl);
        rowEl.appendChild(mergeEl);
        rowEl.appendChild(lineEl);
        rowEl.appendChild(badgesEl);
        subtitleContent.appendChild(rowEl);
        subtitleRowElements.push(rowEl);
      });

      updateActiveSubtitleRow(getGlobalTime() || 0, { scroll: false });
    }

    function updateActiveSubtitleRow(time, { scroll = true } = {}) {
      if (!subtitleRows.length) return;
      let activeIndex = -1;
      for (let i = 0; i < subtitleRows.length; i++) {
        const row = subtitleRows[i];
        if (time >= row.start && time < row.end) {
          activeIndex = i;
          break;
        }
        if (row.start <= time) activeIndex = i;
      }
      subtitleRowElements.forEach((el, index) => {
        const isActive = index === activeIndex;
        el.classList.toggle('active', isActive);
        if (scroll && isActive && activeMainView === 'subtitle') {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    }

    function getElementCenterDistance(el, centerY) {
      const rect = el.getBoundingClientRect();
      return Math.abs(rect.top + rect.height / 2 - centerY);
    }

    function getVisibleElementsNearCenter(selector, root) {
      const paperRect = paperMain.getBoundingClientRect();
      const centerY = paperRect.top + paperRect.height / 2;
      return Array.from(root.querySelectorAll(selector))
        .map(el => ({ el, rect: el.getBoundingClientRect() }))
        .filter(item => item.rect.height > 0 && item.rect.bottom >= paperRect.top && item.rect.top <= paperRect.bottom)
        .sort((a, b) => getElementCenterDistance(a.el, centerY) - getElementCenterDistance(b.el, centerY))
        .map(item => item.el);
    }

    function getReadingAnchorIndex() {
      if (activeMainView === 'subtitle') {
        const row = getVisibleElementsNearCenter('.subtitle-row', subtitleContent)[0];
        if (row) {
          const rowIndex = Number(row.dataset.rowIndex);
          const subtitleRow = subtitleRows[rowIndex];
          if (subtitleRow && Number.isInteger(subtitleRow.startIndex)) return subtitleRow.startIndex;
        }
      } else {
        const sentence = getVisibleElementsNearCenter('.article-sentence', content)[0];
        if (sentence) {
          const startIndex = Number(sentence.dataset.startIndex);
          if (Number.isInteger(startIndex)) return startIndex;
        }
      }

      const root = activeMainView === 'subtitle' ? subtitleContent : content;
      const token = getVisibleElementsNearCenter('[data-index]', root)[0];
      if (!token) return null;
      const index = Number(token.dataset.index);
      return Number.isInteger(index) ? index : null;
    }

    function findSubtitleRowByIndex(index) {
      if (!Number.isInteger(index) || !subtitleRows.length) return -1;
      let nearestIndex = -1;
      let nearestDistance = Infinity;
      for (let i = 0; i < subtitleRows.length; i++) {
        const row = subtitleRows[i];
        if (row.items.some(item => item.index === index) || (index >= row.startIndex && index <= row.endIndex)) return i;
        const distance = Math.min(Math.abs(index - row.startIndex), Math.abs(index - row.endIndex));
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = i;
        }
      }
      return nearestIndex;
    }

    function findArticleElementByIndex(index) {
      if (!Number.isInteger(index)) return null;
      if (elements[index]) return elements[index];
      const direct = content.querySelector(\`[data-index="\${index}"]\`);
      if (direct) return direct;
      for (let offset = 1; offset < words.length; offset++) {
        const previous = index - offset;
        const next = index + offset;
        if (previous >= 0 && elements[previous]) return elements[previous];
        if (next < words.length && elements[next]) return elements[next];
      }
      return null;
    }

    function scrollViewToAnchorIndex(index, view) {
      if (!Number.isInteger(index)) return false;
      let target = null;
      if (view === 'subtitle') {
        const rowIndex = findSubtitleRowByIndex(index);
        target = rowIndex >= 0 ? subtitleRowElements[rowIndex] : null;
      } else {
        target = findArticleElementByIndex(index);
      }
      if (!target) return false;
      target.scrollIntoView({ behavior: 'auto', block: 'center' });
      return true;
    }

    function setActiveMainView(view, { persist = true, pushHistory = false, preserveReadingAnchor = pushHistory } = {}) {
      const nextView = view === 'subtitle' ? 'subtitle' : 'article';
      const previousView = activeMainView;
      const anchorIndex = preserveReadingAnchor && nextView !== previousView ? getReadingAnchorIndex() : null;
      if (pushHistory && nextView !== activeMainView) pushUndo();
      activeMainView = nextView;
      content.classList.toggle('is-hidden', activeMainView !== 'article');
      subtitleContent.classList.toggle('is-hidden', activeMainView !== 'subtitle');
      viewSwitch.querySelectorAll('button').forEach(button => {
        const isActive = button.dataset.view === activeMainView;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
      });
      if (activeMainView === 'subtitle') updateActiveSubtitleRow(getGlobalTime() || 0, { scroll: false });
      if (anchorIndex != null) {
        requestAnimationFrame(() => scrollViewToAnchorIndex(anchorIndex, activeMainView));
      }
      if (persist) scheduleProjectSave();
    }

    function buildSubtitleCuePayload() {
      if (!subtitleRows.length) renderSubtitles();
      return subtitleRows.map(row => {
        const cueWords = row.items
          .filter(item => item.type === 'word' && words[item.index] && !words[item.index].isGap && !selected.has(item.index) && getWordText(item.index))
          .map(item => ({
            index: item.index,
            start: words[item.index].start,
            end: words[item.index].end,
            text: getWordText(item.index)
          }));
        if (!cueWords.length) return null;
        const text = cueWords.map(item => item.text).join('');
        return {
          start: cueWords[0].start,
          end: cueWords[cueWords.length - 1].end,
          text,
          words: cueWords
        };
      }).filter(Boolean);
    }

    function createSpeakerPill(speakerId) {
      const pill = document.createElement('span');
      pill.className = 'speaker-pill';
      pill.style.setProperty('--speaker-color', getSpeakerColor(speakerId));
      pill.textContent = getSpeakerLabel(speakerId);
      return pill;
    }

    function buildParagraphEntriesFromBlocks(blocks) {
      return blocks.map((block, index) => {
        const items = block.flatMap(sentenceBlock => sentenceBlock.items);
        const startIndex = getFirstTimedIndex(items);
        const timedItems = items.map(item => words[item.index]).filter(Boolean);
        const start = timedItems.length ? Math.min(...timedItems.map(word => word.start)) : 0;
        const end = timedItems.length ? Math.max(...timedItems.map(word => word.end)) : start;
        return {
          id: startIndex >= 0 ? 'p-' + startIndex : 'p-empty-' + index,
          block,
          startIndex,
          start,
          end
        };
      });
    }

    function orderParagraphEntries(entries) {
      const entryMap = new Map(entries.map(entry => [entry.id, entry]));
      const ordered = [];
      const seen = new Set();
      paragraphOrder.forEach(id => {
        const entry = entryMap.get(String(id));
        if (!entry || seen.has(entry.id)) return;
        ordered.push(entry);
        seen.add(entry.id);
      });
      entries.forEach(entry => {
        if (seen.has(entry.id)) return;
        ordered.push(entry);
        seen.add(entry.id);
      });
      paragraphOrder = ordered.map(entry => entry.id);
      return ordered;
    }

    function getParagraphPayload() {
      return paragraphEntries.map(entry => ({
        id: entry.id,
        start: entry.start,
        end: entry.end,
        startIndex: entry.startIndex
      }));
    }

    function createParagraphTools(entry, index, total) {
      const tools = document.createElement('span');
      tools.className = 'paragraph-tools';
      const up = document.createElement('button');
      up.type = 'button';
      up.textContent = '↑';
      up.title = '上移段落';
      up.disabled = index === 0;
      up.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        moveParagraph(entry.id, -1);
      };
      const down = document.createElement('button');
      down.type = 'button';
      down.textContent = '↓';
      down.title = '下移段落';
      down.disabled = index === total - 1;
      down.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        moveParagraph(entry.id, 1);
      };
      tools.appendChild(up);
      tools.appendChild(down);
      return tools;
    }

    function clearParagraphDropTargets() {
      document.querySelectorAll('.article-paragraph.is-drop-target, .article-paragraph.is-dragging')
        .forEach(el => el.classList.remove('is-drop-target', 'is-dragging'));
    }

    function createParagraphHandle(entry) {
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'paragraph-handle';
      handle.textContent = '↕';
      handle.title = '拖动段落排序';
      handle.setAttribute('aria-label', '拖动段落排序');
      handle.draggable = true;
      handle.onmousedown = event => {
        event.stopPropagation();
      };
      handle.ondragstart = event => {
        draggingParagraphStartIndex = entry.id;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', entry.id);
        handle.closest('.article-paragraph')?.classList.add('is-dragging');
        setCutMode(false);
      };
      handle.ondragend = () => {
        draggingParagraphStartIndex = null;
        clearParagraphDropTargets();
      };
      return handle;
    }

    function moveParagraph(paragraphId, direction) {
      const from = paragraphOrder.indexOf(paragraphId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= paragraphOrder.length) return;
      pushUndo();
      const nextOrder = paragraphOrder.slice();
      const [item] = nextOrder.splice(from, 1);
      nextOrder.splice(to, 0, item);
      paragraphOrder = nextOrder;
      render();
      scheduleProjectSave();
    }

    function moveParagraphBefore(paragraphId, targetParagraphId) {
      if (!paragraphId || !targetParagraphId || paragraphId === targetParagraphId) return;
      const from = paragraphOrder.indexOf(paragraphId);
      const target = paragraphOrder.indexOf(targetParagraphId);
      if (from < 0 || target < 0) return;
      pushUndo();
      const nextOrder = paragraphOrder.slice();
      const [item] = nextOrder.splice(from, 1);
      const nextTarget = nextOrder.indexOf(targetParagraphId);
      nextOrder.splice(nextTarget, 0, item);
      paragraphOrder = nextOrder;
      render();
      scheduleProjectSave();
    }

    // 渲染内容
    function render() {
      content.innerHTML = '';
      elements = [];
      paragraphStartIndices = [];
      sentenceStartIndices = [];

      const rawEntries = buildParagraphEntriesFromBlocks(buildArticleBlocks(words));
      paragraphEntries = orderParagraphEntries(rawEntries);
      articleBlocks = paragraphEntries.map(entry => entry.block);
      articleBreakableIndices = new Set(words.map((_, index) => index).filter(canArticleBreakAfter));
      paragraphEntries.forEach((entry, paragraphIndex) => {
        const block = entry.block;
        const paragraphEl = document.createElement('p');
        paragraphEl.className = 'article-paragraph';
        paragraphEl.dataset.paragraphId = entry.id;
        paragraphEl.appendChild(createParagraphHandle(entry));
        paragraphEl.ondragover = event => {
          if (!draggingParagraphStartIndex || draggingParagraphStartIndex === entry.id) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          clearParagraphDropTargets();
          paragraphEl.classList.add('is-drop-target');
        };
        paragraphEl.ondragleave = () => {
          paragraphEl.classList.remove('is-drop-target');
        };
        paragraphEl.ondrop = event => {
          if (!draggingParagraphStartIndex) return;
          event.preventDefault();
          const sourceId = event.dataTransfer.getData('text/plain') || draggingParagraphStartIndex;
          clearParagraphDropTargets();
          moveParagraphBefore(sourceId, entry.id);
        };
        const paragraphItems = block.flatMap(sentenceBlock => sentenceBlock.items);
        const startIndex = getFirstTimedIndex(paragraphItems);
        paragraphStartIndices.push(startIndex);
        if (startIndex >= 0) paragraphEl.dataset.startIndex = startIndex;
        if (isMulticam) paragraphEl.appendChild(createParagraphTools(entry, paragraphIndex, paragraphEntries.length));

        let previousSpeakerId = null;
        block.forEach(sentenceBlock => {
          const sentenceEl = document.createElement('span');
          sentenceEl.className = 'article-sentence';
          const sentenceStartIndex = getFirstTimedIndex(sentenceBlock.items);
          if (sentenceStartIndex >= 0) {
            sentenceStartIndices.push(sentenceStartIndex);
            sentenceEl.dataset.startIndex = sentenceStartIndex;
          }

          sentenceBlock.items.forEach(item => {
            const itemSpeakerId = words[item.index]?.speakerId || null;
            if (isMulticam && itemSpeakerId && itemSpeakerId !== previousSpeakerId) {
              sentenceEl.appendChild(createSpeakerPill(itemSpeakerId));
            }
            sentenceEl.appendChild(createSelectableElement(item.index));
            if (articleBreakableIndices.has(item.index)) {
              sentenceEl.appendChild(createArticleBreakButton(item.index));
            }
            if (itemSpeakerId) previousSpeakerId = itemSpeakerId;
          });

          if (sentenceBlock.punctuation) {
            const punctuationEl = document.createElement('span');
            punctuationEl.className = 'punctuation';
            punctuationEl.textContent = sentenceBlock.punctuation;
            sentenceEl.appendChild(punctuationEl);
          }

          paragraphEl.appendChild(sentenceEl);
        });

        content.appendChild(paragraphEl);
      });

      renderSubtitles();
      setActiveMainView(activeMainView, { persist: false });
      renderDailyQuote();
      renderMulticamPanel();
      syncCutModeUi();
      updateStats();
      updateUndoButtons();
    }

    viewSwitch.querySelectorAll('button').forEach(button => {
      button.addEventListener('click', () => {
        setActiveMainView(button.dataset.view || 'article', { pushHistory: true });
      });
    });

    function clearDragPreview() {
      dragPreviewSet.forEach(i => {
        document.querySelectorAll(\`[data-index="\${i}"]\`).forEach(el => {
          el.classList.remove('drag-preview', 'drag-remove-preview');
        });
      });
      dragPreviewSet.clear();
    }

    function setDragPreview(endIndex) {
      clearDragPreview();
      const min = Math.min(selectStart, endIndex);
      const max = Math.max(selectStart, endIndex);
      for (let j = min; j <= max; j++) {
        if (!words[j]) continue;
        dragPreviewSet.add(j);
        document.querySelectorAll(\`[data-index="\${j}"]\`).forEach(el => {
          el.classList.remove('drag-preview', 'drag-remove-preview');
          el.classList.add(selectMode === 'remove' ? 'drag-remove-preview' : 'drag-preview');
        });
      }
    }

    function commitDragPreview() {
      if (!dragPreviewSet.size) return;
      pushUndo();
      dragPreviewSet.forEach(i => {
        if (selectMode === 'add') selected.add(i);
        else selected.delete(i);
      });
      const committed = Array.from(dragPreviewSet);
      clearDragPreview();
      committed.forEach(i => syncElementState(i));
      rebuildSkipIntervals();
      updateStats();
      renderSubtitles();
      scheduleProjectSave();
    }

    function hideSelectionMenu() {
      selectionMenu.classList.remove('is-visible');
      activeSelectionIndices = [];
    }

    function getSelectionIndices() {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return [];
      const range = selection.getRangeAt(0);
      const indices = [];
      document.querySelectorAll('[data-index]').forEach(el => {
        const index = Number(el.dataset.index);
        if (!Number.isInteger(index) || indices.includes(index)) return;
        if (!el) return;
        try {
          if (range.intersectsNode(el)) indices.push(index);
        } catch (err) {
          // Some browser range edge cases can throw for detached nodes.
        }
      });
      return indices;
    }

    function getSelectionPlainText(indices = activeSelectionIndices) {
      return indices
        .filter(i => words[i] && !words[i].isGap)
        .map(i => getWordText(i))
        .join('');
    }

    function showSelectionMenuFromCurrentSelection() {
      if (isCutMode || isSelecting) {
        hideSelectionMenu();
        return;
      }
      const selection = window.getSelection();
      const indices = getSelectionIndices();
      if (!selection || !indices.length) {
        hideSelectionMenu();
        return;
      }
      activeSelectionIndices = indices;
      const allSelected = indices.every(i => selected.has(i));
      selectionToggleBtn.textContent = allSelected ? '取消删除' : '标记删除';
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const menuWidth = 190;
      const top = Math.max(10, rect.top - 44);
      const left = Math.min(window.innerWidth - menuWidth - 10, Math.max(10, rect.left + rect.width / 2 - menuWidth / 2));
      selectionMenu.style.top = \`\${top}px\`;
      selectionMenu.style.left = \`\${left}px\`;
      selectionMenu.classList.add('is-visible');
    }

    function toggleSelectionMenuDelete() {
      if (!activeSelectionIndices.length) return;
      const shouldRemove = activeSelectionIndices.every(i => selected.has(i));
      pushUndo();
      activeSelectionIndices.forEach(i => {
        if (shouldRemove) selected.delete(i);
        else selected.add(i);
        syncElementState(i);
      });
      rebuildSkipIntervals();
      updateStats();
      renderSubtitles();
      scheduleProjectSave();
      window.getSelection()?.removeAllRanges();
      hideSelectionMenu();
    }

    async function copySelectionText() {
      const text = getSelectionPlainText();
      if (!text) return;
      await navigator.clipboard.writeText(text);
      setSaveStatus('已复制', 'saved');
      hideSelectionMenu();
    }

    async function addTermsToDictionary(text) {
      const res = await fetch('/api/dictionary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terms: text })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '词库写入失败');
      return data;
    }

    async function editSelectionText() {
      const wordIndices = activeSelectionIndices.filter(i => words[i] && !words[i].isGap);
      if (!wordIndices.length) return;
      const oldText = getSelectionPlainText(wordIndices);
      const nextText = prompt('请输入正确文案 / 词汇。多个词可用逗号或换行分隔加入词库。', oldText);
      if (nextText === null) return;
      const value = nextText.trim();
      if (!value) return;
      pushUndo();
      wordIndices.forEach((index, position) => {
        textOverrides[index] = position === 0 ? value : '';
      });
      wordIndices.forEach(i => syncElementState(i));
      renderSubtitles();
      scheduleProjectSave();
      try {
        const result = await addTermsToDictionary(value);
        setSaveStatus(result.added?.length ? '词库已更新' : '词库已存在', 'saved');
      } catch (err) {
        setSaveStatus('词库失败', 'error');
        alert('文稿已修改，但词库写入失败: ' + err.message);
      }
      window.getSelection()?.removeAllRanges();
      hideSelectionMenu();
    }

    // Shift+拖动多选/取消
    function handleSelectionMousemove(e) {
      if (isCutMode || !isSelecting) return;
      const target = e.target.closest('[data-index]');
      if (!target) return;

      const i = parseInt(target.dataset.index);
      setDragPreview(i);
    }

    content.addEventListener('mousemove', handleSelectionMousemove);
    subtitleContent.addEventListener('mousemove', handleSelectionMousemove);

    document.addEventListener('mouseup', () => {
      if (isCutMode) {
        isSelecting = false;
        clearDragPreview();
        content.classList.remove('is-dragging');
        subtitleContent.classList.remove('is-dragging');
        window.getSelection()?.removeAllRanges();
        hideSelectionMenu();
        return;
      }
      if (isSelecting) commitDragPreview();
      isSelecting = false;
      content.classList.remove('is-dragging');
      subtitleContent.classList.remove('is-dragging');
      setTimeout(showSelectionMenuFromCurrentSelection, 0);
    });

    document.addEventListener('mousedown', e => {
      if (isCutMode) {
        hideSelectionMenu();
        if (!e.target.closest('.article-break-slot, .subtitle-break-slot, #splitModeBtn')) {
          window.getSelection()?.removeAllRanges();
        }
        return;
      }
      if (selectionMenu.contains(e.target) || content.contains(e.target) || subtitleContent.contains(e.target)) return;
      hideSelectionMenu();
    });

    function toggle(i) {
      pushUndo();
      if (selected.has(i)) {
        selected.delete(i);
      } else {
        selected.add(i);
      }
      syncElementState(i);
      rebuildSkipIntervals();
      updateStats();
      renderSubtitles();
      scheduleProjectSave();
    }

    function toggleGroup(indices) {
      pushUndo();
      const shouldSelect = indices.some(i => !selected.has(i));
      indices.forEach(i => {
        if (shouldSelect) selected.add(i);
        else selected.delete(i);
        syncElementState(i);
      });
      rebuildSkipIntervals();
      updateStats();
      renderSubtitles();
      scheduleProjectSave();
    }

    function updateStats() {
      const count = selected.size;
      const totalDuration = getSelectionDuration(selected);
      const currentText = formatDurationCompact(getGlobalTime() || 0);
      statsDiv.innerHTML = \`
        <div class="stat-row"><span>已确认删除</span><span class="stat-value">\${count} 个 / \${totalDuration.toFixed(2)}s</span></div>
        <div class="stat-row"><span>AI 预选</span><span class="stat-value">\${autoSelected.size} 个 / \${aiDuration.toFixed(2)}s</span></div>
        <div class="stat-row"><span>当前播放</span><span class="stat-value">\${currentText}</span></div>
      \`;
      bottomSelectedDuration.textContent = formatDurationCompact(totalDuration);
      bottomDeleted.textContent = \`\${count} / \${totalDuration.toFixed(2)}s\`;
      bottomAi.textContent = \`\${autoSelected.size} / \${aiDuration.toFixed(2)}s\`;
    }

    // Web Audio API：采样级精度静音（~3ms vs player.muted 的 ~50ms）
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaElementSource(player);
    const gainNode = audioCtx.createGain();
    source.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    player.addEventListener('play', () => {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      safePlayBgm();
    });
    player.addEventListener('pause', () => {
      pauseBgm();
      scheduleProjectSave();
    });
    player.addEventListener('ended', pauseBgm);
    player.addEventListener('loadedmetadata', () => {
      if (pendingRestoreTime != null) {
        setGlobalTime(pendingRestoreTime);
        pendingRestoreTime = null;
      }
      updateStats();
    });
    player.addEventListener('ratechange', () => scheduleProjectSave());

    // 预计算跳过区间（selected 变化时重建）
    let skipIntervals = [];
    function rebuildSkipIntervals() {
      const sorted = Array.from(selected).sort((a, b) => a - b);
      skipIntervals = [];
      let i = 0;
      while (i < sorted.length) {
        let start = words[sorted[i]].start;
        let end = words[sorted[i]].end;
        let j = i + 1;
        while (j < sorted.length && words[sorted[j]].start - end < 0.1) {
          end = words[sorted[j]].end;
          j++;
        }
        skipIntervals.push({ start: start - 0.05, end });
        i = j;
      }
    }
    rebuildSkipIntervals();

    // rAF 高频轮询 + Web Audio API 采样级静音
    let lastHighlight = -1;
    let skipLock = false;
    function tick() {
      requestAnimationFrame(tick);
      const t = getGlobalTime();

      if (!player.paused) {
        for (const iv of skipIntervals) {
          if (t >= iv.start && t < iv.end) {
            if (!skipLock) {
              skipLock = true;
              gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
              setGlobalTime(iv.end);
            }
            return;
          }
        }
        if (skipLock) {
          skipLock = false;
          gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
        }
      }

      timeDisplay.textContent = \`\${formatTime(t)} / \${formatTime(player.duration || 0)}\`;
      bottomCurrent.textContent = formatDurationCompact(t);

      // 高亮当前词（用二分查找提速）
      let curr = -1;
      for (let i = 0; i < words.length; i++) {
        if (t >= words[i].start && t < words[i].end) { curr = i; break; }
      }
      if (curr !== lastHighlight) {
        if (lastHighlight >= 0) {
          document.querySelectorAll(\`[data-index="\${lastHighlight}"]\`).forEach(el => {
            el.classList.remove('is-current');
          });
        }
        if (curr >= 0) {
          document.querySelectorAll(\`[data-index="\${curr}"]\`).forEach(el => {
            el.classList.add('is-current');
          });
          if (activeMainView === 'article' && elements[curr]) {
            elements[curr].scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
        currentIndex = curr;
        updateActiveSubtitleRow(t);
        lastHighlight = curr;
      }
    }
    requestAnimationFrame(tick);

    function getSelectedSegments() {
      const segments = [];
      const sortedSelected = Array.from(selected).sort((a, b) => a - b);

      sortedSelected.forEach(i => {
        const word = words[i];
        segments.push({ start: word.start, end: word.end });
      });

      return segments;
    }

    function mergeTimeSegments(segments, mergeGap = 0.05) {
      const merged = [];
      segments
        .map(seg => ({ start: Number(seg.start), end: Number(seg.end) }))
        .filter(seg => Number.isFinite(seg.start) && Number.isFinite(seg.end) && seg.end > seg.start)
        .sort((a, b) => a.start - b.start)
        .forEach(seg => {
          const last = merged[merged.length - 1];
          if (last && seg.start <= last.end + mergeGap) last.end = Math.max(last.end, seg.end);
          else merged.push({ ...seg });
        });
      return merged;
    }

    function subtractSegments(range, deleteSegments) {
      let parts = [{ start: range.start, end: range.end }];
      deleteSegments.forEach(del => {
        const next = [];
        parts.forEach(part => {
          if (del.end <= part.start || del.start >= part.end) {
            next.push(part);
            return;
          }
          if (del.start > part.start) next.push({ start: part.start, end: Math.min(del.start, part.end) });
          if (del.end < part.end) next.push({ start: Math.max(del.end, part.start), end: part.end });
        });
        parts = next;
      });
      return parts.filter(part => part.end - part.start > 0.001);
    }

    function getOrderedTimelineRanges() {
      if (!hasParagraphOrderChanged()) return [];
      if (!paragraphEntries.length) render();
      const deleteSegments = mergeTimeSegments(getSelectedSegments(), 0.1);
      const ranges = [];
      paragraphEntries.forEach(entry => {
        if (!Number.isFinite(entry.start) || !Number.isFinite(entry.end) || entry.end <= entry.start) return;
        subtractSegments({ start: entry.start, end: entry.end }, deleteSegments).forEach(part => ranges.push(part));
      });
      return ranges;
    }

    function hasParagraphOrderChanged() {
      const starts = getParagraphOrderStartIndices();
      for (let i = 1; i < starts.length; i++) {
        if (starts[i] < starts[i - 1]) return true;
      }
      return false;
    }

    function copyDeleteList() {
      const segments = getSelectedSegments();

      // 合并相邻片段
      const merged = [];
      for (const seg of segments) {
        if (merged.length === 0) {
          merged.push({ ...seg });
        } else {
          const last = merged[merged.length - 1];
          if (Math.abs(seg.start - last.end) < 0.05) {
            last.end = seg.end;
          } else {
            merged.push({ ...seg });
          }
        }
      }

      const json = JSON.stringify(merged, null, 2);
      navigator.clipboard.writeText(json).then(() => {
        alert('已复制 ' + merged.length + ' 个删除片段到剪贴板');
      });
    }

    async function exportFinalCutXML() {
      const segments = getSelectedSegments();
      const orderedTimelineRanges = getOrderedTimelineRanges();
      if (segments.length === 0) {
        alert('当前没有选择删除片段，将导出完整视频时间线。');
      }

      try {
        const res = await fetch('/api/export-finalcut-xml', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            segments,
            orderedTimelineRanges,
            chooseDirectory: true,
            mode: isMulticam ? 'multicam' : 'single',
            projectTitle,
            sourceOffsets,
            speakerNames,
            activeCameraId,
            paragraphOrder,
            paragraphs: getParagraphPayload()
          })
        });
        const data = await res.json();

        if (data.success) {
          const fileName = data.outputName || 'videocut_roughcut.fcpxml';
          const xmlBlob = new Blob([data.xml], { type: 'application/xml' });
          let savedByPicker = Boolean(data.output);

          if (!savedByPicker && window.showSaveFilePicker) {
            try {
              const handle = await window.showSaveFilePicker({
                suggestedName: fileName,
                types: [{
                  description: 'Final Cut Pro XML',
                  accept: { 'application/xml': ['.fcpxml', '.xml'] }
                }]
              });
              const writable = await handle.createWritable();
              await writable.write(xmlBlob);
              await writable.close();
              savedByPicker = true;
            } catch (saveErr) {
              if (saveErr.name === 'AbortError') return;
              console.warn('保存对话框失败，改用下载:', saveErr);
            }
          }

          if (!savedByPicker) {
            const url = URL.createObjectURL(xmlBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          }

          alert(\`✅ Final Cut XML 已导出！

📁 文件名: \${fileName}
📂 保存位置: \${data.output || '浏览器下载目录'}
🎞️ 保留片段: \${data.keepClips}
⏱️ 时间线时长: \${formatDuration(data.timelineDuration)}

在 Final Cut Pro 中使用“文件 > 导入 > XML...”导入。
\${savedByPicker ? '' : '\\n当前浏览器未提供保存目录选择，已改用普通下载。'}\`);
        } else {
          alert('❌ 导出失败: ' + data.error);
        }
      } catch (err) {
        alert('❌ 请求失败: ' + err.message + '\\n\\n请确保使用 review_server.js 启动服务');
      }
    }

    async function exportSRT() {
      const segments = getSelectedSegments();
      const orderedTimelineRanges = getOrderedTimelineRanges();
      const subtitles = buildSubtitleCuePayload();
      if (!subtitles.length) {
        alert('当前没有可导出的字幕。');
        return;
      }
      if (segments.length === 0) {
        alert('当前没有选择删除片段，将导出完整视频时间线的 SRT。');
      }

      try {
        const res = await fetch('/api/export-srt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            segments,
            subtitles,
            orderedTimelineRanges,
            chooseDirectory: true,
            mode: isMulticam ? 'multicam' : 'single',
            paragraphOrder,
            paragraphs: getParagraphPayload()
          })
        });
        const data = await res.json();

        if (data.success) {
          const fileName = data.outputName || 'videocut_roughcut.srt';
          const srtBlob = new Blob([data.srt], { type: 'text/plain;charset=utf-8' });
          let savedByPicker = Boolean(data.output);

          if (!savedByPicker && window.showSaveFilePicker) {
            try {
              const handle = await window.showSaveFilePicker({
                suggestedName: fileName,
                types: [{
                  description: 'SRT 字幕',
                  accept: { 'text/plain': ['.srt'] }
                }]
              });
              const writable = await handle.createWritable();
              await writable.write(srtBlob);
              await writable.close();
              savedByPicker = true;
            } catch (saveErr) {
              if (saveErr.name === 'AbortError') return;
              console.warn('保存对话框失败，改用下载:', saveErr);
            }
          }

          if (!savedByPicker) {
            const url = URL.createObjectURL(srtBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          }

          alert(\`✅ SRT 已导出！

📁 文件名: \${fileName}
📂 保存位置: \${data.output || '浏览器下载目录'}
💬 字幕条数: \${data.subtitleCount}
⏱️ 时间线时长: \${formatDuration(data.timelineDuration)}
\${savedByPicker ? '' : '\\n当前浏览器未提供保存目录选择，已改用普通下载。'}\`);
        } else {
          alert('❌ 导出失败: ' + data.error);
        }
      } catch (err) {
        alert('❌ 请求失败: ' + err.message + '\\n\\n请确保使用 review_server.js 启动服务');
      }
    }

    async function exportProject() {
      const segments = getSelectedSegments();
      const orderedTimelineRanges = getOrderedTimelineRanges();
      const subtitles = buildSubtitleCuePayload();
      if (!subtitles.length) {
        alert('当前没有可导出的字幕。');
        return;
      }
      if (segments.length === 0) {
        alert('当前没有选择删除片段，将导出完整视频时间线的工程文件。');
      }

      try {
        const res = await fetch('/api/export-project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            segments,
            subtitles,
            orderedTimelineRanges,
            projectTitle,
            chooseDirectory: true,
            mode: isMulticam ? 'multicam' : 'single',
            sourceOffsets,
            speakerNames,
            activeCameraId,
            paragraphOrder,
            paragraphs: getParagraphPayload()
          })
        });
        const data = await res.json();

        if (data.success) {
          const fallbackNote = data.outputDir ? '' : '\\n当前浏览器未提供保存目录选择，已改用普通下载。';
          alert(\`✅ 工程已导出！

📁 FCPXML: \${data.fcpxml?.outputName || ''}
📁 SRT: \${data.srt?.outputName || ''}
📂 保存位置: \${data.outputDir || '浏览器下载目录'}
🎞️ 保留片段: \${data.keepClips}
💬 字幕条数: \${data.subtitleCount}
⏱️ 时间线时长: \${formatDuration(data.timelineDuration)}
\${fallbackNote}\`);
        } else {
          alert('❌ 导出失败: ' + data.error);
        }
      } catch (err) {
        alert('❌ 请求失败: ' + err.message + '\\n\\n请确保使用 review_server.js 启动服务');
      }
    }

    function clearAll() {
      if (!selected.size) return;
      pushUndo();
      applySelectionSnapshot([]);
    }

    function selectAiSuggestions() {
      const aiSnapshot = Array.from(autoSelected).sort((a, b) => a - b);
      if (snapshotsEqual(snapshotSelection(), aiSnapshot)) return;
      pushUndo();
      applySelectionSnapshot(aiSnapshot);
    }

    async function executeCut() {
      if (isMulticam) {
        alert('多机位模式首版不直接渲染 mp4。请点击“导出工程”，在 Final Cut Pro 中继续精剪。');
        return;
      }
      // 直接发送原始时间戳，不做合并（和预览一致）
      const segments = getSelectedSegments();
      const orderedTimelineRanges = getOrderedTimelineRanges();
      if (segments.length === 0 && !hasParagraphOrderChanged()) {
        alert('当前没有红线删除片段，也没有段落重排。为避免误渲染完整视频，已取消渲染。');
        return;
      }

      // 基于视频时长预估剪辑时间
      const videoDuration = player.duration;
      const videoMinutes = (videoDuration / 60).toFixed(1);
      const estimatedTime = Math.max(5, Math.ceil(videoDuration / 4)); // 经验值：约4倍速处理
      const estMin = Math.floor(estimatedTime / 60);
      const estSec = estimatedTime % 60;
      const estText = estMin > 0 ? \`\${estMin}分\${estSec}秒\` : \`\${estSec}秒\`;

      if (!confirm(\`确认开始渲染保留部分？\\n\\n📹 原视频时长: \${videoMinutes} 分钟\\n🧹 将跳过红线删除内容，只渲染留下的部分\\n⏱️ 预计耗时: \${estText}\\n\\n点击确定后请选择渲染保存目录\`)) return;

      // 显示 loading 并开始计时
      const overlay = document.getElementById('loadingOverlay');
      const loadingTimeEl = document.getElementById('loadingTime');
      const loadingProgress = document.getElementById('loadingProgress');
      const loadingEstimate = document.getElementById('loadingEstimate');
      overlay.classList.add('show');
      loadingEstimate.textContent = \`预估剩余: \${estText}\`;

      const startTime = Date.now();
      const timer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        loadingTimeEl.textContent = \`已等待 \${elapsed} 秒\`;

        // 更新进度条（预估进度，最多到95%等待完成）
        const progress = Math.min(95, (elapsed / estimatedTime) * 100);
        loadingProgress.style.width = progress + '%';

        // 更新预估剩余时间
        const remaining = Math.max(0, estimatedTime - elapsed);
        if (remaining > 0) {
          loadingEstimate.textContent = \`预估剩余: \${remaining} 秒\`;
        } else {
          loadingEstimate.textContent = \`即将完成...\`;
        }
      }, 500);

      try {
        const res = await fetch('/api/cut', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ segments, orderedTimelineRanges, chooseDirectory: true })
        });
        const data = await res.json();

        // 停止计时并隐藏 loading
        clearInterval(timer);
        loadingProgress.style.width = '100%';
        await new Promise(r => setTimeout(r, 300)); // 让进度条动画完成
        overlay.classList.remove('show');
        loadingProgress.style.width = '0%'; // 重置
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

        if (data.success) {
          const msg = \`✅ 渲染完成！(耗时 \${totalTime}s)

📁 输出文件: \${data.output}

⏱️ 时间统计:
   原时长: \${formatDuration(data.originalDuration)}
   新时长: \${formatDuration(data.newDuration)}
   删减: \${formatDuration(data.deletedDuration)} (\${data.savedPercent}%)\`;
          alert(msg);
        } else {
          alert('❌ 渲染失败: ' + data.error);
        }
      } catch (err) {
        clearInterval(timer);
        overlay.classList.remove('show');
        loadingProgress.style.width = '0%'; // 重置
        alert('❌ 请求失败: ' + err.message + '\\n\\n请确保使用 review_server.js 启动服务');
      }
    }

    function isTypingTarget(target) {
      return target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
    }

    function jumpSentence(direction) {
      const validStarts = sentenceStartIndices.filter(i => i >= 0);
      if (!validStarts.length) return;
      const t = getGlobalTime();
      let target = validStarts[0];
      if (direction > 0) {
        target = validStarts.find(i => words[i].start > t + 0.15) ?? validStarts[validStarts.length - 1];
      } else {
        for (let i = validStarts.length - 1; i >= 0; i--) {
          if (words[validStarts[i]].start < t - 0.15) {
            target = validStarts[i];
            break;
          }
        }
      }
      setGlobalTime(words[target].start);
      scrollToIndex(target);
    }

    function toggleMainView() {
      setActiveMainView(activeMainView === 'article' ? 'subtitle' : 'article', { pushHistory: true });
    }

    // 键盘快捷键
    document.addEventListener('keydown', e => {
      if (isTypingTarget(e.target)) return;
      if (e.shiftKey && isCutMode) setCutMode(false);
      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) redoSelection();
        else undoSelection();
      } else if (e.code === 'KeyB') {
        e.preventDefault();
        toggleCutMode();
      } else if (e.code === 'Space' || e.code === 'KeyK') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        jumpSentence(-1);
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        jumpSentence(1);
      } else if (e.code === 'Tab') {
        e.preventDefault();
        toggleMainView();
      } else if (e.code === 'ArrowLeft') {
        setGlobalTime(Math.max(0, getGlobalTime() - (e.shiftKey ? 5 : 1)));
      } else if (e.code === 'ArrowRight') {
        setGlobalTime(getGlobalTime() + (e.shiftKey ? 5 : 1));
      }
    });

    window.addEventListener('beforeunload', () => {
      if (!hasLoadedProjectState) return;
      const payload = JSON.stringify(getProjectStatePayload());
      navigator.sendBeacon('/api/project-state', new Blob([payload], { type: 'application/json' }));
    });

    Object.assign(window, {
      togglePlay,
      setPlaybackRate,
      setSelectedBgm,
      copyDeleteList,
      exportFinalCutXML,
      exportSRT,
      exportProject,
      saveProject,
      executeCut,
      clearAll,
      selectAiSuggestions,
      undoSelection,
      redoSelection
    });

    document.getElementById('playBtn').addEventListener('click', togglePlay);
    document.getElementById('speed').addEventListener('change', event => {
      setPlaybackRate(event.target.value);
      event.target.blur();
    });
    bgmSelect.addEventListener('change', event => setSelectedBgm(event.target.value));
    document.getElementById('copyBtn').addEventListener('click', copyDeleteList);
    exportProjectBtn.addEventListener('click', exportProject);
    document.getElementById('saveProjectBtn').addEventListener('click', saveProject);
    document.getElementById('selectAiBtn').addEventListener('click', selectAiSuggestions);
    document.getElementById('cutBtn').addEventListener('click', executeCut);
    document.getElementById('clearBtn').addEventListener('click', clearAll);
    document.getElementById('undoBtn').addEventListener('click', undoSelection);
    document.getElementById('redoBtn').addEventListener('click', redoSelection);
    splitModeBtn.addEventListener('click', toggleCutMode);
    document.getElementById('selectionToggleBtn').addEventListener('click', toggleSelectionMenuDelete);
    document.getElementById('selectionCopyBtn').addEventListener('click', copySelectionText);
    document.getElementById('selectionEditBtn').addEventListener('click', editSelectionText);
    paperTitle.addEventListener('dblclick', startProjectTitleEdit);
    paperTitle.addEventListener('blur', () => {
      if (paperTitle.isContentEditable) commitProjectTitleEdit();
    });
    paperTitle.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitProjectTitleEdit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelProjectTitleEdit();
      }
    });

    renderProjectTitle();
    render();
    loadProjectState();
  </script>
</body>
</html>`;

fs.writeFileSync('review.html', html);
console.log('✅ 已生成 review.html');
console.log('📌 启动服务器: node review_server.js 8899');
console.log('📌 打开: http://localhost:8899/review.html');
