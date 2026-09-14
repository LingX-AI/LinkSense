import {
  AudioLinesIcon,
  BookOpenCheckIcon,
  BrainIcon,
  CalendarDaysIcon,
  ChartNoAxesCombinedIcon,
  Clock3Icon,
  CloudIcon,
  DatabaseIcon,
  FileCode2Icon,
  FilePenLineIcon,
  FileSearchIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FolderTreeIcon,
  GitBranchIcon,
  Globe2Icon,
  ImageIcon,
  LibraryBigIcon,
  ListChecksIcon,
  MailIcon,
  MapPinIcon,
  MessageCircleQuestionIcon,
  PanelsTopLeftIcon,
  PresentationIcon,
  ScanSearchIcon,
  SquareTerminalIcon,
  TestTube2Icon,
  UsersIcon,
  VideoIcon,
  WandSparklesIcon,
  WorkflowIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react"

import type { NativeCodexItem } from "@/api/contracts"
import {
  ContextCompactedIcon,
  ContextCompactionIcon,
} from "@/features/conversations/context-compaction-icons"
import {
  resolveNativeActivityIconKind,
  type NativeActivityIconKind,
} from "@/features/conversations/native-activity-icon-kind"
import type { NativeLifecycleMethod } from "@/features/conversations/native-activity-view-model"

const nativeActivityIcons = {
  agents: UsersIcon,
  audio: AudioLinesIcon,
  automation: WorkflowIcon,
  browser: PanelsTopLeftIcon,
  calendar: CalendarDaysIcon,
  cloud: CloudIcon,
  code: FileCode2Icon,
  compact: ContextCompactionIcon,
  database: DatabaseIcon,
  document: FileTextIcon,
  "file-edit": FilePenLineIcon,
  "file-read": FileTextIcon,
  "file-search": FileSearchIcon,
  finance: ChartNoAxesCombinedIcon,
  folder: FolderTreeIcon,
  git: GitBranchIcon,
  image: ImageIcon,
  "image-generation": WandSparklesIcon,
  knowledge: LibraryBigIcon,
  mail: MailIcon,
  map: MapPinIcon,
  plan: ListChecksIcon,
  presentation: PresentationIcon,
  reasoning: BrainIcon,
  review: ScanSearchIcon,
  skill: BookOpenCheckIcon,
  spreadsheet: FileSpreadsheetIcon,
  terminal: SquareTerminalIcon,
  test: TestTube2Icon,
  tool: WrenchIcon,
  "user-input": MessageCircleQuestionIcon,
  video: VideoIcon,
  wait: Clock3Icon,
  web: Globe2Icon,
} satisfies Record<NativeActivityIconKind, LucideIcon>

export function NativeActivityIcon({
  item,
  method,
  activityItems,
}: {
  item: NativeCodexItem
  method: NativeLifecycleMethod
  activityItems?: readonly NativeCodexItem[]
}) {
  const kind = resolveNativeActivityIconKind(item, activityItems)
  const Icon =
    kind === "compact" && method === "item/completed"
      ? ContextCompactedIcon
      : nativeActivityIcons[kind]

  return (
    <Icon
      className="size-3.5"
      data-native-activity-icon={kind}
      aria-hidden="true"
    />
  )
}
