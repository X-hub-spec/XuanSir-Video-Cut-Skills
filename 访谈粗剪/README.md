# 访谈粗剪

访谈粗剪是多人、多机位内容的实验入口。它把多轨素材整理成一篇能阅读、能划线、能重排的采访稿，最后导出多轨 FCPXML、SRT、删除区间和项目状态。

## 输入清单

先在项目目录里创建 `interview_sources.json`：

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

## 三种创建方式

已对轨 XML：

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

访谈版 MVP 不直接渲染 mp4。它导出多轨工程，让用户继续在 Final Cut Pro 里选机位和精剪。
