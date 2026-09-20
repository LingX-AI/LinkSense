import type { ComponentType, SVGProps } from "react"

export type ApplicationIllustratedIcon = ComponentType<SVGProps<SVGSVGElement>>

// Individual scenes use optically normalized view boxes so their visible
// artwork occupies roughly the same area despite having different silhouettes.
function SceneIcon({
  children,
  viewBox = "0 0 48 48",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {children}
    </svg>
  )
}

export function BotSceneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SceneIcon viewBox="4 4 40 40" {...props}>
      <path d="M24 6 38 14v18L24 40 10 32V14L24 6Z" fill="#7C4DFF" />
      <path d="m24 6 14 8-14 8-14-8 14-8Z" fill="#B478FF" />
      <path d="m24 22 14-8v18l-14 8V22Z" fill="#FF6A5F" />
      <path d="M15 20.5 24 25v10l-9-4.8v-9.7Z" fill="#4267F5" />
      <circle cx="19" cy="27" r="1.8" fill="white" />
      <circle cx="28.5" cy="25.5" r="1.8" fill="white" />
      <path
        d="m21 32 3 1.5 3-1.7"
        stroke="#FFE69A"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </SceneIcon>
  )
}

export function SearchSceneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SceneIcon viewBox="1.5 1.5 45 45" {...props}>
      <path d="m19 7 12 7-12 7-12-7 12-7Z" fill="#FFB04A" />
      <path d="m19 21 12-7v13l-12 7V21Z" fill="#FF6B5D" />
      <path d="M7 14l12 7v13L7 27V14Z" fill="#7A4FF3" />
      <circle cx="29" cy="27" r="8" fill="#54C6F0" />
      <circle cx="29" cy="27" r="4.6" fill="#F7FBFF" />
      <path
        d="m35 33 6 6"
        stroke="#2764E7"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </SceneIcon>
  )
}

export function KnowledgeSceneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SceneIcon viewBox="2 2 44 44" {...props}>
      <path d="M6 13 22 8v27L6 39V13Z" fill="#6A52E8" />
      <path d="m22 8 9 5v27l-9-5V8Z" fill="#A96BF5" />
      <path d="m25 13 17-4v27l-17 4V13Z" fill="#35BDF0" />
      <path d="m25 13 8 4 9-8-17 4Z" fill="#75DCFF" />
      <path
        d="M29 22.5 38 20M29 27.5l9-2.5M29 32.5l6-1.7"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="m8 13 14 7 3-7-3-5-16 5h2Z" fill="#FFB64A" />
    </SceneIcon>
  )
}

export function EducationSceneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SceneIcon viewBox="2 2 44 44" {...props}>
      <path d="m24 7 20 10-20 10L4 17 24 7Z" fill="#405FE6" />
      <path d="m24 12 12 6-12 6-12-6 12-6Z" fill="#7E65F4" />
      <path d="M12 21v10c5 5 19 5 24 0V21l-12 6-12-6Z" fill="#FF765F" />
      <path
        d="M40 19v11"
        stroke="#FFB13B"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="40" cy="33" r="3" fill="#FFB13B" />
    </SceneIcon>
  )
}

export function BusinessSceneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SceneIcon viewBox="2.5 2.5 43 43" {...props}>
      <path d="M8 16h30v21L8 32V16Z" fill="#FF774F" />
      <path d="m38 16 5 4v20l-5-3V16Z" fill="#E94E55" />
      <path d="m8 32 30 5 5 3-30-4-5-4Z" fill="#FFC34A" />
      <path
        d="M17 16v-5h12v5"
        stroke="#7350DF"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path d="M8 22h30" stroke="#FFD98B" strokeWidth="2" />
      <rect x="21" y="20" width="6" height="6" rx="1.5" fill="#7049DF" />
    </SceneIcon>
  )
}

export function AnalyticsSceneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SceneIcon {...props}>
      <path d="m7 34 9 5V23l-9-5v16Z" fill="#5868F2" />
      <path d="m16 23 5-3v16l-5 3V23Z" fill="#3049D8" />
      <path d="m20 36 9 5V15l-9-5v26Z" fill="#A35CF5" />
      <path d="m29 15 5-3v26l-5 3V15Z" fill="#7740D8" />
      <path d="m33 34 8 4V9l-8-4v29Z" fill="#FF7558" />
      <path d="m41 9 3 2v29l-3-2V9Z" fill="#E64B52" />
      <path
        d="m7 18 9 5 5-3-9-5-5 3ZM20 10l9 5 5-3-9-5-5 3ZM33 5l8 4 3 2-8-4-3-2Z"
        fill="#FFBE4A"
      />
    </SceneIcon>
  )
}

export function CodeSceneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SceneIcon viewBox="1.5 1.5 45 45" {...props}>
      <path d="M7 10h30v27H7V10Z" fill="#554DE5" />
      <path d="m37 10 5 4v27l-5-4V10Z" fill="#3334B9" />
      <path d="m7 10 5-4h30l-5 4H7Z" fill="#8B73FF" />
      <circle cx="12" cy="14.5" r="1.5" fill="#FF755E" />
      <circle cx="17" cy="14.5" r="1.5" fill="#FFBD4A" />
      <path
        d="m18 23-5 5 5 5M28 23l5 5-5 5M25 20l-4 16"
        stroke="#6DE4FF"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </SceneIcon>
  )
}

