import type { TaskArtifactFileType } from "@linksense/shared";

import { Prisma } from "../../generated/prisma/client.js";

type FileTypeRule = {
  extensions: string;
  mimePattern: string;
};

const fileTypeRules: Record<Exclude<TaskArtifactFileType, "other">, FileTypeRule> = {
  image: {
    extensions: "png|jpg|jpeg|gif|webp|avif|svg|bmp|ico|tif|tiff|heic|heif|psd|ai",
    mimePattern: "^image/",
  },
  word: {
    extensions: "doc|docx|docm|dot|dotx|dotm|odt|ott|pages|wps|wpt",
    mimePattern: "^application/(msword|vnd\\.openxmlformats-officedocument\\.wordprocessingml\\.(document|template)|vnd\\.ms-word\\.(document|template)\\.macroenabled\\.12|vnd\\.oasis\\.opendocument\\.text(-template)?|vnd\\.apple\\.pages|vnd\\.ms-works)$",
  },
  excel: {
    extensions: "xls|xlsx|xlsm|xlsb|xlt|xltx|xltm|csv|tsv|ods|ots|numbers|et|ett",
    mimePattern: "^(text/(csv|tab-separated-values)|application/(vnd\\.ms-excel(\\.(sheet|template)\\.macroenabled\\.12|\\.sheet\\.binary\\.macroenabled\\.12)?|vnd\\.openxmlformats-officedocument\\.spreadsheetml\\.(sheet|template)|vnd\\.oasis\\.opendocument\\.spreadsheet(-template)?|vnd\\.apple\\.numbers))$",
  },
  powerpoint: {
    extensions: "ppt|pptx|pptm|pps|ppsx|ppsm|pot|potx|potm|odp|otp|key|dps|dpt",
    mimePattern: "^application/(vnd\\.ms-powerpoint(\\.(presentation|slideshow|template)\\.macroenabled\\.12)?|vnd\\.openxmlformats-officedocument\\.presentationml\\.(presentation|slideshow|template)|vnd\\.oasis\\.opendocument\\.presentation(-template)?|vnd\\.apple\\.keynote)$",
  },
  html: {
    extensions: "html|htm|xhtml",
    mimePattern: "^(text/html|application/xhtml\\+xml)$",
  },
  pdf: {
    extensions: "pdf",
    mimePattern: "^application/pdf$",
  },
  archive: {
    extensions: "zip|rar|7z|tar|gz|tgz|bz|bz2|tbz|tbz2|xz|txz|zst|tzst|cab|iso|jar",
    mimePattern: "^application/(zip|gzip|x-gzip|x-zip-compressed|x-rar-compressed|vnd\\.rar|x-7z-compressed|x-tar|x-bzip|x-bzip2|x-xz|zstd|x-zstd|vnd\\.ms-cab-compressed|x-iso9660-image|java-archive)$",
  },
  text: {
    extensions: "txt|md|markdown|log|rtf|tex|nfo|fb2",
    mimePattern: "^(text/(plain|markdown|x-markdown|rtf)|application/rtf)$",
  },
  audio: {
    extensions: "mp3|wav|ogg|oga|opus|flac|aac|m4a|aiff|aif|wma",
    mimePattern: "^audio/",
  },
  video: {
    extensions: "mp4|webm|mov|mkv|avi|mpeg|mpg|m4v|ogv|wmv",
    mimePattern: "^video/",
  },
};

/** Keep classification in the database so pagination only counts matching files. */
export function taskArtifactFileTypeFilter(fileType: TaskArtifactFileType): Prisma.Sql {
  const rules = Object.entries(fileTypeRules);
  // A recognized filename wins over generic MIME metadata, e.g. an XLSX stored as ZIP.
  const extensionCases = rules.map(([type, rule]) =>
    Prisma.sql`WHEN lower(btrim(f.filename)) ~ ${`\\.(${rule.extensions})$`} THEN ${type}`,
  );
  const mimeCases = rules.map(([type, rule]) =>
    Prisma.sql`WHEN lower(btrim(split_part(COALESCE(f.mime_type, ''), ';', 1))) ~ ${rule.mimePattern} THEN ${type}`,
  );
  return Prisma.sql`AND COALESCE(
    CASE ${Prisma.join(extensionCases, " ")} END,
    CASE ${Prisma.join(mimeCases, " ")} END,
    'other'
  ) = ${fileType}`;
}
