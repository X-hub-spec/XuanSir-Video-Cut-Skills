---
name: 访谈粗剪
description: 多人多机位访谈粗剪入口。适用于“多机位访谈”“访谈版粗剪”“处理这个访谈”“帮我剪这个多机位访谈”等请求，创建 interview_project.json，生成访谈审核页，并导出多轨 FCPXML/SRT。
---

# 访谈粗剪

这个入口用于多人、多机位、播客、圆桌和主持人/嘉宾问答的粗剪。

## 工作流

1. 准备 `interview_sources.json`。
2. 根据用户已有素材选择创建方式：
   - 已对轨 FCPXML：清单内写 `timelineXml`、`transcriptSourceId`、可选 `primaryPreviewSourceId`，运行 `scripts/prepare_interview_project.js <清单>`。
   - 旧版 XML offset：运行 `scripts/prepare_interview_project.js <清单> --xml <xml>`。
   - 内嵌 timecode：运行 `scripts/prepare_interview_project.js <清单> --timecode`。
   - 普通素材：运行 `scripts/prepare_interview_project.js <清单>`，offset 默认为 0。
3. 运行 `scripts/generate_interview_review.js` 生成 `review.html`。
4. 运行 `scripts/interview_review_server.js 8899` 启动审核页。
5. 审核完成后使用页面的“导出工程”，导出多轨 FCPXML、SRT、删除区间和项目状态。

## 约束

- 访谈版使用 `interview_project.json`，不要混用口播版 `review_project_state.json`。
- 审核状态保存到 `interview_review_state.json`。
- MVP 不直接渲染 mp4，只导出多轨工程。
- 删除和段落重排作用于全局时间区间，也就是所有视频轨和音频轨一起移动，避免音画错位。
- 新版 FCPXML 驱动流程必须指定 `transcriptSourceId`，默认使用混音总轨做唯一转写源，不做说话人识别。

## 对轨优先级

1. 已对轨 FCPXML 完整时间线，`syncMethod: "xml"`，`syncConfidence: 1`。
2. 素材内嵌 timecode，`syncMethod: "timecode"`，`syncConfidence: 0.95`。
3. 手动 offset，`syncMethod: "manual"`，`syncConfidence: 0.8`。

## 转录

默认使用口播入口里的火山引擎大模型识别脚本：

```bash
剪口播/scripts/volcengine_bigmodel_flash_transcribe.py
```

如果素材已经有 `wordsFile`，准备脚本会直接复用，不重新转录。
