import type { MermaidConfig } from "mermaid"
import type { ResolvedTheme } from "@/app/theme"

// Mermaid's theme engine needs hex colors; the SVG also has to work outside the app.
const palettes = {
  light: {
    background: "#ffffff",
    surface: "#ffffff",
    text: "#17283d",
    border: "#d8e1eb",
    line: "#7b8ea0",
    shadow: "#17283d14",
    groups: ["#edf7f3", "#eef6fd", "#f5f3ef"],
  },
  dark: {
    background: "#141414",
    surface: "#232b35",
    text: "#e8eef5",
    border: "#465465",
    line: "#9aaec2",
    shadow: "#00000033",
    groups: ["#1b2d28", "#1d2b3b", "#2c2a27"],
  },
} satisfies Record<
  ResolvedTheme,
  {
    background: string
    surface: string
    text: string
    border: string
    line: string
    shadow: string
    groups: [string, string, string]
  }
>

export function getMermaidAppearance(theme: ResolvedTheme): {
  background: string
  config: MermaidConfig
} {
  const palette = palettes[theme]
  return {
    background: palette.background,
    config: {
      theme: "base",
      look: "classic",
      fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
      themeVariables: {
        darkMode: theme === "dark",
        background: palette.background,
        primaryColor: palette.surface,
        primaryTextColor: palette.text,
        primaryBorderColor: palette.border,
        secondaryColor: palette.surface,
        secondaryTextColor: palette.text,
        tertiaryColor: palette.groups[0],
        tertiaryTextColor: palette.text,
        lineColor: palette.line,
        textColor: palette.text,
        edgeLabelBackground: palette.surface,
        clusterBkg: palette.groups[0],
        clusterBorder: palette.groups[0],
        titleColor: palette.text,
        fontSize: "16px",
      },
      flowchart: {
        htmlLabels: false,
        useMaxWidth: false,
        curve: "rounded",
        nodeSpacing: 40,
        rankSpacing: 56,
        padding: 16,
        diagramPadding: 28,
        wrappingWidth: 240,
        subGraphTitleMargin: { top: 20, bottom: 24 },
      },
      // Library SVG styles cannot use Tailwind and must travel with PNG exports.
      // Avoid !important so explicit Mermaid classDef/style colors keep their meaning.
      themeCSS: `
        .node .label-container {
          filter: drop-shadow(0px 4px 8px ${palette.shadow});
          stroke-width: 1.2px;
          stroke-linejoin: round;
        }
        .node rect.label-container { rx: 12px; ry: 12px; }
        .node .label { font-weight: 550; }
        .flowchart-link { stroke-linecap: round; stroke-linejoin: round; }
        .edgeLabel { font-size: 13px; font-weight: 500; }
        .edgeLabel rect {
          rx: 5px; ry: 5px; opacity: 1;
          fill: ${palette.surface};
        }
        .cluster rect { rx: 18px; ry: 18px; stroke-width: 0; }
        .cluster:nth-of-type(3n + 2) > rect { fill: ${palette.groups[1]}; }
        .cluster:nth-of-type(3n + 3) > rect { fill: ${palette.groups[2]}; }
        .cluster-label text { font-size: 18px; font-weight: 600; }
      `,
    },
  }
}
