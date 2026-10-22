import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { taskArtifactThumbnail } from "@linksense/shared"

import { FileTypeIcon } from "@/components/media/file-type-icon"
import { Skeleton } from "@/components/ui/skeleton"

import {
  getTaskArtifactThumbnail,
  type TaskArtifact,
} from "./task-artifact-api"

export function TaskArtifactThumbnail({ file }: { file: TaskArtifact }) {
  const targetRef = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const [image, setImage] = useState<{ blob: Blob; url: string | null } | null>(
    null
  )
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const query = useQuery({
    queryKey: [
      "task-artifact-thumbnail",
      file.conversation_id,
      file.id,
      file.updated_at,
    ],
    queryFn: ({ signal }) => getTaskArtifactThumbnail(file, signal),
    enabled: visible,
    staleTime: taskArtifactThumbnail.cacheMaxAgeSeconds * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    const target = targetRef.current
    if (!target) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setVisible(true)
        observer.disconnect()
      },
      { root: target.closest(".management-scroll"), rootMargin: "160px 0px" }
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const blob = query.data
    if (!blob) return
    const url = URL.createObjectURL(blob)
    let active = true
    const candidate = new Image()
    candidate.src = url
    void candidate.decode().then(
      () => {
        if (active) setImage({ blob, url })
      },
      () => {
        if (active) setImage({ blob, url: null })
      }
    )
    return () => {
      active = false
      URL.revokeObjectURL(url)
    }
  }, [query.data])

  const url = image?.blob === query.data ? image?.url : undefined
  const failed =
    query.isError || url === null || (url !== undefined && failedUrl === url)

  return (
    <span
      ref={targetRef}
      aria-hidden="true"
      data-slot="task-artifact-thumbnail"
      className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted"
    >
      {failed ? (
        <FileTypeIcon
          filename={file.name}
          mimeType={file.mime_type}
          className="size-7"
        />
      ) : (
        <>
          {!url && (
            <Skeleton className="absolute inset-0 size-full rounded-lg" />
          )}
          {url && (
            <img
              src={url}
              alt=""
              width={taskArtifactThumbnail.displaySize}
              height={taskArtifactThumbnail.displaySize}
              className="size-full object-cover"
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={() => setFailedUrl(url)}
            />
          )}
        </>
      )}
    </span>
  )
}
