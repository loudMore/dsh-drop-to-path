# Changelog

本项目的所有重要变更都会记录在此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Fixed

- **pnpm 安装告警**:将 `@deepseek-ai/cordis` 声明为可选 peer(`peerDependenciesMeta`),消除 DSH profile 安装( `autoInstallPeers: false` )下的 missing peer 告警——感谢 [@SPYQWER1](https://github.com/SPYQWER1) 的 [PR #4](https://github.com/loudMore/dsh-drop-to-path/pull/4)(见 [issue #3](https://github.com/loudMore/dsh-drop-to-path/issues/3))。

## [0.1.0] - 2026-08-14

**首个正式版本**:图片与文件直达纯文本模型的完整实现,已通过自动化浏览器验证,并获得首次社区贡献(PR #2)。

### Added

- **图片**(png/jpg/jpeg/webp/gif,≤30MB):保留 DSH 原生附件体验(缩略图/预览/移除),点击发送时自动转为工作区路径;
- **非图片文件**(pdf/office/zip/视频/音频,≤100MB):附件栏方块标签(格式图标、截断文件名、hover 显示全名、✕ 移除),发送时自动附加路径;
- **混合拖入**:图片进原生附件栏、文件进方块区,同一排并排显示;
- 路径只在**点击发送时**附加,输入框保持干净;
- 上传失败显示**可见提示条**并回退原生发送,消息永不丢失;
- 支持粘贴与拖入;多文件按序上传,一次送达;
- 自动关闭 DSH 全屏拖拽蒙版(`dragend`),页面不会卡住;
- 方块尺寸**实时复用** DSH 图片缩略图尺寸(默认 62px,DSH 改版自动跟随);
- 中英双语 README(演示 GIF + 效果图)、ADAPTING.md 升级适配指南;
- GitHub 生态:`dsh-plugin` topic,已被 awesome-dsh-plugin 自动收录。

### Fixed

- **DSH_HOME 未设置时上传失败**:回退到 `~/.dsh`(与 DSH 官方 home 解析一致)——感谢 [@SPYQWER1](https://github.com/SPYQWER1) 的 [PR #2](https://github.com/loudMore/dsh-drop-to-path/pull/2);
- **多工作区下文件落到错误目录**:上传携带活动会话工作区,host 仅信任绝对路径——感谢 [@SPYQWER1](https://github.com/SPYQWER1)。
