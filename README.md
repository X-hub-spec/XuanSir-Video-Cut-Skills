# XuanSir Video Cut Skills

一个面向口播视频的 AI 粗剪审核工具。

它把视频转成可阅读、可划线、可批注的文稿。你像审稿一样删掉口误、重复、停顿和废话，系统再把这些删除决定转换成视频粗剪、FCPXML 工程和 SRT 字幕。

## 核心功能

- **AI 粗剪建议**：自动标记静音、重复表达、口误、重说和明显废话。
- **文章式审核**：把口播内容排成可阅读的稿件，而不是一堆字幕块。
- **画线删除**：双击或 Shift 拖动画线，像改稿一样确认删除片段。
- **字幕视图**：按字幕行检查内容，提示字幕过长/过短，支持手动分段和合并。
- **状态自动保存**：删除选择、文字修改、字幕分段、BGM 选择和阅读位置会保存到本地项目。
- **BGM 参考试听**：剪辑时可选择内置 BGM 试听，最终渲染不会混入 BGM。
- **导出工程**：一键导出同名 FCPXML + SRT，时间码对齐剪后时间线。
- **本地渲染**：只渲染保留下来的部分，适合快速生成粗剪成片。

## 解决的问题

- 不用在时间线上反复找口误，直接读稿划掉。
- AI 只做建议，最终删除由人工确认，减少误剪。
- 字幕和粗剪共用同一份 token 状态，避免剪掉的内容还出现在字幕里。
- 导出的 SRT 从剪后 `00:00` 开始连续计时，可直接进入后期流程。
- 项目状态保存在本地，刷新或重新打开后可以继续剪。

## 快速使用

把本仓库安装到 Skills 目录：

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/xuansir1/XuanSir-Video-Cut-Skills.git ~/.claude/skills/videocut
```

安装基础依赖：

```bash
brew install node ffmpeg
cd ~/.claude/skills/videocut
python3 -m venv .venv
.venv/bin/python -m pip install -U pip mlx-whisper
```

在 Codex 或 Claude Code 里把视频交给它，然后说：

```text
帮我剪这个口播视频
```

## 相关文档

- [使用说明](./使用说明.md)
- [工程原理](./工程原理.md)
- [剪辑审核页产品说明](./剪辑审核页产品说明.md)

