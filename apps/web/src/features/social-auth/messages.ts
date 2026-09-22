export const socialZhCN = {
  disableHelp:
    "停用后，所有用户将不能再通过此平台登录。请先确保他们有其他登录方式。",
  setupPassword: "通过邮箱设置或重置密码",
  title: "第三方账号登录",
  configure: "配置",
  configureProvider: "配置 {{provider}}",
  providerDescription: "通过 {{provider}} 注册或登录。",
  statusEnabled: "已启用",
  statusDisabled: "已停用",
  statusNotConfigured: "未配置",
  description:
    "通过 Google、Apple 等平台账号注册或登录。开放注册后，新用户完成邮箱验证即可使用，无需管理员启用；已有账号需先登录并关联。",
  providers: {
    google: "Google",
    apple: "Apple",
    microsoft: "Microsoft 个人账号",
    facebook: "Facebook",
  },
  continueWith: "使用 {{provider}} 继续",
  available: "或使用第三方账号",
  enabled: "允许使用此平台登录",
  clientId: "应用 ID",
  clientSecret: "应用密钥",
  privateKey: "Apple 私钥（.p8 文件内容）",
  teamId: "Apple 团队 ID",
  keyId: "Apple 密钥 ID",
  graphVersion: "Facebook API 版本",
  redirectUri: "授权回调地址",
  redirectHelp: "将此地址完整填写到对应平台的开发者后台，保持一致。",
  secretSaved: "已保存，留空可保持不变",
  secretEmpty: "填写平台提供的密钥",
  saved: "配置已保存",
  guide: "打开平台配置后台",
  credentialsHelp:
    "密钥仅用于完成登录验证，保存后不会再次显示。上线前请先用测试账号确认授权正常。",
  microsoftHelp:
    "仅用于 Microsoft 个人账号。工作或学校账号请在“企业账号登录”中配置 Microsoft Entra ID。",
  appleHelp:
    "使用 Services ID 作为应用 ID，并填写所属团队、密钥 ID 和私钥。需要 HTTPS 网站地址。",
  facebookHelp:
    "为应用启用 Facebook Login，并填写开发者后台当前使用的 API 版本（如 vXX.0）。",
  googleHelp: "创建“Web 应用”类型的 OAuth 客户端，并配置授权回调地址。",
  bindings: "已关联的第三方账号",
  bindingsHelp: "关联后可直接登录已有账号。同邮箱的第三方账号不会自动合并。",
  link: "关联 {{provider}}",
  unlink: "解除关联",
  linked: "已关联",
  unavailable: "当前没有可关联的平台。",
  unlinkTitle: "解除第三方账号关联？",
  unlinkDescription:
    "解除后，您需要重新登录。请确保已设置密码或关联另一个可用的登录方式。",
  verifyTitle: "验证您的邮箱",
  verifyDescription:
    "为确保账号安全，请验证您用于接收账号通知和找回密码的邮箱。此步骤仅在首次注册时需要。",
  sendEmail: "发送验证邮件",
  emailSent:
    "验证邮件已发送。请在当前浏览器中打开邮件链接，15 分钟内完成注册。",
  finish: "验证并完成注册",
  callbackTitle: "完成第三方账号登录",
  returnSettings: "返回账号安全设置",
  errors: {
    failed: "授权未完成或已过期，请返回登录页重新尝试。",
    disabled: "该账号已被停用，请联系管理员。",
    email_exists:
      "此邮箱已有账号。请先使用原有方式登录，再到账号安全设置关联第三方账号。",
    registration_disabled:
      "系统暂未开放注册。已有账号请先登录，再关联此第三方账号。",
    last_method: "请先设置密码或关联另一个可用的登录方式。",
    already_linked: "此第三方账号已被关联，或您已关联该平台的另一个账号。",
    configuration_changed: "登录配置已更新，请重新开始登录。",
  },
}

export const socialEnUS = {
  disableHelp:
    "Disabling this provider prevents everyone from signing in with it. Make sure affected users have another sign-in method first.",
  setupPassword: "Set or reset a password by email",
  title: "Third-party accounts",
  configure: "Configure",
  configureProvider: "Configure {{provider}}",
  providerDescription: "Sign up or sign in with {{provider}}.",
  statusEnabled: "Enabled",
  statusDisabled: "Disabled",
  statusNotConfigured: "Not configured",
  description:
    "Sign up or sign in with accounts from Google, Apple and other providers. When registration is open, new users can start after email verification without administrator activation. Existing users must sign in first to link an account.",
  providers: {
    google: "Google",
    apple: "Apple",
    microsoft: "Microsoft personal account",
    facebook: "Facebook",
  },
  continueWith: "Continue with {{provider}}",
  available: "Or use a third-party account",
  enabled: "Allow sign-in with this provider",
  clientId: "App ID",
  clientSecret: "App secret",
  privateKey: "Apple private key (.p8 file contents)",
  teamId: "Apple Team ID",
  keyId: "Apple Key ID",
  graphVersion: "Facebook API version",
  redirectUri: "Authorization callback URL",
  redirectHelp:
    "Copy this exact address into the provider's developer console.",
  secretSaved: "Saved; leave blank to keep it",
  secretEmpty: "Enter the secret provided by the platform",
  saved: "Settings saved",
  guide: "Open developer console",
  credentialsHelp:
    "Secrets are used only to verify sign-in and are never displayed after saving. Test with a test account before launch.",
  microsoftHelp:
    "For personal Microsoft accounts only. Configure Microsoft Entra ID under Enterprise accounts for work or school accounts.",
  appleHelp:
    "Use your Services ID as the App ID, with its Team ID, Key ID and private key. An HTTPS website is required.",
  facebookHelp:
    "Enable Facebook Login and enter the API version currently selected in your developer console (vXX.0).",
  googleHelp:
    "Create a Web application OAuth client and configure its authorization callback URL.",
  bindings: "Linked third-party accounts",
  bindingsHelp:
    "Link an account to sign in to your existing profile. Matching emails are never merged automatically.",
  link: "Link {{provider}}",
  unlink: "Unlink",
  linked: "Linked",
  unavailable: "No providers are currently available to link.",
  unlinkTitle: "Unlink this third-party account?",
  unlinkDescription:
    "You will need to sign in again. Make sure you have a password or another available sign-in method.",
  verifyTitle: "Verify your email",
  verifyDescription:
    "Verify the email used for account notifications and password recovery. This step is only required when first signing up.",
  sendEmail: "Send verification email",
  emailSent:
    "Email sent. Open the link in this browser within 15 minutes to finish signing up.",
  finish: "Verify and finish sign-up",
  callbackTitle: "Complete third-party sign-in",
  returnSettings: "Return to account security",
  errors: {
    failed:
      "Authorization was not completed or has expired. Return to sign-in and try again.",
    disabled: "This account has been disabled. Contact an administrator.",
    email_exists:
      "An account already uses this email. Sign in with your existing method, then link the third-party account in account security settings.",
    registration_disabled:
      "Registration is currently closed. If you already have an account, sign in first and link this third-party account.",
    last_method:
      "Set a password or link another available sign-in method first.",
    already_linked:
      "This third-party account is already linked, or you have linked another account from this provider.",
    configuration_changed:
      "Sign-in settings changed. Please start sign-in again.",
  },
} satisfies typeof socialZhCN
