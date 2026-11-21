import { readDesktopApplicationAnnotationConfig } from "./application-annotation-bridge"
import { installDesktopApplicationAnnotationBridge } from "./application-annotation-preload-install"

const config = readDesktopApplicationAnnotationConfig(window)
if (config) installDesktopApplicationAnnotationBridge(window, config)
