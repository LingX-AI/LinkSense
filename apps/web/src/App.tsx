import {
  loadConversationWorkspace,
  loadInteractiveApplicationPage,
} from "@/features/applications/application-page-loaders"
import { lazy, Suspense } from "react"
import { SocialCallbackPage } from "@/features/social-auth/social-callback-page"
import { useTranslation } from "react-i18next"
import { Navigate, Route, Routes } from "react-router-dom"

import {
  AdminRoute,
  BootstrapGate,
  ProtectedRoute,
  PublicAuthRoute,
} from "@/app/route-guards"
import { ApplicationOpeningPage } from "@/features/applications/application-opening-page"
import { AppShell } from "@/components/shell/app-shell"
import { SettingsShell } from "@/components/shell/settings-shell"
import { EmptyState, LoadingState } from "@/components/feedback/page-state"

const AdminQuotaPage = lazy(() =>
  import("@/pages/admin-quota-page").then((module) => ({
    default: module.AdminQuotaPage,
  }))
)

const AdminPages = lazy(() =>
  import("@/pages/admin-pages").then((module) => ({
    default: module.AdminPages,
  }))
)
const LoginPage = lazy(() =>
  import("@/pages/auth-pages").then((module) => ({ default: module.LoginPage }))
)
const ForgotPasswordPage = lazy(() =>
  import("@/pages/auth-pages").then((module) => ({
    default: module.ForgotPasswordPage,
  }))
)
const ResetPasswordPage = lazy(() =>
  import("@/pages/auth-pages").then((module) => ({
    default: module.ResetPasswordPage,
  }))
)
const RegistrationPage = lazy(() =>
  import("@/pages/auth-pages").then((module) => ({
    default: module.RegistrationPage,
  }))
)
const CompleteRegistrationPage = lazy(() =>
  import("@/pages/auth-pages").then((module) => ({
    default: module.CompleteRegistrationPage,
  }))
)
const EnterpriseCallbackPage = lazy(() =>
  import("@/pages/auth-pages").then((module) => ({
    default: module.EnterpriseCallbackPage,
  }))
)
const CapabilityManagementPage = lazy(() =>
  import("@/pages/capability-pages").then((module) => ({
    default: module.CapabilityManagementPage,
  }))
)
const KnowledgeBaseListPage = lazy(() =>
  import("@/pages/knowledge-base-pages").then((module) => ({
    default: module.KnowledgeBaseListPage,
  }))
)
const KnowledgeBaseDetailPage = lazy(() =>
  import("@/pages/knowledge-base-pages").then((module) => ({
    default: module.KnowledgeBaseDetailPage,
  }))
)
const KnowledgeDocumentPreviewPage = lazy(() =>
  import("@/pages/knowledge-base-pages").then((module) => ({
    default: module.KnowledgeDocumentPreviewPage,
  }))
)
const KnowledgeCitationPage = lazy(() =>
  import("@/pages/knowledge-citation-page").then((module) => ({
    default: module.KnowledgeCitationPage,
  }))
)
const AdminCapabilityManagementPage = lazy(() =>
  import("@/pages/capability-pages").then((module) => ({
    default: module.AdminCapabilityManagementPage,
  }))
)
const AdminKnowledgeBasePage = lazy(() =>
  import("@/pages/admin-knowledge-base-page").then((module) => ({
    default: module.AdminKnowledgeBasePage,
  }))
)
const UsageAnalyticsPage = lazy(() =>
  import("@/pages/admin-usage-page").then((module) => ({
    default: module.UsageAnalyticsPage,
  }))
)
const AdminKnowledgeSourcePage = lazy(() =>
  import("@/pages/admin-knowledge-source-page").then((module) => ({
    default: module.AdminKnowledgeSourcePage,
  }))
)
const MyFeedbackPage = lazy(() =>
  import("@/pages/my-feedback-page").then((module) => ({
    default: module.MyFeedbackPage,
  }))
)
const AdminFeedbackPage = lazy(() =>
  import("@/pages/admin-feedback-page").then((module) => ({
    default: module.AdminFeedbackPage,
  }))
)
const ConversationPage = lazy(loadConversationWorkspace)
const SharedConversationPage = lazy(() =>
  import("@/pages/shared-conversation-page").then((module) => ({
    default: module.SharedConversationPage,
  }))
)
const InteractiveApplicationPage = lazy(loadInteractiveApplicationPage)
const ApplicationUsagePage = lazy(() =>
  import("@/features/applications/application-usage-page").then((module) => ({
    default: module.ApplicationUsagePage,
  }))
)
const AutomationPage = lazy(() =>
  import("@/pages/automation-pages").then((module) => ({
    default: module.AutomationPage,
  }))
)
const ArchivedConversationListPage = lazy(() =>
  import("@/pages/conversation-pages").then((module) => ({
    default: module.ArchivedConversationListPage,
  }))
)
const CredentialManagementPage = lazy(() =>
  import("@/pages/credential-pages").then((module) => ({
    default: module.CredentialManagementPage,
  }))
)
const McpManagementPage = lazy(() =>
  import("@/pages/mcp-pages").then((module) => ({
    default: module.McpManagementPage,
  }))
)
const WeixinChannelPage = lazy(() =>
  import("@/pages/weixin-channel-page").then((module) => ({
    default: module.WeixinChannelPage,
  }))
)
const ApplicationExternalAccessPage = lazy(() =>
  import("@/features/applications/application-external-access-page").then(
    (module) => ({
      default: module.ApplicationExternalAccessPage,
    })
  )
)
const InitializePage = lazy(() =>
  import("@/pages/initialize-page").then((module) => ({
    default: module.InitializePage,
  }))
)
const SettingsGeneralPage = lazy(() =>
  import("@/pages/settings-pages").then((module) => ({
    default: module.SettingsGeneralPage,
  }))
)
const SettingsProfilePage = lazy(() =>
  import("@/pages/settings-pages").then((module) => ({
    default: module.SettingsProfilePage,
  }))
)
const PersonalQuotaPage = lazy(() => import("@/pages/personal-quota-page"))
const SettingsPersonalizationPage = lazy(() =>
  import("@/pages/settings-pages").then((module) => ({
    default: module.SettingsPersonalizationPage,
  }))
)
const SettingsAppearancePage = lazy(() =>
  import("@/pages/settings-pages").then((module) => ({
    default: module.SettingsAppearancePage,
  }))
)
const SettingsSecurityPage = lazy(() =>
  import("@/pages/settings-pages").then((module) => ({
    default: module.SettingsSecurityPage,
  }))
)
function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <div className="management-scroll">
      <EmptyState title={t("common.notFound")} />
    </div>
  )
}

