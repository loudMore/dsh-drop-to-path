/**
 * dsh-drop-to-path — host side.
 *
 * Registers one exact HTTP route on the DSH webServer:
 *   POST /_dsh/drop-to-path/import  { name, dataBase64 }
 * Writes the decoded image into the active session workspace `.drops/`
 * directory and returns the absolute path, so the browser plugin can paste
 * that path into the composer and the text-only agent can read the image
 * with the vision toolkit.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

export const IMPORT_ROUTE = '/_dsh/drop-to-path/import'

const MAX_BODY_BYTES = 40 * 1024 * 1024 // JSON body cap (~30MB image in base64)
const MAX_IMAGE_BYTES = 30 * 1024 * 1024
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
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
  const dshHome = process.env.DSH_HOME
  if (!dshHome || dshHome.length === 0) throw new Error('DSH_HOME is not set')
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

/** Strip path separators and control characters from an uploaded file name. */
function safeName(raw) {
  const base = basename(String(raw ?? '')).replace(/[^\w.\-]+/g, '_').trim().slice(0, 120)
  return base.length === 0 ? 'image.png' : base
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
            const { name: rawName, dataBase64 } = body
            if (typeof dataBase64 !== 'string' || dataBase64.length === 0) {
              respond({ ok: false, error: { code: 'invalid-request', message: 'Missing dataBase64' } }, 400)
              return
            }
            const bytes = Buffer.from(dataBase64, 'base64')
            if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
              respond({ ok: false, error: { code: 'too-large', message: `Image exceeds ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)}MB` } }, 413)
              return
            }
            const safe = safeName(rawName)
            const dot = safe.lastIndexOf('.')
            const ext = (dot >= 0 ? safe.slice(dot) : '').toLowerCase()
            if (!IMAGE_EXTENSIONS.has(ext)) {
              respond({ ok: false, error: { code: 'unsupported-type', message: `Unsupported image extension "${ext}" (png/jpg/jpeg/webp/gif only)` } }, 415)
              return
            }
            const root = await workspaceRoot()
            const dir = join(root, DROP_DIR)
            await mkdir(dir, { recursive: true })
            const target = join(dir, `${Date.now()}-${safe}`)
            await writeFile(target, bytes)
            respond({ ok: true, value: { path: target, filename: basename(target), bytes: bytes.length } })
          } catch (error) {
            respond({ ok: false, error: { code: 'import-failed', message: error instanceof Error ? error.message : String(error) } }, 500)
          }
        },
      })
      return dispose
    }, 'drop-to-path: import route')
  })
}
