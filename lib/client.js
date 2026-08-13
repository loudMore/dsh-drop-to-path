/**
 * dsh-drop-to-path — browser side.
 *
 * Two behaviors, one plugin:
 *
 * 1. IMAGES keep the native attachment experience (thumbnails, preview,
 *    remove). The submit path is wrapped: when the user sends a prompt that
 *    carries draft images, each image is uploaded to the host import route
 *    and the message content sent to the model is replaced by the returned
 *    workspace file paths — so a text-only model agent receives file
 *    addresses it can feed to the vision toolkit, instead of a rejected
 *    image attachment.
 *
 * 2. NON-IMAGE files (pdf / office / plain text / zip / video / audio) are
 *    shown as small square chips IN the attachment rail, same row as image
 *    thumbnails (icon tile + truncated name, full name on hover). Nothing is
 *    written into the composer text; on send, the file paths are appended to
 *    the message automatically — exactly like the image conversion.
 *
 * Drop handling rules:
 *   - pure-image drop  → untouched, DSH handles it natively (rail + overlay);
 *   - file-only drop   → intercepted, files uploaded as paths + chips;
 *   - mixed drop       → files intercepted, images re-dispatched as a
 *     pure-image drop (which the pure-image rule lets through).
 * After intercepting, a synthetic `dragend` is dispatched so DSH closes its
 * full-screen drop overlay (it resets unconditionally on dragend).
 *
 * The sendSession wrapper is installed on the ConversationController
 * prototype (reached through the injected singleton), so any future instance
 * of the service inherits the patch. A failed upload is never silent: a
 * short page notice explains what happened before falling back to the
 * native send path.
 */

