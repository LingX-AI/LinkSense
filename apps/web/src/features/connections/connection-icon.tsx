import type { ConnectionProvider } from "@linksense/shared"
import oneDriveLogo from "./assets/onedrive.svg"
import sharePointLogo from "./assets/sharepoint.svg"
import googleDocsLogo from "./assets/google-docs.png"
import gmailLogo from "./assets/gmail.png"
import outlookLogo from "./assets/outlook.svg"

const logos: Record<ConnectionProvider, string> = {
  onedrive: oneDriveLogo,
  sharepoint: sharePointLogo,
  google_docs: googleDocsLogo,
  gmail: gmailLogo,
  outlook: outlookLogo,
}

export function ConnectionIcon({ provider }: { provider: ConnectionProvider }) {
  return (
    <img
      src={logos[provider]}
      alt=""
      aria-hidden="true"
      className="size-10 shrink-0 object-contain"
    />
  )
}
