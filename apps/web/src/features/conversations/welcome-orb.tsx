import {
  motion,
  useMotionTemplate,
  useReducedMotion,
  useSpring,
  useTransform,
  useVelocity,
} from "framer-motion"
import { PauseIcon, PlayIcon } from "lucide-react"
import { memo, useEffect, useRef, useState, type PointerEvent } from "react"
import { useTranslation } from "react-i18next"

import welcomeOrb from "@/assets/home/welcome-orb.svg?raw"
import { Button } from "@/components/ui/button"

// Connection anchors follow dots sampled from the original design SVG.
const anchors = [
  [54.48, 59.35],
  [78.05, 54.75],
  [107.07, 55.65],
  [123.29, 69.76],
  [136.66, 90.28],
  [127, 110.06],
  [110.67, 129.66],
  [90.9, 133.37],
  [64.17, 127],
  [48.21, 106.62],
  [42.14, 79.71],
  [64.2, 83.44],
  [87.02, 75.72],
  [109.06, 84.09],
  [103.62, 102.8],
  [81.95, 113.32],
  [66.72, 103.11],
  [86.14, 92.49],
] as const
const spring = { stiffness: 120, damping: 22, mass: 0.65 }
const welcomeOrbMask = `url("data:image/svg+xml,${encodeURIComponent(welcomeOrb)}")`
// Keep the detailed static geometry mounted while pointer feedback updates.
const WelcomeOrbArtwork = memo(function WelcomeOrbArtwork() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none block size-full [&>svg]:size-full"
      // Trusted, bundled artwork; never insert user-provided SVG here.
      dangerouslySetInnerHTML={{ __html: welcomeOrb }}
    />
  )
})

