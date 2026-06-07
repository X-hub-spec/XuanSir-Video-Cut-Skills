# Export Demo

这是一个内置粗剪审核 demo，用于展示 `XuanSir Video Cut Skills` 的文章视图、字幕视图、AI 预选删除、分段模式、段落重排、导出工程和渲染能力。

## 启动

```bash
cd /Users/xuansir/Documents/粗剪skills优化/demo/Export/剪口播/3_审核
node /Users/xuansir/.claude/skills/videocut/剪口播/scripts/review_server.js 8899 /Users/xuansir/Documents/粗剪skills优化/demo/Export/source/Export.M4V
```

然后用 Chrome 打开：

```text
http://127.0.0.1:8899/review.html
```

## 内容

- `source/Export.M4V`: demo 原视频。
- `剪口播/1_转录/`: 音频、转录结果、字级字幕。
- `剪口播/2_分析/`: 可读文本、句子切分、AI 预选删除、口误分析。
- `剪口播/3_审核/`: 可直接打开的审核页。

## 默认预选

这个 demo 默认预选了静音、开场测试语和两处明显重复句，打开审核页后可以直接看到红线批注效果。
