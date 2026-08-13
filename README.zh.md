# dsh-drop-to-path

> 给纯文本模型 Agent 的图片"传送带":附件照常管理(预览/移除),发送时自动把图片转成工作区文件路径交给模型。

[English](README.md) | [中文](README.zh.md)

[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-%E2%9C%93-5B4CF0?style=flat-square)](https://github.com/topics/dsh-plugin)

## 为什么做这个

我在 DeepSeek Harness 里用纯文本模型(deepseek)写代码,需要经常把截图发给 Agent 看。但 DSH 的图片附件走模型原生附件通道,纯文本模型会在发送前被预检拦下:

```
Model "deepseek-v4-flash" does not support image input. (attachment-error)
```

配合 [dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) 可以解决"看图"的问题——但它的工具只认**工作区文件路径**,图片必须以路径形式进入消息。于是每次看图都要:截图 → 存到工作区 → 手动把地址写进消息。非常笨重。

在另一个工具里体验过"粘贴即用"之后,我决定把这个体验搬回 DSH:**附件 UI 完全保持原生,只在发送瞬间把图片转换成文件路径**。于是有了这个插件。

## 工作原理

```
粘贴/拖入图片 → 附件卡片(原生:缩略图/预览/叉掉)
      ↓ 点击发送
conversation.sendSession 被包装:
   逐张上传 → <workspace>/.drops/<timestamp>-<name>.png
   消息内容 → [{ type: 'text', text: '<路径>\n<你的文字>' }]
      ↓
纯文本模型收到文件地址 → agent 调 vision 工具看图
```

- 图片准入预检(`dsh-host-apiproxy` 的 `attachment-error`)被**绕过**:发送时根本没有 image 块,模型收到的全是文本。
- 上传失败自动回退到原生发送(会看到熟悉的附件错误提示),不会吞消息。
- 支持粘贴和拖入,支持多张图片。

## 与 dsh-vision-toolkit 配合(推荐搭配)

> 🎯 **强烈推荐搭配 [dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) 一起使用**——它是纯文本模型的眼睛,本插件是传送带:
>
> - **本插件**解决"图片怎么变成路径"(发送时自动转换);
> - **dsh-vision-toolkit** 解决"路径怎么变成视觉能力"(图片问答、长截图 OCR、UI 还原、目标定位、像素对比等 10 个结构化视觉工具,已适配 DSH Credentials / 托管运行时 / Web Settings)。
>
> 安装:`dsh plugin --profile web add <dsh-vision-toolkit 路径>`(详见其仓库 README)。两者配合,纯文本模型即可获得接近多模态模型的看图体验。

| 场景 | 之前 | 现在 |
|---|---|---|
| 看图问答 | 截图 → 存工作区 → 手写路径 | 截图 → Ctrl+V → 回车 |
| 多图对比(pixel diff) | 同上,每个路径手写 | 发两张图即可 |
| 长截图 OCR / UI 还原 | 同上 | 发图即可 |

## 同类插件对比

- [dsh-drag-and-drop](https://github.com/bill9109/dsh-drag-and-drop):拖放文件→直接在输入框插入**原始路径**,不复制文件。适合"引用工作区已有文件";图片仍会以附件形式发送(纯文本模型下仍会被拒),且不支持粘贴。
- **本插件**:保留原生附件 UI(预览/移除),发送时**自动复制到工作区并转换为路径**,支持粘贴与拖入。专为"发图给纯文本模型"设计。

两者互补:引用已有文件用 dsh-drag-and-drop,发截图用本插件。

## 安装

前置:DeepSeek Harness(Web profile),Node.js,`dsh` CLI。

```sh
# 方式一:dsh plugin 安装(推荐)
dsh plugin --profile web add /path/to/dsh-drop-to-path

# 方式二:手动(与本仓库 layout 一致)
# 1. package.json 的 dependencies 加:
#    "@dsh-external/dsh-drop-to-path": "link:/path/to/dsh-drop-to-path"
# 2. dsh.profile.bundles 数组加: "@dsh-external/dsh-drop-to-path"
# 3. 将目录(含 lib/)复制到 profiles/<name>/node_modules/@dsh-external/dsh-drop-to-path
```

安装后**重启 Web profile**(双击启动器 / 重启 `dsh web`)生效。无任何设置项。

## 使用

1. 像平时一样粘贴或拖入图片,附件卡片照常显示(可预览、可叉掉);
2. 可输入文字,可多张图片;
3. 发送 —— 消息里不会出现图片附件,模型收到的是文件路径;
4. agent(配合 dsh-vision-toolkit)自动用 `vision_glance` / `vision_pixel_diff` 等工具读取图片。

图片保存在 `<workspace>/.drops/` 目录,可定期清理。

## 文件结构

```
dsh-drop-to-path/
├─ package.json        bundle 声明(dsh.bundle.patch / dsh.client)
├─ cordis.patch.yml    挂载行(insert drop-to-path)
├─ lib/
│  ├─ index.js         host:POST /_dsh/drop-to-path/import 路由
│  └─ client.js        browser:包装 conversation.sendSession
├─ README.md
├─ README.zh.md
└─ ADAPTING.md         升级适配指南(必读)
```

## 实现要点

- **host 侧**(`lib/index.js`):注册 `webServer` 服务路由 `POST /_dsh/drop-to-path/import`,接收 `{ name, dataBase64 }`,校验(仅 png/jpg/jpeg/webp/gif、≤30MB、文件名清洗防路径穿越),写入会话工作区 `.drops/`,返回 `{ ok, value: { path } }`。
- **工作区定位**:读取 `$DSH_HOME/storages/workspace.json`(durable workspace registry),取 `updatedAt` 最新的 workspace 路径。
- **browser 侧**(`lib/client.js`):不拦截任何 DOM 事件;通过 `exports.inject = ['conversation']` 注入会话服务,实例级包装 `conversation.sendSession`——有草稿图片时上传并替换为文本块,否则原样转发。
- **失败回退**:上传异常 → `console.error` + 走原生 `sendSession`,保证消息不丢。

## 兼容性

| DSH 版本 | 状态 |
|---|---|
| 0.1.0-rc.6(本仓库验证环境) | ✅ 可用 |

本插件依赖 DSH 若干**未公开的内部接口**(服务名、方法签名、存储格式),DSH 升级后可能失效。升级前请先阅读 [`ADAPTING.md`](ADAPTING.md),失效症状与修复步骤都在里面。

## 贡献与适配

- 问题/想法:GitHub Issues。
- DSH 升级后插件失效:对照 [`ADAPTING.md`](ADAPTING.md) 的症状表排查修复,并在适配记录表追加一行。

## 许可证

MIT
