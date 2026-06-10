#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectFile = process.argv[2] || 'interview_project.json';
const autoSelectedFile = process.argv[3] || path.join('2_分析', 'auto_selected.json');
const oralGenerateReview = path.resolve(__dirname, '..', '..', '剪口播', 'scripts', 'generate_review.js');

if (!fs.existsSync(projectFile)) {
  console.error(`❌ 找不到 ${projectFile}，请先运行 prepare_interview_project.js`);
  process.exit(1);
}

const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
if (project.mode !== 'interview') {
  console.error('❌ 项目不是 interview 模式');
  process.exit(1);
}

const args = [oralGenerateReview, projectFile];
if (fs.existsSync(autoSelectedFile)) args.push(autoSelectedFile);

const result = spawnSync('node', args, { stdio: 'inherit' });
process.exit(result.status || 0);
