import type { ReactNode } from "react"

export function MarketplaceGovernanceRow({
  name,
  logo,
  description,
  status,
  metadata,
  notice,
  actions,
}: {
  name: string
  logo: ReactNode
  description: string
  status: ReactNode
  metadata?: ReactNode
  notice?: ReactNode
  actions?: ReactNode
}) {
  return (
    <article
      className="marketplace-governance-item -mx-4 px-4"
      aria-label={name}
    >
      {logo}
      <div className="marketplace-governance-copy">
        <div className="marketplace-governance-title-row">
          <h3 className="marketplace-governance-name" title={name}>
            {name}
          </h3>
          {status}
        </div>
        <p className="marketplace-governance-description" title={description}>
          {description}
        </p>
        {metadata && (
          <div className="marketplace-governance-meta">{metadata}</div>
        )}
        {notice}
      </div>
      {actions && (
        <div className="marketplace-governance-action">{actions}</div>
      )}
    </article>
  )
}
