import { useEffect, useMemo, useState } from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderOpenIcon,
  SearchIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { FileTypeIcon } from "@/components/media/file-type-icon"
import {
  loadArchivePreviewEntry,
  loadArchivePreviewManifest,
} from "@/components/media/archive-preview/archive-preview-loader"
import {
  getArchiveEntryPreviewKind,
  getArchiveEntryPreviewMimeType,
  getArchiveBreadcrumbPaths,
  getArchivePreviewChildren,
  getArchivePreviewFileType,
  type ArchiveEntryPreviewKind,
  type ArchivePreviewItem,
  type ArchivePreviewManifest,
} from "@/components/media/archive-preview/archive-preview-utils"
import { OfficePreviewShell } from "@/components/media/office-preview/office-preview-shell"
import { OfficePreviewLoadingState } from "@/components/media/office-preview/office-preview-loading-state"
import type {
  OfficeDocumentState,
  OfficePreviewUpdateAction,
} from "@/components/media/office-preview/office-preview.types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  CodePreviewWrapButton,
  ReadOnlyFilePreviewContent,
} from "@/components/media/read-only-file-preview/read-only-file-preview"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime, formatFileSize } from "@/i18n/date"
import { cn } from "@/lib/utils"

type ArchiveManifestState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error" }>
  | Readonly<{ status: "ready"; manifest: ArchivePreviewManifest }>

type ResolvedArchiveManifestState =
  | Readonly<{
      content: Uint8Array
      status: "error"
    }>
  | Readonly<{
      content: Uint8Array
      status: "ready"
      manifest: ArchivePreviewManifest
    }>

type ArchiveEntryPreviewState =
  | Readonly<{
      item: ArchivePreviewItem
      kind: ArchiveEntryPreviewKind
      status: "loading"
    }>
  | Readonly<{
      item: ArchivePreviewItem
      kind: ArchiveEntryPreviewKind
      status: "error"
    }>
  | Readonly<{
      item: ArchivePreviewItem
      kind: ArchiveEntryPreviewKind
      status: "ready"
      content: Uint8Array
    }>

type ArchivePreviewProps = Readonly<{
  document: OfficeDocumentState
  fileName: string
  mimeType: string
  onRetry?: () => void
  onDownload?: () => void
  updateAction?: OfficePreviewUpdateAction
  onClose?: () => void
  className?: string
}>

const ARCHIVE_EMPTY_VALUE = "-"