export function WritingSceneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SceneIcon viewBox="2 2 44 44" {...props}>
      <path d="M8 8h26v32H8V8Z" fill="#54C9EA" />
      <path d="m34 8 6 5v27h-6V8Z" fill="#2B83DD" />
      <path
        d="M13 15h15M13 21h12M13 27h9"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path d="m28 34 3-10 9-9 4 4-9 9-7 6Z" fill="#FF735C" />
      <path d="m31 24 4 4-7 6 3-10Z" fill="#FFD04E" />
      <path d="m40 15 4 4-2 2-4-4 2-2Z" fill="#7547DB" />
    </SceneIcon>
  )
}

export function CreativeSceneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SceneIcon viewBox="-1.5 -1.5 51 51" {...props}>
      <path
        d="m24 4 5.5 14.5L44 24l-14.5 5.5L24 44l-5.5-14.5L4 24l14.5-5.5L24 4Z"
        fill="#FF6D62"
      />
      <path d="m24 4 5.5 14.5L24 24l-5.5-5.5L24 4Z" fill="#FFB347" />
      <path d="m4 24 14.5-5.5L24 24l-5.5 5.5L4 24Z" fill="#4771F1" />
      <path d="M24 44V24l5.5 5.5L24 44Z" fill="#7B30DF" />
      <path d="m24 24 5.5-5.5L44 24l-14.5 5.5L24 24Z" fill="#FF7772" />
      <path d="m24 18 6 6-6 6-6-6 6-6Z" fill="#FFF2B0" />
    </SceneIcon>
  )
}

export function IdeaSceneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SceneIcon viewBox="5.5 5.5 37 37" {...props}>
      <path
        d="M36 20c0-7-5.4-12-12-12S12 13 12 20c0 5 3 8 6 11v4h12v-4c3-3 6-6 6-11Z"
        fill="#FFB83F"
      />
      <path d="M24 8v27H18v-4c-3-3-6-6-6-11 0-7 5.4-12 12-12Z" fill="#FFD45E" />
      <path d="m18 20 6-4 6 4-6 4-6-4Z" fill="#7C54EA" />
      <path d="m24 24 6-4v8l-6 4v-8Z" fill="#5543D8" />
      <path d="m18 20 6 4v8l-6-4v-8Z" fill="#976EF5" />
      <path
        d="M19 36h10M20 40h8"
        stroke="#FF6D5B"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </SceneIcon>
  )
}

export function SupportSceneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SceneIcon viewBox="2 2 44 44" {...props}>
      <circle cx="24" cy="23" r="13" fill="#5F65EC" />
      <path
        d="M11 23c0-8 5-14 13-14s13 6 13 14"
        stroke="#FF7A5C"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <rect x="7" y="21" width="7" height="12" rx="3.5" fill="#FFB54A" />
      <rect x="34" y="21" width="7" height="12" rx="3.5" fill="#FF6B59" />
      <circle cx="19" cy="23" r="2" fill="white" />
      <circle cx="29" cy="23" r="2" fill="white" />
      <path
        d="M19 29c3 2 7 2 10 0M36 33c0 4-3 6-7 6h-3"
        stroke="#43CBE8"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </SceneIcon>
  )
}

export function DocumentSceneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SceneIcon viewBox="1 1 46 46" {...props}>
      <path d="M8 13h24v29H8V13Z" fill="#7754E8" />
      <path d="m14 8 23 4v29l-23-4V8Z" fill="#4D7CF3" />
      <path d="m37 12 5 5v29l-5-5V12Z" fill="#2A54CD" />
      <path d="m31 11 6 1 5 5-11-2v-4Z" fill="#70D9F5" />
      <path
        d="m20 20 12 2M20 26l12 2M20 32l8 1.5"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path d="m8 13 6-5v29l-6 5V13Z" fill="#A66AF5" />
    </SceneIcon>
  )
}

export function FinanceSceneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SceneIcon {...props}>
      <path d="m24 6 18 9H6l18-9Z" fill="#FFB33F" />
      <path d="M9 18h30v5H9v-5Z" fill="#7854E8" />
      <path
        d="M12 23h5v13h-5V23ZM22 23h5v13h-5V23ZM32 23h5v13h-5V23Z"
        fill="#4E73EF"
      />
      <path d="M7 36h34v6H7v-6Z" fill="#FF6E58" />
      <circle cx="38" cy="32" r="7" fill="#FFD153" />
      <path
        d="M38 28v8M35.5 30h4a2 2 0 1 1 0 4h-4"
        stroke="#8A4BE3"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </SceneIcon>
  )
}

