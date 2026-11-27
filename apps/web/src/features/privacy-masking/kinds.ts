import type { PrivacyMaskingKind } from "@linksense/shared"

export const privacyMaskingKindLabelKeys: Record<PrivacyMaskingKind, string> =
  {
    PRIVATE_KEY: "settings.privacyMaskingKindPrivateKey",
    API_KEY: "settings.privacyMaskingKindApiKey",
    TOKEN: "settings.privacyMaskingKindToken",
    SECRET: "settings.privacyMaskingKindSecret",
    PASSWORD: "settings.privacyMaskingKindPassword",
    TERM: "settings.privacyMaskingKindTerm",
    EMAIL: "settings.privacyMaskingKindEmail",
    PHONE: "settings.privacyMaskingKindPhone",
    ID_CARD: "settings.privacyMaskingKindIdCard",
    BANK_CARD: "settings.privacyMaskingKindBankCard",
  }