function ArchiveDirectoryTree({
  manifest,
  currentPath,
  onSelect,
  rootLabel,
  folderLabel,
}: Readonly<{
  manifest: ArchivePreviewManifest
  currentPath: string
  onSelect: (path: string) => void
  rootLabel: string
  folderLabel: string
}>) {
  const renderDirectories = (parentPath: string) => {
    const directories = getArchivePreviewChildren(manifest, parentPath).filter(
      (item) => item.kind === "directory"
    )
    if (!directories.length) return null

    return (
      <ul className="archive-preview-tree-list">
        {directories.map((directory) => (
          <li key={directory.id}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="archive-preview-tree-button"
              aria-current={directory.path === currentPath ? "page" : undefined}
              onClick={() => onSelect(directory.path)}
            >
              <FileTypeIcon
                filename={directory.name}
                mimeType="inode/directory"
              />
              <span className="truncate">{directory.name}</span>
            </Button>
            {renderDirectories(directory.path)}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <nav className="archive-preview-tree" aria-label={folderLabel}>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="archive-preview-tree-button"
        aria-current={currentPath === "" ? "page" : undefined}
        onClick={() => onSelect("")}
      >
        <FolderOpenIcon aria-hidden="true" />
        <span className="truncate">{rootLabel}</span>
      </Button>
      {renderDirectories("")}
    </nav>
  )
}

function ArchiveItemName({
  item,
  onOpenDirectory,
  onOpenEntry,
}: Readonly<{
  item: ArchivePreviewItem
  onOpenDirectory: (path: string) => void
  onOpenEntry: (item: ArchivePreviewItem) => void
}>) {
  const { t } = useTranslation()
  const icon = (
    <FileTypeIcon
      filename={item.name}
      mimeType={item.kind === "directory" ? "inode/directory" : undefined}
    />
  )

  if (item.kind !== "directory") {
    const previewKind = getArchiveEntryPreviewKind(item)
    if (previewKind) {
      return (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="archive-preview-item-button"
          aria-label={t("archivePreview.previewFile", { name: item.name })}
          onClick={() => onOpenEntry(item)}
        >
          {icon}
          <span className="truncate">{item.name}</span>
        </Button>
      )
    }

    return (
      <span className="archive-preview-item-name">
        {icon}
        <span className="truncate">{item.name}</span>
      </span>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="archive-preview-item-button"
      onClick={() => onOpenDirectory(item.path)}
    >
      {icon}
      <span className="truncate">{item.name}</span>
    </Button>
  )
}

function ArchiveEntryPreview({
  entry,
  onBack,
  onRetry,
}: Readonly<{
  entry: ArchiveEntryPreviewState
  onBack: () => void
  onRetry: () => void
}>) {
  const { t } = useTranslation()
  const [codeWrap, setCodeWrap] = useState(true)
  const mimeType = getArchiveEntryPreviewMimeType(entry.item)
  const supportsCodeWrap = entry.kind === "code" || entry.kind === "text"

  return (
    <section
      className="archive-preview-entry"
      aria-label={t("archivePreview.entryPreview", { name: entry.item.name })}
    >
      <div className="archive-preview-entry-toolbar">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="archive-preview-entry-back-button"
          onClick={onBack}
        >
          <ChevronLeftIcon aria-hidden="true" data-icon="inline-start" />
          {t("archivePreview.backToFiles")}
        </Button>
        <div className="archive-preview-entry-file" title={entry.item.name}>
          <FileTypeIcon filename={entry.item.name} mimeType={mimeType} />
          <span className="truncate">{entry.item.name}</span>
          <span className="archive-preview-entry-read-only">
            {t("filePreview.readOnly")}
          </span>
        </div>
        {entry.status === "ready" && supportsCodeWrap && (
          <div className="archive-preview-entry-actions">
            <CodePreviewWrapButton wrap={codeWrap} onWrapChange={setCodeWrap} />
          </div>
        )}
      </div>
      <div className="archive-preview-entry-content">
        {entry.status === "loading" && (
          <OfficePreviewLoadingState
            label={t("archivePreview.entryLoading", { name: entry.item.name })}
          />
        )}
        {entry.status === "error" && (
          <div className="office-preview-state" role="alert">
            <p>{t("archivePreview.entryLoadFailed")}</p>
            <Button type="button" variant="secondary" onClick={onRetry}>
              {t("common.retry")}
            </Button>
          </div>
        )}
        {entry.status === "ready" && (
          <ReadOnlyFilePreviewContent
            document={{ status: "ready", content: entry.content }}
            fileName={entry.item.name}
            kind={entry.kind}
            mimeType={mimeType}
            codeWrap={supportsCodeWrap ? codeWrap : undefined}
            onCodeWrapChange={supportsCodeWrap ? setCodeWrap : undefined}
            showCodeToolbar={!supportsCodeWrap}
          />
        )}
      </div>
    </section>
  )
}

function ArchivePreviewContents({
  manifest,
  archiveContent,
}: Readonly<{
  manifest: ArchivePreviewManifest
  archiveContent: Uint8Array
}>) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const [currentPath, setCurrentPath] = useState("")
  const [query, setQuery] = useState("")
  const [entryPreview, setEntryPreview] =
    useState<ArchiveEntryPreviewState | null>(null)
  const breadcrumbs = getArchiveBreadcrumbPaths(currentPath)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleItems = useMemo(
    () =>
      normalizedQuery
        ? manifest.entries.filter((item) =>
            item.path.toLocaleLowerCase().includes(normalizedQuery)
          )
        : getArchivePreviewChildren(manifest, currentPath),
    [currentPath, manifest, normalizedQuery]
  )
  const isSearching = normalizedQuery.length > 0

  const openDirectory = (path: string) => {
    setCurrentPath(path)
    setQuery("")
  }
  const openEntry = (item: ArchivePreviewItem) => {
    const kind = getArchiveEntryPreviewKind(item)
    if (!kind) return
    setEntryPreview({ item, kind, status: "loading" })
  }
  const fileType = (item: ArchivePreviewItem) =>
    item.kind === "directory"
      ? t("archivePreview.folder")
      : (getArchivePreviewFileType(item.name) ?? t("archivePreview.file"))

  useEffect(() => {
    if (!entryPreview || entryPreview.status !== "loading") return

    const controller = new AbortController()
    const { item, kind } = entryPreview
    void loadArchivePreviewEntry(archiveContent, item, controller.signal)
      .then((content) => {
        if (!controller.signal.aborted) {
          setEntryPreview((current) =>
            current?.status === "loading" && current.item.id === item.id
              ? { content, item, kind, status: "ready" }
              : current
          )
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setEntryPreview((current) =>
            current?.status === "loading" && current.item.id === item.id
              ? { item, kind, status: "error" }
              : current
          )
        }
      })

    return () => controller.abort()
  }, [archiveContent, entryPreview])

  if (entryPreview) {
    return (
      <ArchiveEntryPreview
        entry={entryPreview}
        onBack={() => setEntryPreview(null)}
        onRetry={() =>
          setEntryPreview((current) =>
            current
              ? { item: current.item, kind: current.kind, status: "loading" }
              : current
          )
        }
      />
    )
  }

  return (
    <div className="archive-preview-workspace">
      <div className="archive-preview-toolbar">
        <nav
          className="archive-preview-breadcrumbs"
          aria-label={t("archivePreview.breadcrumb")}
        >
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="archive-preview-breadcrumb-button"
            onClick={() => openDirectory("")}
          >
            {t("archivePreview.root")}
          </Button>
          {breadcrumbs.map((breadcrumb) => (
            <span key={breadcrumb.path} className="contents">
              <ChevronRightIcon
                className="archive-preview-breadcrumb-separator"
                aria-hidden="true"
              />
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="archive-preview-breadcrumb-button"
                aria-current={
                  breadcrumb.path === currentPath ? "page" : undefined
                }
                onClick={() => openDirectory(breadcrumb.path)}
              >
                {breadcrumb.name}
              </Button>
            </span>
          ))}
        </nav>
        <div className="archive-preview-toolbar-actions">
          <span className="archive-preview-summary">
            {t("archivePreview.summary", {
              files: manifest.totalFiles,
              folders: manifest.totalFolders,
            })}
          </span>
          <InputGroup className="archive-preview-search">
            <InputGroupInput
              aria-label={t("archivePreview.searchLabel")}
              placeholder={t("archivePreview.searchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <InputGroupAddon align="inline-start">
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
          </InputGroup>
        </div>
      </div>

      {manifest.skippedEntryCount > 0 && (
        <p className="archive-preview-safety-note" role="status">
          {t("archivePreview.skippedEntries", {
            count: manifest.skippedEntryCount,
          })}
        </p>
      )}

      <div className="archive-preview-content">
        <ArchiveDirectoryTree
          manifest={manifest}
          currentPath={currentPath}
          onSelect={openDirectory}
          rootLabel={t("archivePreview.root")}
          folderLabel={t("archivePreview.folderTreeLabel")}
        />
        <section
          className="archive-preview-list"
          aria-label={t("archivePreview.listLabel")}
        >
          {visibleItems.length ? (
            <Table className="archive-preview-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("archivePreview.name")}</TableHead>
                  <TableHead className="archive-preview-type-column">
                    {t("archivePreview.type")}
                  </TableHead>
                  <TableHead className="archive-preview-size-column">
                    {t("archivePreview.compressedSize")}
                  </TableHead>
                  <TableHead className="archive-preview-size-column">
                    {t("archivePreview.originalSize")}
                  </TableHead>
                  <TableHead className="archive-preview-date-column">
                    {t("archivePreview.modifiedAt")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <ArchiveItemName
                        item={item}
                        onOpenDirectory={openDirectory}
                        onOpenEntry={openEntry}
                      />
                    </TableCell>
                    <TableCell className="archive-preview-type-column">
                      <span className="archive-preview-item-type">
                        {fileType(item)}
                      </span>
                      {item.encrypted && (
                        <Badge
                          variant="secondary"
                          className="archive-preview-encrypted-badge"
                        >
                          {t("archivePreview.encrypted")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="archive-preview-size-column">
                      {item.kind === "directory"
                        ? ARCHIVE_EMPTY_VALUE
                        : formatFileSize(item.compressedSize, language)}
                    </TableCell>
                    <TableCell className="archive-preview-size-column">
                      {item.kind === "directory"
                        ? ARCHIVE_EMPTY_VALUE
                        : formatFileSize(item.uncompressedSize, language)}
                    </TableCell>
                    <TableCell className="archive-preview-date-column">
                      {item.modifiedAt
                        ? formatDateTime(item.modifiedAt, language)
                        : ARCHIVE_EMPTY_VALUE}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="archive-preview-empty-state">
              {isSearching
                ? t("archivePreview.noSearchResults")
                : t("archivePreview.emptyFolder")}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export default function ArchivePreview({
  document,
  fileName,
  mimeType,
  onRetry,
  onDownload,
  updateAction,
  onClose,
  className,
}: ArchivePreviewProps) {
  const { t } = useTranslation()
  const [resolvedManifestState, setResolvedManifestState] =
    useState<ResolvedArchiveManifestState | null>(null)
  const archiveContent = document.status === "ready" ? document.content : null

  useEffect(() => {
    if (!archiveContent) return

    const controller = new AbortController()
    void loadArchivePreviewManifest(archiveContent, controller.signal)
      .then((manifest) => {
        if (!controller.signal.aborted) {
          setResolvedManifestState({
            content: archiveContent,
            status: "ready",
            manifest,
          })
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setResolvedManifestState({ content: archiveContent, status: "error" })
        }
      })
    return () => controller.abort()
  }, [archiveContent])

  const manifestState: ArchiveManifestState =
    document.status === "error"
      ? { status: "error" }
      : !archiveContent || resolvedManifestState?.content !== archiveContent
        ? { status: "loading" }
        : resolvedManifestState.status === "ready"
          ? { status: "ready", manifest: resolvedManifestState.manifest }
          : { status: "error" }

  const shellDocument: OfficeDocumentState =
    document.status === "error" || manifestState.status === "error"
      ? { status: "error" }
      : document.status === "ready" && manifestState.status === "ready"
        ? document
        : { status: "loading" }
  const archivePreviewContent =
    document.status === "ready" && manifestState.status === "ready"
      ? document.content
      : null
  const archivePreviewManifest =
    manifestState.status === "ready" ? manifestState.manifest : null

  return (
    <OfficePreviewShell
      document={shellDocument}
      fileName={fileName}
      mimeType={mimeType}
      onRetry={onRetry}
      onDownload={shellDocument.status === "ready" ? onDownload : undefined}
      updateAction={updateAction}
      onClose={onClose}
      className={cn("archive-preview-pane", className)}
      bodyClassName="archive-preview-body"
      loadingLabel={t("archivePreview.loading")}
      loadFailedLabel={t("archivePreview.loadFailed")}
    >
      {shellDocument.status === "ready" &&
      archivePreviewContent &&
      archivePreviewManifest ? (
        <ArchivePreviewContents
          archiveContent={archivePreviewContent}
          manifest={archivePreviewManifest}
        />
      ) : (
        <OfficePreviewLoadingState label={t("archivePreview.loading")} />
      )}
    </OfficePreviewShell>
  )
}
