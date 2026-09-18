import type {
  ProjectColor,
  ProjectIcon as ProjectIconName,
} from "@linksense/shared"
import {
  AsteriskIcon,
  BookIcon,
  BrainIcon,
  BracesIcon,
  BriefcaseBusinessIcon,
  BrushIcon,
  ChartColumnIcon,
  CoinsIcon,
  DumbbellIcon,
  EarthIcon,
  FlaskConicalIcon,
  Flower2Icon,
  FolderClosedIcon,
  FolderOpenIcon,
  GlobeIcon,
  GraduationCapIcon,
  HeartIcon,
  MedalIcon,
  MusicIcon,
  NotebookIcon,
  PaletteIcon,
  PawPrintIcon,
  PencilIcon,
  PenToolIcon,
  PlaneIcon,
  PopcornIcon,
  ScaleIcon,
  SproutIcon,
  StethoscopeIcon,
  TerminalIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { projectColorClasses } from "./project-colors"

const icons: Record<ProjectIconName, LucideIcon> = {
  folder: FolderClosedIcon,
  coins: CoinsIcon,
  book: BookIcon,
  "graduation-cap": GraduationCapIcon,
  pencil: PencilIcon,
  "pen-tool": PenToolIcon,
  braces: BracesIcon,
  terminal: TerminalIcon,
  music: MusicIcon,
  popcorn: PopcornIcon,
  brush: BrushIcon,
  palette: PaletteIcon,
  stethoscope: StethoscopeIcon,
  asterisk: AsteriskIcon,
  flower: Flower2Icon,
  briefcase: BriefcaseBusinessIcon,
  "chart-column": ChartColumnIcon,
  medal: MedalIcon,
  dumbbell: DumbbellIcon,
  notebook: NotebookIcon,
  scale: ScaleIcon,
  globe: GlobeIcon,
  plane: PlaneIcon,
  earth: EarthIcon,
  wrench: WrenchIcon,
  "paw-print": PawPrintIcon,
  flask: FlaskConicalIcon,
  brain: BrainIcon,
  heart: HeartIcon,
  sprout: SproutIcon,
}

export function ProjectIcon({
  icon = "folder",
  color = "default",
  open = false,
  className,
}: {
  icon?: ProjectIconName
  color?: ProjectColor
  open?: boolean
  className?: string
}) {
  const Icon = icon === "folder" && open ? FolderOpenIcon : icons[icon]
  return (
    <Icon
      aria-hidden="true"
      data-project-icon={icon}
      data-project-color={color}
      className={cn(projectColorClasses[color], className)}
    />
  )
}
