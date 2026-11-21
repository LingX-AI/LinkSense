import { desktopSlug, desktopVersion } from "./version.mjs";

export default ({ command }: { command: string }) => {
  // scripts/desktop-update.mjs validates these inputs and selects the root
  // that matches the candidate's channel. Only public values and a path reach
  // this configuration; the private key itself stays in a 0600 file.
  const version = process.env.LINKSENSE_DESKTOP_VERSION || desktopVersion;
  const updateUrl = process.env.LINKSENSE_DESKTOP_UPDATE_CONFIG_URL;
  const updatePublicKey = process.env.LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY;
  const updatePrivateKey = process.env.LINKSENSE_DESKTOP_UPDATE_PRIVATE_KEY_FILE;
  return {
    name: "LinkSense",
    slug: desktopSlug,
    identifier: "org.linksense.desktop",
    version,
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
    ...(updateUrl && {
      // MyGo writes the signed archive and update-<target>.json from the
      // signed and notarized app. `url` is the stable or beta directory
      // selected above; the build verifies the outputs before exposing them.
      updates: {
        publicKey: updatePublicKey,
        url: updateUrl,
        deltas: 3,
        ...(updatePrivateKey && { privateKey: updatePrivateKey }),
      },
    }),
    urlSchemes: ["linksense-desktop"],
    i18n: { dir: "locales", source: "zh-CN" },
  };
};
