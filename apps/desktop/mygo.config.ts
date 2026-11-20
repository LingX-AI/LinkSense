export default ({ command }: { command: string }) => ({
  name: "LinkSense",
  slug: "linksense-desktop",
  identifier: "org.linksense.desktop",
  version: "0.1.0",
  buildCommand: "pnpm --dir ../.. desktop:build-web",
  frontendDist: "../web/dist",
  bindings: "../web/src/adapters/desktop/mygo.ts",
  out: "build",
  macos: {
    icon: "AppIcon.icns",
    signingIdentity: "-",
    ...(command === "build" && process.env.LINKSENSE_DESKTOP_MACOS_RELEASE === "1" && {
      notarize: { keychainProfile: "linksense-desktop-notary" },
      helperEntitlements: { "runtime/bin/node": "node-release.entitlements.plist" },
    }),
  },
  urlSchemes: ["linksense-desktop"],
  i18n: { dir: "locales", source: "zh-CN" },
})
