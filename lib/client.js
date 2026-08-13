/**
 * dsh-drop-to-path — browser side.
 *
 * The composer keeps its native attachment experience (thumbnails, preview,
 * remove). Only the submit path is wrapped: when the user sends a prompt that
 * carries draft images, each image is uploaded to the host import route and
 * the message content sent to the model is replaced by the returned workspace
 * file paths — so a text-only model agent receives file addresses it can feed
 * to the vision toolkit, instead of a rejected image attachment.
 */

window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-drop-to-path',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var IMPORT_ROUTE = '/_dsh/drop-to-path/import'

    function toBase64(buffer) {
      var bytes = new Uint8Array(buffer)
      var binary = ''
      var chunk = 0x8000
      for (var i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
      }
      return btoa(binary)
    }

    /** Upload one image file to the host and resolve its workspace path. */
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

    function apply(ctx) {
      var conversation = ctx.conversation
      if (!conversation || typeof conversation.sendSession !== 'function') return
      var original = conversation.sendSession.bind(conversation)

      conversation.sendSession = async function (session, text, imageIds, mode) {
        // No draft images: behave exactly like the product.
        if (!imageIds || imageIds.length === 0) return original(session, text, imageIds, mode)
        var attachments = typeof conversation.draftImages === 'function' ? conversation.draftImages(imageIds) : []
        if (attachments.length !== imageIds.length) return original(session, text, imageIds, mode)

        var paths = []
        try {
          for (var i = 0; i < attachments.length; i++) {
            var file = attachments[i] && attachments[i].file
            if (!file) continue
            paths.push(await upload(file))
          }
        } catch (error) {
          // Upload failed: fall back to the native path (the model preflight
          // will reject the attachment with its usual toast) and log why.
          console.error('[drop-to-path] image upload failed, sending as attachment:', error)
          return original(session, text, imageIds, mode)
        }
        if (paths.length === 0) return original(session, text, imageIds, mode)

        var lines = paths.join('\n')
        var body = text && text.trim().length > 0 ? lines + '\n' + text : lines
        var result = await session.prompt([{ type: 'text', text: body }], mode)
        if (!result.ok) {
          throw new Error('conversation.send failed: ' + result.error.code + ': ' + result.error.message)
        }
        if (typeof conversation.releaseDraftImages === 'function') conversation.releaseDraftImages(attachments)
      }
    }

    exports.inject = ['conversation']
    exports.apply = apply
    return module.exports
  },
})
