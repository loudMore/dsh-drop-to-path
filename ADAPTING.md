# dsh-drop-to-path — 升级适配指南

本插件依赖 DSH 若干**未公开的内部接口**。DSH 升级(或插件本身被重新安装/覆盖)后可能失效。本文记录:依赖哪些接口、失效症状、如何定位、如何修复。

> 维护约定:每次成功适配后,在文末「适配记录」追加一行(DSH 版本 / 日期 / 改动)。排查问题从「失效症状」表开始。

## 1. 依赖的内部接口清单

### 1.1 浏览器侧(`lib/client.js`)

| 接口 | 位置 | 用途 | 失效信号 |
|---|---|---|---|
| 客户端插件加载格式 `window.__ModuleLoader__.load({ id, factory })` | DSH 客户端运行时(所有 client bundle) | 插件入口 | 插件完全不加载(F12 无 `[drop-to-path]` 日志) |
| 插件对象 `exports.apply(ctx)`、`exports.inject = ['conversation']` | cordis 客户端 | 生命周期与依赖注入 | apply 未执行 / `ctx.conversation` 为 undefined |
| `conversation` 服务(root 单例,scope-addressed) | `@deepseek-ai/dsh-client-ui-conversation` | 注入目标 | 注入失败 |
| `conversation.sendSession(session, text, imageIds, mode)`(原型方法) | 同上 | **包装点**:图片+文件发送入口(prototype 级包装,实例重建不失效) | 发送后仍报 `attachment-error` |
| `conversation.draftImages(imageIds)` | 同上 | 由草稿附件 id 取附件描述符(`{ file }`) | 附件取不到 |
| `conversation.releaseDraftImages(attachments)` | 同上 | 发送成功后释放附件预览 | 附件残留 |
| `session.prompt(content, mode)` | 客户端运行时会话对象 | 提交转换后的文本块 | 发送失败 |
| document 级 `drop` / `paste` 事件(capture 阶段拦截) | 浏览器 DOM | 拦截含非图片文件的拖放/粘贴 | 文件拖入无方块生成 |
| `window` 级 `dragend` 事件(DSH 监听并重置拖拽蒙版) | DSH 输入区(`dsh-client-ui-conversation`) | 派发合成 `dragend` 关闭全屏蒙版 | 拖入文件后蒙版残留、页面卡住 |
| 附件栏容器 `[class*="_attachments"]`(类名后缀按构建变化) | DSH 输入区 DOM | 方块标签插入位置 + flex 布局 CSS 覆盖 | 方块出现在错误位置 |
| 图片缩略图 `img[src^="blob:"]` | DSH 附件栏 DOM | **实时测量**缩略图尺寸,方块 1:1 对齐 | 方块尺寸与图片不一致 |

### 1.2 宿主侧(`lib/index.js`)

| 接口 | 位置 | 用途 | 失效信号 |
|---|---|---|---|
| `webServer` 服务 + `register({ kind: 'exact'\|'prefix', path, handler })` | `@deepseek-ai/dsh-host-webserver` | 挂载导入路由 | `GET /_dsh/drop-to-path/import` 返回 HTML(SPA 兜底)而非 405 JSON |
| `ctx.inject(['webServer'], cb)` | cordis 宿主 | 等待 webServer 可用 | 路由从未注册 |
| `$DSH_HOME/storages/workspace.json`(durable workspace registry,`tables.workspaces.<id>.path / .updatedAt`) | `@deepseek-ai/dsh-workspace` 持久化 | 定位会话工作区 | 上传返回 500 `cannot read workspace registry` |

### 1.3 宿主侧(了解即可,不直接依赖)

| 接口 | 位置 | 说明 |
|---|---|---|
| 图片准入预检 `attachment-error` / `MODEL_DOES_NOT_SUPPORT_IMAGES` | `@deepseek-ai/dsh-host-apiproxy` 的 `prompt` handler(`modelInfo.inputModalities` 不含 `image` 即拒绝) | 本插件绕过的就是它。若 DSH 未来把"不支持图片→自动降级/转换"做成内置能力,本插件可整体退役 |

## 2. 失效症状 → 定位 → 修复

