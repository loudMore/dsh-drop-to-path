/**
 * dsh-drop-to-path — host side.
 *
 * Registers one exact HTTP route on the DSH webServer:
 *   POST /_dsh/drop-to-path/import  { name, dataBase64 }
 * Writes the decoded file into the active session workspace `.drops/`
 * directory and returns the absolute path.
 *
 * Two kinds of files are accepted:
 *   - images (png/jpg/jpeg/webp/gif, ≤30MB)  → sent via the wrapped
 *     conversation.sendSession while keeping the native attachment UI;
 *   - documents/media (pdf/office/plain/zip/video/audio, ≤100MB) → inserted
 *     into the composer as a plain path by the browser side.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'

export const IMPORT_ROUTE = '/_dsh/drop-to-path/import'

const MAX_BODY_BYTES = 140 * 1024 * 1024 // JSON body cap (~100MB file in base64)
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const FILE_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.md', '.csv', '.json', '.zip',
  '.mp4', '.mov', '.webm', '.mkv', '.avi', '.mp3', '.wav', '.flac', '.m4a',
])
const MAX_IMAGE_BYTES = 30 * 1024 * 1024
const MAX_FILE_BYTES = 100 * 1024 * 1024
const DROP_DIR = '.drops'

export const name = '@dsh-external/dsh-drop-to-path'

/** Read the whole request body as UTF-8 text with a hard size cap. */
async function readBody(req, limit) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > limit) throw new Error('payload too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Resolve the active session workspace root from the durable workspace registry. */
async function workspaceRoot() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const store = join(dshHome, 'storages', 'workspace.json')
  let parsed
  try {
    parsed = JSON.parse(await readFile(store, 'utf8'))
  } catch (error) {
    throw new Error(`cannot read workspace registry: ${error instanceof Error ? error.message : String(error)}`)
  }
  const workspaces = parsed?.tables?.workspaces
  if (typeof workspaces !== 'object' || workspaces === null) throw new Error('workspace registry is empty')
  const ids = Object.keys(workspaces)
  if (ids.length === 0) throw new Error('no workspace registered')
  let best = ids[0]
  for (const id of ids) {
    if ((workspaces[id].updatedAt ?? '') > (workspaces[best].updatedAt ?? '')) best = id
  }
  const path = workspaces[best]?.path
  if (typeof path !== 'string' || path.length === 0) throw new Error('workspace has no path')
  return path
}

/** Strip path separators and control characters from an uploaded file name.
 *  Unicode (Chinese etc.), spaces and dots are preserved; only characters
 *  that are illegal in Windows file names are replaced. */
function safeName(raw) {
  const base = basename(String(raw ?? ''))
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .trim()
    .slice(0, 120)
  return base.length === 0 ? 'file' : base
}

export async function apply(ctx) {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const dispose = webCtx.webServer.register({
        kind: 'exact',
        path: IMPORT_ROUTE,
        handler: async (req, res) => {
          const respond = (value, status = 200) => {
            res.writeHead(status, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(value))
          }
          try {
            if (req.method !== 'POST') {
              respond({ ok: false, error: { code: 'method-not-allowed', message: 'Use POST' } }, 405)
              return
            }
            let body
            try {
              body = JSON.parse(await readBody(req, MAX_BODY_BYTES))
            } catch (error) {
              respond({ ok: false, error: { code: 'invalid-request', message: error instanceof Error ? error.message : String(error) } }, 400)
              return
            }
            const { name: rawName, dataBase64, workspace: clientWorkspace } = body
            if (typeof dataBase64 !== 'string' || dataBase64.length === 0) {
              respond({ ok: false, error: { code: 'invalid-request', message: 'Missing dataBase64' } }, 400)
              return
            }
            // Trust the client-supplied active workspace only when it is an
            // absolute path; otherwise fall back to the registry scan so a
            // stale or tampered payload can never write outside a real root.
            const root = typeof clientWorkspace === 'string' && isAbsolute(clientWorkspace)
              ? clientWorkspace
              : await workspaceRoot()
            const bytes = Buffer.from(dataBase64, 'base64')
            const safe = safeName(rawName)
            const dot = safe.lastIndexOf('.')
            const ext = (dot >= 0 ? safe.slice(dot) : '').toLowerCase()

            let kind, limit
            if (IMAGE_EXTENSIONS.has(ext)) { kind = 'image'; limit = MAX_IMAGE_BYTES }
            else if (FILE_EXTENSIONS.has(ext)) { kind = 'file'; limit = MAX_FILE_BYTES }
            else {
              respond({ ok: false, error: { code: 'unsupported-type', message: `Unsupported file extension "${ext}"` } }, 415)
              return
            }
            if (bytes.length === 0 || bytes.length > limit) {
              respond({ ok: false, error: { code: 'too-large', message: `File exceeds ${Math.floor(limit / 1024 / 1024)}MB` } }, 413)
              return
            }
            const dir = join(root, DROP_DIR)
            await mkdir(dir, { recursive: true })
            const target = join(dir, `${Date.now()}-${safe}`)
            await writeFile(target, bytes)
            respond({ ok: true, value: { path: target, filename: basename(target), bytes: bytes.length, kind } })
          } catch (error) {
            respond({ ok: false, error: { code: 'import-failed', message: error instanceof Error ? error.message : String(error) } }, 500)
          }
        },
      })
      return dispose
    }, 'drop-to-path: import route')
  })
}
