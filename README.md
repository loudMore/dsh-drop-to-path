# dsh-drop-to-path

> An image "conveyor belt" for text-only model agents: keep the native attachment UI (thumbnail / preview / remove), and automatically convert images to workspace file paths when you hit send.

[English](README.md) | [中文](README.zh.md)

[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-%E2%9C%93-5B4CF0?style=flat-square)](https://github.com/topics/dsh-plugin)

## Why this plugin

I use a text-only model (deepseek) in DeepSeek Harness and frequently need to send screenshots to the agent. But DSH image attachments go through the model's native attachment channel, and text-only models are rejected by a preflight check before the message is even sent:

```
Model "deepseek-v4-flash" does not support image input. (attachment-error)
```

[dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) solves the "see the image" half — but its tools only accept **workspace file paths**, so the image must enter the message as a path. Every screenshot became: save to workspace → manually type the path into the message. Painful.

After experiencing "paste and go" in another tool, I decided to bring that experience back to DSH: **keep the attachment UI completely native, and convert images to file paths only at the moment of sending**. Hence this plugin.

## How it works

```
Paste / drop an image → attachment card (native: thumbnail / preview / remove)
      ↓ hit send
conversation.sendSession is wrapped:
   upload each image → <workspace>/.drops/<timestamp>-<name>.png
   message content → [{ type: 'text', text: '<path>\n<your text>' }]
      ↓
text-only model receives file addresses → agent reads them with vision tools
```

- The image admission preflight (`attachment-error` in `dsh-host-apiproxy`) is **bypassed**: no image block is ever sent, the model only sees text.
- Upload failure falls back to the native send path (you get the familiar attachment error toast) — messages are never swallowed.
- Supports paste and drag-and-drop, and multiple images per message.

## Pairing with dsh-vision-toolkit (recommended)

> 🎯 **Strongly recommended to pair with [dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit)** — it is the eyes of a text-only model, this plugin is the conveyor belt:
>
> - **This plugin** solves "how an image becomes a path" (automatic conversion on send);
> - **dsh-vision-toolkit** solves "how a path becomes vision capability" (intent-aware image Q&A, long-screenshot OCR, UI restoration, grounding, pixel diff — 10 structured vision tools, with DSH Credentials / managed runtime / Web Settings).
>
> Install: `dsh plugin --profile web add <path-to-dsh-vision-toolkit>` (see its repo README). Together they give a text-only model an experience close to a native multimodal model.

| Scenario | Before | Now |
|---|---|---|
| Image Q&A | screenshot → save to workspace → type path | screenshot → Ctrl+V → Enter |
| Multi-image diff (pixel diff) | same, type every path | just send two images |
| Long-screenshot OCR / UI restoration | same | just send the image |

## Comparison with similar plugins

- [dsh-drag-and-drop](https://github.com/bill9109/dsh-drag-and-drop): dropping a file inserts its **raw path** into the composer, no file copying. Great for referencing files already in the workspace; images are still sent as attachments (still rejected by text-only models), and paste is not supported.
- **This plugin**: keeps the native attachment UI (preview / remove), **automatically copies images to the workspace and converts them to paths on send**, supports paste and drag-and-drop. Built specifically for "sending images to a text-only model".

They are complementary: use dsh-drag-and-drop to reference existing files, use this plugin to send screenshots.

## Installation

Requirements: DeepSeek Harness (Web profile), Node.js, `dsh` CLI.

```sh
# Option 1: install via dsh plugin (recommended)
dsh plugin --profile web add /path/to/dsh-drop-to-path

# Option 2: manual (matches this repo layout)
# 1. add to dependencies in package.json:
#    "@dsh-external/dsh-drop-to-path": "link:/path/to/dsh-drop-to-path"
# 2. add to dsh.profile.bundles: "@dsh-external/dsh-drop-to-path"
# 3. copy the directory (including lib/) into profiles/<name>/node_modules/@dsh-external/dsh-drop-to-path
```

**Restart the Web profile** after installing (relaunch the launcher / restart `dsh web`). No settings to configure.

## Usage

1. Paste or drop images as usual — the attachment cards behave natively (preview / remove);
2. You can add text, and multiple images;
3. Hit send — no image attachment appears in the message; the model receives file paths;
4. The agent (paired with dsh-vision-toolkit) automatically reads the images with `vision_glance` / `vision_pixel_diff` and friends.

Images are stored under `<workspace>/.drops/`; clean them up whenever you like.

## File structure

```
dsh-drop-to-path/
├─ package.json        bundle manifest (dsh.bundle.patch / dsh.client)
├─ cordis.patch.yml    mount row (insert drop-to-path)
├─ lib/
│  ├─ index.js         host:POST /_dsh/drop-to-path/import route
│  └─ client.js        browser: wraps conversation.sendSession
├─ README.md
├─ README.zh.md
└─ ADAPTING.md         upgrade adaptation guide (read before upgrading DSH)
```

## Implementation notes

- **host side** (`lib/index.js`): registers the `webServer` route `POST /_dsh/drop-to-path/import`, accepts `{ name, dataBase64 }`, validates (png/jpg/jpeg/webp/gif only, ≤30MB, sanitized file names against path traversal), writes into the session workspace `.drops/`, returns `{ ok, value: { path } }`.
- **Workspace resolution**: reads `$DSH_HOME/storages/workspace.json` (the durable workspace registry) and picks the workspace with the newest `updatedAt`.
- **browser side** (`lib/client.js`): intercepts no DOM events; injects the `conversation` service via `exports.inject = ['conversation']` and wraps `conversation.sendSession` at instance level — uploads draft images and replaces them with a text block, otherwise forwards verbatim.
- **Failure fallback**: upload error → `console.error` + native `sendSession`, messages are never lost.

## Compatibility

| DSH version | Status |
|---|---|
| 0.1.0-rc.6 (verified in this repo's environment) | ✅ Works |

This plugin depends on several **undocumented internal interfaces** of DSH (service names, method signatures, storage formats) and may break after a DSH upgrade. Read [`ADAPTING.md`](ADAPTING.md) before upgrading — it contains the failure symptoms and the fix steps.

## Contributing & adapting

- Issues / ideas: GitHub Issues.
- Plugin broken after a DSH upgrade: follow the symptom table in [`ADAPTING.md`](ADAPTING.md), fix, and append a row to the adaptation log.

## License

MIT