| 症状 | 可能原因 | 定位 | 修复 |
|---|---|---|---|
| 发送后仍弹「当前模型不支持图片」 | `sendSession` 包装未生效 | F12 控制台:是否有 `[drop-to-path]` 报错;`conversation` 服务名或 `sendSession` 签名/调用路径变了 | 用 `__ModuleLoader__` 环境里 `console.log(Object.keys(ctx.conversation))` 核对方法;同步改 `client.js` 的包装点 |
| `GET /_dsh/drop-to-path/import` 返回 `<!doctype html>`(200) | 路由未注册 | 见上表 1.2 第一行 | 核对 `webServer` 服务名与 `register` 契约(**历史坑**:rc.6 之前/某些版本该服务曾叫 `httpServer`,见适配记录 #1) |
| 拖图发送后消息为空/无反应 | `session.prompt` 返回失败被 composer catch | 看会话消息流与 F12 | 核对 `session.prompt(content, mode)` 签名;确认 `mode`(queue/steer)仍存在 |
| 上传报 500 `cannot read workspace registry` | `workspace.json` 格式或路径变化 | 打开 `$DSH_HOME/storages/workspace.json` 目视核对 | 更新 `workspaceRoot()` 解析逻辑;必要时改用 `workspaceRegistry` 服务注入 |
| 图片保存成功但 agent 说找不到文件 | 工作区定位到了错误的目录(如服务器 cwd) | 看上传返回的 path | 确认 `workspaceRoot()` 返回的是**会话工作区**(与 `dsh-workspace` 记录的 path 一致) |
| 插件完全无效果且无日志 | client bundle 未被宿主发现 | 重启后页面源码 `window.__DSH_BOOT__.entries` 是否含 `@dsh-external/dsh-drop-to-path` | 核对 `package.json` 的 `dsh.client` 声明、`exports['./client']`、`cordis.patch.yml` 挂载行 |
| 拖入文件后**全屏蒙版残留**、页面卡住 | `dragend` 派发未生效或 DSH 不再监听 window `dragend` | F12 Console 看 `[drop-to-path]` 日志;DSH 输入区源码里找蒙版重置逻辑 | 更新 `client.js` 的蒙版关闭方式(当前:派发合成 `DragEvent('dragend')`) |
| 方块标签出现在错误位置/与图片不并排 | 附件栏类名后缀变化(`_attachments`)或 flex CSS 覆盖失效 | F12 检查 `[class*="_attachments"]` 是否存在及其 display | 更新 `findRail()` 选择器与注入的 CSS |
| 方块尺寸与图片缩略图不一致 | 缩略图选择器 `img[src^="blob:"]` 失效或尺寸测量逻辑变化 | F12 看缩略图是否仍为 blob URL | 更新 `thumbnailSize()` |

## 3. 验证清单(适配后必跑)

1. 重启 Web profile(必须,host 路由与 client bundle 都在启动时发现);
2. `curl -i http://127.0.0.1:8099/_dsh/drop-to-path/import` → 期望 `405` + JSON(`{"ok":false,...}`),**不是** HTML;
3. 浏览器 F12 → Network:粘贴图片后点发送,应看到一次 `POST /_dsh/drop-to-path/import`(200 JSON `{ok:true,value:{path}}`);
4. 会话消息流:发出的消息是**文本路径**(`D:\...\.drops\...`),无图片附件卡片;
5. agent 回复应能描述图片内容(配合 dsh-vision-toolkit)。

## 4. 适配记录

| # | 日期 | DSH 版本 | 改动 |
|---|---|---|---|
| 1 | 2026-08-14 | 0.1.0-rc.6 | 初版。注:本环境同时给 `dsh-vision-toolkit` v0.1.2 打过 `httpServer` → `webServer` 补丁(其 `lib/web.js` 与 `src/web.ts`);若该插件也失效,检查此补丁是否被覆盖 |
| 2 | 2026-08-14 | 0.1.0-rc.6 | 合并 PR #2(感谢 @SPYQWER1):`workspaceRoot()` 增加 `~/.dsh` 回退(不再强制 DSH_HOME);导入路由接受可选 `workspace` 字段(仅绝对路径受信任,否则回退注册表扫描);client 通过 `sessions` 服务解析活动会话 cwd 并随上传携带 |

## 5. 本机环境备注(调试用)

- 数据目录:`D:\DeepSeekHarness\dsh-home`(`C:\Users\<user>\.dsh` 是 junction 指向它);
- 服务器进程:`dsh web --host 127.0.0.1 --port 8099`,日志:`D:\DeepSeekHarness\dsh.log`;
- 插件安装形态:profile 的 `package.json` 用 `link:` 依赖 + `node_modules/@dsh-external/dsh-drop-to-path` 为**目录拷贝**(pnpm 跨盘 link 退化为拷贝)——更新源码后需重新拷贝(见 README 安装方式二第 3 步)。
