# 访谈粗剪

访谈粗剪是多人、多机位内容的实验入口。它把多轨素材整理成一篇能阅读、能划线、能重排的采访稿，最后导出多轨 FCPXML、SRT、删除区间和项目状态。

## 推荐输入清单：已对轨 FCPXML

先在项目目录里创建 `interview_sources.json`。第一版推荐把已对轨的 Final Cut Pro `FCPXML` 作为权威时间线，并明确指定用于转写的混音总轨：

```json
{
  "mode": "interview",
  "projectTitle": "访谈粗剪",
  "timelineXml": "/abs/synced.fcpxml",
  "transcriptSourceId": "mix_audio",
  "primaryPreviewSourceId": "cam_a"
}
```

- `timelineXml`：已经对轨好的 FCPXML。
- `transcriptSourceId`：混音总轨或主音频素材，用它做唯一转写源，避免多支麦克风串音导致重复识别。
  - 如果 FCPXML 把同一个混音文件拆成多个 asset id，系统会按相同素材路径自动合并这些片段。
- `primaryPreviewSourceId`：审核页左侧默认预览机位；不填时默认使用第一条视频素材。

准备项目：

```bash
node /Users/xuansir/Documents/粗剪skills优化/访谈粗剪/scripts/prepare_interview_project.js interview_sources.json
```

系统会从 FCPXML 解析素材和时间线片段，生成 `interview_project.json`。文稿里的时间戳会从混音轨本地时间映射到 FCPXML 全局时间线。

## 兼容输入清单：手动素材列表

如果没有完整 FCPXML，也可以继续使用素材列表：

```json
{
  "mode": "interview",
  "projectTitle": "访谈粗剪",
  "sources": [
    {
      "id": "cam_a",
      "kind": "video",
      "path": "/abs/cam-a.mp4",
      "name": "正面机位",
      "primary": true
    },
    {
      "id": "mic_zhang",
      "kind": "audio",
      "path": "/abs/zhang.wav",
      "name": "张三麦",
      "speakerId": "zhang"
    }
  ],
  "speakers": [
    { "id": "zhang", "name": "张三", "color": "#2f6fe4" }
  ]
}
```

`speakerId` 表示这条音频/视频用于转录某位说话人。没有 `speakerId` 的素材只作为画面或辅轨进入工程。

## 兼容创建方式

旧版 XML offset：

```bash
node /Users/xuansir/Documents/粗剪skills优化/访谈粗剪/scripts/prepare_interview_project.js interview_sources.json --xml synced.fcpxml
```

内嵌 timecode：

```bash
node /Users/xuansir/Documents/粗剪skills优化/访谈粗剪/scripts/prepare_interview_project.js interview_sources.json --timecode
```

手动 offset：

```bash
node /Users/xuansir/Documents/粗剪skills优化/访谈粗剪/scripts/prepare_interview_project.js interview_sources.json
```

生成审核页并启动：

```bash
node /Users/xuansir/Documents/粗剪skills优化/访谈粗剪/scripts/generate_interview_review.js
node /Users/xuansir/Documents/粗剪skills优化/访谈粗剪/scripts/interview_review_server.js 8899
```

浏览器打开：

```text
http://127.0.0.1:8899/review.html
```

## 输出

- `interview_project.json`
- `interview_review_state.json`
- `delete_segments.json`
- 多轨 `FCPXML`
- `SRT`

访谈版 MVP 不直接渲染 mp4。它导出多轨工程，让用户继续在 Final Cut Pro 里选机位和精剪。导出时会按文稿删除和段落重排结果裁切原 FCPXML 的全部轨道，尽量保留原 lane/role。