window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-drop-to-path',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var IMPORT_ROUTE = '/_dsh/drop-to-path/import'
    var PATCH_MARK = '__dshDropToPathPatched'
    var CHIPS_ATTR = 'data-drop-to-path-chips'
    var FILE_EXT_PATTERN = /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|json|zip|mp4|mov|webm|mkv|avi|mp3|wav|flac|m4a)$/i

    /** Non-image files dragged in this page: { path, name } in drop order. */
    var fileQueue = []

    function isImageFile(file) {
      return !!file && typeof file.type === 'string' && file.type.indexOf('image/') === 0
    }

    function isSupportedFile(file) {
      if (!file) return false
      if (isImageFile(file)) return true
      return FILE_EXT_PATTERN.test(file.name || '')
    }

    function toBase64(buffer) {
      var bytes = new Uint8Array(buffer)
      var binary = ''
      var chunk = 0x8000
      for (var i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
      }
      return btoa(binary)
    }

    /** Upload one file to the host and resolve its workspace path. */
    function upload(file) {
      return file.arrayBuffer().then(function (buffer) {
        return fetch(IMPORT_ROUTE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, dataBase64: toBase64(buffer) }),
        })
      }).then(function (response) {
        return response.json().then(function (result) {
          if (!response.ok || !result.ok) {
            throw new Error(result.error && result.error.message ? result.error.message : 'import failed')
          }
          return result.value.path
        })
      })
    }

    /** Short red notice near the top of the page; removed automatically. */
    function showNotice(message) {
      try {
        var existing = document.querySelector('[data-drop-to-path-notice]')
        if (existing) existing.remove()
        var box = document.createElement('div')
        box.dataset.dropToPathNotice = '1'
        box.textContent = message
        box.style.cssText = 'position:fixed;top:16px;right:16px;z-index:99999;max-width:420px;' +
          'background:#c34f4f;color:#fff;padding:10px 14px;border-radius:10px;' +
          'font:12px/1.5 sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35)'
        document.body.append(box)
        setTimeout(function () { box.remove() }, 6000)
      } catch (error) { /* notice is best-effort */ }
    }

    /** The DSH composer input. */
    function findComposer() {
      return document.querySelector('textarea')
    }

    // ---- file chips: small squares in the attachment rail, same row as images ----

    /** Per-format icon + accent color so chips are distinguishable at a glance. */
    function fileKind(name) {
      var n = String(name || '').toLowerCase()
      if (/\.pdf$/.test(n)) return { icon: '📕', color: '#d9534f' }
      if (/\.docx?$/.test(n)) return { icon: '📘', color: '#2b579a' }
      if (/\.xlsx?$/.test(n)) return { icon: '📗', color: '#217346' }
      if (/\.pptx?$/.test(n)) return { icon: '📙', color: '#d24726' }
      if (/\.(txt|md|csv|json)$/.test(n)) return { icon: '📄', color: '#6b7280' }
      if (/\.zip$/.test(n)) return { icon: '📦', color: '#b45309' }
      if (/\.(mp4|mov|webm|mkv|avi)$/.test(n)) return { icon: '🎬', color: '#7c3aed' }
      if (/\.(mp3|wav|flac|m4a)$/.test(n)) return { icon: '🎵', color: '#0e7490' }
      return { icon: '📄', color: '#6b7280' }
    }

    /** DSH attachment rail container (class suffix is stable per build). */
    function findRail() {
      return document.querySelector('[class*="_attachments"]')
    }

    /** Composer card container that also owns the rail. */
    function findCard(ta) {
      var scroll = ta.parentElement && ta.parentElement.parentElement
      return scroll ? scroll.parentElement : null
    }

    function renderChips() {
      var ta = findComposer()
      if (!ta) return
      var old = document.querySelector('[' + CHIPS_ATTR + ']')
      if (old) old.remove()
      if (fileQueue.length === 0) return

      var bar = document.createElement('div')
      bar.setAttribute(CHIPS_ATTR, '1')
      bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center'
      fileQueue.forEach(function (item) {
        var kind = fileKind(item.name)
        var chip = document.createElement('span')
        chip.style.cssText = 'position:relative;display:inline-flex;flex-direction:column;align-items:center;' +
          'justify-content:center;gap:2px;width:58px;height:58px;box-sizing:border-box;' +
          'border:1px solid rgba(92,108,213,.4);background:rgba(92,108,213,.08);' +
          'border-radius:8px;overflow:hidden'
        var iconBox = document.createElement('span')
        iconBox.textContent = kind.icon
        iconBox.style.cssText = 'font-size:24px;line-height:1'
        var label = document.createElement('span')
        label.textContent = item.name
        label.title = item.name
        label.style.cssText = 'max-width:52px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
          'font:9px/1.2 sans-serif;color:var(--dsw-alias-fg-tertiary,#6f7c99);padding:0 2px'
        var remove = document.createElement('button')
        remove.textContent = '✕'
        remove.title = '移除'
        remove.style.cssText = 'position:absolute;top:2px;right:2px;width:16px;height:16px;display:inline-flex;' +
          'align-items:center;justify-content:center;border:0;border-radius:50%;cursor:pointer;' +
          'background:rgba(0,0,0,.35);color:#fff;font-size:9px;line-height:1;padding:0'
        remove.addEventListener('click', function () { removeFile(item.path) })
        chip.append(iconBox, label, remove)
        bar.append(chip)
      })

      // Same row as image thumbnails when the rail exists; otherwise the top
      // of the composer card, right above the scroll area.
      var rail = findRail()
      if (rail) {
        rail.appendChild(bar)
      } else {
        var card = findCard(ta)
        if (!card) return
        var scroll = ta.parentElement.parentElement
        card.insertBefore(bar, scroll)
      }
    }

    function addFile(path, name) {
      fileQueue.push({ path: path, name: name })
      renderChips()
    }

    function removeFile(path) {
      fileQueue = fileQueue.filter(function (item) { return item.path !== path })
      renderChips()
    }

    function clearFiles() {
      fileQueue = []
      renderChips()
    }

    // Rebuild chips if a React re-render of the rail/card removed them.
    var chipsTimer = null
    function ensureChipsObserver(ta) {
      var card = findCard(ta)
      if (!card) return
      var observer = new MutationObserver(function () {
        if (fileQueue.length > 0 && document.querySelector('[' + CHIPS_ATTR + ']') === null) {
          clearTimeout(chipsTimer)
          chipsTimer = setTimeout(renderChips, 60)
        }
      })
      observer.observe(card, { childList: true, subtree: true })
    }

    /** Upload a batch of files in order, adding a chip per file (no composer text). */
    function enqueueFiles(files) {
      var chain = Promise.resolve()
      files.forEach(function (file) {
        chain = chain.then(function () { return upload(file) }).then(function (path) {
          addFile(path, file.name)
        }).catch(function (error) {
          console.error('[drop-to-path] file upload failed:', error)
          showNotice('[dsh-drop-to-path] 文件上传失败: ' + (error && error.message ? error.message : String(error)))
        })
      })
    }

    /** Intercept drops/pastes that contain non-image supported files. */
    function installFileInterception() {
      var onDrop = function (event) {
        var files = Array.prototype.slice.call(event.dataTransfer ? event.dataTransfer.files : [])
        var supported = files.filter(isSupportedFile)
        if (supported.length === 0) return
        var images = supported.filter(isImageFile)
        var others = supported.filter(function (f) { return !isImageFile(f) })

        // Pure-image drop: let DSH handle it natively (attachment rail,
        // overlay close, everything) — never intercept.
        if (others.length === 0) return

        // Mixed or file-only drop: intercept.
        event.preventDefault()
        event.stopPropagation()
        enqueueFiles(others)

        var target = event.target
        // Mixed drop: re-dispatch the images as a pure-image drop. The
        // pure-image rule above lets it through, so DSH builds its native
        // rail and closes the overlay itself.
        if (images.length > 0) {
          try {
            var dt = new DataTransfer()
            images.forEach(function (f) { dt.items.add(f) })
            setTimeout(function () {
              try {
                target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
              } catch (error) {
                console.error('[drop-to-path] image re-dispatch failed, uploading as paths:', error)
                enqueueFiles(images)
              }
            }, 0)
          } catch (error) {
            console.error('[drop-to-path] image re-dispatch setup failed, uploading as paths:', error)
            enqueueFiles(images)
          }
        }

        // DSH closes its full-screen drop overlay on `dragend` (window
        // listener, unconditional). Dispatch one so the overlay never stays
        // stuck when no pure-image drop reached DSH.
        setTimeout(function () {
          try {
            window.dispatchEvent(new DragEvent('dragend'))
          } catch (error) { /* best-effort */ }
        }, 0)
      }

      var onPaste = function (event) {
        var files = Array.prototype.slice.call(event.clipboardData ? event.clipboardData.files : [])
        var supported = files.filter(isSupportedFile)
        if (supported.length === 0) return
        // Pure image paste keeps the native flow (attachment + send conversion).
        if (supported.every(isImageFile)) return
        event.preventDefault()
        event.stopPropagation()
        enqueueFiles(supported)
      }

      document.addEventListener('drop', onDrop, true)
      document.addEventListener('paste', onPaste, true)
      return function () {
        document.removeEventListener('drop', onDrop, true)
        document.removeEventListener('paste', onPaste, true)
      }
    }

    /** Wrap conversation.sendSession on the prototype: images + chips → paths. */
    function patchSendSession(conversation) {
      var proto = conversation.constructor && conversation.constructor.prototype
      if (!proto || typeof proto.sendSession !== 'function' || proto[PATCH_MARK]) return
      proto[PATCH_MARK] = true

      var original = proto.sendSession
      proto.sendSession = async function (session, text, imageIds, mode) {
        var filePaths = fileQueue.map(function (item) { return item.path })
        var hasImages = !!imageIds && imageIds.length > 0

        // Plain text, nothing queued: behave exactly like the product.
        if (!hasImages && filePaths.length === 0) return original.call(this, session, text, imageIds, mode)

        var attachments = []
        if (hasImages) {
          attachments = typeof this.draftImages === 'function' ? this.draftImages(imageIds) : []
          if (attachments.length !== imageIds.length) return original.call(this, session, text, imageIds, mode)
        }

        var paths = filePaths.slice()
        try {
          if (hasImages) {
            for (var i = 0; i < attachments.length; i++) {
              var file = attachments[i] && attachments[i].file
              if (!file) continue
              paths.push(await upload(file))
            }
          }
        } catch (error) {
          // Upload failed: tell the user why, then fall back to the native
          // path (the model preflight shows its usual rejection toast).
          var reason = error && error.message ? error.message : String(error)
          console.error('[drop-to-path] image upload failed, sending as attachment:', error)
          showNotice('[dsh-drop-to-path] 图片上传失败,已按原生附件发送: ' + reason)
          return original.call(this, session, text, imageIds, mode)
        }
        if (paths.length === 0) return original.call(this, session, text, imageIds, mode)

        var lines = paths.join('\n')
        var body = text && text.trim().length > 0 ? lines + '\n' + text : lines
        var result = await session.prompt([{ type: 'text', text: body }], mode)
        if (!result.ok) {
          throw new Error('conversation.send failed: ' + result.error.code + ': ' + result.error.message)
        }
        if (hasImages && typeof this.releaseDraftImages === 'function') this.releaseDraftImages(attachments)
        clearFiles()
      }
    }

    function apply(ctx) {
      // Make the DSH attachment rail lay out horizontally (native style is
      // display:block → image thumbnails and file chips stack vertically).
      try {
        var styleId = 'dsh-drop-to-path-style'
        if (!document.getElementById(styleId)) {
          var style = document.createElement('style')
          style.id = styleId
          style.textContent = '[class*="_attachments"]{display:flex;flex-wrap:wrap;align-items:center;gap:8px}'
          document.head.append(style)
        }
      } catch (error) { /* best-effort */ }

      var conversation = ctx.conversation
      if (conversation && typeof conversation.sendSession === 'function') {
        patchSendSession(conversation)
      }
      var ta = findComposer()
      if (ta) ensureChipsObserver(ta)
      ctx.effect(installFileInterception, 'drop-to-path: non-image file interception')
    }

    exports.inject = ['conversation']
    exports.apply = apply
    return module.exports
  },
})
