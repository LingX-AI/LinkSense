import { useState, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { AuthProvider } from "@/app/auth-context"
import { BootstrapProvider } from "@/app/bootstrap-context"
import { ThemeProvider } from "@/app/theme-context"
import { NotificationCenter } from "@/components/feedback/notification-toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import { BrowserNotificationCenter } from "@/features/browser-notifications/browser-notification-center"
import { BrowserNotificationPrompt } from "@/features/browser-notifications/browser-notification-prompt"
import { ApiError } from "@/api/client"
import { CreditQuotaRefreshCenter } from "@/features/usage/credit-quota-refresh-center"

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: (count, error) =>
              count < 1 &&
              !(
                error instanceof ApiError &&
                error.errorCode === "CLIENT_UPDATE_REQUIRED"
              ),
          },
          mutations: { retry: false },
        },
      })
  )

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BootstrapProvider>
          <AuthProvider>
            <TooltipProvider>
              <CreditQuotaRefreshCenter />
              <BrowserNotificationCenter />
              {children}
              <BrowserNotificationPrompt />
            </TooltipProvider>
          </AuthProvider>
        </BootstrapProvider>
      </QueryClientProvider>
      <NotificationCenter />
    </ThemeProvider>
  )
}
