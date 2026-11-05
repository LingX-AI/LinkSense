import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { setAppLanguage } from "./i18n"
import { ThemeProvider } from "./app/theme-context"
import { TooltipProvider } from "./components/ui/tooltip"
import { PublicKnowledgeVisitorApp } from "./features/public-knowledge/visitor-app"
import { publicKnowledgeFrameSchema } from "./features/public-knowledge/frame-contract"
import "./index.css"
import "./embed/embed.css"

const root = document.getElementById("public-knowledge-root")
if (!root) throw new Error("Public knowledge root is missing")
const config = publicKnowledgeFrameSchema.parse(
  JSON.parse(root.dataset.config ?? "null")
)
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})
void setAppLanguage(config.locale, { persist: false }).then(() => {
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider>
        <TooltipProvider>
          <QueryClientProvider client={queryClient}>
            <MemoryRouter>
              <PublicKnowledgeVisitorApp config={config} />
            </MemoryRouter>
          </QueryClientProvider>
        </TooltipProvider>
      </ThemeProvider>
    </StrictMode>
  )
})
