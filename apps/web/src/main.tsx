import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, RouterProvider } from "react-router-dom"

import "./index.css"
import "./i18n"
import App from "./App.tsx"
import { AppProviders } from "@/app/providers"
import { initializeTheme } from "@/app/theme"
import { initializeUiFontSize } from "@/app/ui-font-size"

initializeTheme()
initializeUiFontSize()

const rootElement = document.getElementById("root")
if (!rootElement) throw new Error("Application root element was not found")

const router = createBrowserRouter([
  {
    path: "*",
    element: (
      <AppProviders>
        <App />
      </AppProviders>
    ),
  },
])

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)
