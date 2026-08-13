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
 * 2. NON-IMAGE files (pdf / office / plain text / zip / video / audio) that
 *    DSH would otherwise refuse to attach are intercepted on drop/paste,
 *    uploaded to the workspace, and inserted into the composer as plain
 *    paths. No preview UI for those — the agent just gets the path.
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
    var FILE_EXT_PATTERN = /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|json|zip|mp4|mov|webm|mkv|avi|mp3|wav|flac|m4a)$/i

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

    /** Append a path line to the (React-controlled) textarea without breaking its state. */
    function insertPath(path) {
      var ta = findComposer()
      if (!ta) return
      var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      var current = ta.value
      var addition = (current.length === 0 || current.charAt(current.length - 1) === '\n' ? '' : '\n') + path + '\n'
      setter.call(ta, current + addition)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      ta.focus()
    }

    /** Intercept drops/pastes that contain non-image supported files. */
    function installFileInterception() {
      var onDrop = function (event) {
        var files = Array.prototype.slice.call(event.dataTransfer ? event.dataTransfer.files : [])
        var supported = files.filter(isSupportedFile)
        if (supported.length === 0) return
        event.preventDefault()
        event.stopPropagation()
        var images = supported.filter(isImageFile)
        var others = supported.filter(function (f) { return !isImageFile(f) })
        others.forEach(function (file) {
          upload(file).then(insertPath).catch(function (error) {
            console.error('[drop-to-path] file upload failed:', error)
            showNotice('[dsh-drop-to-path] 文件上传失败: ' + (error && error.message ? error.message : String(error)))
          })
        })
        // Re-dispatch a pure-image drop so DSH keeps its native attachment
        // UI for images dragged together with other files.
        if (images.length > 0) {
          var dt = new DataTransfer()
          images.forEach(function (f) { dt.items.add(f) })
          var target = event.target
          setTimeout(function () {
            target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
          }, 0)
        }
      }
      var onPaste = function (event) {
        var files = Array.prototype.slice.call(event.clipboardData ? event.clipboardData.files : [])
        var supported = files.filter(isSupportedFile)
        if (supported.length === 0) return
        // Pure image paste keeps the native flow (attachment + send conversion).
        if (supported.every(isImageFile)) return
        event.preventDefault()
        event.stopPropagation()
        supported.forEach(function (file) {
          upload(file).then(insertPath).catch(function (error) {
            console.error('[drop-to-path] file upload failed:', error)
            showNotice('[dsh-drop-to-path] 文件上传失败: ' + (error && error.message ? error.message : String(error)))
          })
        })
      }
      document.addEventListener('drop', onDrop, true)
      document.addEventListener('paste', onPaste, true)
      return function () {
        document.removeEventListener('drop', onDrop, true)
        document.removeEventListener('paste', onPaste, true)
      }
    }

    /** Wrap conversation.sendSession on the prototype: images → paths. */
    function patchSendSession(conversation) {
      var proto = conversation.constructor && conversation.constructor.prototype
      if (!proto || typeof proto.sendSession !== 'function' || proto[PATCH_MARK]) return
      proto[PATCH_MARK] = true

      var original = proto.sendSession
      proto.sendSession = async function (session, text, imageIds, mode) {
        // No draft images: behave exactly like the product.
        if (!imageIds || imageIds.length === 0) return original.call(this, session, text, imageIds, mode)
        var attachments = typeof this.draftImages === 'function' ? this.draftImages(imageIds) : []
        if (attachments.length !== imageIds.length) return original.call(this, session, text, imageIds, mode)

        var paths = []
        try {
          for (var i = 0; i < attachments.length; i++) {
            var file = attachments[i] && attachments[i].file
            if (!file) continue
            paths.push(await upload(file))
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
        if (typeof this.releaseDraftImages === 'function') this.releaseDraftImages(attachments)
      }
    }

    function apply(ctx) {
      var conversation = ctx.conversation
      if (conversation && typeof conversation.sendSession === 'function') {
        patchSendSession(conversation)
      }
      ctx.effect(installFileInterception, 'drop-to-path: non-image file interception')
    }

    exports.inject = ['conversation']
    exports.apply = apply
    return module.exports
  },
})
