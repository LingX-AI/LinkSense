import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, RouterProvider } from "react-router-dom"

import "./index.css"
import "./i18n"
import App from "./App.tsx"
import { AppProviders } from "@/app/providers"
import { initializeTheme } from "@/app/theme"
import { initializeUiFontSize } from "@/app/ui-font-size"
import {
  clearClientUpdateUrl,
  installClientBuildListeners,
} from "@/app/client-build"
import { ClientUpdateNotice } from "@/components/shell/client-update-notice"
import { ApplicationLoadError } from "@/app/application-load-error"

initializeTheme()
initializeUiFontSize()
clearClientUpdateUrl()
const disposeClientBuildListeners = installClientBuildListeners()
if (import.meta.hot) import.meta.hot.dispose(disposeClientBuildListeners)

const rootElement = document.getElementById("root")
if (!rootElement) throw new Error("Application root element was not found")

const router = createBrowserRouter([
  {
    path: "*",
    errorElement: <ApplicationLoadError />,
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
    <ClientUpdateNotice />
  </StrictMode>
)
