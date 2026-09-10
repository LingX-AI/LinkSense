import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

import "./index.css"
import "./embed/embed.css"
import { setAppLanguage } from "./i18n"
import { ThemeProvider } from "@/app/theme-context"
import { TooltipProvider } from "@/components/ui/tooltip"
import { EmbedApp } from "@/embed/embed-app"
import { EmbedBootstrapProvider } from "@/embed/embed-bootstrap-provider"
import { embedFrameConfigSchema } from "@/embed/config"

const rootElement = document.getElementById("embed-root")
if (!rootElement) throw new Error("Embed root element was not found")

const config = embedFrameConfigSchema.parse(
  JSON.parse(rootElement.dataset.embedConfig ?? "null")
)
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})

void setAppLanguage(config.locale, { persist: false }).then(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <TooltipProvider>
              <EmbedBootstrapProvider>
                <EmbedApp config={config} />
              </EmbedBootstrapProvider>
            </TooltipProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>
    </StrictMode>
  )
})
