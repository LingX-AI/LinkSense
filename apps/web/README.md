# React + TypeScript + Vite + shadcn/ui

This is a template for a new Vite project with React, TypeScript, and shadcn/ui.

## Adding components

To add components to your app, run the following command:

```bash
npx shadcn@latest add button
```

This will place the ui components in the `src/components` directory.

## Using components

To use the components in your app, import them as follows:

```tsx
import { Button } from "@/components/ui/button"
```

## iOS 主屏幕启动 / iOS Home Screen launch

部署更新后，用 Safari 打开 LinkSense，选择「分享 → 添加到主屏幕」，如有「作为 Web App 打开」选项，请开启。旧图标可能保留原来的启动方式；如果仍显示地址栏和底部浏览器工具栏，请移除旧图标后重新添加。时间、信号和电量属于系统状态栏，独立运行模式仍会保留。

After deploying the update, open LinkSense in Safari and choose Share → Add to Home Screen. Enable Open as Web App when offered. Existing icons may retain their previous launch mode; remove and re-add the icon if browser bars remain. The system status bar (time, signal and battery) remains visible in standalone mode.

`public/manifest.json` declares standalone launch with `/` as both the start URL and scope, keeping application routes within the installed app. The HTML also declares iOS standalone capability before JavaScript loads. These use native browser support and require no service worker or offline cache. Verify launch behavior on an actual iPhone after deployment; unit tests validate the metadata and public assets, not iOS installation behavior.