export function WelcomeOrb() {
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()
  const orbRef = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(true)
  const [pageVisible, setPageVisible] = useState(() => !document.hidden)
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [connections, setConnections] = useState<readonly number[]>([])
  const horizontal = useSpring(0, spring)
  const vertical = useSpring(0, spring)
  const horizontalVelocity = useVelocity(horizontal)
  const verticalVelocity = useVelocity(vertical)
  const rotateX = useTransform(vertical, [-1, 1], [3, -3])
  const rotateY = useTransform(horizontal, [-1, 1], [-4, 4])
  const x = useTransform(horizontal, [-1, 1], [-4, 4])
  const y = useTransform(vertical, [-1, 1], [-3, 3])
  const deformation = useTransform(() => {
    const dx = horizontal.get()
    const dy = vertical.get()
    const distance = Math.hypot(dx, dy)
    if (distance < 0.001) return "matrix(1, 0, 0, 1, 0, 0)"
    const directionX = dx / distance
    const directionY = dy / distance
    const speed = Math.min(
      1,
      Math.hypot(horizontalVelocity.get(), verticalVelocity.get()) / 5
    )
    // Stretch toward the pointer and gently compress across it. The velocity
    // contribution settles on its own, even when the pointer stops inside.
    const stretch = Math.min(1, distance) * 0.04 + speed * 0.015
    const compression = stretch * 0.6
    const xx = 1 + stretch * directionX ** 2 - compression * directionY ** 2
    const yy = 1 + stretch * directionY ** 2 - compression * directionX ** 2
    const xy = (stretch + compression) * directionX * directionY
    return `matrix(${xx}, ${xy}, ${xy}, ${yy}, 0, 0)`
  })
  const cursorX = useTransform(horizontal, [-1, 1], [0, 176])
  const cursorY = useTransform(vertical, [-1, 1], [0, 176])
  const light = useMotionTemplate`radial-gradient(circle at ${cursorX}px ${cursorY}px, rgb(220 249 255 / 85%), rgb(68 210 255 / 35%) 22%, transparent 52%)`
  const enabled = !paused && !reducedMotion && inView && pageVisible
  const active = enabled && hovered

  useEffect(() => {
    const onVisibilityChange = () => setPageVisible(!document.hidden)
    document.addEventListener("visibilitychange", onVisibilityChange)
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            ([entry]) => {
              if (entry) setInView(entry.isIntersecting)
            },
            { threshold: 0.1 }
          )
    if (orbRef.current) observer?.observe(orbRef.current)
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
      observer?.disconnect()
    }
  }, [])

  useEffect(() => {
    if (enabled) return
    horizontal.jump(0)
    vertical.jump(0)
  }, [enabled, horizontal, vertical])

  function followPointer(event: PointerEvent<HTMLDivElement>) {
    if (!enabled || event.pointerType === "touch") return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    const px = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / bounds.width)
    )
    const py = Math.max(
      0,
      Math.min(1, (event.clientY - bounds.top) / bounds.height)
    )
    horizontal.set(px * 2 - 1)
    vertical.set(py * 2 - 1)
    const nearest = anchors
      .map(([ax, ay], index) => ({
        index,
        distance: Math.hypot(ax - px * 176, ay - py * 176),
      }))
      .filter((point) => point.distance < 55)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 4)
      .map((point) => point.index)
    setConnections((current) =>
      current.length === nearest.length &&
      current.every((value, index) => value === nearest[index])
        ? current
        : nearest
    )
  }

  return (
    <div
      ref={orbRef}
      className="conversation-welcome-icon group/orb relative mr-10 hidden size-44 shrink-0 @min-[56rem]/task-home:block"
      data-active={active}
      data-paused={paused}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") setHovered(true)
      }}
      onPointerMove={followPointer}
      onPointerLeave={() => {
        setHovered(false)
        horizontal.set(0)
        vertical.set(0)
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-5 rounded-full bg-[radial-gradient(ellipse,rgb(72_154_255_/_18%),rgb(153_103_242_/_8%)_48%,transparent_70%)] opacity-20 transition-opacity duration-500 group-data-[active=true]/orb:opacity-100 motion-reduce:opacity-0"
      />
      <motion.div
        initial={false}
        style={
          reducedMotion
            ? undefined
            : { rotateX, rotateY, x, y, transformPerspective: 600 }
        }
        className="relative size-full"
      >
        <motion.div
          style={reducedMotion ? undefined : { transform: deformation }}
          className="relative size-full"
        >
          <div
            data-paused={!enabled}
            className="welcome-orb-idle relative size-full translate-0 rotate-0 data-[paused=true]:[animation-play-state:paused] motion-safe:animate-welcome-orb-float"
          >
            <WelcomeOrbArtwork />
            <span
              aria-hidden="true"
              className="welcome-orb-mask pointer-events-none absolute inset-0 motion-reduce:hidden"
              style={{ maskImage: welcomeOrbMask }}
            >
              <span
                data-paused={!enabled}
                className="absolute inset-y-0 left-0 w-1/2 translate-0 bg-linear-to-r from-transparent via-cyan-100/70 to-transparent mix-blend-screen data-[paused=true]:[animation-play-state:paused] motion-safe:animate-welcome-orb-sheen"
              />
            </span>
            <motion.span
              aria-hidden="true"
              style={{
                backgroundImage: light,
                maskImage: welcomeOrbMask,
              }}
              className="welcome-orb-mask pointer-events-none absolute inset-0 opacity-0 mix-blend-screen transition-opacity duration-300 group-data-[active=true]/orb:opacity-70 motion-reduce:hidden"
            />
            <svg
              aria-hidden="true"
              viewBox="0 0 176 176"
              className="pointer-events-none absolute inset-0 size-full text-cyan-200 opacity-0 transition-opacity duration-300 group-data-[active=true]/orb:opacity-35 motion-reduce:hidden"
            >
              {connections.map((index) => (
                <motion.line
                  key={index}
                  x1={cursorX}
                  y1={cursorY}
                  x2={anchors[index][0]}
                  y2={anchors[index][1]}
                  stroke="currentColor"
                  strokeWidth="0.65"
                />
              ))}
            </svg>
          </div>
        </motion.div>
      </motion.div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t(
          paused ? "workspaceHome.resumeMotion" : "workspaceHome.pauseMotion"
        )}
        className="pointer-events-none absolute -right-4 -bottom-2 z-10 size-7 rounded-full bg-card/70 text-muted-foreground opacity-0 transition-opacity focus-visible:pointer-events-auto focus-visible:opacity-100 motion-reduce:hidden"
        onClick={() => setPaused(!paused)}
      >
        {paused ? (
          <PlayIcon className="size-3.5" />
        ) : (
          <PauseIcon className="size-3.5" />
        )}
      </Button>
    </div>
  )
}