export function App() {
  return (
    <Suspense fallback={<LoadingState fullScreen />}>
      <Routes>
        <Route element={<BootstrapGate />}>
          <Route path="/initialize" element={<InitializePage />} />
          <Route element={<PublicAuthRoute />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegistrationPage />} />
            <Route
              path="/register/activate"
              element={<CompleteRegistrationPage />}
            />
          </Route>
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route
            path="/auth/oidc/callback"
            element={<EnterpriseCallbackPage />}
          />
          <Route
            path="/auth/saml/callback"
            element={<EnterpriseCallbackPage />}
          />
          <Route
            path="/auth/social/callback"
            element={<SocialCallbackPage />}
          />
          <Route path="/share/:shareId" element={<SharedConversationPage />} />

          <Route element={<ProtectedRoute />}>
            <Route
              path="/credentials"
              element={<Navigate to="/settings/credentials" replace />}
            />
            <Route
              path="/mcp"
              element={<Navigate to="/settings/mcp" replace />}
            />
            <Route element={<SettingsShell />}>
              <Route
                path="/settings"
                element={<Navigate to="/settings/general" replace />}
              />
              <Route
                path="/settings/general"
                element={<SettingsGeneralPage />}
              />
              <Route
                path="/settings/profile"
                element={<SettingsProfilePage />}
              />
              <Route path="/settings/quota" element={<PersonalQuotaPage />} />
              <Route
                path="/settings/personalization"
                element={<SettingsPersonalizationPage />}
              />
              <Route
                path="/settings/appearance"
                element={<SettingsAppearancePage />}
              />
              <Route
                path="/settings/security"
                element={<SettingsSecurityPage />}
              />
              <Route
                path="/settings/credentials"
                element={<CredentialManagementPage />}
              />
              <Route path="/settings/feedback" element={<MyFeedbackPage />} />
              <Route path="/settings/mcp" element={<McpManagementPage />} />
              <Route path="/settings/weixin" element={<WeixinChannelPage />} />
              <Route
                path="/archived"
                element={<ArchivedConversationListPage />}
              />
              <Route
                path="/settings/*"
                element={<Navigate to="/settings/general" replace />}
              />

              <Route element={<AdminRoute />}>
                <Route
                  path="/admin/users"
                  element={<AdminPages page="users" />}
                />
                <Route path="/admin/usage" element={<UsageAnalyticsPage />} />
                <Route path="/admin/quotas" element={<AdminQuotaPage />} />
                <Route
                  path="/admin/roles"
                  element={<AdminPages page="roles" />}
                />
                <Route
                  path="/admin/groups"
                  element={<AdminPages page="groups" />}
                />
                <Route
                  path="/admin/capabilities"
                  element={<AdminCapabilityManagementPage />}
                />
                <Route
                  path="/admin/knowledge-bases"
                  element={<AdminKnowledgeBasePage />}
                />
                <Route
                  path="/admin/knowledge-sources"
                  element={<AdminKnowledgeSourcePage />}
                />
                <Route
                  path="/admin/audit"
                  element={<AdminPages page="audit" />}
                />
                <Route path="/admin/feedback" element={<AdminFeedbackPage />} />
                <Route
                  path="/admin/models"
                  element={<AdminPages page="models" />}
                />
                <Route
                  path="/admin/settings"
                  element={<AdminPages page="settings" />}
                />
                <Route
                  path="/admin/health"
                  element={<AdminPages page="health" />}
                />
                <Route
                  path="/admin/system-update"
                  element={<AdminPages page="updates" />}
                />
              </Route>
            </Route>
            <Route element={<AppShell />}>
              <Route
                index
                element={<Navigate to="/conversations/new" replace />}
              />
              <Route
                path="/conversations/new"
                element={
                  <Suspense fallback={<LoadingState fill />}>
                    <ConversationPage />
                  </Suspense>
                }
              />
              <Route path="/automations" element={<AutomationPage />} />
              <Route
                path="/conversations/:conversationId"
                element={
                  <Suspense fallback={<LoadingState fill />}>
                    <ConversationPage />
                  </Suspense>
                }
              />
              <Route
                path="/conversations"
                element={<Navigate to="/conversations/new" replace />}
              />
              <Route
                path="/capabilities"
                element={<CapabilityManagementPage />}
              />
              <Route
                path="/capabilities/applications/:applicationId/external-access"
                element={<ApplicationExternalAccessPage />}
              />
              <Route
                path="/capabilities/applications/:applicationId/usage"
                element={<ApplicationUsagePage />}
              />
              <Route
                path="/applications/open/:openingId"
                element={<ApplicationOpeningPage />}
              />
              <Route
                path="/applications/:applicationId/run/:conversationId"
                element={
                  <Suspense fallback={<LoadingState fill />}>
                    <InteractiveApplicationPage />
                  </Suspense>
                }
              />
              <Route
                path="/knowledge-bases"
                element={<KnowledgeBaseListPage />}
              />
              <Route
                path="/knowledge-bases/:knowledgeBaseId"
                element={<KnowledgeBaseDetailPage />}
              />
              <Route
                path="/knowledge-bases/:knowledgeBaseId/documents/:documentId/preview"
                element={<KnowledgeDocumentPreviewPage />}
              />
              <Route
                path="/knowledge-citations/:citationId"
                element={<KnowledgeCitationPage />}
              />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </Suspense>
  )
}

export default App
