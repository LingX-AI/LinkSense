import archiveIcon from "@/assets/file-icons/archive.svg"
import audioIcon from "@/assets/file-icons/audio.svg"
import codeIcon from "@/assets/file-icons/code.svg"
import configurationIcon from "@/assets/file-icons/configuration.svg"
import databaseServerIcon from "@/assets/file-icons/database-server.svg"
import databaseIcon from "@/assets/file-icons/database.svg"
import emailIcon from "@/assets/file-icons/email.svg"
import excelIcon from "@/assets/file-icons/excel.svg"
import executableIcon from "@/assets/file-icons/executable.svg"
import folderIcon from "@/assets/file-icons/folder.svg"
import gifIcon from "@/assets/file-icons/gif.svg"
import imageIcon from "@/assets/file-icons/image.svg"
import linkIcon from "@/assets/file-icons/link.svg"
import model3dIcon from "@/assets/file-icons/model-3d.svg"
import pdfIcon from "@/assets/file-icons/pdf.svg"
import powerpointIcon from "@/assets/file-icons/powerpoint.svg"
import textIcon from "@/assets/file-icons/text.svg"
import unknownIcon from "@/assets/file-icons/unknown.svg"
import videoIcon from "@/assets/file-icons/video.svg"
import wordIcon from "@/assets/file-icons/word.svg"
import wpsIcon from "@/assets/file-icons/wps.svg"

export const fileIconAssets = {
  archive: archiveIcon,
  audio: audioIcon,
  code: codeIcon,
  configuration: configurationIcon,
  database: databaseIcon,
  "database-server": databaseServerIcon,
  email: emailIcon,
  excel: excelIcon,
  executable: executableIcon,
  folder: folderIcon,
  gif: gifIcon,
  image: imageIcon,
  link: linkIcon,
  "model-3d": model3dIcon,
  pdf: pdfIcon,
  powerpoint: powerpointIcon,
  text: textIcon,
  unknown: unknownIcon,
  video: videoIcon,
  word: wordIcon,
  wps: wpsIcon,
} as const

export type FileIconKind = keyof typeof fileIconAssets

const fileIconKindByExtension: Readonly<Record<string, FileIconKind>> = {
  "3ds": "model-3d",
  "3mf": "model-3d",
  "7z": "archive",
  accdb: "database",
  aac: "audio",
  ai: "image",
  aiff: "audio",
  apk: "executable",
  app: "executable",
  avi: "video",
  bak: "database-server",
  bash: "code",
  bat: "executable",
  bin: "executable",
  blend: "model-3d",
  bmp: "image",
  bz2: "archive",
  c: "code",
  cab: "archive",
  cfg: "configuration",
  cmd: "executable",
  com: "executable",
  conf: "configuration",
  config: "configuration",
  cpp: "code",
  cs: "code",
  css: "code",
  csv: "excel",
  db: "database",
  dbf: "database",
  deb: "executable",
  desktop: "link",
  dmg: "executable",
  doc: "word",
  docm: "word",
  docx: "word",
  dot: "word",
  dotx: "word",
  dps: "wps",
  dpt: "wps",
  dump: "database-server",
  dwg: "model-3d",
  dxf: "model-3d",
  eml: "email",
  env: "configuration",
  eot: "configuration",
  et: "wps",
  ett: "wps",
  exe: "executable",
  fb2: "text",
  fbx: "model-3d",
  flac: "audio",
  gif: "gif",
  glb: "model-3d",
  gltf: "model-3d",
  go: "code",
  gz: "archive",
  h: "code",
  heic: "image",
  heif: "image",
  hpp: "code",
  html: "code",
  ico: "image",
  ini: "configuration",
  ipa: "executable",
  iso: "archive",
  jar: "archive",
  java: "code",
  jpeg: "image",
  jpg: "image",
  js: "code",
  json: "configuration",
  jsx: "code",
  key: "powerpoint",
  lnk: "link",
  lock: "configuration",
  log: "text",
  m4a: "audio",
  m4v: "video",
  markdown: "text",
  md: "text",
  mdb: "database",
  mhtml: "email",
  mkv: "video",
  mov: "video",
  mp3: "audio",
  mp4: "video",
  mpeg: "video",
  mpg: "video",
  msi: "executable",
  msg: "email",
  nfo: "text",
  numbers: "excel",
  obj: "model-3d",
  odp: "powerpoint",
  ods: "excel",
  odt: "word",
  oga: "audio",
  ogg: "audio",
  ogv: "video",
  opus: "audio",
  pages: "word",
  pdf: "pdf",
  php: "code",
  pkg: "executable",
  png: "image",
  pps: "powerpoint",
  ppsx: "powerpoint",
  ppt: "powerpoint",
  pptm: "powerpoint",
  pptx: "powerpoint",
  properties: "configuration",
  psd: "image",
  py: "code",
  rar: "archive",
  rb: "code",
  rpm: "executable",
  rs: "code",
  rtf: "text",
  sass: "code",
  scss: "code",
  sh: "code",
  sql: "database-server",
  sqlite: "database",
  sqlite3: "database",
  stl: "model-3d",
  svg: "image",
  tar: "archive",
  tex: "text",
  tif: "image",
  tiff: "image",
  tgz: "archive",
  toml: "configuration",
  ts: "code",
  tsx: "code",
  txt: "text",
  url: "link",
  vbs: "code",
  video: "video",
  vue: "code",
  wav: "audio",
  webm: "video",
  webp: "image",
  webloc: "link",
  wma: "audio",
  wmv: "video",
  wps: "wps",
  wpt: "wps",
  xls: "excel",
  xlsb: "excel",
  xlsm: "excel",
  xlsx: "excel",
  xml: "configuration",
  xz: "archive",
  yaml: "configuration",
  yml: "configuration",
  zip: "archive",
  zsh: "code",
}

