/** Shared by inline previews and resource-backed previews served at their entry path. */
export const htmlPreviewShellDocument = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Interactive preview</title>
    <style>
      html,
      body {
        margin: 0;
        min-height: 0;
        background: transparent;
      }
    </style>
  </head>
  <body>
    <script>
      ;(() => {
        const shellReadyType = "linksense:assistant-html-preview:shell-ready"
        const initializeType = "linksense:assistant-html-preview:initialize"
        // Bundle HTML is capped at 20 MiB before preparation. Leave room for
        // the injected fit runtime and CSP metadata without accepting an
        // unbounded cross-window payload.
        const maximumDocumentLength = 21 * 1024 * 1024
        const previewId = new URLSearchParams(window.location.search).get(
          "previewId"
        )
        if (!previewId || previewId.length > 256) return

        let initialized = false
        let readyInterval = 0
        const announceReady = () => {
          if (initialized) {
            window.clearInterval(readyInterval)
            return
          }
          parent.postMessage({ type: shellReadyType, previewId }, "*")
        }
        window.addEventListener("message", (event) => {
          if (
            initialized ||
            event.source !== parent ||
            event.origin !== window.location.origin
          ) {
            return
          }
          const message = event.data
          if (
            typeof message !== "object" ||
            message === null ||
            message.type !== initializeType ||
            message.previewId !== previewId ||
            typeof message.html !== "string" ||
            message.html.length > maximumDocumentLength
          ) {
            return
          }

          initialized = true
          window.clearInterval(readyInterval)
          document.open()
          document.write(message.html)
          document.close()
        })

        announceReady()
        readyInterval = window.setInterval(announceReady, 500)
      })()
    </script>
  </body>
</html>
`;