export function LegalSceneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SceneIcon viewBox="0.5 0.5 47 47" {...props}>
      <path d="m24 6 5 5-5 5-5-5 5-5Z" fill="#FFAF42" />
      <path d="M22 14h4v25h-4V14Z" fill="#6C55E8" />
      <path d="M9 17h30v4H9v-4Z" fill="#4D77EE" />
      <path d="m13 20-7 13h14l-7-13ZM35 20l-7 13h14l-7-13Z" fill="#FF755D" />
      <path
        d="M6 33c1.5 4 12.5 4 14 0H6ZM28 33c1.5 4 12.5 4 14 0H28Z"
        fill="#FFBF4B"
      />
      <path d="M16 39h16v4H16v-4Z" fill="#4939BF" />
    </SceneIcon>
  )
}

export function HealthSceneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SceneIcon viewBox="3 3 42 42" {...props}>
      <path
        d="M24 41S7 31 7 18c0-7 9-11 17-3 8-8 17-4 17 3 0 13-17 23-17 23Z"
        fill="#FF665F"
      />
      <path d="M24 15c8-8 17-4 17 3 0 13-17 23-17 23V15Z" fill="#E94660" />
      <path d="M20 19h8v6h6v8h-6v6h-8v-6h-6v-8h6v-6Z" fill="white" />
      <path d="m7 18 8 4-8 5v-9Z" fill="#FFB345" />
    </SceneIcon>
  )
}

export function SecuritySceneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SceneIcon viewBox="1.5 1.5 45 45" {...props}>
      <path
        d="m24 5 16 6v12c0 10-6 16-16 21C14 39 8 33 8 23V11l16-6Z"
        fill="#446BEA"
      />
      <path d="m24 5 16 6v12c0 10-6 16-16 21V5Z" fill="#2F4DCB" />
      <path
        d="m14 13 10-4 10 4v10c0 6-3 10-10 14-7-4-10-8-10-14V13Z"
        fill="#55D0D4"
      />
      <path
        d="m18 24 4 4 9-10"
        stroke="white"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m34 13 6-2v12c0 10-6 16-16 21v-7c7-4 10-8 10-14V13Z"
        fill="#36A9CB"
        opacity=".7"
      />
    </SceneIcon>
  )
}

export function WorkflowSceneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SceneIcon viewBox="1.5 1.5 45 45" {...props}>
      <path d="M12 9h12v12H12V9Z" fill="#8458ED" />
      <path d="m24 9 5 4v12l-5-4V9Z" fill="#6340CF" />
      <path d="M24 29h12v12H24V29Z" fill="#FF705B" />
      <path d="m36 29 5 4v12l-5-4V29Z" fill="#DF4651" />
      <path d="M7 31h10v10H7V31Z" fill="#4FC8E7" />
      <path
        d="M18 18v8a6 6 0 0 0 6 6M14 21v10"
        stroke="#FFB442"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="18" cy="26" r="3" fill="#FFCF59" />
    </SceneIcon>
  )
}

export function CalendarSceneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SceneIcon {...props}>
      <path d="M7 12h29v29H7V12Z" fill="#5B6CEC" />
      <path d="m36 12 5 4v29l-5-4V12Z" fill="#3C49C7" />
      <path d="M7 12h29v9H7v-9Z" fill="#FF7059" />
      <path
        d="M14 7v9M29 7v9"
        stroke="#FFBC46"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M13 27h5v5h-5v-5ZM22 27h5v5h-5v-5ZM13 35h5v4h-5v-4Z"
        fill="#B6EAF8"
      />
      <circle cx="34" cy="34" r="9" fill="#FFBF4D" />
      <path
        d="M34 29v5l4 2"
        stroke="#6944D8"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </SceneIcon>
  )
}

export function TeamSceneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SceneIcon viewBox="-1.5 -1.5 51 51" {...props}>
      <circle cx="24" cy="14" r="8" fill="#FFB347" />
      <circle cx="11" cy="23" r="6" fill="#58CBEA" />
      <circle cx="37" cy="23" r="6" fill="#FF6B61" />
      <path d="M11 42c0-9 5-15 13-15s13 6 13 15H11Z" fill="#7353E6" />
      <path d="M24 27c8 0 13 6 13 15H24V27Z" fill="#5037C5" />
      <path d="M2 41c0-7 3-12 9-12 4 0 7 2 8 6-2 2-3 4-3 6H2Z" fill="#369BD2" />
      <path
        d="M46 41c0-7-3-12-9-12-4 0-7 2-8 6 2 2 3 4 3 6h14Z"
        fill="#E74C58"
      />
    </SceneIcon>
  )
}

export function GlobeSceneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SceneIcon {...props}>
      <circle cx="24" cy="24" r="17" fill="#436DEB" />
      <path
        d="M24 7c7 5 10 11 10 17s-3 12-10 17c-7-5-10-11-10-17S17 12 24 7Z"
        fill="#54CDE5"
      />
      <path
        d="M8 18h32M7 29h34M24 7v34"
        stroke="#E9FBFF"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M5 35c8 5 24 3 34-6"
        stroke="#FFB03F"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="m36 26 6 1-2 6"
        stroke="#FF6A58"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </SceneIcon>
  )
}