const fileIconKindByMimeType: Readonly<Record<string, FileIconKind>> = {
  "application/gzip": "archive",
  "application/java-archive": "archive",
  "application/json": "configuration",
  "application/msword": "word",
  "application/pdf": "pdf",
  "application/rtf": "text",
  "application/sql": "database-server",
  "application/vnd.apple.installer+xml": "executable",
  "application/vnd.ms-access": "database",
  "application/vnd.ms-excel": "excel",
  "application/vnd.ms-outlook": "email",
  "application/vnd.ms-powerpoint": "powerpoint",
  "application/vnd.oasis.opendocument.presentation": "powerpoint",
  "application/vnd.oasis.opendocument.spreadsheet": "excel",
  "application/vnd.oasis.opendocument.text": "word",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "powerpoint",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "word",
  "application/vnd.rar": "archive",
  "application/x-7z-compressed": "archive",
  "application/x-apple-diskimage": "executable",
  "application/x-bzip2": "archive",
  "application/x-executable": "executable",
  "application/x-msdownload": "executable",
  "application/x-rar-compressed": "archive",
  "application/x-sqlite3": "database",
  "application/x-tar": "archive",
  "application/xml": "configuration",
  "application/zip": "archive",
  "inode/directory": "folder",
  "message/rfc822": "email",
  "text/csv": "excel",
  "text/html": "code",
  "text/markdown": "text",
  "text/plain": "text",
  "text/x-sql": "database-server",
}

const wellKnownFileNameKinds: Readonly<Record<string, FileIconKind>> = {
  dockerfile: "code",
  license: "text",
  makefile: "code",
  readme: "text",
}

function normalizeMimeType(mimeType: string | null | undefined) {
  return mimeType?.split(";", 1)[0]?.trim().toLocaleLowerCase("en-US") ?? ""
}

function fileBaseName(filename: string) {
  return filename.trim().split(/[\\/]/).pop()?.toLocaleLowerCase("en-US") ?? ""
}

function fileExtension(filename: string) {
  const basename = fileBaseName(filename)
  if (!basename) return ""
  if (basename.startsWith(".env")) return "env"
  if (basename.startsWith(".") && !basename.slice(1).includes(".")) {
    return basename.slice(1)
  }
  const separator = basename.lastIndexOf(".")
  return separator > -1 ? basename.slice(separator + 1) : ""
}

export function resolveFileIconKind(
  filename: string,
  mimeType?: string | null
): FileIconKind {
  const normalizedMimeType = normalizeMimeType(mimeType)
  if (normalizedMimeType === "inode/directory") return "folder"

  const basename = fileBaseName(filename)
  const knownFilenameKind = wellKnownFileNameKinds[basename]
  if (knownFilenameKind) return knownFilenameKind

  const extensionKind = fileIconKindByExtension[fileExtension(filename)]
  if (extensionKind) return extensionKind

  const exactMimeKind = fileIconKindByMimeType[normalizedMimeType]
  if (exactMimeKind) return exactMimeKind
  if (normalizedMimeType.startsWith("audio/")) return "audio"
  if (normalizedMimeType === "image/gif") return "gif"
  if (normalizedMimeType.startsWith("image/")) return "image"
  if (normalizedMimeType.startsWith("model/")) return "model-3d"
  if (normalizedMimeType.startsWith("text/")) return "text"
  if (normalizedMimeType.startsWith("video/")) return "video"

  return "unknown"
}

export function resolveFileIconAsset(
  filename: string,
  mimeType?: string | null
) {
  return fileIconAssets[resolveFileIconKind(filename, mimeType)]
}
