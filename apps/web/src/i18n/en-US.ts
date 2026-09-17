import { errorCatalog } from "@linksense/shared"

export const enUS = {
  common: {
    close: "Close",
    notifications: "Notifications",
    cancel: "Cancel",
    save: "Save",
    saving: "Saving…",
    create: "Create",
    update: "Update",
    delete: "Delete",
    edit: "Edit",
    confirm: "Confirm",
    gotIt: "Got It",
    retry: "Retry",
    continue: "Continue",
    search: "Search",
    loading: "Loading…",
    pageLoading: "Loading…",
    actions: "Actions",
    status: "Status",
    name: "Name",
    description: "Description",
    view: "View",
    email: "Email",
    type: "Type",
    scope: "Scope",
    createdAt: "Created",
    updatedAt: "Updated",
    language: "Language",
    chinese: "简体中文",
    english: "English",
    settings: "Settings",
    signOut: "Sign Out",
    empty: "No data",
    notAvailable: "Not Available",
    back: "Back",
    details: "Details",
    more: "More Actions",
    moreActionsNamed: "More Actions for {{name}}",
    enabled: "Enabled",
    disabled: "Disabled",
    active: "Active",
    system: "System",
    user: "User",
    admin: "Administrator",
    upload: "Upload",
    download: "Download",
    previous: "Previous",
    next: "Next",
    refresh: "Refresh",
    all: "All",
    select: "Select",
    notFound: "Page not found.",
    configured: "Configured",
    notConfigured: "Not Configured",
    enable: "Enable",
    disable: "Disable",
    yes: "Yes",
    no: "No",
    copy: "Copy",
    copied: "Copied.",
    copyNamed: "Copy {{name}}",
    clear: "Clear",
  },
  reasoningEffort: {
    minimal: "Minimal",
    low: "Light",
    medium: "Medium",
    high: "High",
    xhigh: "Extra High",
    max: "Max",
    ultra: "Ultra",
  },
  embed: {
    defaultDescription:
      "Chat with this application and use its complete configured business capabilities.",
    waitingForHost: "Waiting for the host system to provide access…",
    authenticating: "Establishing a secure session…",
    startingPublicSession: "Creating a public access session…",
    reconnecting: "Reconnecting…",
    starterQuestionsLabel: "Suggested questions",
    history: "Task list",
    historyEmpty: "No tasks",
    newConversation: "New task",
    deleteTaskLabel: "Delete task “{{name}}”",
    deleteTaskTitle: "Permanently delete task?",
    deleteTaskDescription:
      "The messages, attachments, and results in “{{name}}” will be permanently deleted and cannot be recovered.",
    deleteTaskConfirm: "Delete permanently",
    deletingTask: "Deleting…",
    inputLabel: "Send a message to the application",
    inputPlaceholder: "Type a message and press Enter to send",
    attachFiles: "Attach files",
    removeAttachment: "Remove attachment {{name}}",
    uploading: "Uploading…",
    send: "Send message",
    stop: "Stop generation",
    errors: {
      systemUnavailable:
        "System status is temporarily unavailable. Check your connection and try again.",
      requestFailed: "The session could not be refreshed. Try again.",
      authenticationFailed:
        "The external session could not be established. Reauthenticate through the host system.",
      hostAuthenticationFailed:
        "The external page could not verify access. Check the App ID and App Secret, then try again.",
      publicSessionFailed:
        "The public access session could not be created. Confirm the application is configured to not require authentication.",
      submitFailed: "The message could not be sent. Try again.",
      interruptFailed: "Generation could not be stopped. Try again.",
      uploadFailed:
        "The attachment could not be uploaded. Check it and try again.",
      removeAttachmentFailed: "The attachment could not be removed. Try again.",
      downloadFailed: "The file could not be downloaded. Try again.",
      answerFailed: "The answer could not be submitted. Try again.",
      switchConversationFailed:
        "The previous task could not be opened. Try again.",
      createConversationFailed: "A new task could not be created. Try again.",
      deleteTaskFailed: "The task could not be permanently deleted. Try again.",
    },
  },
  nav: {
    navigationLabel: "{{productName}} navigation",
    newConversation: "New task",
    automations: "Automations",
    conversations: "Tasks",
    archived: "Archived tasks",
    capabilities: "Plugin Center",
    knowledgeBases: "Resource library",
    pinned: "Pinned",
    recent: "Tasks",
    administration: "Administration",
    usage: "Usage analytics",
    users: "Users",
    roles: "Roles & permissions",
    groups: "User groups",
    adminCapabilities: "Plugin Center",
    adminKnowledgeBases: "Knowledge bases",
    adminKnowledgeSources: "Knowledge sources",
    audit: "Audit logs",
    feedback: "User feedback",
    usersAndGroups: "Users & groups",
    productSettings: "System settings",
    health: "System health",
    open: "Open navigation",
    collapseSidebar: "Collapse sidebar",
    expandSidebar: "Expand sidebar",
    resizeSidebar: "Resize sidebar",
    helpCenter: "Help Center",
    helpCenterNewTab: "Open Help Center in a new tab",
    automationNotifications: "Automation notifications",
    automationNotificationsUnread:
      "Automation notifications, with an unread completed task",
    automationTask: "Automation task",
    unreadCompletion: "Task completed and not yet viewed",
    unreadFailure: "Task failed and has not been viewed",
    creditQuotaRemainingTitle: "Credits remaining",
    creditQuotaRemaining: "Total {{total}} · W {{weekly}} · M {{monthly}}",
  },
  support: {
    menuLabel: "Feedback and help",
    feedback: "Feedback",
    help: "Help",
    feedbackTitle: "Submit feedback",
    feedbackDescription:
      "Tell us about a problem you encountered or something we could improve.",
    feedbackLabel: "Feedback",
    feedbackPlaceholder: "Describe your feedback or paste text and images…",
    feedbackImagesLabel: "Images",
    feedbackImagesHint:
      "Optional. Add up to {{count}} PNG, JPEG, WebP, or GIF images, no larger than {{size}} MB each. You can also paste images directly into the feedback field.",
    addFeedbackImages: "Add images",
    selectedFeedbackImages: "Selected feedback images",
    removeFeedbackImage: "Remove image {{name}}",
    feedbackImageInvalid:
      "Choose images that meet the format and size requirements.",
    feedbackImageCountError: "You can upload up to {{count}} images.",
    submitFeedback: "Submit",
    submittingFeedback: "Submitting…",
    feedbackSubmitted: "Thank you for your feedback.",
  },
  automation: {
    title: "Automations",
    description:
      "Schedule recurring tasks, set reminders, and keep track of what matters.",
    create: "New automation",
    createTitle: "New automation",
    editTitle: "Edit automation",
    editorDescription:
      "Configure the instruction, fixed task, and custom cadence.",
    resizeEditor: "Resize automation editor",
    empty: "No automations yet",
    emptyDescription:
      "Create an automation to start a new run in a fixed task on schedule.",
    suggestions: {
      title: "Suggestions",
      useTemplateNamed: "Use the {{name}} template",
      dailyBrief: {
        title: "Daily brief",
        schedule: "Weekdays 08:00",
        description:
          "Start each workday with a summary of your calendar, unread email, and priorities",
        instruction:
          "Review my calendar, unread email, and priorities. Summarize today's schedule, messages that need a reply, and the most important tasks in a concise daily brief.",
      },
      weeklyReview: {
        title: "Weekly review",
        schedule: "Friday 16:00",
        description:
          "Turn the week's recent work into a concise status update every Friday",
        instruction:
          "Review this week's progress, completed work, unfinished items, and next week's priorities, then organize them into a concise status update.",
      },
      followUpMonitor: {
        title: "Follow-up monitor",
        schedule: "Weekdays 09:00",
        description:
          "Review recent email and calendar activity and flag items that need attention",
        instruction:
          "Review recent email and calendar activity. Identify items that need follow-up, are approaching a deadline, or deserve attention, and summarize them by priority.",
      },
    },
    filterLabel: "Filter automations",
    filter: {
      all: "All",
      active: "Active",
      paused: "Paused",
    },
    filteredEmpty: "No {{filter}} automations",
    filteredEmptyDescription: "Switch filters to view your other automations.",
    name: "Automation title",
    instruction: "Automation instruction",
    instructionHint: "Describe the complete task to perform on every trigger.",
    runIn: "Run in",
    task: "Task",
    targetTask: "Task",
    existingTask: "Existing task",
    newTask: "New task",
    existingTaskHint:
      "Only active pinned tasks owned by your account can be selected.",
    newTaskHint:
      "The task is created and pinned once, then reused for every future trigger.",
    noPinnedTasks:
      "No task is available. Pin a task first, or select New task.",
    selectTask: "Select a pinned task",
    repeat: "Repeat",
    interval: "Every",
    intervalHint: "Run every number of {{unit}} from 1 to 999.",
    minuteOfHour: "Minute of the hour",
    minuteOfHourHint:
      "Enter 0–59. For example, 15 runs at minute 15 of each cycle.",
    time: "Time",
    hour: "Hour",
    minute: "Minute",
    weekdays: "Run on",
    dayOfMonth: "Day",
    monthOfYear: "Month",
    invalidMonthDayHint: "Months without this day are skipped.",
    monthOption: "Month {{month}}",
    dayOption: "Day {{day}}",
    expiresEnabled: "Set an expiration date",
    expiresEnabledHint:
      "Runs may still occur on the expiration date; execution stops the following day.",
    expiresOn: "Expiration date",
    expiresOnPlaceholder: "Select an expiration date",
    clearExpiresOn: "Clear expiration date",
    timeZone: "Runs in the {{timeZone}} time zone.",
    modelOverride: "Set model and reasoning effort",
    modelOverrideHint:
      "When enabled, runs use the selected model and reasoning effort. Otherwise they fall back to your account defaults.",
    modelOverrideUnavailable:
      "No models are available yet. Configure a model provider in the admin settings.",
    modelOverrideLoading: "Loading available models…",
    modelLabel: "Model",
    modelNotSelected: "Select a model",
    reasoningEffortLabel: "Reasoning effort",
    reasoningEffortNotSelected: "Select a reasoning effort",
    nextRun: "Next run",
    lastRun: "Last run",
    nextRunRelative: "Next run {{relative}}",
    lastRunRelative: "Last run {{relative}}",
    lastRunFailed: "Last run failed",
    lastRunEmptyResult: "Last run failed: no output",
    pause: "Pause",
    resume: "Resume",
    pauseNamed: "Pause {{name}}",
    resumeNamed: "Resume {{name}}",
    runNow: "Run now",
    runNowLoading: "Running automation…",
    runNowStarted: "Started “{{name}}”.",
    runNowQueued: "Queued “{{name}}” in its task.",
    openTask: "Open task",
    moreActionsNamed: "More actions for {{name}}",
    editNamed: "Edit {{name}}",
    deleteNamed: "Delete {{name}}",
    deleteTitle: "Delete automation",
    deleteDescription:
      "Delete “{{name}}”? The linked task and its history will be kept.",
    validation:
      "Complete the automation settings and check all numbers, dates, and times.",
    weekdaySeparator: ", ",
    status: {
      active: "Active",
      paused: "Paused",
    },
    frequency: {
      hourly: "Hourly",
      daily: "Daily",
      weekly: "Weekly",
      monthly: "Monthly",
      yearly: "Yearly",
    },
    unit: {
      hourly: "hours",
      daily: "days",
      weekly: "weeks",
      monthly: "months",
      yearly: "years",
    },
    weekday: {
      "1": "Mon",
      "2": "Tue",
      "3": "Wed",
      "4": "Thu",
      "5": "Fri",
      "6": "Sat",
      "7": "Sun",
    },
    schedule: {
      hourly: "Every {{interval}} hour(s) at minute {{minute}}",
      daily: "Every {{interval}} day(s) at {{time}}",
      weekly: "Every {{interval}} week(s), {{weekdays}} at {{time}}",
      monthly: "Every {{interval}} month(s), day {{day}} at {{time}}",
      yearly: "Every {{interval}} year(s), {{month}}/{{day}} at {{time}}",
    },
  },
  quotaManagement: {
    save: "Save settings",
    title: "Quota management",
    description:
      "Manage personal quotas for organization members and self-registered users, and the credit conversion price.",
    conversionTitle: "Credit conversion",
    conversionDescription:
      "Convert model usage costs into credits. Price changes apply only to subsequent consumption; existing charges stay unchanged.",
    creditPrice: "Amount per credit (CNY)",
    conversionExample:
      "For example, at CNY 0.01 per credit, a CNY 0.25 charge consumes 25 credits.",
    organization_members: {
      reset: "Reset quotas for all",
      resetDescription:
        "Restore every existing organization member's weekly, monthly, and total quotas to 100% of their own current limits. Unlimited quotas stay unlimited. Unsaved limits in this form do not apply to the reset. Historical usage stays available, and subsequent consumption is deducted as usual.",

      title: "Initial organization member quotas",
      description:
        "Applied to each member created or imported afterwards. Use the button below to apply these limits to all existing organization members, or adjust members individually or in bulk in user management.",
    },
    self_registered_users: {
      reset: "Reset quotas for all",
      resetDescription:
        "Restore every existing self-registered user's weekly, monthly, and total quotas to 100% of their own current limits. Unlimited quotas stay unlimited. Unsaved limits in this form do not apply to the reset. Historical usage stays available, and subsequent consumption is deducted as usual.",

      title: "Self-registered user quotas",
      description:
        "Applied to each self-registered user. Changing these quotas also updates existing self-registered users, including individual overrides. Leaving a field blank removes that limit.",
    },
    weekly_credit_limit: "Weekly quota (credits)",
    monthly_credit_limit: "Monthly quota (credits)",
    total_credit_limit: "Total quota (credits)",
    weekly_credit_limit_hint:
      "Resets on Monday at midnight in the system time zone.",
    monthly_credit_limit_hint:
      "Resets on the first day of each month in the system time zone.",
    total_credit_limit_hint:
      "Lifetime consumption limit. Does not reset automatically.",
    unlimited: "Unlimited",
    invalidAmount:
      "Enter a positive amount with up to 6 decimal places, no greater than 9,223,372,036,854.775807.",
    applyOrganization: "Apply limits to all",
    applyDescription:
      "Save weekly {{weekly}}, monthly {{monthly}}, and total {{total}} limits as the organization defaults and overwrite every existing organization member's limits, including individual overrides. Used credits are not reset; other form settings stay unchanged.",
    confirmReset: "Confirm quota reset",
    resetHint:
      "Confirmation restores available credits immediately and preserves historical usage.",
    confirmApply: "Confirm save and apply",
    resetSuccess: "Reset quotas for {{count}} members.",
    applySuccess:
      "Saved new limits and applied them to {{count}} organization members.",
    refreshFailed:
      "The action completed, but the page could not refresh. Reload to see the latest quotas.",
    saved: "Quota settings saved.",
    enforcementHint:
      "Blank means unlimited. Reaching any configured limit prevents new tasks; running tasks continue. Consumption is rounded up to the nearest 0.000001 credit.",
  },
  settings: {
    navigationLabel: "{{productName}} settings navigation",
    navigation: "Settings navigation",
    backToApp: "Back to {{productName}}",
    search: "Search settings",
    personalGroup: "Personal",
    administrationGroup: "Administration",
    usageDescription: "Review tasks, turns, and token usage by model",
    general: "General",
    generalDescription:
      "Interface language, message handling, and browser notifications",
    profile: "Profile",
    profileDescription: "Profile and personal usage",
    personalization: "Personalization",
    personalizationDescription: "Custom instructions and memory",
    appearance: "Appearance",
    appearanceDescription: "Interface theme and font size",
    security: "Security",
    securityDescription: "Change sign-in password",
    credentials: "Plugin credentials",
    credentialsDescription: "Manage personal plugin credentials",
    mcp: "MCP",
    mcpDescription: "Manage personal HTTP and STDIO MCP servers",
    channelAccess: "Message channels",
    channelAccessDescription:
      "Manage Weixin, WeCom, DingTalk, Teams, Feishu, and other channels",
    capabilitiesDescription:
      "Browse the Plugin Center and manage personal plugins and Skills",
    archivedDescription: "View archived tasks",
    usersDescription: "Manage user accounts, roles, and status",
    rolesDescription: "Review fixed roles and permission boundaries",
    groupsDescription: "Manage user groups and members",
    usersAndGroupsDescription:
      "Manage user accounts, roles, status, and group membership",
    adminCapabilitiesDescription:
      "Review releases and manage the Plugin Center",
    adminKnowledgeBasesDescription:
      "Govern cross-user knowledge bases and configure external sources",
    adminKnowledgeSourcesDescription:
      "Configure SharePoint and other external knowledge sources",
    auditDescription: "Query cross-user audit logs",
    feedbackDescription: "Review user feedback and issue screenshots",
    modelSettings: "Model settings",
    modelSettingsDescription:
      "Manage the model service, models, and reasoning efforts",
    systemSettings: "System settings",
    systemSettingsDescription: "Product and authentication settings",
    systemHealth: "System health",
    systemHealthDescription: "Service and dependency status",
    systemUpdate: "System update",
    systemUpdateDescription:
      "Check for new releases and review safe update guidance",
    noResults: "No settings match your search.",
    generalPageDescription:
      "Manage interface preferences that apply only to your account.",
    interfaceLanguage: "Interface language",
    interfaceLanguageDescription: "App UI language",
    runningMessageAction: "New messages during a run",
    runningMessageActionDescription:
      "When a task is still running, new messages follow this preference automatically instead of opening a choice dialog.",
    runningMessageActionSteer: "Guide the current run",
    runningMessageActionQueue: "Queue as the next request",
    profilePageDescription: "Update your display name and avatar.",
    taskAutoNaming: "Automatic task naming",
    taskAutoNamingDescription:
      "Name tasks on the first message or update them with every new message. Manually edited names stay unchanged.",
    taskAutoNamingFrequency: "Naming frequency",
    taskAutoNamingFirstMessage: "First message",
    taskAutoNamingEveryMessage: "Every message",
    taskAutoNamingSaved: "Task naming preference saved.",
    personalizationPageDescription:
      "Configure task naming, custom instructions, and memory preferences.",
    customInstructions: "Custom instructions",
    customInstructionsDescription:
      "Provide extra guidance and context for all future tasks. Task-level platform rules and safety boundaries always take precedence.",
    customInstructionsPlaceholder:
      "For example: Keep answers concise; lead with the conclusion, then add any necessary details.",
    customInstructionsCount: "{{count}} / {{max}}",
    customInstructionsSaved: "Custom instructions saved",
    unsavedChangesTitle: "Discard Unsaved Changes?",
    unsavedChangesDescription:
      "Your unsaved custom instructions will be lost if you leave this page.",
    stayOnPage: "Stay on Page",
    discardChanges: "Discard Changes",
    memory: "Memory",
    memoryDescription:
      "Configure how your personal memories are created, retained, and used.",
    enableMemories: "Enable memories",
    enableMemoriesDescription:
      "Create memories from tasks and use existing memories in future tasks. Tasks involving external tools or web context do not create memories.",
    resetMemories: "Reset memories",
    resetMemoriesDescription:
      "Delete all your memories without deleting tasks, custom instructions, plugins, or Skills.",
    reset: "Reset",
    resetMemoriesConfirmTitle: "Reset all memories?",
    resetMemoriesConfirmDescription:
      "This cannot be undone. Your tasks, custom instructions, plugins, and Skills will remain.",
    memoriesReset: "Memories reset",
    appearancePageDescription:
      "Set the {{productName}} interface theme and base font size.",
    theme: "Theme",
    themeSystem: "System",
    themeLight: "Light",
    themeDark: "Dark",
    uiFontSize: "UI font size",
    uiFontSizeDescription:
      "Adjust the base font size used across {{productName}}, from {{min}} to {{max}} px.",
    uiFontSizeUnit: "px",
    securityPageDescription:
      "Change your local sign-in password and revoke existing sign-in sessions.",
  },
  botChannels: {
    connectionError:
      "Check the app credentials, messaging permissions, and network, then try again.",
    connect: "Connect",
    disconnect: "Disconnect {{name}}",
    settings: "View configuration",
    setupTitle: "Connect {{name}}",
    save: "Save configuration",
    cancel: "Cancel",
    confirmDisconnect: "Disconnect",
    retry: "Retry",
    account: "App or bot account",
    botId: "Bot ID",
    clientId: "App Client ID",
    secret: "App secret",
    tenantId: "Tenant ID",
    sender: "Allowed member ID",
    groups: "Allow this member to start tasks by mentioning the bot in groups",
    callback: "Messaging endpoint",
    callbackHelp:
      "Set this URL as the Azure Bot messaging endpoint. It must be publicly reachable over HTTPS.",
    replaceHelp:
      "To replace the app or secret, disconnect and configure the channel again.",
    disconnectHelp:
      "Disconnecting stops receiving and replying through this channel and removes pending messages and replies. Existing LinkSense tasks are kept.",
    invalid:
      "Check all required fields. Teams app, tenant, and member IDs must be valid UUIDs.",
    status: {
      connecting: "Connecting",
      online: "Online",
      waiting_message: "Waiting for a message",
      error: "Connection error",
      disconnected: "Not connected",
    },
    description: {
      wecom:
        "Receive direct messages and group mentions through a WeCom intelligent bot.",
      dingtalk:
        "Receive direct messages and group mentions through a DingTalk app bot.",
      teams: "Receive direct messages and group mentions through a Teams bot.",
    },
    setup: {
      wecom:
        "Create an intelligent bot in WeCom using API mode and a persistent connection, then enter its ID, secret, and allowed member.",
      dingtalk:
        "Create an internal app on the DingTalk developer platform, enable and publish its Stream bot, and grant direct and group messaging permissions.",
      teams:
        "Create a single-tenant Azure Bot and enable Microsoft Teams. After saving, configure its messaging endpoint in Azure and install the bot app in Teams.",
    },
    senderHelp: {
      wecom:
        "Enter the member userid from your WeCom directory. Only this member can use your LinkSense assistant.",
      dingtalk:
        "Enter the member UserId from your DingTalk organization. Only this member can use your LinkSense assistant.",
      teams:
        "Enter the user object ID from Microsoft Entra. Only this user can use your LinkSense assistant.",
    },
  },
  channelAccess: {
    title: "Message channels",
    description:
      "Connect and manage Weixin, WeCom, DingTalk, Teams, Feishu, and other message channels. The LinkSense assistant handles messages by default.",
    channelsLabel: "Available channels",
    weixin: {
      name: "Weixin",
      description:
        "Receive messages through a personal Weixin connection and hand them to the LinkSense assistant.",
      notConnected: "No Weixin account connected",
      accountConnected: "Connected account {{account}}",
      scopeValue: "Scanning account only · Text and transcribed voice",
      iconLabel: "Weixin icon",
      connect: "Connect",
      reconnect: "Reconnect",
      disconnect: "Disconnect",
      successDescription: "Weixin is connected to LinkSense.",
      connectedNotice: "Weixin connected",
      disconnectedNotice: "Weixin disconnected",
      loginTitle: "Connect Weixin",
      loginDescription:
        "Scan and confirm with Weixin on your phone. LinkSense only processes messages from that scanning account.",
      generatingQr: "Generating a Weixin QR code",
      qrCodeLabel: "Weixin connection QR code",
      verificationLabel: "Pairing code shown in Weixin",
      submitVerification: "Submit pairing code",
      generateAgain: "Generate again",
      finish: "Done",
      disconnectTitle: "Disconnect Weixin?",
      disconnectDescription:
        "LinkSense will stop receiving and replying to Weixin messages. Existing LinkSense tasks will remain.",
    },
    wecom: {
      name: "WeCom",
      description:
        "Receive member or customer messages in WeCom and hand them to the LinkSense assistant.",
    },
    dingtalk: {
      name: "DingTalk",
      description:
        "Receive organization messages and collaboration notifications in DingTalk and hand them to the LinkSense assistant.",
    },
    teams: {
      name: "Microsoft Teams",
      description:
        "Receive personal or team messages in Teams and hand them to the LinkSense assistant.",
      scopeValue: "Teams chats and channel messages",
    },
    feishu: {
      name: "Feishu",
      description:
        "Receive messages through a Feishu bot and hand them to the LinkSense assistant.",
      notConnected: "No personal Feishu bot created",
      scopeValue: "Owner only · Direct text messages",
      iconLabel: "Feishu icon",
      connect: "Connect",
      reconnect: "Update access",
      disconnect: "Disconnect",
      successDescription:
        "The bot credentials are saved securely. The message connection is being established.",
      botCreated:
        "Bot “{{bot}}” was created. The message connection is being established",
      appUpdated:
        "Feishu app access was updated. The message connection is being established.",
      connectedNotice: "Feishu bot created",
      updatedNotice: "Feishu app access updated",
      pendingApprovalNotice:
        "The Feishu app was created and is waiting for administrator approval",
      pendingApprovalUpdatedNotice:
        "The Feishu app was updated and is waiting for administrator approval",
      pendingApprovalDescription:
        "You do not need to scan again. LinkSense will connect automatically after an administrator approves the app.",
      disconnectedNotice: "Feishu disconnected",
      registrationTitle: "Create a personal Feishu bot",
      registrationDescription:
        "Scan with Feishu and approve access. LinkSense creates an official bot and stores its credentials securely, with no developer-console setup required.",
      reauthorizationTitle: "Update Feishu bot access",
      reauthorizationDescription:
        "Scan with Feishu and approve the additional message access. LinkSense updates the current bot and configures its message connection without creating a duplicate bot.",
      generatingQr: "Requesting a creation QR code from Feishu",
      qrCodeLabel: "Feishu bot creation QR code",
      generateAgain: "Generate again",
      recoverExisting: "Connect created bot",
      createWhenMissing: "App deleted? Create a new app",
      finish: "Done",
      disconnectTitle: "Disconnect Feishu?",
      disconnectDescription:
        "LinkSense will stop receiving and replying to Feishu messages. The official bot and existing LinkSense tasks will remain.",
      registrationStatus: {
        generating_qr: "Generating a QR code",
        waiting_scan: "Scan with Feishu and approve access",
        pending_approval: "App created, waiting for administrator approval",
        pending_approval_update:
          "App updated, waiting for administrator approval",
        connected: "Bot created",
        updated: "Feishu app updated",
        expired: "The QR code expired",
        failed:
          "The bot may already exist, but connection setup did not finish. Scan again and select the bot you just created",
        update_failed:
          "The Feishu app update did not finish. Scan again to retry",
      },
    },
    scopeLabel: "Message scope",
    entryLabel: "Access method",
    weixinEntryValue: "QR connection",
    upcomingEntryValue: "Pending release",
    unavailableAction: "Not available yet",
    status: {
      available: "Available",
      comingSoon: "Coming soon",
      online: "Online",
      connecting: "Connecting",
      pending_approval: "Waiting for administrator approval",
      error: "Connection error",
      reauthorization_required: "Reconnect required",
    },
    loginStatus: {
      waiting_scan: "Waiting for the QR code to be scanned",
      scanned: "Scanned. Confirm the connection in Weixin",
      verification_required: "Enter the pairing code shown in Weixin",
      connected: "Connected",
      expired: "The QR code expired",
      failed: "The connection did not complete. Generate a new QR code",
    },
  },
  browserNotifications: {
    settingsTitle: "Browser notifications",
    settingsDescription:
      "When you are not actively using LinkSense, this browser notifies you when a regular task or automation succeeds, fails, or is interrupted.",
    promptMessage: "Get browser notifications and sounds when tasks finish.",
    promptDismiss: "Not now",
    promptEnable: "Enable",
    promptEnabling: "Enabling",
    enable: "Enable browser notifications",
    unsupported:
      "Browser notifications are not supported in this browser or host environment. Open LinkSense in a supported secure browser page.",
    permissionDenied:
      "Notifications are blocked by the browser. Allow them in this site's browser permissions, then return here and try again.",
    permissionDismissed:
      "Notifications have not been allowed. Turn this on again and choose Allow in the browser prompt.",
    permissionRequired:
      "The enabled preference is saved, but browser permission was reset. Turn browser notifications off, then on again to grant permission.",
    permissionError:
      "Browser notification permission could not be requested. Try again later.",
    storageError:
      "The notification setting could not be saved in this browser. Notifications are stopped on this page; refresh and check the switch again.",
    deliveryError:
      "The browser could not create a system notification, so notifications remain off. Check this site's permissions and your operating system's notification settings for this browser.",
    feedError:
      "The task completion notification service could not be reached, so notifications remain off. Check your connection and try again.",
    testTitle: "{{productName}} · Browser notification test",
    testBody:
      "Notifications are connected. You will be notified here when a task or automation produces a result.",
    testSent:
      "A test notification was sent to the system. If you did not see it, check your operating system's notification settings for this browser.",
    notificationTitle: "{{productName}} · {{taskTitle}}",
    statusCompletedBody: "Processed successfully",
    statusFailedBody: "Processing failed",
    statusInterruptedBody: "Processing interrupted",
  },
  mcp: {
    title: "MCP servers",
    description:
      "Connect and manage personal Streamable HTTP and STDIO MCP servers. Every enabled item is attached to new tasks automatically.",
    add: "Add server",
    empty: "No personal MCP servers configured",
    emptyDescription:
      "Add a remote Streamable HTTP endpoint or a container-hosted STDIO MCP server.",
    createTitle: "Connect a custom MCP",
    editTitle: "Edit MCP server",
    editorDescription:
      "MCP is independent from plugins. Enabled configurations are attached to your new tasks automatically.",
    transportLabel: "Connection type",
    transport: {
      streamable_http: "HTTP",
      stdio: "STDIO",
    },
    name: "Name",
    url: "Server URL",
    urlHint: "HTTP and HTTPS Streamable HTTP MCP endpoints are supported.",
    stdioConfiguration: "STDIO configuration (JSON)",
    stdioConfigurationHint:
      "Enter command, args, and env directly, or paste an mcpServers JSON object containing exactly one server. env values are encrypted; npx -y is safely translated to managed pnpm dlx inside the task container.",
    stdioConfigurationEditHint:
      "Saved env values are never shown. Omit env to keep them, provide env to replace them, or use an empty object to clear them.",
    stdioConfigurationInvalid:
      "Enter valid single-server STDIO JSON. command is required, args must be a string array, and env must be a string object.",
    currentEnvironmentKeys: "Current variables: {{keys}}",
    environmentCount: "{{count}} environment variables",
    authentication: "Authentication",
    apiKeyHeader: "API Key header",
    credential: "Credential",
    credentialHint:
      "The credential is encrypted at rest and is not shown again.",
    keepCredentialHint: "Leave blank to keep the current credential.",
    startupTimeout: "Startup timeout (seconds)",
    toolTimeout: "Tool timeout (seconds)",
    httpWarningTitle: "HTTP connections are insecure",
    httpWarningDescription:
      "Bearer tokens, API Keys, tool arguments, and results are transmitted without encryption and may be read or modified in transit.",
    httpAcknowledgement:
      "I understand and accept the risks of unencrypted HTTP.",
    testConnection: "Test connection",
    testing: "Testing {{name}}",
    testSucceeded: "Connected to {{serverName}} and found {{count}} tools.",
    testStatus: {
      succeeded: "Test passed",
      failed: "Test failed",
      untested: "Not tested",
    },
    testStatusLabel: "{{name}}: {{status}}",
    auth: {
      none: "No authentication",
      bearer: "Bearer Token",
      api_key: "API Key",
    },
    toggle: "Enable or disable {{name}}",
    saved: "The MCP server was saved.",
    deleted: "The MCP server was deleted.",
    deleteTitle: "Delete this MCP server?",
    deleteDescription:
      "The server configuration, encrypted credential, and encrypted environment variables will be permanently deleted. New tasks will no longer connect to it.",
  },
  bootstrap: {
    unavailableTitle: "{{productName}} is temporarily unavailable",
    unavailableDescription:
      "Unable to connect to {{productName}}. Please wait a moment or try again.",
  },
  maintenance: {
    title: "System maintenance",
    indicatorLabel: "System maintenance enabled",
    dialogTitle: "System maintenance enabled",
    dialogDescription:
      "Regular users cannot access the system right now. You can continue using and managing it. Turn off maintenance mode when you are finished.",
    reasonLabel: "Maintenance details",
    doNotShowAgain: "Don’t show again",
    rememberFailed:
      "Your preference could not be saved. Check whether your browser allows site data. You can still close this reminder using the top-right button.",
    openSettings: "Maintenance settings",
    defaultReason: "The system is undergoing scheduled maintenance.",
    description:
      "This page will recover automatically when maintenance ends. Try again later.",
    windowLabel: "Expected maintenance window",
    windowValue: "{{start}} to {{end}}",
    adminEntry: "Admin sign-in",
  },
  auth: {
    loginTitle: "Sign in to {{productName}}",
    loginDescription: "Continue with an available sign-in method.",
    passwordLogin: "Email and password",
    password: "Password",
    signIn: "Sign in",
    signOutTitle: "Sign out?",
    signOutDescription:
      "You will need to sign in again to continue using {{productName}}.",
    forgotPassword: "Forgot password or set one for the first time",
    forgotTitle: "Set or reset your password",
    forgotDescription:
      "Enter your email. The system sends a secure link when the account is eligible.",
    sendResetLink: "Send secure link",
    resetRequestSubmitted: "Secure-link request submitted",
    resetRequestFailed: "Secure link could not be sent",
    resetAccepted:
      "If the email belongs to an eligible account, a password setup or reset email will be sent.",
    resetTitle: "Set a new password",
    resetDescription:
      "The secure link can be used once. Set a password that meets the policy.",
    newPassword: "New password",
    currentPassword: "Current password",
    confirmPassword: "Confirm new password",
    showPassword: "Show {{field}}",
    hidePassword: "Hide {{field}}",
    resetPassword: "Save new password",
    resetCompleted: "Your password has been set. Sign in again.",
    changePassword: "Change password",
    passwordPolicy:
      "8–16 characters with uppercase, lowercase, a number, and punctuation or a symbol.",
    oidc: "Use single sign-on",
    teamsSigningIn: "Signing in silently with Microsoft Teams…",
    teamsNotConfigured:
      "Teams single sign-on is not configured. Sign in to {{productName}}.",
    teamsFailed: "Teams sign-in failed. Retry or use another sign-in method.",
    callbackTitle: "Completing single sign-on",
    oidcAccountPendingApproval:
      "Single sign-on succeeded. Your account was created and is awaiting administrator approval. Contact an administrator, then sign in again after it is enabled.",
    externalAccountPendingApproval:
      "Sign-in succeeded. Your account was created and is awaiting administrator approval. Contact an administrator, then sign in again after it is enabled.",
    oidcCallbackFailed:
      "Single sign-on could not be completed. Return to the sign-in page and try again.",
    oidcCallbackSessionFailed:
      "Single sign-on completed, but the {{productName}} session could not be established. Return to the sign-in page and try again.",
    backToLogin: "Back to sign in",
    sessionExpired: "Your session has expired. Please sign in again.",
    sessionRestoreFailed:
      "Your sign-in session could not be restored. Check your connection and try again.",
    registration: {
      createAccount: "Create account",
      title: "Create a {{productName}} account",
      description:
        "Enter your email and we will send an account activation link when it is eligible.",
      closed: "Registration is currently closed.",
      disabled: "Registration is currently closed.",
      sendActivationLink: "Send activation email",
      requestSubmitted: "Activation email requested",
      requestFailed: "Activation email could not be sent",
      requestAccepted:
        "If the email address is eligible, an account activation email will be sent.",
      emailUnavailable:
        "Account activation email is temporarily unavailable. Please try again later.",
      deliveryFailed:
        "The account activation email could not be sent. Please try again later.",
      activateTitle: "Set a password and activate your account",
      activateDescription:
        "The activation link can be used once. Set a sign-in password that meets the policy.",
      activate: "Activate account and sign in",
      invalidOrExpired:
        "The account activation link is invalid or has expired. Request a new one.",
      emailAlreadyRegistered:
        "An account already exists for this email. Sign in or reset the password instead.",
    },
  },
  initialize: {
    title: "Initialize {{productName}}",
    description:
      "Create the first administrator. Infrastructure and secrets remain deployment-managed.",
    adminName: "Administrator name",
    credential: "One-time initialization credential",
    credentialHint:
      "Enter the one-time credential shown in the terminal after installation. It becomes invalid after the administrator is created.",
    systemName: "System name",
    submit: "Create administrator and finish setup",
    completed:
      "Initialization is complete. Sign in with the administrator account.",
  },
  knowledgeSources: {
    title: "Knowledge sources",
    description:
      "Configure external knowledge connections centrally. Only administrators can create and manage externally sourced knowledge bases.",
    saved: "The SharePoint source settings were saved and authenticated.",
    secretConfigured: "Secret configured; leave blank to keep it",
    sharepoint: {
      title: "Microsoft SharePoint",
      description:
        "Synchronize documents from an approved site folder with a Microsoft Graph application identity.",
      enable: "Enable SharePoint source",
      enableDescription:
        "Administrators can paste a SharePoint folder URL when creating a knowledge base.",
      tenantId: "Directory (tenant) ID",
      clientId: "Application (client) ID",
      tenantDomain: "SharePoint tenant domain",
      tenantDomainDescription:
        "Only folder URLs on this exact host are accepted, for example contoso.sharepoint.com.",
      clientSecret: "Client secret",
      secretDescription:
        "The secret is encrypted at rest and is never returned or logged.",
      permissionTitle: "Least-privilege requirement",
      permissionDescription:
        "Use Sites.Selected and have a Microsoft 365 administrator grant read access only to approved Sites. Saving validates the application identity; knowledge-base creation also verifies access to the actual folder.",
    },
  },
  library: {
    title: "Resource library",
    description: "Manage knowledge and files generated while tasks run.",
    tabsLabel: "Resource library content",
    tabs: {
      knowledge: "Knowledge bases",
      artifacts: "Task artifacts",
    },
    artifacts: {
      title: "Task artifacts",
      description:
        "Browse files generated by tasks in task and time order, then download or preview supported formats.",
      searchPlaceholder: "Search task titles or file names…",
      fileTypeLabel: "Filter by file type",
      fileTypes: {
        all: "All types",
        image: "Images",
        word: "Word",
        excel: "Excel",
        powerpoint: "PPT",
        html: "HTML",
        pdf: "PDF",
        archive: "Archives",
        text: "Text",
        audio: "Audio",
        video: "Video",
        other: "Other",
      },
      empty: "No task artifacts",
      emptyDescription:
        "Files will appear here after a task generates and registers a downloadable artifact.",
      searchEmpty: "No matching task artifacts",
      listLabel: "Task artifact timeline",
      archivedTask: "Archived",
      previewAvailable: "Preview available",
      downloadNamed: "Download {{name}}",
      loadingMore: "Loading more…",
      resizePreview: "Resize task artifact preview",
    },
  },
  knowledge: {
    title: "Knowledge bases",
    description: "Organize, share, and search the documents you can access.",
    searchCapability: {
      notInstalledTitle: "Knowledge bases are not included in Core",
      notInstalledDescription:
        "This installation uses LinkSense Core. Install the Full edition to add document parsing and knowledge search.",
      unavailableTitle: "Knowledge search is unavailable",
      unavailableDescription:
        "Knowledge search cannot be used right now. You can still use plugins, Skills, attachments, and submit tasks normally. Try again later.",
      dimensionMismatch:
        "The knowledge index does not match the current deployment configuration. An administrator must check the configuration and run a manual full rebuild.",
    },
    creationCapability: {
      unreadyTitle: "A knowledge base cannot be created yet",
      unreadyDescription:
        "The following requirements must recover before you can create a knowledge base:",
      requestFailedTitle: "Knowledge-base requirements could not be confirmed",
      requestFailedDescription:
        "The service check did not finish. Check again before creating a knowledge base.",
      notInstalledTitle: "Knowledge bases are not included in this edition",
      notInstalledDescription:
        "Install an edition that includes knowledge bases before creating one.",
      retry: "Check again",
      checks: {
        objectStorageUnavailable: "File storage is temporarily unavailable",
        documentParsingUnavailable:
          "Document parsing is temporarily unavailable",
        embeddingNotConfigured:
          "An administrator has not configured an embedding model",
        embeddingUnavailable:
          "The embedding model service is temporarily unavailable",
        searchAndIndexingUnavailable:
          "Knowledge search and indexing are temporarily unavailable",
      },
    },
    searchPlaceholder: "Search knowledge base names or descriptions…",
    empty: "No knowledge bases",
    loadMore: "Load more",
    noDescription: "No description",
    backToList: "Back to knowledge bases",
    overview: "Knowledge base overview",
    documents: "Documents",
    documentsDescription:
      "Upload documents and follow parsing, chunking, embedding, and indexing progress.",
    documentsEmpty: "No documents",
    directory: {
      breadcrumb: "Knowledge base directory path",
      root: "Root",
      empty: "This folder has no documents",
      flatEmpty: "This knowledge base and its folders have no documents",
      viewMode: "Document view",
      directoryView: "Folders",
      flatView: "Flat",
      openFolder: "Open folder {{name}}",
      expandFolder: "Expand folder {{name}}",
      collapseFolder: "Collapse folder {{name}}",
      showFolders: "Show folders",
      open: "Open",
      folder: "Folder",
    },
    documentCount: "{{count}} documents",
    readyCount: "{{count}} searchable",
    ownerNamed: "Owner: {{name}}",
    ownerNamedSelf: "Owner: {{name}} (me)",
    updated: "Updated {{date}}",
    sourceType: {
      label: "Source: {{source}}",
      local: "Local",
      sharepoint: "SharePoint",
    },
    disabled: "Knowledge base disabled",
    disabledDescription:
      "This knowledge base is currently unavailable. Contact its owner or an administrator.",
    archivedReadOnly:
      "This knowledge base is archived and read-only. Restore it to manage documents or sharing.",
    lifecycle: {
      label: "Status",
      current: "Current",
      archived: "Archived",
    },
    filter: {
      label: "Filter knowledge bases",
      all: "All",
    },
    scope: {
      label: "Knowledge base scope",
      all: "All",
      owned: "Created by me",
      shared: "Shared with me",
    },
    access: {
      owner: "Created by me",
      direct: "Shared directly with me",
      group: "Shared through {{name}}",
      multiple: "{{count}} sharing sources",
      shared: "Shared with me",
      unknownGroup: "Unknown group",
      detailsAction: "View source details",
      detailsTitle: "Access sources",
      detailsDescription:
        "You currently have access through the following active sources.",
      directSource: "Direct personal share",
      groupSource: "User group: {{name}}",
    },
    create: {
      action: "Create knowledge base",
      title: "Create knowledge base",
      description:
        "Upload documents after creation, then share them with users or groups as needed.",
      name: "Knowledge base name",
      optionalDescription: "Description (optional)",
      nameRequired: "Enter a knowledge base name.",
      sourceType: "Data source",
      sourceLocal: "Local upload",
      sourceLocalDescription:
        "Upload and manage local documents after creation.",
      sourceSharePoint: "SharePoint folder",
      sourceSharePointDescription:
        "Connect a SharePoint folder and synchronize it on a schedule.",
      sourceUnavailable: "Not enabled",
      sharePointNotConfigured:
        "An administrator has not enabled the SharePoint source.",
      sharePointUrl: "SharePoint folder URL",
      sharePointUrlHint:
        "Supports SharePoint folder sharing links and direct in-site folder URLs.",
      sharePointUrlPlaceholder:
        "https://contoso.sharepoint.com/:f:/s/team/share-token",
      syncFrequencyLabel: "Sync frequency",
      syncFrequency: {
        daily: "Daily",
        weekly: "Weekly",
        monthly: "Monthly",
      },
      syncWeekdayLabel: "Weekday",
      syncWeekday: {
        "1": "Mon",
        "2": "Tue",
        "3": "Wed",
        "4": "Thu",
        "5": "Fri",
        "6": "Sat",
        "7": "Sun",
      },
      syncDayOfMonth: "Day",
      syncInvalidMonthDayHint: "Months without this day are skipped.",
      syncDayOption: "Day {{day}}",
      syncTime: "Time",
      syncHour: "Hour",
      syncMinute: "Minute",
      syncTimeZone: "Synchronizes in the {{timeZone}} time zone.",
    },
    source: {
      title: "SharePoint synchronization",
      syncNow: "Sync now",
      retrySync: "Retry synchronization",
      syncAccepted: "The SharePoint synchronization job was submitted.",
      status: {
        pending: "Folder {{folder}} is waiting to synchronize.",
        syncing: "Synchronizing folder {{folder}}.",
        ready: "Folder {{folder}} is synchronized.",
        failed:
          "Some or all content in folder {{folder}} failed to synchronize.",
      },
      phase: {
        scanning: "Scanning the SharePoint folder",
        syncing: "Synchronizing SharePoint files",
        processing: "Processing knowledge documents",
        completed: "Synchronization completed",
      },
      progress: {
        scanning: "Scanning the folder; {{count}} items discovered",
        syncing: "Synchronizing files ({{processed}}/{{total}})",
        processing: "Processing documents ({{processed}}/{{total}})",
        completed: "Synchronization completed ({{processed}}/{{total}})",
        discovered: "{{count}} discovered",
        summary:
          "Processed {{processed}}/{{total}}: {{created}} created, {{updated}} updated, {{deleted}} deleted, {{skipped}} skipped, {{retried}} resumed, and {{failed}} failed.",
      },
      retryHint:
        "Select Retry synchronization to continue from the failed scan page or file-processing checkpoint.",
    },
    edit: {
      title: "Edit knowledge base details",
      description:
        "Update the name and description without reprocessing existing documents.",
    },
    actions: {
      archive: "Archive",
      restore: "Restore",
      retryNamed: "Retry processing {{name}}",
      reprocessNamed: "Reprocess {{name}}",
      rebuildNamed: "Rebuild index for {{name}}",
      cancelProcessing: "Cancel processing",
      reprocess: "Reprocess",
      rebuild: "Rebuild index",
      rebuildSelected: "Rebuild selected",
      rebuildSelectedShort: "Selected",
      rebuildAll: "Rebuild all documents",
      rebuildAllShort: "All",
      rename: "Rename",
      removeDirectShare: "Remove my direct share",
      documentMenu: "Manage document {{name}}",
    },
    confirm: {
      archive: {
        title: "Archive knowledge base?",
        description:
          "The knowledge base becomes read-only after archiving and can be restored later.",
      },
      restore: {
        title: "Restore knowledge base?",
        description:
          "Uploading, processing, and sharing are available again after restoration.",
      },
      delete_base: {
        title: "Permanently delete knowledge base?",
        description:
          "This cannot be undone. Only archived knowledge bases can be deleted.",
      },
      delete_document: {
        title: "Delete document?",
        description:
          "This deletes “{{name}}”, its parsed content, and its index data.",
      },
      reprocess: {
        title: "Reprocess document?",
        description:
          "“{{name}}” will be parsed and processed again with the current configuration.",
      },
      rebuild: {
        title: "Rebuild document index?",
        description:
          "“{{name}}” will be chunked and embedded again, replacing its current index.",
      },
      rebuild_selected: {
        title: "Rebuild the selected document indexes?",
        description:
          "Ready documents will be rechunked and embedded to replace their indexes. Failed documents will resume from their existing failed candidates and complete indexing. {{count}} documents will be processed.",
      },
      rebuild_all: {
        title: "Rebuild every document index in this knowledge base?",
        description:
          "Ready documents will be rechunked and embedded to replace their indexes. Failed documents will resume from their existing failed candidates and complete indexing.",
      },
      remove_direct_share: {
        title: "Remove your direct share?",
        description:
          "This removes the personal share granted directly to you. {{remainingAccess}}",
      },
    },
    deleteBlocked: {
      title: "Knowledge base cannot be deleted yet",
      description:
        "Remove this knowledge base from the following applications, then try deleting it again.",
      usagesTitle: "Applications using this knowledge base ({{count}})",
      openApplications: "Open Application Center",
    },
    storage: {
      title: "Storage",
      description:
        "Current versions, archived content, old versions retained for citations or for 30 days, failed originals, and objects awaiting cleanup all use storage. A deleted status does not mean capacity has already been released.",
      reserved: "{{size}} reserved",
    },
    events: {
      reconnecting:
        "The live progress connection was interrupted and is reconnecting. Periodic refresh remains active.",
    },
    document: {
      name: "Document",
      size: "Size",
      rebuildRequired: "Rebuild required",
      retryAt: "Next retry expected {{date}}",
      retryWaitingFirst: "First automatic retry will continue at {{date}}",
      retryWaitingSecond: "Second automatic retry will continue at {{date}}",
      selectAll: "Select all currently loaded documents",
      selectNamed: "Select document {{name}}",
      selectedCount: "{{count}} documents selected",
      rebuildBatchResult:
        "Submitted {{accepted}} documents for processing; {{rejected}} could not be submitted.",
      candidateFailure:
        "This candidate failed. The current available version remains usable.",
      failureDetailsNamed:
        "View processing failure details for document {{name}}",
      renameTitle: "Rename document",
      renameDescription:
        "Only the display name changes. The document is not parsed or embedded again.",
      displayName: "Document name",
      failure: {
        cancelled: "Processing for this task was stopped.",
        encrypted:
          "The document is password-protected or encrypted and cannot be processed.",
        unsupportedFormat:
          "This document format is not supported for processing.",
        officeConversionFailed:
          "The document could not be converted to a parseable format. Confirm that it opens normally in common office software.",
        tooLarge:
          "The document exceeds the per-file size limit and cannot be processed.",
        storageQuota:
          "The knowledge base does not have enough storage to continue processing.",
        structureInvalid:
          "The document structure or source coverage validation failed.",
        imageConfigurationChanged:
          "The image-understanding configuration changed. Reprocess the document with the current configuration.",
        imageModelNotFound:
          "The configured image-understanding model no longer exists. Select another image-understanding model, then reprocess the document.",
        imageOutputInvalid:
          "The image-understanding model did not return a valid structured description. Check the model and retry.",
        imageThinkingNotDisabled:
          "The system could not verify that image-model thinking was disabled, so processing stopped safely.",
        parsingServiceFailed:
          "The document parsing service did not produce a usable result. Retry, or contact an administrator if the problem continues.",
        parsingTaskExpired:
          "The document parsing task expired and automatic resubmission failed. Retry, or contact an administrator if the problem continues.",
        parsingInvalid:
          "The parsed document did not pass integrity or safety validation.",
        configuration:
          "The embedding or index configuration is incompatible with this document. Check the deployment configuration and retry.",
        serviceAuthentication:
          "Authentication to an external processing service failed. Ask an administrator to check the deployment configuration.",
        serviceUnavailable:
          "A document processing dependency is unavailable. Retry later.",
        indexingFailed:
          "Writing or validating the knowledge index failed. Retry later.",
        busy: "Another task is processing this document. Try again later.",
        unknown:
          "Document processing failed. Retry, or contact an administrator if it continues.",
      },
      status: {
        processing: "Processing",
        ready: "Searchable",
        failed: "Processing failed",
        deleted: "Deleted",
      },
      stage: {
        queued: "Waiting to process",
        uploading: "Uploading",
        validating: "Validating",
        parsing: "Parsing",
        chunking: "Generating child chunks",
        image_understanding: "Understanding document images",
        parenting: "Building parent chunks",
        embedding: "Generating embeddings",
        indexing: "Writing index",
        activating: "Activating the new index",
        processing: "Processing",
      },
    },
    upload: {
      action: "Upload documents",
      title: "Upload documents",
      ocrLabel: "Enable OCR",
      ocrDescription:
        "Recognize text in scans and images. Enabling OCR increases document processing time.",
      ocrRecommendedForImages:
        "The selected files include images. Enable OCR for this batch to recognize text in them.",
      enableOcrForBatch: "Enable OCR for this batch",
      sourceType: "Upload source",
      sourceTypeDescription:
        "Choose one or more files, or preserve a local folder hierarchy.",
      filesMode: "Files",
      folderMode: "Folder",
      chooseFiles: "Choose documents",
      chooseFolder: "Choose local folder",
      limits:
        "Up to {{maxFileSize}} per file and {{maxFiles}} documents per selection.",
      loadingLimits: "Loading the deployment upload limits.",
      queue: "Upload queue",
      queueSummary: "{{total}} files, {{waiting}} waiting",
      start: "Start upload ({{count}})",
      locateExisting: "View existing document",
      replace: "Replace existing document",
      keepBoth: "Keep both",
      resolveConflict: "Resolve name conflict",
      conflictTitle: "Resolve document name conflict",
      conflictDescription:
        "“{{incoming}}” has the same name as “{{existing}}” but different content. Choose how to handle this file.",
      confirmedName: "Server-confirmed name: {{name}}",
      batch: {
        runningTitle: "Uploading and processing documents",
        attentionTitle: "Some documents need attention",
        completedTitle: "Document batch processing finished",
        summary: "Processed {{completed}} / {{total}} documents",
        issues: "{{count}} documents did not finish successfully",
        viewDetails: "View details",
      },
      state: {
        waiting: "Waiting to upload",
        uploading: "Uploading",
        processing: "Uploaded and processing",
        ready: "Processing complete",
        duplicate: "Duplicate content",
        conflict: "Name conflict",
        skipped: "Skipped",
        failed: "Upload failed",
      },
      errors: {
        unsupportedFormat: "This file format is not supported.",
        emptyFile: "Empty files cannot be uploaded.",
        fileTooLarge: "The file exceeds the {{maxFileSize}} per-file limit.",
        tooManyFiles: "Select no more than {{maxFiles}} files at a time.",
      },
    },
    share: {
      action: "Share",
      title: "Share knowledge base",
      description:
        "Grant access to this knowledge base to a user or user group.",
      targetType: "Share with",
      permissionDescription:
        "Recipients can view and search content, but cannot manage documents or sharing.",
      user: "User",
      group: "User group",
      selectTarget: "Choose a recipient",
      searchUserPlaceholder: "Search users by name or email…",
      searchGroupPlaceholder: "Search user groups by name…",
      loadingTargets: "Loading recipients",
      noTargets: "No matching recipients",
      removeTarget: "Remove recipient {{name}}",
      additionalTargets: "{{count}} additional selections",
      active: "Current shares",
      permissionUse: "Use access",
      empty: "Not shared with any users or groups",
      revokeNamed: "Revoke access for {{name}}",
      revokeUserRemoved:
        "Access for {{name}} was revoked. This user has no other active access source.",
      revokeUserRetained:
        "Access for {{name}} was revoked. This user still has access through {{sources}}.",
      revokeGroupNone:
        "Access for user group {{name}} was revoked. No active group member currently retains access through another source.",
      revokeGroupSome:
        "Access for user group {{name}} was revoked. Some active members still have access through {{sources}}. Member details are not shown.",
      revokeGroupAll:
        "Access for user group {{name}} was revoked. All active members still have access through {{sources}}. Member details are not shown.",
      remainingSource: {
        owner: "knowledge-base ownership",
        direct: "another direct share",
        user_group: "another user-group share",
      },
      submit: "Add share",
      removeDirectSuccess: "The direct personal share was removed.",
      removeDirectStillAccessible:
        "The direct personal share was removed. You can still access this knowledge base through another active source.",
      noRemainingAccess:
        "You will no longer be able to access this knowledge base after removal.",
      remainingAccess:
        "You will still be able to access this knowledge base through another active source.",
    },
    preview: {
      title: "Document preview",
      views: "Preview mode",
      original: "Original",
      parsed: "Parsed content",
      parsedDescription:
        "This is the parsed Markdown for the displayed document version.",
      sameVersionDescription:
        "The original and parsed views refer to the same current document version.",
      exactVersionDescription:
        "Viewing the exact historical document version used by this citation.",
      citationExcerpt: "Cited passage",
      unsupportedOriginal:
        "Original preview is not available for this file type. View parsed content or download the original.",
      loadingOriginal: "Loading original preview",
      loadingParsed: "Loading parsed content",
      assetLoading: "Loading document image",
      assetLoadingNamed: "Loading document image “{{name}}”",
      assetUnavailable: "Document image unavailable",
      assetUnavailableNamed: "Document image “{{name}}” is unavailable",
      parsedEmpty: "This document has no parsed content to display",
      downloadOriginal: "Download original",
      expand: "Open larger view",
      expandImage: "Open a larger view of {{name}}",
      openNamed: "Preview document {{name}}",
      backToKnowledgeBase: "Back to knowledge base",
    },
    citation: {
      title: "Knowledge citation",
      loading: "Resolving knowledge citation",
      back: "Back to task",
      source: "Citation [{{number}}] · {{knowledgeBase}}",
      location: "Source location: {{location}}",
      historicalUnavailableTitle: "Historical citation content is unavailable",
      historicalUnavailableDescription:
        "The source knowledge base or document was deleted. Its content, original preview, and download are no longer available. Only the historical name and source-location summary recorded with the answer remain.",
      inlinePreviewUnavailable:
        "The cited passage could not be loaded. Select the marker to open citation details.",
      pages: "Pages {{values}}",
      documentLevel: "Document-level source",
    },
  },
  adminKnowledge: {
    title: "Knowledge bases",
    description:
      "Govern cross-user knowledge-base metadata and configure knowledge sources without access to document content, previews, or downloads.",
    tabsLabel: "Knowledge base sections",
    tabs: {
      knowledgeBases: "Knowledge bases",
      sources: "Knowledge sources",
    },
    search: "Search knowledge bases or owners",
    empty: "No matching knowledge bases",
    ownerDisabled: "Owner disabled",
    lifecycle: {
      label: "Lifecycle",
      all: "All lifecycles",
      active: "Active",
      archived: "Archived",
      deleted: "Deleted",
    },
    availability: {
      label: "Availability",
      all: "All availability states",
      enabled: "Enabled",
      disabled: "Disabled",
    },
    columns: {
      knowledgeBase: "Knowledge base",
      owner: "Owner",
      documents: "Documents",
      storage: "Storage",
      shares: "Share grants",
      diagnostics: "Diagnostics",
    },
    documentSummary: "{{total}} total · {{ready}} searchable",
    documentIssues: "{{processing}} processing · {{failed}} failed",
    shareCount: "{{count}} active grants",
    pagination: {
      label: "Knowledge base list pagination",
      page: "Page {{page}}",
    },
    revokeNamed: "Revoke the share grant for {{name}}",
    cleanup: "Cleanup: {{status}}",
    cleanupStatus: {
      pending: "Pending",
      running: "Running",
      failed: "Failed",
      completed: "Completed",
    },
    noDiagnostics: "No issues",
    actionsFor: "Govern knowledge base {{name}}",
    archiveBeforeDelete:
      "Deletion still requires a separate confirmation after archiving. This action does not delete the knowledge base.",
    reason: "Reason",
    reasonHint: "Required. The reason is recorded in a redacted audit entry.",
    actions: {
      disable: "Disable",
      enable: "Enable",
      archive: "Archive",
      transferOwner: "Transfer owner",
      retryCleanup: "Retry cleanup",
      delete: "Permanently delete",
    },
    feedback: {
      disable: "Knowledge base disabled.",
      enable: "Knowledge base enabled.",
      archive: "Knowledge base archived.",
      delete: "Knowledge-base deletion submitted.",
      cleanup_retry: "Cleanup retry submitted.",
      revoke_grant: "Share grant revoked.",
      transfer_owner: "Knowledge-base owner transferred.",
    },
    confirm: {
      disable: {
        title: "Disable knowledge base?",
        description:
          "Users will not be able to search or use content from “{{name}}” while it is disabled.",
        action: "Disable",
      },
      enable: {
        title: "Enable knowledge base?",
        description:
          "Existing active grants for “{{name}}” become usable again.",
        action: "Enable",
      },
      archive: {
        title: "Archive knowledge base?",
        description: "“{{name}}” becomes read-only after it is archived.",
        action: "Archive",
      },
      delete: {
        title: "Permanently delete knowledge base?",
        description:
          "Permanently delete archived knowledge base “{{name}}”. This cannot be undone.",
        action: "Permanently delete",
      },
      cleanup_retry: {
        title: "Retry resource cleanup?",
        description:
          "Run the failed cleanup tasks for knowledge base “{{name}}” again.",
        action: "Retry cleanup",
      },
      revoke_grant: {
        title: "Revoke share grant?",
        description: "Remove knowledge-base access for “{{name}}”.",
        action: "Revoke",
      },
    },
    transfer: {
      title: "Transfer knowledge-base owner",
      description: "Choose a new active user to own knowledge base “{{name}}”.",
      owner: "New owner",
      search: "Search users",
      select: "Select a new owner",
      action: "Transfer owner",
    },
  },
  presentation: {
    previewTitle: "Preview presentation {{name}}",
    loading: "Loading presentation",
    loadFailed: "This presentation could not be previewed. Try again.",
    close: "Close presentation preview",
    download: "Download",
    downloadNamed: "Download presentation {{name}}",
    zoomOut: "Zoom presentation out",
    zoomIn: "Zoom presentation in",
    resetZoom: "Reset presentation zoom",
    enterFullscreen: "Preview presentation full screen",
    exitFullscreen: "Exit full-screen preview",
    resizePreview: "Resize presentation preview",
    slideCount: "{{current}} / {{total}}",
    toggleSlideNavigator: "Show or hide slide thumbnails",
    slideNavigator: "Slide thumbnails",
    goToSlide: "Go to slide {{slide}}",
    selectElement: "Select presentation element",
    askLinkSense: "Ask {{productName}}",
    askShortcut: "⌘I",
    selectionPromptLabel: "Ask {{productName}} about the selected elements",
    selectionPromptPlaceholder: "Describe a change or ask a question",
    selectionPromptSubmit: "Add annotation",
    selectionPromptError: "Unable to add the annotation. Try again.",
    selectionStatus: "Selected {{count}} elements on slide {{slide}}",
  },
  officePreview: {
    previewTitle: "Preview document {{name}}",
    loading: "Loading document",
    loadFailed: "This document could not be previewed. Try again.",
    close: "Close document preview",
    download: "Download",
    downloadNamed: "Download document {{name}}",
    enterFullscreen: "Preview document full screen",
    exitFullscreen: "Exit full-screen preview",
    resizePreview: "Resize document preview",
    updateAvailable: "Refresh to view the latest content",
    update: "Refresh preview",
    dismissUpdate: "Dismiss update notice",
    annotate: "Add annotation",
    annotating: "Annotating",
    enterAnnotationMode: "Enter file annotation mode",
    exitAnnotationMode: "Exit file annotation mode",
    askLinkSense: "Ask {{productName}}",
    askShortcut: "⌘I",
    selectionUnavailableWhileBusy:
      "The selection is being submitted. Please wait.",
    selectionPromptLabel: "Ask {{productName}} about the selection",
    selectionPromptPlaceholder: "Describe a change or ask a question",
    selectionPromptSubmit: "Add annotation",
    selectionPromptError: "Unable to add the annotation. Try again.",
    annotationBatch: {
      regionLabel: "Pending annotations",
      triggerLabel: "View {{count}} pending annotations",
      count_one: "{{count}} annotation",
      count_other: "{{count}} annotations",
      title: "Pending annotations",
      listLabel: "Pending annotation list",
      presentationLocation: "Slide {{slide}} · {{count}} elements",
      wordPageLocation: "Page {{page}}",
      wordParagraphLocation: "Paragraph {{paragraph}}",
      spreadsheetLocation: "{{sheet}} · {{selection}}",
      htmlLocation: "{{count}} HTML elements",
      locate: "Go to annotation {{index}}",
      remove: "Remove annotation {{index}}",
      clear: "Clear",
      sendAll: "Send",
      sendError: "Unable to send the annotations. They were kept for retry.",
      limitReached: "You can add up to 20 annotations at a time.",
    },
  },
  wordPreview: {
    zoomOut: "Zoom Word document out",
    zoomIn: "Zoom Word document in",
    resetZoom: "Reset Word document zoom",
    pageCount: "Page {{current}} of {{total}}",
    selectionStatus: "Text selected",
  },
  htmlPreview: {
    frameTitle: "HTML document {{name}}",
    annotate: "Annotate",
    annotating: "Annotating",
    enterAnnotationMode: "Enter HTML annotation mode",
    exitAnnotationMode: "Exit HTML annotation mode",
    interactionModeStatus:
      "HTML interaction mode. Controls inside the page are available.",
    annotationModeStatus:
      "HTML annotation mode. Select elements to ask {{productName}}.",
    zoomOut: "Zoom HTML document out",
    zoomIn: "Zoom HTML document in",
    resetZoom: "Reset HTML document zoom",
    selectionStatus: "Selected {{count}} HTML elements",
  },
  archivePreview: {
    loading: "Reading archive contents",
    loadFailed: "This archive could not be read. Download it to open it.",
    summary: "{{files}} files · {{folders}} folders",
    root: "Root",
    breadcrumb: "Archive path",
    folderTreeLabel: "Archive folders",
    listLabel: "Archive file list",
    searchLabel: "Search archive contents",
    searchPlaceholder: "Search file or folder names…",
    name: "Name",
    type: "Type",
    compressedSize: "Compressed",
    originalSize: "Original",
    modifiedAt: "Modified",
    folder: "Folder",
    file: "File",
    encrypted: "Encrypted",
    emptyFolder: "This folder is empty",
    noSearchResults: "No files or folders match",
    skippedEntries: "{{count}} unsafe archive entries are hidden.",
    previewFile: "Preview {{name}}",
    backToFiles: "Back to file list",
    entryLoading: "Reading {{name}}",
    entryLoadFailed:
      "This file inside the archive could not be read. Try again.",
    entryPreview: "Read-only preview of {{name}}",
  },
  filePreview: {
    loading: "Loading preview",
    loadFailed: "This file could not be previewed. Try again.",
    readOnly: "Read only",
    codeContent: "Read-only code content for {{name}}",
    wrap: "Wrap lines",
    enableWrap: "Enable line wrapping",
    disableWrap: "Disable line wrapping",
    contentTruncated:
      "Only the first part of this file is shown to keep the preview responsive.",
    binaryContent:
      "This file contains binary data that cannot be displayed as text.",
    contentUnavailable: "Preview content is unavailable.",
    csvFailed: "This table could not be read.",
    csvSummary: "{{rows}} rows · {{columns}} columns",
    tableTruncated:
      "Only part of this table is shown to keep the preview responsive.",
    emptyTable: "This table is empty.",
    unnamedColumn: "Column {{index}}",
    pdfLoading: "Rendering PDF",
    pdfFailed: "This PDF could not be rendered.",
    imageFailed: "This image could not be loaded.",
    mediaFailed: "This media file could not be loaded.",
    mediaUnsupported: "Your browser cannot play this media file.",
  },
  spreadsheetPreview: {
    zoomOut: "Zoom Excel workbook out",
    zoomIn: "Zoom Excel workbook in",
    resetZoom: "Reset Excel workbook zoom",
    sheetTabsLabel: "Worksheets",
    selectionStatus: {
      range: "Selected {{address}} on sheet {{sheet}}",
      image: "Selected image {{name}} on sheet {{sheet}}",
      chart: "Selected chart {{name}} on sheet {{sheet}}",
    },
  },
  projects: {
    nameExists: errorCatalog.PROJECT_NAME_EXISTS.messages["en-US"],
    notFound: errorCatalog.PROJECT_NOT_FOUND.messages["en-US"],
    taskActive: errorCatalog.PROJECT_TASK_ACTIVE.messages["en-US"],
    empty: "No tasks yet",
    create: "New project",
    createDescription:
      "Tasks in a project share files and keep separate message histories.",
    rename: "Rename project",
    renameAction: "Rename",
    reorderHandle:
      "Use the keyboard to reorder project “{{title}}”, currently position {{position}}",
    sidebarDragInstructions:
      "Press Space to pick up a task or project, use Up and Down to change its position, then press Space to save. Press Escape to cancel. Tasks can also move into other projects.",
    reorderStarted: "Picked up project “{{title}}” at position {{position}}.",
    reorderOver: "Project “{{title}}” will move to position {{position}}.",
    reorderCompleted: "Moved project “{{title}}” to position {{position}}.",
    reorderCancelled: "Project dragging cancelled.",
    dragSaving: "Saving project order.",
    dragSaveFailed: "Could not save the project order. Please try again.",
    delete: "Remove project",
    move: "Move to project",
    moveNamed: "Move “{{title}}” to a project",
    name: "Project name",
    namePlaceholder: "Enter a project name",
    search: "Search projects",
    noResults: "No matching projects",
    choose: "Project",
    projectless: "Common workspace",
    projectlessTask: "Task in common workspace",
    clearSelection: "Clear project selection",
    unavailable: "Project unavailable",
    loadError: "Unable to load task projects",
    deleteDescription:
      "Removing “{{name}}” moves its tasks to the common workspace. Conversations and original project files are kept. Future work uses the common workspace.",
  },
  conversation: {
    untitled: "Untitled task",
    title: "Task",
    share: {
      action: "Share",
      title: "Share {{title}}",
      description:
        "Only the content previewed below is shared, without your name. Later messages or new shares won't change this link's content.",
      previewLabel: "Shared task preview",
      anyoneWithLink: "Anyone with this link can view this task",
      copyLink: "Copy link",
      copied: "Copied",
      copyFailed:
        "The link couldn't be copied. Check browser permissions and try again.",
      unavailable: "This shared link doesn't exist or is no longer available.",
      continueInProduct: "Continue in {{productName}}",
    },
    rename: "Rename",
    archive: "Archive task",
    archivedNotification: "Task archived",
    undoArchive: "Undo",
    undoingArchive: "Undoing archive…",
    archiveUndone: "Archive undone",
    archiveNamed: "Archive task “{{title}}”",
    pin: "Pin task",
    pinNamed: "Pin task “{{title}}”",
    unpin: "Unpin",
    unpinNamed: "Unpin task “{{title}}”",
    reorderHandle:
      "Use the keyboard to reorder task “{{title}}”, currently position {{position}}",
    reorderInstructions:
      "Press Space to pick up a task, use Up and Down to reorder it or select a category, then press Space to save. Press Escape to cancel.",
    reorderStarted: "Picked up task “{{title}}” at position {{position}}.",
    reorderOver: "Task “{{title}}” will move to position {{position}}.",
    reorderCompleted: "Moved task “{{title}}” to position {{position}}.",
    reorderCancelled: "Task dragging cancelled.",
    dragProjectOver: "Drop task “{{title}}” into project “{{project}}”.",
    dragProjectCompleted: "Moved task “{{title}}” into project “{{project}}”.",
    dragSaving: "Saving task position.",
    dragSaveFailed: "Could not save the task position. Please try again.",
    unpinBlockedTitle: "Unable to unpin task",
    unarchive: "Unarchive",
    unarchiveNamed: "Unarchive task “{{title}}”",
    delete: "Delete task",
    deleteNamed: "Delete task “{{title}}”",
    deleteTitle: "Permanently delete this task?",
    deleteDescription:
      "Task content cannot be recovered. Artifacts and minimum trace metadata remain permanently retained, but cannot be restored or downloaded again.",
    clearArchived: "Clear all",
    clearArchivedTitle: "Clear all archived tasks?",
    clearArchivedDescription:
      "All archived tasks will be permanently deleted and cannot be recovered. Active tasks are not affected. Artifacts and minimum trace metadata remain retained according to system policy.",
    clearingArchived: "Clearing archived tasks…",
    clearArchivedSuccess: "Cleared {{count}} archived tasks.",
    searchTitle: "Search",
    searchPlaceholder:
      "Search titles, messages, attachments, artifacts, plugins, or Skills…",
    searchEmpty: "No results found",
    listEmpty: "No tasks yet. Start directly from the composer.",
    newTaskWelcome: "What should we do together in {{productName}}?",
    creditQuotaBlocked: {
      title: "Token usage is exhausted",
      description:
        "Your available credit quota is exhausted. You cannot start new tasks or follow-up requests right now; running tasks are not affected.",
      dismiss: "Dismiss usage notice",
    },
    starterQuestions: {
      label: "Common task suggestions",
      analyzeFile: {
        title: "Analyze a file",
        description: "Extract key points, risks, and action items",
        prompt:
          "Analyze the file I upload. Extract the core conclusions, key risks, and action items, ordered by importance.",
      },
      searchKnowledge: {
        title: "Search internal knowledge",
        description: "Answer from knowledge bases with sources",
        prompt:
          "Answer the following question using the knowledge bases I select. Cite the supporting sources, and say clearly when the available information is insufficient:",
      },
      analyzeData: {
        title: "Analyze spreadsheet data",
        description: "Find trends, anomalies, and create charts",
        prompt:
          "Analyze the Excel or CSV file I upload. Identify key metrics, trends, and anomalies, explain likely causes, and create charts with a concise summary.",
      },
      createDeliverable: {
        title: "Create a work deliverable",
        description: "Draft a plan, report, or presentation",
        prompt:
          "Using the materials I provide, create a clear, ready-to-use [plan/report/presentation] about [topic] for [audience].",
      },
    },
    archivedTaskCount_one: "{{count}} task",
    archivedTaskCount_other: "{{count}} tasks",
    archivedEmpty: "No archived tasks.",
    unavailable: "Unable to load the task. Try again.",
    messageInput: "Task composer",
    messageNavigation: "Task message navigation",
    awaitingAssistant: "AI is responding…",
    historyLoading: "Loading messages…",
    historyExchange: "Exchange {{count}}",
    historyViewExchange: "Click to view this exchange",
    historyRetry: "Couldn’t load messages. Retry",
    scrollToBottom: "Scroll to bottom",
    placeholder: "Describe what you want {{productName}} to do…",
    followUpPlaceholder: "Add a follow-up…",
    send: "Send",
    model: "Model",
    modelSelector: "Choose model and reasoning effort",
    resetReasoningEffort: "Reset reasoning effort to default",
    modelNotConfigured: "Model service not configured",
    reasoningEffort: "Reasoning effort",
    modelContextUsageUnknown: "No usage yet",
    modelContextBadgeLabel: "Background context window: {{value}}",
    modelContextTitle: "Background context window:",
    modelContextUsagePercent: "{{percent}}% used",
    modelContextUsageDetail: "{{used}} used, {{total}} total",
    modelContextUnavailable: "No context usage yet",
    stop: "Stop",
    interrupting: "Interrupting…",
    attach: "Attach file",
    attachFolder: "Attach folder",
    dropFilesToAttach: "Drop to upload files",
    removeAttachment: "Remove attachment {{name}}",
    attachmentUploading: "Uploading attachment…",
    attachmentUploadingName: "Uploading attachment {{name}}",
    attachmentUploadingShort: "Uploading",
    attachmentOverflowLabel: "View all {{count}} attachments",
    attachmentListTitle: "All attachments ({{count}})",
    clearAllAttachments: "Clear all",
    pastedTextFilePrefix: "Pasted text",
    pastedTextAttachmentUploading: "Adding pasted text as an attachment…",
    pastedTextAttachmentMeta: "{{characters}} characters · {{size}}",
    pastedTextAttachmentPlaceholder:
      "Describe how you want this attachment handled…",
    pastedTextAttachmentPreview: "Preview pasted content {{name}}",
    previewImage: "Preview image {{name}}",
    imagePreviewTitle: "Image preview",
    imagePreviewDescription: "Preview an uploaded image attachment.",
    previousImage: "Previous image",
    nextImage: "Next image",
    zoomOut: "Zoom out",
    zoomIn: "Zoom in",
    previewLoading: "Loading image {{name}}",
    previewLoadFailed: "Unable to preview image {{name}}",
    inlineImage: "message image",
    inlineImageUnavailable: "Image unavailable",
    openKnowledgeCitation: "Open knowledge citation {{number}}",
    previewPresentation: "Preview presentation {{name}}",
    previewDocument: "Preview document {{name}}",
    previewHtml: "Preview HTML document {{name}}",
    previewArchive: "Preview archive {{name}}",
    previewFile: "Preview file {{name}}",
    openPreview: "Open preview",
    presentationAnnotation: "Presentation annotation: {{name}}",
    presentationAnnotationCount_one: "{{count}} annotation",
    presentationAnnotationCount_other: "{{count}} annotations",
    officeAnnotation: "Document annotation: {{name}}",
    officeAnnotationCount_one: "{{count}} annotation",
    officeAnnotationCount_other: "{{count}} annotations",
    htmlAnnotation: "HTML annotation: {{name}}",
    htmlAnnotationCount_one: "{{count}} annotation",
    htmlAnnotationCount_other: "{{count}} annotations",
    voice: "Voice input",
    voiceChecking: "Checking the speech-to-text service…",
    voiceNotConfigured: "Speech-to-text has not been configured",
    voiceServiceUnavailable:
      "Speech-to-text is temporarily unavailable. Try again later.",
    voiceStop: "Stop voice input",
    voiceRecording: "Recording",
    voiceDuration: "Recording duration",
    voiceTranscribing: "Transcribing speech…",
    voiceUnavailable:
      "Voice input is unavailable. Check browser support and microphone permission.",
    voiceUnsupported:
      "This browser cannot record audio. Use a browser that supports microphone recording.",
    voicePermissionDenied:
      "Microphone permission is disabled. Allow microphone access for this page and try again.",
    voiceDeviceNotFound:
      "No microphone was detected. Check your device and try again.",
    voiceDeviceUnavailable:
      "The microphone is unavailable. Check system permission or whether another app is using it.",
    voiceRecordingFailed:
      "Recording failed. Check your microphone and try again.",
    voiceRecordingTimeout: "Saving the recording timed out. Try again.",
    voiceTooShort: "The recording is too short. Record for at least 1 second.",
    voiceTooLarge: "The recording is too large. Shorten it and try again.",
    voiceTimeout: "Speech recognition timed out. Try again.",
    voiceNoContent:
      "No speech was recognized. Try again or enter the text manually.",
    slashCommands: {
      menuLabel: "Action menu",
      back: "Back to actions",
      noMatches: "No matching actions",
      newTask: "New task",
      newTaskDescription: "Start a new blank task",
      compact: "Compact context",
      compactDescription: "Compact context after the current task stops",
      plugins: "Plugin list",
      pluginsDescription: "View and select available plugins",
      pluginsTitle: "Plugins",
      skills: "Skill list",
      skillsDescription: "View and select available Skills",
      skillsTitle: "Skills",
      applications: "Application list",
      applicationsDescription: "Choose an application and start its task",
      applicationsTitle: "Applications",
      knowledgeBases: "Knowledge-base list",
      knowledgeBasesDescription: "View and select available knowledge bases",
      knowledgeBasesTitle: "Knowledge bases",
      mcp: "MCP status",
      mcpDescription: "Show personal MCP server status",
      mcpTitle: "MCP",
      applicationManagedDescription:
        "This resource is managed by the application",
      emptyCapabilities: "No {{type}} available",
      selected: "Selected",
      personal: "Personal",
      available: "Available",
      owned: "Mine",
      shared: "Shared",
      unavailable: "Unavailable",
      enabled: "Enabled",
      disabled: "Disabled",
      mcpNoAuthentication: "No authentication",
      mcpCredentialMissing: "Authentication credential missing",
      mcpAuthenticationConfigured: "{{method}} authentication configured",
      mcpStdioConfigured: "STDIO · {{count}} environment variables",
    },
    skillCommands: {
      menuLabel: "Skill selection menu",
      noMatches: "No matching Skills",
    },
    addMenu: "Add",
    addMenuTitle: "Add content",
    addGroup: "Add",
    attachFileMenuLabel: "Files",
    attachFileMenuSearchValue: "files attachments upload",
    attachFolderMenuLabel: "Folders",
    attachFolderMenuSearchValue: "folders directories attachments upload",
    capabilitySearch: "Search available plugins or Skills…",
    pluginGroup: "Plugins",
    skillGroup: "Skills",
    noCapabilities: "No plugins or Skills available",
    capabilityUnavailable:
      "Available plugins or Skills could not be loaded. Try again.",
    goal: {
      regionLabel: "Goal status",
      menuLabel: "Goal",
      menuSearchValue: "goal long-running task automatic continuation",
      menuDescription: "Keep working until complete or attention is needed",
      modeLabel: "Goal",
      disableMode: "Exit Goal mode",
      placeholder:
        "Describe your goal, define measurable outcomes, and get better results.",
      startUnavailable:
        "This task already has a Goal or still has an active run.",
      statusLabel: {
        active: "Goal in progress",
        paused: "Goal paused",
        blocked: "Goal needs attention",
        usageLimited: "Goal usage limited",
        budgetLimited: "Goal budget limited",
        complete: "Goal complete",
      },
      statusDescription: {
        active:
          "The system automatically continues after each run until the Goal is complete.",
        paused:
          "The Goal is paused and will not continue after the current run ends.",
        blocked: "The Goal needs an external change or your input to continue.",
        usageLimited: "The Goal stopped because of the current usage limit.",
        budgetLimited: "The Goal reached its configured token budget.",
        complete: "The system marked this Goal as complete.",
      },
      elapsedLabel: "Time Used",
      edit: "Edit Goal",
      pause: "Pause Goal",
      resume: "Resume Goal",
      clear: "Clear Goal",
      details: "View Goal Details",
      editTitle: "Edit Goal",
      editDescription:
        "Editing the Goal preserves the time and tokens already used.",
      detailsTitle: "Goal Details",
      objective: "Objective",
      tokenBudget: "Token budget",
      noTokenBudget: "No limit",
      tokensUsed: "Tokens used",
      completedInline: "Reached the Goal within {{duration}}",
      clearTitle: "Clear this Goal?",
      clearDescription:
        "The Goal status and usage record will be removed from this task. The current native run will not be force-stopped.",
    },
    plan: {
      menuLabel: "Plan mode",
      menuSearchValue: "plan mode analyze planning",
      menuDescription: "Analyze and draft a plan before implementation",
      modeLabel: "Plan",
      disableMode: "Exit Plan mode",
      placeholder:
        "Describe the task to analyze and plan. LinkSense will ask questions and draft a plan first.",
    },
    proposedPlan: {
      title: "Plan",
    },
    planDecision: {
      title: "Implement this plan?",
      description: "Implement it now, suggest revisions, or skip it for now.",
      implement: "Yes, implement this plan",
      implementDescription: "Switch to Default mode and start implementation.",
      implementing: "Starting implementation",
      revise: "No, revise the plan first",
      reviseInline: "No, tell LinkSense what should be different",
      reviseDescription: "Tell LinkSense what should be different.",
      revisionForm: "Revise the plan",
      revisionLabel: "Revision notes",
      revisionDescription:
        "LinkSense will stay in Plan mode and produce a complete revised plan from your feedback.",
      revisionPlaceholder: "Describe what you want to change",
      submitRevision: "Submit revision notes",
      submittingRevision: "Submitting revision notes",
      back: "Back",
      dismiss: "Skip",
      dismissing: "Skipping",
      dismissDescription: "Skip for now and stay in Plan mode",
      exit: "Exit Plan mode",
      exiting: "Exiting Plan mode",
      exitDescription: "Exit Plan mode without starting implementation",
    },
    userInput: {
      asyncDescription:
        "LinkSense can keep working while you answer. You can also reply after it finishes.",
      title: "Your answer is needed",
      formTitle: "Please confirm these details",
      formResultTitle: "Completed form",
      description: "Answer these questions so LinkSense can continue the plan.",
      autoResolveDescription:
        "Please answer promptly. This question will close automatically when time runs out.",
      other: "Other",
      answerPlaceholder: "Enter your answer",
      secretDescription: "The entered value will not be echoed in the task UI.",
      submit: "Submit answers",
      submitting: "Submitting",
      cancel: "Cancel",
      selectPlaceholder: "Select an option",
      datePlaceholder: "Select date",
      clearDate: "Clear date",
      hour: "Hour",
      minute: "Minute",
      booleanYes: "Yes",
      booleanNo: "No",
      status: {
        pending: "Pending",
        submitting: "Submitting",
        submitted: "Submitted",
        approved: "Approved",
        rejected: "Rejected",
        cancelled: "Cancelled",
        expired: "Expired",
        terminated: "Terminated",
      },
      validation: {
        required: "This field is required.",
        invalid: "The value is invalid.",
        invalidEmail: "Enter a valid email address.",
        invalidUri: "Enter a valid URL including its protocol.",
        invalidDate: "Select a valid date.",
        invalidDateTime: "Select a valid date and time.",
        invalidNumber: "Enter a valid number.",
        integer: "Enter a whole number.",
        minimum: "Must be at least {{value}}.",
        maximum: "Must be no more than {{value}}.",
        minimumSelections: "Select at least {{count}} option(s).",
        maximumSelections: "Select no more than {{count}} option(s).",
        minimumLength: "Enter at least {{count}} character(s).",
        maximumLength: "Enter no more than {{count}} character(s).",
      },
    },
    priorityHint: "Requested this turn",
    selectedCapabilities: "Selected plugins or Skills",
    selectedKnowledgeBases: "Knowledge bases for this turn",
    selectedResources: "Selected knowledge bases, plugins, and Skills",
    moreSelectedResources_one: "{{count}} more selected item",
    moreSelectedResources_other: "{{count}} more selected items",
    additionalSelectedResources: "Additional selected items",
    removeCapability: "Remove {{name}}",
    addKnowledgeBase: "Add knowledge base",
    knowledgeBaseTitle: "Choose knowledge bases",
    knowledgeBaseSearch: "Search available knowledge bases…",
    noKnowledgeBases: "No knowledge bases available",
    knowledgeBasesUnavailable:
      "Available knowledge bases could not be loaded. Try again.",
    knowledgeBaseUnavailable: "Knowledge base unavailable",
    applicationManagedKnowledgeBase: "Application-managed knowledge base",
    knowledgeBaseVerificationUnavailable:
      "The knowledge base status could not be verified. Try again.",
    removeKnowledgeBase: "Remove knowledge base {{name}}",
    pendingKnowledgeBases: "Knowledge bases",
    runningChoiceTitle: "How should this follow-up be handled?",
    runningChoiceDescription:
      "This task is still running. Guide the current run or save the content as the next request.",
    steer: "Guide current run",
    steerContextUnavailable:
      "Guiding the current run only adds text; it does not reload attachments or priority plugins/Skills. Remove them to use this action.",
    steerFallbackQueued:
      "This follow-up includes attachments or selected plugins/Skills, so it was queued as the next request.",
    addPending: "Add as next request",
    pendingQueued: "Queued",
    pendingGuide: "Guide",
    pendingGuideTooltip: "Submit without interrupting the running task",
    pendingReorderHandle: "Reorder pending request {{position}}",
    pendingReorderTooltip: "Drag up or down to reorder",
    pendingReorderInstructions:
      "Press Space to start sorting, use the Up and Down arrow keys to move, press Space to confirm, or press Escape to cancel.",
    pendingReorderStarted: "Picked up pending request {{position}}.",
    pendingReorderOver: "Currently at position {{position}}.",
    pendingReorderCompleted: "Moved to position {{position}}.",
    pendingReorderCancelled: "Sorting cancelled.",
    pendingDetails: "View pending request details",
    editPending: "Edit information",
    closePending: "Close queue",
    pendingTitle: "Pending requests",
    pendingPriorityCapabilities: "Priority plugins/Skills",
    pendingAttachmentCount: "{{count}} pending attachments",
    pendingAttachments: "Pending attachments",
    pendingBlockedOverload: "The system is busy. Select Continue to try again.",
    pendingBlockedPreflight:
      "Preflight checks failed. Resolve the issue and continue, or contact an administrator.",
    pendingUnknownBlock: "A preflight check failed. Contact an administrator.",
    cancelPending: "Cancel pending request",
    maxPending:
      "You can keep up to 5 pending requests. Process an existing request first.",
    pendingCancelled:
      "The pending request was cancelled, and its attachments were restored to the composer.",
    pendingContinued:
      "{{productName}} was asked to continue the first pending request.",
    pendingGuided: "The first pending request now guides the current run.",
    reconnecting: "Connection is recovering",
    planTitle: "Execution plan",
    planProgress: "Step {{current}} of {{total}}",
    planChangedFiles_one: "{{count}} file changed",
    planChangedFiles_other: "{{count}} files changed",
    planExpand: "Expand execution plan",
    planCollapse: "Collapse execution plan",
    planStepPending: "Pending",
    planStepInProgress: "In progress",
    planStepCompleted: "Completed",
    activity: "Activity summary",
    expandActivity: "Expand work details",
    collapseActivity: "Collapse work details",
    intermediateMessage: "Intermediate response",
    currentActivity: "Current activity",
    reasoningActivity: {
      label: "Reasoning",
      expand: "Expand reasoning",
      collapse: "Collapse reasoning",
    },
    thinking: "Thinking",
    processing: "Processing",
    elapsed: "Took",
    processingDuration: "Processing time {{duration}}",
    userMessage: "User message",
    assistantMessage: "Assistant response",
    messageActions: "Message actions",
    messageSentAt: "Sent at {{time}}",
    messageModel: "Model used: {{model}}",
    timeSeparator: {
      today: "Today {{time}}",
      yesterday: "Yesterday {{time}}",
      sameYear: "{{date}}, {{time}}",
      otherYear: "{{date}}, {{time}}",
      accessibleLabel: "Message time: {{time}}",
    },
    modelChanged: "Model changed from {{previousModel}} to {{currentModel}}.",
    copyMessage: "Copy message",
    showMore: "Show more",
    showLess: "Show less",
    messageSending: "Sending…",
    messageCopied: "Message copied",
    copyMessageFailed: "Unable to copy the message. Try again.",
    forkMessage: "Branch to new chat",
    forkingMessage: "Creating branch…",
    forkMessageFailed: "Unable to create the branched task. Try again.",
    forkSource: {
      continueFromChat: "Continued from chat",
      openSourceTask: "Open source task: {{title}}",
      unavailable: "Source task unavailable",
    },
    diagram: {
      title: "Flowchart",
      actions: "Flowchart actions",
      copy: "Copy code",
      export: "Export image",
      expand: "Enlarge diagram",
      close: "Close",
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
      resetZoom: "Reset zoom",
      filename: "flowchart.png",
      streaming: "Generating diagram…",
      loading: "Drawing diagram…",
      error:
        "Unable to display this diagram. Copy the code to check it and try again.",
      exportFailed: "Image export failed. Please try again.",
    },
    copyCode: "Copy code",
    codeCopied: "Code copied",
    previewHtmlCode: "Preview HTML code",
    showHtmlCode: "View HTML code",
    htmlCodePreviewFileName: "HTML code preview.html",
    inlineHtmlPreview: {
      cardLabel: "Interactive HTML preview",
      frameTitle: "AI-generated interactive HTML page",
      generating: "Generating interactive component…",
      generatingHint: "Generating now, this may take a little while",
      loading: "Loading interactive preview…",
      loadFailedTitle: "Interactive preview is temporarily unavailable",
      loadFailedDescription:
        "The interactive component failed to load. Try again.",
      actions: "HTML preview actions",
      downloadHtml: "Download HTML file",
      copyImage: "Copy as image",
      fullscreen: "Preview fullscreen",
      exitFullscreen: "Exit fullscreen preview",
      imageCopied: "Preview copied as an image",
      copyImageFailed: "Unable to copy the preview as an image. Try again.",
      fullscreenFailed:
        "Unable to enter or exit fullscreen preview. Try again.",
    },
    waitingGame: {
      title: "Snake",
      enter: "Click or press Enter to play Snake.",
      controls:
        "Use arrow keys, WASD or swipe to steer. Double-click or press Escape to return to waiting.",
    },
    imageGeneration: {
      loading: "Generating image…",
    },
    copyTable: "Copy table",
    tableCopied: "Table copied",
    tableActions: "Table actions",
    tableScrollHint: "Scroll sideways to see the full table",
    scrollTable: "Horizontally scrollable table",
    expandTable: "Open table in a larger view",
    tableDialogTitle: "Full table",
    tableDialogDescription:
      "Scroll horizontally or vertically to see all content.",
    scrollExpandedTable: "Full table content",
    copyContentFailed: "Unable to copy. Try again.",
    editMessage: "Edit message",
    editMessageInput: "Edit message content",
    cancelEdit: "Cancel",
    regenerating: "Sending",
    regenerateFailed: "Unable to regenerate the response. Try again.",
    downloadArtifact: "Download {{name}}",
    downloadPreparing: "Preparing a secure download link…",
    taskOverview: {
      sources: "Sources",
      noSources: "No sources yet",
      sourcesError: "Couldn’t load sources. Please try again.",
      open: "Open task overview",
      close: "Close task overview",
      title: "Task overview",
      subagents: "Subagents",
      subagentsUsed: "{{count}} subagents used",
      subagentsCompleted: "{{count}} completed",
      subagentsProgress: "{{completed}} / {{count}} completed",
      outputFiles: "Output files",
      noOutputFiles: "No output files yet",
    },
    capabilitiesUsed: "Turn plugins/Skills",
    loaded: "Loaded",
    used: "Actually used",
    priority: "User priority",
    saved: "Draft saved",
    followUpAction: "Handle follow-up",
    submitFollowUp: "Submit follow-up",
    pendingBlockCodes: {
      priority_capability_unavailable:
        "A selected priority plugin/Skill is no longer available. Select again.",
      required_credential_unavailable:
        "A required plugin credential is missing. Bind it first.",
      credential_binding_ambiguous:
        "Credential bindings conflict. Make the binding explicit.",
      attachment_unavailable:
        "An attachment is unavailable. Remove it and upload it again.",
      agents_template_unavailable:
        "Execution rules are unavailable. Contact an administrator.",
      workspace_invalid:
        "The task workspace is unavailable. Contact an administrator.",
      runner_unavailable:
        "The execution service is unavailable. Contact an administrator.",
      deployment_stopped:
        "A system update paused this request. Review its progress before continuing manually.",
      execution_environment_invalid:
        "The execution environment is not ready. Contact an administrator.",
      credit_limit_exceeded:
        "This user's available credit quota is exhausted and they cannot start a new task right now.",
    },
    activities: {
      analysis: "Analyzing the request",
      analyzing: "Analyzing the request",
      attachment_read: "Reading an attachment",
      plugin_use: "Using a plugin",
      skill_use: "Using a Skill",
      file_write: "Creating or updating a file",
      external_access: "Accessing an external service",
      step_started: "Started a step",
      step_completed: "Step completed",
      tool_started: "Calling a tool",
      tool_completed: "Tool call completed",
      working_in_workspace: "Working with workspace content",
      registering_artifact: "Registering a downloadable artifact",
      using_platform_tool: "Using a platform tool",
      working: "Working",
      capability_use: "Using a plugin or Skill",
      system_capability_used: "Used the file service",
      reconnecting: "Reconnecting",
      reconnectingAttempt: "Reconnecting {{attempt}}/{{total}}",
      error: "The run encountered a recoverable issue",
    },
    streamDisconnectedBeforeCompletion:
      "stream disconnected before completion.",
    streamDisconnectedWarning:
      "Task stopped because the response stream disconnected",
    nativeActivities: {
      fileChangeRunning_one: "Updating {{count}} file",
      fileChangeRunning_other: "Updating {{count}} files",
      fileChangeCompleted_one: "Updated {{count}} file",
      fileChangeCompleted_other: "Updated {{count}} files",
      fileChangeRunningGeneric: "Updating files",
      fileChangeCompletedGeneric: "Updated files",
      webSearchRunning: "Searching the web",
      webSearchCompleted: "Searched the web",
      knowledgeSearchRunning: "Searching selected knowledge bases",
      knowledgeSearchCompleted: "Knowledge base search completed",
      knowledgeSearchFailed: "Knowledge base search failed",
      knowledgeSearchNoAvailableBases:
        "No knowledge bases are available for this run",
      imageViewRunning: "Viewing an image",
      imageViewCompleted: "Viewed an image",
      imageGenerationRunning: "Generating an image",
      imageGenerationCompleted: "Generated an image",
      enteredReviewMode: "Entered review mode",
      exitedReviewMode: "Exited review mode",
      contextCompactionRunning: "Compacting context",
      contextCompactionCompleted: "Context compacted",
      contextCompactionIncomplete: "Context compaction did not complete",
      collabAgentRunning: "Coordinating subagents",
      collabAgentCompleted: "Coordinated subagents",
      subAgentStarted: "Subagent started working",
      subAgentUpdated: "Subagent updated",
      subAgentCompleted: "Subagent completed",
      subAgentInterrupted: "Subagent interrupted",
      summary: {
        separator: " · ",
        loadedTools: {
          leading_one: "Loaded a tool",
          leading_other: "Loaded tools",
          following_one: "loaded a tool",
          following_other: "loaded tools",
          running_one: "Loading a tool",
          running_other: "Loading tools",
        },
        calledTools: {
          leading_one: "Called a tool",
          leading_other: "Called tools",
          following_one: "called a tool",
          following_other: "called tools",
          running_one: "Calling a tool",
          running_other: "Calling tools",
        },
        editedFiles: {
          leading_one: "Edited a file",
          leading_other: "Edited files",
          following_one: "edited a file",
          following_other: "edited files",
          running_one: "Editing a file",
          running_other: "Editing files",
        },
        readFiles: {
          leading: "Read files",
          following: "read files",
          running: "Reading files",
        },
        commands: {
          leading_one: "Ran a command",
          leading_other: "Ran commands",
          following_one: "ran a command",
          following_other: "ran commands",
          running_one: "Running a command",
          running_other: "Running commands",
        },
        webSearch: {
          leading: "Searched the web",
          following: "searched the web",
          running: "Searching the web",
        },
        dynamicTool: "{{tool}}",
      },
    },
    subAgentActivities: {
      agentList: "{{count}} subagents",
      agentFallback: "Subagent {{number}}",
      agentStatus: "{{name}}: {{status}}",
      openAgent: "Open {{name}} subagent",
      detailPanelLabel: "{{name}} details",
      closeDetails: "Close subagent details",
      resizeDetails: "Resize subagent details",
      loadingDetails: "Loading subagent activity",
      detailLoadFailed: "Subagent details could not be loaded.",
      noDetails: "No activity details are available yet.",
      continuedAfterInterruption:
        "The subagent was interrupted and then continued.",
      continuedAfterFailure: "The subagent failed and then continued.",
      status: {
        pendingInit: "Preparing",
        running: "Working",
        started: "Started working",
        updated: "Updated",
        interrupted: "Interrupted",
        completed: "Completed",
        errored: "Failed",
        shutdown: "Stopped",
        notFound: "Not found",
      },
    },
    nativeActivityDetails: {
      expand: "Expand details for {{activity}}",
      collapse: "Collapse details for {{activity}}",
      commands: "Command details",
      fileChanges: "File change details",
      queries: "Search query details",
      fields: {
        duration: "Duration",
        server: "Server",
        tool: "Tool",
        plugin: "Plugin",
        namespace: "Namespace",
        result: "Result",
        action: "Action",
        url: "URL",
        pattern: "Pattern",
        path: "Path",
        prompt: "Prompt",
        review: "Review",
      },
      actions: {
        read: "Read",
        listFiles: "List files",
        search: "Search",
        unknown: "Other",
        openPage: "Open page",
        findInPage: "Find in page",
        other: "Other",
      },
      fileKinds: {
        add: "Added",
        delete: "Deleted",
        update: "Updated",
      },
      values: {
        succeeded: "Succeeded",
        failed: "Failed",
      },
    },
  },
  applications: {
    distribution: {
      versionNumber: "Version number",
      versionHint: "Enter a version such as 1.0.0.",
      versionInvalid: "Enter a valid version such as 1.0.0.",
      versionSame:
        "Version v{{version}} already exists. You can submit using the same version.",
      versionLower:
        "The version cannot be lower than the highest existing version, v{{version}}.",
      saveSharing: "Save sharing",
      applyListing: "Apply for listing",
      completeSetup: "Complete setup",
      installedVersion: "Installed · v{{version}}",
      editModes: "Edit usage modes",
      direct: "Share with organization",
      center: "Application center",
      myApplications: "My applications",
      sharedApplications: "Applications shared with me",
      usageModes: "Usage options",
      usageModesHint: "Choose at least one option. You can offer both.",
      modes: { install: "Application package", service: "Application service" },
      modeDescriptions: {
        install:
          "Users install their own application, configure their credentials and maintain it independently.",
        service:
          "Users run your application with your configured credentials, without installing it.",
      },
      install: "Install application",
      useService: "Use",
      installationName: "Installed application name",
      installationHint:
        "The application and included plugins and skills will be saved to your account. Configure your own credentials, knowledge bases and external connections.",
      installed:
        "Application installed. Review and complete the required setup.",
      installedLabel: "Installed",
      openInstalled: "Open my application",
      configure: "Configure application",
      guide: "Usage guide",
      version: "v{{version}}",
      submit: "Submit for approval",
      submitHint:
        "An administrator will review this version and its usage options. Later changes require another submission and do not replace the approved version automatically.",
      releaseNotes: "Release notes",
      submitted: "Submitted for administrator approval.",
      withdraw: "Withdraw submission",
      withdrawn: "Submission withdrawn.",
      unlist: "Unlist",
      relist: "Relist",
      statusSaved: "Listing status updated.",
      noReleases: "No versions have been submitted yet.",
      noCenterApplications: "No applications in the center yet",
      centerSearch: "Search application center",
      centerUnavailable:
        "This application is currently unavailable for use or installation.",
      updateAvailable: "Update available",
      checkUpdate: "Check for updates",
      updateTitle: "Update installed application",
      update: "Update application",
      updateHint:
        "Update application content you have not customized while keeping your credentials, resource settings and personal changes.",
      upToDate: "You have the latest available version.",
      updateUnavailable:
        "Updates are currently unavailable. Your installed application is retained.",
      updated:
        "Application updated. Your personal settings have been preserved.",
      setupRequired: "Setup required",
      preserved: "These personal changes will be kept: {{fields}}",
      fields: {
        name: "Application name",
        instructions: "Application instructions",
        model: "Model",
        reasoning_effort: "Reasoning effort",
        capabilities: "Plugins and skills",
        resources: "Knowledge bases and external connections",
      },
      adminTitle: "Application approvals",
      adminHint:
        "Review application versions and usage options, and manage application listings.",
      review: "Review application",
      approve: "Approve",
      reject: "Reject",
      reviewComment: "Review comment",
      reviewed: "Review decision saved.",
      reviewInstructions: "Application instructions",
      noReviews: "No application submissions yet",
      suspend: "Suspend listing",
      resume: "Restore listing",
      governanceReason: "Reason",
      revokeHint:
        "Revoking access prevents new installations or service use. Existing independent installations and history are retained.",
      saveModes: "Save usage options",
      modesSaved: "Usage options updated.",
    },
    publication: {
      noGuide: "The creator has not provided a usage guide.",
    },
    scopeLabel: "Application scope",
    scope: {
      all: "All applications",
      owned: "Created by me",
      shared: "Shared with me",
    },
    search: "Search applications",
    searchPlaceholder: "Search application names or descriptions…",
    create: "Create application",
    createTypeDescription:
      "Configure an application directly, or import an interactive application built with HTML, CSS, and JavaScript.",
    createStandardApp: "Create standard app",
    createStandardAppDescription:
      "Configure a model, instructions, and fixed plugins, Skills, knowledge bases, and MCP servers.",
    interactiveApp: "Interactive application",
    importInteractiveApp: "Import interactive app",
    importInteractiveAppDescription:
      "Upload a ZIP package containing manifest.json and index.html.",
    updateInteractivePackage: "Update application package",
    interactivePackageUpdated:
      "The interactive application package was updated. New tasks will use the new version.",
    interactiveAppImported: "The interactive application was imported.",
    interactivePackageRequirements:
      "The ZIP root must contain manifest.json and index.html. The application runs in an isolated iframe.",
    applicationPackage: "Application package",
    interactivePackageHint:
      "ZIP only, up to {{size}}. Use a new manifest.json version when updating.",
    interactivePackageSizeInvalid:
      "The application package is empty or exceeds the size limit.",
    importPackageAction: "Import",
    declaration: {
      title: "Resource declaration list",
      purpose:
        "When creating an interactive app, use this list to declare the plugins, skills, MCP servers, and knowledge bases it needs in manifest.json.",
      search: "Search resources by name",
      selectAll: "Select all",
      selectResults: "Select all search results",
      selectType: "Select all: {{type}}",
      selectTypeResults: "Select all search results: {{type}}",
      selected: "{{count}} selected",
      groupSelected: "{{count}} / {{total}} selected",
      empty: "No resources available to declare",
      preview: "Declaration preview",
      mergeHint:
        "After copying, add the dependencies field to manifest.json alongside name and version. Replace any existing dependencies field; do not overwrite the entire file.",
      invalid:
        "Cannot generate a valid declaration. Select up to 50 plugins and skills combined, 20 MCP servers, and 20 knowledge bases. Resource names must contain 1–160 characters. Adjust your selection or resource names.",
      copy: "Copy dependencies JSON",
      copyFailed:
        "Copy failed. Try again, or select the text in the declaration preview and copy it manually.",
    },
    dependencies: {
      title: "Configure required resources",
      preview: "Check required resources",
      hint: "The following plugins, skills, and other resources have been declared by the app package. We recommend completing resource configuration before importing so the app can work properly.",
      empty: "This app does not declare any required resources.",
      search: "Search and choose your resources",
      matched: "Configured",
      unmatched: "Not configured",
      clear: "Clear selection",
      savedDraft:
        "Changes are saved to the app draft. Shared and listed versions stay unchanged until you publish again.",
      serviceOnly:
        "Interactive apps can only be used online, not copied. Users do not need to reconfigure the creator's connected resources.",
      types: {
        plugin: "Plugin",
        skill: "Skill",
        mcp_server: "MCP server",
        knowledge_base: "Knowledge base",
      },
    },
    nativeChatPanel: "LinkSense chat",
    hideNativeChat: "Hide chat",
    showNativeChat: "Show chat",
    resizeNativeChat: "Resize chat panel",
    interactiveRuntimeUnavailable:
      "This interactive application is currently unavailable. Contact its creator.",
    created: "Application created.",
    updated:
      "Application updated. Future task turns will automatically use the latest configuration.",
    deleted: "Application deleted.",
    emptyTitle: "No applications are available yet",
    createdByMe: "Created by me",
    createdBy: "Created by {{name}}",
    status: {
      active: "Enabled",
      disabled: "Disabled",
    },
    noDescription: "No description",
    capabilityCount: "{{count}} plugins/Skills",
    knowledgeBaseCount: "{{count}} knowledge bases",
    mcpServerCount: "{{count}} MCP servers",
    shareTargets: "Shared with {{targets}}",
    dependencyUnavailable:
      "Some dependencies are disabled or unavailable. Restore them before starting a new task.",
    dependencyUnavailableShort: "Currently unavailable; it can be removed",
    usesPluginCredentials: "Uses plugin credentials",
    share: "Share",
    shareWithinOrganization: "Share within organization",
    usage: {
      action: "Usage analytics",
      title: "Application usage",
      description:
        "Review usage and model costs for “{{name}}” during the selected period.",
      backToApplications: "Back to applications",
      activeUsers: "Active users",
      activeUsersHint:
        "Distinct users who created a task or started an actual turn during the selected period",
      coverageTitle: "Token and cost data starts when collection began",
      coverageDescription:
        "Coverage starts on {{date}}. Earlier tasks and turns are still counted, but historical tokens and costs are not estimated using current prices.",
      tokenBreakdownTitle: "Token composition",
      costBreakdownTitle: "Cost composition",
      unpricedTokens: "Unpriced tokens",
      modelBreakdownDescription:
        "Review calls, turns, tokens, and cost by model.",
      workloadBreakdownDescription:
        "Review calls, tokens, and cost by model workload.",
    },
    startChat: "Try now",
    deleteTitle: "Delete this application?",
    deleteDescription:
      "The application will disappear from the Plugin Center and cannot start new tasks. Existing private task history is retained.",
    editTitle: "Edit application",
    createTitle: "Create application",
    editorDescription:
      "Configure the model, plugins/Skills, knowledge bases, and application instructions. The model can be fixed by the application or selected by the user in chat. Saved updates automatically apply to everyone's future turns.",
    basicInformation: "Basic information",
    runtimeConfiguration: "Runtime configuration",
    icon: "Application icon",
    iconPresetLabel: "Built-in application icons",
    uploadIcon: "Upload image",
    replaceIcon: "Replace image",
    iconHint:
      "PNG, JPEG, or WebP; ≤ {{size}}, max {{dimension}}×{{dimension}} px.",
    iconFileInvalid:
      "Select an image that meets the format, file size, and dimension limits.",
    iconPresets: {
      bot: "Bot",
      search: "Research and search",
      "book-open": "Knowledge base",
      "graduation-cap": "Education and training",
      "briefcase-business": "Business and office",
      "chart-column": "Data analytics",
      "code-xml": "Software development",
      "pen-line": "Content writing",
      sparkles: "Creative design",
      lightbulb: "Innovation and planning",
      headset: "Customer service",
      "file-text": "Document processing",
      landmark: "Finance",
      scale: "Legal and compliance",
      "heart-pulse": "Healthcare",
      "shield-check": "Security and risk",
      workflow: "Workflow automation",
      "calendar-clock": "Scheduling",
      users: "Team collaboration",
      "globe-2": "Global business",
    },
    instructions: "Application instructions",
    instructionsDescription:
      "These instructions are injected as application-level developer instructions and are not shown to recipients.",
    model: "Model",
    userSelectedModel: "Selected by user in chat",
    modelOptionalDescription:
      "When no model is specified, users can select the model and reasoning effort in chat.",
    reasoningEffort: "Reasoning effort",
    plugins: "Plugins",
    pluginsDescription:
      "Select plugins managed by you. Applications directly use credentials already bound to each plugin.",
    noPlugins: "No plugins are available.",
    pluginSelectPlaceholder: "Select plugins…",
    pluginSearchPlaceholder: "Search plugins…",
    skills: "Skills",
    skillsDescription: "Select Skills managed by you.",
    noSkills: "No Skills are available.",
    skillSelectPlaceholder: "Select Skills…",
    skillSearchPlaceholder: "Search Skills…",
    knowledgeBases: "Knowledge bases",
    knowledgeBasesDescription:
      "Recipients may query these knowledge bases only inside application tasks; they cannot browse, preview, download, or manage them.",
    noKnowledgeBases: "No knowledge bases are available.",
    knowledgeBaseSelectPlaceholder: "Select knowledge bases…",
    knowledgeBaseSearchPlaceholder: "Search knowledge bases…",
    mcpServers: "MCP servers",
    mcpServersDescription:
      "Select the MCP servers available to this application. Their complete tool set, including tools with external side effects, follows the active runtime policy.",
    noMcpServers: "No MCP servers are available.",
    mcpServerSelectPlaceholder: "Select MCP servers…",
    mcpServerSearchPlaceholder: "Search MCP servers…",
    resourceSearchEmpty: "No matching options.",
    removeResource: "Remove {{name}}",
    additionalResources: "{{count}} additional selections",
    shareTitle: "Share application",
    shareDescription:
      "Share with selected users or groups in the organization. Use External Access for iframe integrations.",
    shareTargetType: "Recipient",
    shareToUsers: "Users",
    shareToGroups: "User groups",
    shareUserTarget: "User recipient",
    shareGroupTarget: "User-group recipient",
    shareUserSearchPlaceholder: "Search users by name or email…",
    shareGroupSearchPlaceholder: "Search user groups by name…",
    shareSaved: "Shared successfully.",
    shareGrantType: {
      user: "User",
      user_group: "User group",
    },
    currentShares: "Current recipients",
    noShares: "This application has not been shared with anyone yet.",
    revoke: "Revoke",
    taskUnavailable:
      "This app is unavailable. You cannot send messages right now.",
    conversationManaged: "This task is managed by “{{name}}”",
    conversationManagedDescription:
      "The model, plugins, Skills, and knowledge bases are maintained by the application creator.",
    conversationManagedUserModelDescription:
      "with plugins, Skills, knowledge bases, and instructions",
    externalAccess: {
      action: "External access",
      title: "Application external access",
      description:
        "Embed “{{name}}” into approved websites so external users only use this application.",
      backToApplications: "Back to applications",
      accessTab: "Access & embed",
      accessSettingsSection: "Access settings",
      originSettingsSection: "Origin settings",
      starterQuestionsSection: "Built-in questions",
      credentialSettingsSection: "Server authentication",
      embedSettingsSection: "Embed configuration",
      enabled: "Enable external access",
      enabledDescription:
        "When this is turned off, embedded pages stop working and open sessions expire.",
      authMode: "Authentication",
      authRequirementLabel: "Authentication requirement",
      authModeRequired: "Requires authentication",
      authModePublic: "No authentication",
      authRequiredDescription:
        "Best for partner systems only. Their server verifies the request before opening the application.",
      authPublicDescription:
        "Best for public pages. Approved websites can open the application directly, without a separate server check.",
      allowedOrigins: "Allowed embed origins",
      allowedOriginsPlaceholder:
        "https://portal.example.com\nhttps://ops.example.com",
      allowedOriginsDescription:
        "Enter one website address per line. After saving, each address gets its own iframe URL and embed example. Use HTTPS in production; localhost is allowed for local testing.",
      starterQuestions: "Built-in questions",
      starterQuestionsDescription:
        "Configure up to four suggested questions for each origin. Questions are displayed exactly as entered, and selecting one only fills the message box.",
      starterQuestionOriginsTabsLabel: "Built-in question origins",
      starterQuestionsNeedOrigin:
        "Add at least one allowed embed origin first.",
      starterQuestionsEmpty:
        "No built-in questions are configured for this origin.",
      starterQuestionLabel: "Question {{index}}",
      starterQuestionPlaceholder: "Enter a question users can select quickly",
      starterQuestionDuplicate: "Questions for the same origin must be unique.",
      starterQuestionCount: "{{count}} / {{max}} configured",
      addStarterQuestion: "Add question",
      removeStarterQuestion: "Remove question {{index}}",
      appId: "App ID",
      appSecret: "App Secret",
      secretUnavailableValue: "Regenerate to copy",
      secretUnavailable:
        "For security, older secrets are not shown again. Regenerate the secret when you need the full value and give it to the partner system.",
      rotateSecret: "Regenerate",
      rotateConfirmTitle: "Regenerate App Secret?",
      rotateConfirmDescription:
        "After regeneration, the partner system must use the new secret and open embedded pages will expire.",
      changeConfirmTitle: "Save external access security settings?",
      changeConfirmDescription:
        "After saving, open embedded pages will be checked against the new settings and may need to be reopened.",
      secretRotated:
        "App Secret regenerated. Existing external sessions were revoked.",
      embedOrigin: "Origin",
      embedOriginsTabsLabel: "Embed origins",
      embedOriginTab: "Origin {{index}}",
      currentEmbedOrigin: "Current origin",
      iframeUrl: "iframe URL",
      embedCode: "Embed example",
      serverCredentialWarning:
        "When authentication is required, let the partner system handle verification on its server. Do not put App Secret in frontend code.",
      saved: "External access settings saved.",
      copyFailed: "Copy failed. Select the content manually.",
      snippetTitle: "Embedded application",
      snippetTicketComment:
        "Ask your backend for this visit's access credential. Never expose App Secret here.",
    },
  },
  skillUpdate: {
    description:
      "Edit the current skill or upload a complete skill package. Review the changes before confirming the update.",
    loading: "Loading the current skill…",
    loadFailed: "The current skill could not be loaded. Please try again.",
    mode: "Update method",
    edit: "Edit skill content",
    replace: "Replace complete skill package",
    preserveNotice:
      "Only the display name, description and instructions will change. Existing scripts, templates, images and other files will be preserved. To change those files, download the complete package, edit it and choose “Replace complete skill package”.",
    replaceNotice:
      "The new package will replace the current skill. Existing files missing from the new package will be deleted. Upload a complete package containing every file the skill needs.",
    identifierHint: "The skill identifier stays the same during an update.",
    content: "Skill instructions",
    contentRequired: "Enter the skill instructions.",
    contentTooLarge:
      "These instructions are too long to edit online. Download the complete skill package, edit it and upload it again.",
    noChanges: "No changes have been made yet.",
    files: "Current skill files",
    download: "Download complete skill package",
    selectedFile: "Selected: {{name}}",
    uploading: "Uploading: {{percentage}}%",
    checking: "Checking changes and risks…",
    check: "Review changes and risks",
    confirm: "Confirm update",
    changes: "File changes",
    changeSummary:
      "{{added}} added, {{modified}} modified, {{deleted}} deleted and {{unchanged}} unchanged files.",
    added: "Added files",
    modified: "Modified files",
    deleted: "Files to delete",
    deleteNotice:
      "These files are missing from the new package and will be deleted when you confirm. Check whether the skill still needs them.",
    confirmDeletions: "I confirm deleting these {{count}} files",
  },
  marketplace: {
    title: "Plugin Center",
    description:
      "Browse public plugins and Skills, and manage installed content, personal content, and MCP connections in one place.",
    personalAccountDescription:
      "Manage installed content, personal content, the Skill repository, and MCP connections.",
    adminTitle: "Plugin Center",
    adminDescription:
      "Review immutable release snapshots, manage Plugin Center visibility, and suspend listings immediately when risks are found.",
    adminTabsLabel: "Plugin Center management sections",
    tabs: {
      store: "Plugin Center",
      mine: "My plugins/Skills",
      publishing: "My publications",
      reviews: "Listing reviews",
      listings: "All listings",
    },
    catalogTabsLabel: "Plugin Center content categories",
    catalogTabs: {
      plugin: "Plugins",
      skill: "Skills",
      mcp: "MCP",
      application: "Applications",
    },
    catalogDescriptions: {
      application:
        "Create and manage applications, and find available apps to use.",
      plugin:
        "Browse and manage plugins to add tools and connections to your tasks.",
      skill:
        "Browse the Skill repository, and install and manage Skills for different tasks.",
      mcp: "Manage MCP connections and plugins to give tasks access to the tools and data they need.",
    },
    catalogScopesLabel: "Content scope",
    scopes: {
      public: "Public",
      personal: "Personal",
    },
    installedTitle: "Installed",
    loadingInstalled: "Loading installed content…",
    installedEmpty: "No {{category}} are installed yet.",
    installedListLabel: "Installed {{category}}",
    expandInstalled: "Expand installed {{category}}",
    collapseInstalled: "Collapse installed {{category}}",
    searchCategory: "Search {{category}}",
    publicCatalogLabel: "Public {{category}}",
    personalCatalogLabel: "Personal {{category}}",
    personalCatalogEmpty: "No personal {{category}} match these filters.",
    personalMcpConnections: "MCP connections",
    personalMcpPackages: "MCP extension packages",
    includesMcp: "Includes MCP",
    manageMcp: "Manage MCP",
    status: {
      draft: "Draft",
      published: "Published",
      unlisted: "Unlisted",
      suspended: "Suspended",
      pending: "Pending review",
      approved: "Approved",
      rejected: "Not approved",
      withdrawn: "Withdrawn",
    },
    search: "Search the Plugin Center",
    searchPlaceholder: "Search by name, description, or publisher…",
    capabilityType: "Type",
    itemType: "Type",
    catalogEmpty: "No published {{category}} match these filters.",
    byPublisher: "Published by {{publisher}}",
    publisher: "Publisher",
    noDescription: "No description",
    noKnownRisks:
      "No known risk declarations were detected. Verify that you trust the publisher before installing.",
    releaseNumber: "Release {{number}}",
    installCount: "{{count}} installs",
    riskSummary: "Risk summary",
    manifest: "Manifest snapshot",
    releaseNotes: "Release notes",
    noReleaseNotes: "No release notes were provided.",
    contentHash: "Content SHA-256",
    viewDetails: "View details for {{name}}",
    install: "Install",
    installing: "Installing",
    installingPluginStatus: "Installing plugin…",
    installingSkillStatus: "Installing skill…",
    installingMcpStatus: "Installing MCP…",
    update: "Update",
    updatingPluginStatus: "Updating plugin…",
    updatingSkillStatus: "Updating skill…",
    updatingMcpStatus: "Updating MCP…",
    updateAvailable: "Update available",
    updateInstallation: "Update to latest release",
    installed: "Installed from the Plugin Center as a personal plugin/Skill.",
    installedPlugin: "Installed from the Plugin Center as a personal plugin.",
    installedSkill: "Installed from the Plugin Center as a personal skill.",
    installedMcp: "Installed from the Plugin Center as personal MCP.",
    installationUpdated:
      "The installation now uses the current approved release.",
    installationUpdatedPlugin:
      "The Plugin Center plugin now uses the current approved release.",
    installationUpdatedSkill:
      "The Plugin Center skill now uses the current approved release.",
    installationUpdatedMcp:
      "The Plugin Center MCP now uses the current approved release.",
    installedState: "Installed",
    storeOrigin: "Plugin Center install",
    uninstall: "Uninstall",
    uninstalling: "Uninstalling",
    uninstallingPluginStatus: "Uninstalling plugin…",
    uninstallingSkillStatus: "Uninstalling skill…",
    uninstallingMcpStatus: "Uninstalling MCP…",
    uninstallTitle: "Uninstall this Plugin Center plugin/Skill?",
    uninstallPluginTitle: "Uninstall this Plugin Center plugin?",
    uninstallSkillTitle: "Uninstall this Plugin Center skill?",
    uninstallMcpTitle: "Uninstall this Plugin Center MCP?",
    uninstallDescription:
      "This deletes your personal installation and related personal configuration. The Plugin Center publication is not affected.",
    uninstalled: "The Plugin Center plugin/Skill was uninstalled.",
    uninstalledPlugin: "The Plugin Center plugin was uninstalled.",
    uninstalledSkill: "The Plugin Center skill was uninstalled.",
    uninstalledMcp: "The Plugin Center MCP was uninstalled.",
    ownedCapabilitiesEmpty:
      "You do not have any personal plugins or Skills yet.",
    preferenceUpdated: "Your enablement preference was updated.",
    personalCapabilityDeleted:
      "The personal plugin/Skill was permanently deleted.",
    personalPluginDeleted: "The personal plugin was permanently deleted.",
    personalMcpDeleted: "The personal MCP was permanently deleted.",
    updatePersonalCapability: "Update personal plugin/Skill",
    updatePersonalPlugin: "Update personal plugin",
    updatePersonalSkill: "Update personal skill",
    updatePersonalMcp: "Update personal MCP",
    personalImportDescription:
      "The source is parsed and its risks are shown first. Installation or replacement happens only after a second confirmation.",
    personalPluginImportDescription:
      "The source is parsed and its risks are shown first. The personal plugin is installed or replaced only after a second confirmation.",
    personalSkillImportDescription:
      "The source is parsed and its risks are shown first. The personal skill is installed or replaced only after a second confirmation.",
    importSources: {
      local: "Local ZIP package",
      manualSkill: "Create a Skill manually",
    },
    zipPackage: "ZIP plugin/Skill package",
    zipPackageHint:
      "Only ZIP files that follow the plugin or Skill package conventions are accepted.",
    zipPluginPackage: "ZIP plugin package",
    zipPluginPackageHint:
      "Only ZIP files that follow the plugin package convention are accepted.",
    zipSkillPackage: "ZIP skill package",
    zipSkillPackageHint:
      "Only ZIP files that follow the skill package convention are accepted.",
    skillMarkdown: "SKILL.md content",
    skillIdentifier: "Skill identifier",
    skillNameRequired: "Enter a skill identifier.",
    skillNameTooLong: "The skill identifier cannot exceed 64 characters.",
    skillNameInvalid:
      "Use only lowercase English letters, numbers, and hyphens (-). Hyphens cannot appear at the start or end, or consecutively.",
    skillNameReserved:
      "This skill identifier is reserved by the system. Choose another one.",
    skillDisplayName: "Display name (optional)",
    skillDisplayNameHint:
      "Generated from the skill identifier. You can edit it or leave it blank; Chinese characters and spaces are welcome.",
    skillNameHint:
      "Use 1–64 characters: lowercase English letters, numbers, and hyphens (-). Hyphens cannot appear at the start or end, or consecutively. Do not use built-in skill names. Example: my-skill.",
    skillPreview: "Skill content preview",
    applyForListing: "Submit for listing",
    pendingReviewAction: "Listing review pending",
    publishNew: "Submit a new listing",
    submitUpdate: "Submit new release",
    publishDialogDescription:
      "The current personal plugin or skill is copied into an immutable snapshot and submitted for administrator review.",
    sourceCapability: "Personal plugin/skill source",
    noPublishableSource:
      "No publishable personal plugin or skill has the same name and type as this listing. Import or update the source in the Plugin Center first.",
    immutableSnapshotNotice:
      "Review applies to an independent immutable snapshot. Later edits to your personal plugin or skill cannot change this pending release.",
    submitForReview: "Submit for review",
    submitted: "The release snapshot was submitted for administrator review.",
    submittedAt: "Submitted {{date}}",
    reviewPolicyNotice:
      "Every new release is reviewed again. Approved releases never auto-update existing installations.",
    publicationsEmpty:
      "You have not submitted any applications, plugins, or skills yet.",
    publicationsDescription:
      "Manage your submitted applications, plugins, and skills, track reviews, and publish updates.",
    backToCenter: "Back to plugin center",
    manageApplicationListing: "Manage listing",
    selectApplication: "Select an application to list",
    selectApplicationDescription:
      "Choose your application, set its version and usage modes, and submit it for administrator review.",
    noPublishableApplication:
      "No eligible applications found. Adjust your search, or create and enable an application in My applications first.",
    withdraw: "Withdraw review",
    withdrawn: "The pending release was withdrawn.",
    unlist: "Unlist from Plugin Center",
    relist: "Relist",
    unlisted:
      "The listing was unlisted. Existing installations can still run and update.",
    relisted: "The listing is visible in the Plugin Center again.",
    releaseDetail: "Release details",
    releaseDetailDescription:
      "Inspect snapshot files, risk declarations, Skill content, and the content hash.",
    packageFiles: "Snapshot files",
    adminTitleShort: "Plugin Center",
    reviewsEmpty: "There are no pending releases to review.",
    listingsEmpty: "There are no Plugin Center listings yet.",
    review: "Review",
    reviewRelease: "Review “{{name}}”",
    reviewDescription:
      "The decision applies only to this immutable release. Rejections require a clear reason.",
    reviewDecision: "Review decision",
    reviewComment: "Review comment",
    approvalCommentOptional: "A comment is optional when approving.",
    rejectionCommentRequired: "A reason is required when rejecting.",
    approve: "Approve",
    reject: "Reject",
    submitReview: "Submit decision",
    reviewApproved:
      "The release was approved and is now the current Plugin Center release.",
    reviewRejected:
      "The release was rejected and the reason was sent to the publisher.",
    suspendListing: "Suspend",
    resumeListing: "Resume",
    suspendListingTitle: "Suspend “{{name}}”?",
    suspendListingDescription:
      "The listing will be hidden from the Plugin Center and every installed copy will be blocked from starting new tasks.",
    resumeListingTitle: "Resume “{{name}}”?",
    resumeListingDescription:
      "The listing will return to the Plugin Center and installed copies can be used in new tasks again.",
    suspensionReason: "Suspension reason",
    listingSuspended:
      "The listing was suspended and new tasks are blocked for every installation.",
    listingResumed: "The listing was resumed.",
    risks: {
      contains_mcp_server: "Contains an MCP server",
      contains_scripts: "Contains executable scripts",
      contains_external_connections: "May access external services",
      requires_environment_variables: "Requires environment variables",
      requires_credentials: "Requires credentials",
      contains_dependency_download_commands: "May download dependencies",
      declaredEnvironmentKeys: "Environment variables: {{values}}",
      mcpEnvironmentReferences: "MCP environment variables",
      mcpEnvironmentReference: "{{server}} · {{source}}",
      environmentSource: {
        local: "Provided by a personal credential",
        remote: "Provided by the remote environment",
      },
    },
  },
  clawHub: {
    sourceName: "ClawHub",
    repository: "Skill repository",
    catalogLabel: "ClawHub skill repository",
    search: "Search the skill repository",
    loading: "Loading the skill repository…",
    refreshing: "Refreshing…",
    empty: "No skills are available",
    emptyDescription:
      "The service has not synchronized any available ClawHub skill metadata yet.",
    noSearchResults: "No matching skills",
    noSearchResultsDescription: "No skills match “{{search}}”.",
    sourceNotice:
      "Skill metadata comes from ClawHub. LinkSense does not represent ClawHub and does not audit or endorse these skills. Verify the source and risks before installing.",
    listLabel: "Skill repository results",
    sortLabel: "Sort skills",
    sort: {
      downloads: "Downloads",
      stars: "Stars",
    },
    totalCount: "Total: {{count}}",
    byOwner: "By {{owner}}",
    version: "Version {{version}}",
    downloads: "{{count}} downloads",
    stars: "{{count}} stars",
    owner: "Owner",
    latestVersion: "Latest version",
    downloadCount: "Downloads",
    starCount: "Stars",
    updatedAt: "Updated on ClawHub",
    syncedAt: "Last synchronized",
    topics: "Topics",
    platformRequirements: "Platform requirements",
    changelog: "Changelog",
    openCanonical: "View on ClawHub",
    installedState: "Installed",
    unavailableState: "Unavailable",
    viewDetails: "View details for {{name}}",
    preparing: "Preparing…",
    paginationLabel: "Skill repository pages",
    pageNumber: "Page {{page}}",
    installTitle: "Install “{{name}}”?",
    updateTitle: "Update “{{name}}”?",
    installPreviewDescription:
      "Verify the ClawHub version, source, and risks. The skill is added to your personal skills only after confirmation.",
    packageIdentity: "Skill source",
    versionToInstall: "Version to install",
    installFailedTitle: "Installation failed",
    installing: "Installing…",
    installingStatus: "Installing skill…",
    updatingStatus: "Updating skill…",
    confirmInstall: "Confirm installation",
    confirmUpdate: "Confirm update",
    installed: "Installed from the skill repository as a personal skill.",
    updated: "The skill repository installation is now up to date.",
    origin: "ClawHub install",
    uninstall: "Uninstall",
    uninstalling: "Uninstalling",
    uninstallingStatus: "Uninstalling skill…",
    uninstallTitle: "Uninstall this ClawHub skill?",
    uninstallDescription:
      "This deletes your personal installation and related personal configuration. The synchronized repository metadata is not affected.",
    uninstalled: "The ClawHub skill was uninstalled.",
    securityNoticeTitle: "Security notice",
    security: {
      clean: "Security check passed",
      warning: "Security warnings",
      flagged: "Risk flagged",
      unknown: "Checked during install",
      warningDescription:
        "This skill has a security status that needs attention. Install it only if you trust the source.",
    },
    installability: {
      unavailable: "This skill is currently unavailable.",
      missingVersion: "This skill has no installable version.",
      alreadyInstalled: "This version is already installed.",
    },
  },
  capability: {
    title: "Plugins & Skills",
    description:
      "Manage personal plugins, Skills, Plugin Center sources, and runtime status.",
    builtIn: "Built-in",
    builtInReadOnly:
      "Attached automatically by the platform and cannot be selected, disabled, edited, or deleted.",
    builtIns: {
      browser: {
        name: "{{productName}} Browser",
        description:
          "Uses an isolated managed browser to visit pages, interact with sites, and capture screenshots.",
      },
      documentReader: {
        name: "{{productName}} Document Reader",
        description:
          "Converts common office documents, ebooks, CSV files, and text-based PDFs in the task to Markdown for safe AI reading.",
      },
      docs: {
        name: "{{productName}} Docs",
        description:
          "Answers product usage and administration questions from the official bilingual help documentation.",
      },
      coreMcp: {
        name: "{{productName}} Core MCP",
        description:
          "Provides document conversion, artifact registration, image generation, knowledge retrieval, and Skill creation through one built-in MCP.",
      },
      fileService: {
        name: "{{productName}} File Service",
        description:
          "Registers deliverable files created in the current task as downloadable artifacts.",
      },
      imageGeneration: {
        name: "{{productName}} Image Generation",
        description:
          "Generates image artifacts through the built-in MCP using the admin-configured model.",
      },
      knowledgeBase: {
        name: "{{productName}} Knowledge",
        description:
          "Searches selected knowledge bases and reads the documents needed for the task.",
      },
      skillCreator: {
        name: "{{productName}} Skill Creator",
        description:
          "Turns a confirmed workflow into a complete, reusable personal Skill.",
      },
    },
    pluginTitle: "Plugins",
    pluginDescription:
      "Manage your personal plugins, Plugin Center sources, and runtime status.",
    skillTitle: "Skills",
    skillDescription:
      "Manage your personal skills, Plugin Center sources, and runtime status.",
    typeTabsLabel: "Plugin and Skill type",
    tabs: {
      plugin: "Plugins",
      skill: "Skills",
    },
    searchPlaceholder: "Search {{type}} names or descriptions…",
    installed: "Installed",
    sourceTabsLabel: "Source",
    viewMore: "View {{count}} more",
    viewMorePreview: "View {{names}}",
    viewMorePreviewWithCount: "View {{names}}, plus {{count}} more",
    collapseList: "Show less",
    noSearchResults: "No matching {{type}} found.",
    add: "Add plugin/Skill",
    addPlugin: "Add plugin",
    addSkill: "Add skill",
    install: "Install plugin/Skill",
    importType: "Import method",
    localImport: "Local archive",
    manualSkill: "Create Skill manually",
    packageFile: "Plugin/Skill package",
    skillContent: "SKILL.md content",
    skillContentPreview: "SKILL.md body",
    skillContentEmpty: "The SKILL.md body is empty.",
    skillContentTruncated:
      "The SKILL.md body is too long, so this preview is truncated. The complete SKILL.md will still be installed.",
    descriptionLabel: "Description",
    riskTitle: "Confirm source and risk",
    riskDescription:
      "Installed content may contain scripts, MCP servers, external connections, environment variables, or credential requirements. Continue only if you trust the source.",
    riskConfirm: "I reviewed the source and risk notice",
    installSubmit: "Confirm installation",
    previewSubmit: "Inspect source and risks",
    previewing: "Inspecting…",
    uploading: "Uploading",
    parsing: "Upload complete. Inspecting…",
    importingPluginStatus: "Importing plugin…",
    importingSkillStatus: "Importing skill…",
    updatingPluginStatus: "Updating plugin…",
    updatingSkillStatus: "Updating skill…",
    deletingPluginStatus: "Deleting plugin…",
    uninstallingSkillStatus: "Uninstalling skill…",
    previewConfirmDescription:
      "Review the parsed results below. The plugin or skill is installed or updated only after you check the confirmation and submit.",
    previewExpires: "Preview expires",
    importKind: "Import content",
    logoIncluded: "Logo included",
    declaredCapabilities: "Declarations",
    declaredEnvironmentKeys: "Declared environment keys",
    manifestSummary: "Manifest summary",
    noneDeclared: "None declared",
    noRisksDetected:
      "No known risk item was detected. You must still trust the source.",
    sourceTypes: {
      local: "Local import",
      url: "URL import",
      clawhub: "ClawHub skill repository",
    },
    importKinds: {
      manual_skill: "Manually created Skill",
      zip: "Local ZIP package",
    },
    declarations: {
      mcp_server: "MCP server",
      scripts: "Executable scripts",
      external_connections: "External-service connections",
      environment_variables: "Environment variables",
      credentials: "Credentials",
      dependency_download_commands: "Commands that may download dependencies",
    },
    installCompleted: "Plugin/Skill installed.",
    installSkillCompleted: "Skill installed.",
    updateCompleted: "Plugin/Skill updated.",
    updatePluginCompleted: "Plugin updated.",
    updateSkillCompleted: "Skill updated.",
    pluginSavedForNextTurn:
      "Plugin saved. It will refresh automatically before the next task turn.",
    statusUpdated: "Enablement preference updated.",
    empty: "No plugins or skills are installed.",
    pluginEmpty: "No plugins are installed.",
    skillEmpty: "No skills are installed.",
    source: "Source",
    owner: "Owner",
    personal: "Personal",
    plugin: "Plugin",
    skill: "Skill",
    enable: "Enable",
    disable: "Disable",
    personallyDisable: "Disable for me",
    personallyEnable: "Enable for me",
    personallyDisabledMessage:
      "This plugin or skill has been disabled for you.",
    personallyEnabledMessage: "This plugin or skill has been enabled for you.",
    uninstall: "Uninstall",
    uninstalling: "Uninstalling",
    skillUninstalled: "Skill uninstalled.",
    logo: "Replace logo",
    deleteTitle: "Permanently delete this plugin/Skill?",
    deletePluginTitle: "Permanently delete this plugin?",
    deleteMcpTitle: "Permanently delete this MCP?",
    deleteDescription:
      "Related personal configuration and credential bindings will be permanently deleted. This action cannot be undone.",
    uninstallSkillTitle: "Uninstall this skill?",
    uninstallSkillDescription:
      "This skill and its related personal configuration and credential bindings will be removed. This action cannot be undone.",
    updatePlugin: "Update plugin",
    updateSkill: "Update skill",
    updateSubmit: "Confirm update",
    riskDetected:
      "This plugin or skill declares runtime risks that require attention.",
    riskDetails: "Risk items",
    risks: {
      contains_mcp_server: "Contains an MCP server.",
      contains_scripts: "Contains executable scripts.",
      contains_external_connections: "May connect to external services.",
      requires_environment_variables:
        "Declares environment-variable requirements.",
      requires_credentials: "Declares credential requirements.",
      contains_dependency_download_commands:
        "Contains a startup command that may download dependencies.",
      declared_environment_keys: "Environment keys: {{values}}",
      dependency_commands: "Dependency commands: {{values}}",
    },
  },
  credential: {
    title: "Plugin credentials",
    add: "Add credential",
    personal: "Personal credential",
    capabilityId: "Plugin ID",
    credentialId: "Credential ID",
    deleteTitle: "Permanently delete this credential?",
    edit: "Edit credential",
    confirmCreate: "Confirm creation",
    confirmUpdate: "Confirm update",
    disableTitle: "Disable this credential?",
    enableTitle: "Enable this credential?",
    providerPlaceholder: "For example: openai_api",
    nameInvalid: "Enter a credential name within 160 characters.",
    plugin: "Plugin",
    description:
      "Plugin credentials contain API keys and other authorization details that plugins use to access external services. Add a credential and link it to a plugin to use these details automatically when you run the plugin.",
    secret: "Authorization value",
    secretHint:
      "Saved keys and authorization details are not shown again. Do not include secrets in names.",
    bind: "Link plugin",
    lastUsed: "Last used",
    empty:
      "No credentials yet. Add keys or authorization details here when a plugin needs access to an external service.",
    deleteDescription:
      "Plugins using this credential will no longer be able to access external services through it. The credential and its links will be permanently deleted and cannot be restored.",
    disableDescription:
      "Plugins will stop using this credential in subsequent runs. Existing plugin links will be kept.",
    enableDescription:
      "Linked plugins can use this credential again in subsequent runs.",
    providerType: "Service identifier",
    providerTypeHint:
      "Enter the identifier supplied for this service, such as openai_api. Use lowercase letters, numbers, underscores, or hyphens.",
    providerTypeFormat:
      "Use lowercase letters, numbers, underscores, or hyphens for the service identifier, such as openai_api.",
    secretKey: "Configuration name",
    secretKeyHint:
      "Enter the name required by the plugin, such as API_KEY. Copy it exactly as shown in the plugin instructions.",
    secretKeyFormat:
      "Configuration names must begin with a letter or underscore and contain only letters, numbers, or underscores.",
    secretKeyDuplicate: "Configuration names must be unique.",
    secretRequired: "Enter the authorization details to save.",
    keepSecretHint:
      "Leave blank to keep the saved value. Enter a new value to replace it.",
    savedSecretHint:
      "Saved authorization details are not displayed. They are kept unless you enter new values.",
    bindings: "Linked plugins",
    bindingPriority:
      "Choose a plugin and confirm which information it should use from this credential. The plugin will use these details in subsequent runs.",
    mappingTitle: "Confirm the information to use",
    mappingDescription:
      "Matching names have been selected automatically. For any remaining items, select the corresponding information from this credential.",
    pluginEnvironmentKey: "Information the plugin needs",
    credentialField: "Use from this credential",
    notMapped: "Not selected",
    bindingInProgress: "Saving plugin links…",
    bindingSucceeded: "Plugin links saved.",
    confirmBind: "Save links",
    unbindTitle: "Remove this information link?",
    unbindDescription:
      "“{{plugin}}” will stop reading “{{name}}” from this credential. The saved information will be kept.",
    confirmUnbind: "Remove link",
    unbindNamed: "Unlink {{name}}",
    addSecretField: "Add configuration item",
    removeSecretField: "Remove this configuration item",
    noDeclaredKeys: "This plugin has no credential information to configure.",
    pluginCount_one: "Used by {{count}} plugin",
    pluginCount_other: "Used by {{count}} plugins",
    associatedFields_one: "{{count}} item linked",
    associatedFields_other: "{{count}} items linked",
    notAssociated:
      "Not used by any plugins yet. Link a plugin to use these details automatically when it runs.",
    unavailablePlugin: "Inaccessible plugin",
    credentialDetails: "Credential details",
    showDetails: "View configuration details",
    hideDetails: "Hide configuration details",
    pluginActionsNamed: "Link actions for {{name}}",
    detailsNamed: "Configuration details for {{name}}",
    manageAssociation: "Manage links",
    removeAssociation: "Unlink plugin",
    removeAssociationTitle: "Unlink this plugin?",
    removeAssociationDescription:
      "“{{name}}” will stop using all information from this credential. The credential will be kept, and you can link it again later.",
    completeConfiguration: "Complete setup",
    fixAssociation: "Resolve links",
    enableAction: "Enable credential",
    configurationNote:
      "This shows the saved configuration. It does not verify access to the external service.",
    usesField: "Uses this credential’s:",
    otherCredential: "Provided by another credential.",
    removeField: "Remove link",
    removeFieldNamed: "Remove the link for {{name}}",
    mappingSummary: "{{configured}} of {{total}} items selected",
    unselectedFields: "Not yet selected:",
    selectInformation: "Select or adjust information",
    configurationStatus: {
      loading: "Checking…",
      failed: "Status unavailable",
      unavailable: "Plugin unavailable",
      configured: "Credentials configured",
      missing: "More information needed",
      disabled: "This credential is disabled",
      disabledElsewhere: "A credential is disabled",
      conflict: "Conflicting links",
      invalid: "Configuration needs updating",
    },
    configurationHelp: {
      failed: "Could not load configuration status. Try again.",
      unavailable:
        "This plugin is unavailable or you do not have access. Unlink it or contact an administrator.",
      missing:
        "The plugin has information that is not configured. View the details to see what is missing and complete setup.",
      disabled:
        "Enable this credential so the plugin can use its information again.",
      disabledElsewhere:
        "Another credential used by this plugin is disabled. Enable that credential or update the links.",
      conflict:
        "The same item is linked to multiple credentials. Manage the links to select the information to use.",
      invalid:
        "Linked information cannot be used or no longer matches the plugin requirements. Check the saved values and update the links.",
    },
    fieldStatus: {
      configured: "Configured",
      missing: "Not configured",
      disabled: "The credential providing this value is disabled",
      conflict: "Linked to multiple credentials",
      invalid: "Update needed",
    },
  },
  profile: {
    title: "Personal settings",
    description:
      "Manage your avatar, interface language, and sign-in security.",
    avatar: "Avatar",
    uploadAvatar: "Upload new avatar",
    editName: "Edit name",
    editNameTitle: "Edit name",
    editNameDescription: "Update your display name.",
    role: "Role",
    profileSaved: "Personal settings saved.",
    passwordChanged: "Password changed. Sign in again.",
    general: "General",
    security: "Sign-in security",
    avatarSaved: "Avatar updated.",
    usageSummary: "Personal usage overview",
    loadingUsage: "Loading personal usage…",
    totalTokens: "Total tokens",
    peakDailyTokens: "Peak daily tokens",
    totalTasks: "Total tasks",
    currentStreak: "Current streak",
    longestStreak: "Longest streak",
    dayCount_one: "{{count}} day",
    dayCount_other: "{{count}} days",
    tokenActivity: "Token activity",
    tokenActivityDescription: "Your daily token usage over the last 365 days.",
    activityChartLabel: "Token activity heatmap for the last 365 days",
    activityDayLabel: "{{date}}, {{tokens}} tokens used",
    activityTooltip: "{{date}} used {{tokens}} tokens",
    activityLess: "Less",
    activityMore: "More",
    activityUnavailable: "No token activity is available yet.",
    usageInsights: "Usage insights",
    totalTurns: "Total chats",
    modelCalls: "Total model calls",
    skillUses: "Skill uses",
    activeDays: "Active days",
    averageTokensPerTurn: "Average tokens per turn",
    mostUsedModels: "Most used models",
    mostUsedSkills: "Most used skills",
    modelUsageShare: "{{model}} accounts for {{share}}% of total tokens",
    skillUsageCount_one: "{{count}} use",
    skillUsageCount_other: "{{count}} uses",
    noModelUsage: "No model usage has been recorded yet.",
    noSkillUsage: "No Skill usage has been recorded yet.",
    passwordDescription:
      "Changing your password revokes existing sessions and requires you to sign in again.",
  },
  usage: {
    title: "Usage analytics",
    description:
      "Review tasks, turns, model token usage, and cost globally, by application, current group membership, and user.",
    sectionLabel: "Usage analytics and billing",
    sections: {
      analytics: "Usage analytics",
      billing: "Billing",
    },
    billing: {
      pageDescription:
        "Review calendar-month statements summarized by model, preview them online, and export them as PDF.",
      period: "Billing period",
      total: "Statement total",
      modelCount: "Models",
      generatedAt: "Generated",
      current: {
        title: "Current billing period",
        description:
          "The statement is generated automatically after the calendar month closes.",
        open: "In progress",
        expectedGeneration: "Expected generation",
      },
      history: {
        title: "Monthly statements",
        description: "Immutable monthly snapshots of model usage and charges.",
        empty: "No monthly statements have been generated yet.",
      },
      detail: {
        title: "Statement details",
        description: "Loading statement details…",
      },
      columns: {
        model: "Model",
        input: "Input tokens",
        cached: "Cached tokens",
        output: "Output tokens",
        totalTokens: "Total tokens",
        pricing: "Pricing",
        amount: "Amount",
      },
      uniformPricing: "Fixed rate",
      mixedPricing: "Multiple rates",
      preview: {
        action: "Preview online",
      },
      export: {
        action: "Export PDF",
        success: "Statement PDF exported.",
        filename: "{{statementNumber}}-statement.pdf",
      },
      pdf: {
        statement: "Monthly Statement",
        accountStatement: "Model usage account statement",
        statementNumber: "Statement number",
        billingPeriod: "Billing period",
        generatedAt: "Generated at",
        currency: "Currency",
        pricePerMillion: "Rate per 1M tokens",
        inputShort: "In",
        cachedShort: "Cached",
        outputShort: "Out",
        totalAmount: "Statement total",
        unpricedNote:
          "{{tokens}} tokens have no price snapshot and are excluded from the amount due.",
        page: "Page {{current}} of {{total}}",
        footer:
          "Automatically generated by LinkSense from pricing snapshots captured at call time.",
      },
    },
    rangeLabel: "Reporting period",
    ranges: {
      all: "All time",
      sevenDays: "Last 7 days",
      thirtyDays: "Last 30 days",
      custom: "Custom range",
    },
    customRange: {
      dateFrom: "Start date",
      dateTo: "End date",
      selectDate: "Select date",
      clearDate: "Clear date",
    },
    export: {
      action: "Export Excel",
      exporting: "Exporting…",
      success: "Usage analytics exported.",
      filename: "{{productPrefix}}-usage-analytics-{{date}}.xlsx",
    },
    tasks: "Tasks",
    turns: "Turns",
    modelCalls: "Model calls",
    totalTokens: "Total tokens",
    totalCost: "Total cost",
    inputCost: "Input cost",
    cachedInputCost: "Cached input cost",
    outputCost: "Output cost",
    sort: {
      asc: "Sort by {{field}} ascending",
      desc: "Sort by {{field}} descending",
    },
    tasksHint:
      "Tasks created during the selected period; later deletion does not change history",
    turnsHint:
      "Actual turns created during the selected period; later deletion does not change history",
    tokensHint:
      "Includes responses, document embeddings, query embeddings, and reranking",
    costHint:
      "Accumulated from the price snapshot captured for each call; later price changes do not alter history",
    unpricedTokensHint:
      "{{tokens}} tokens have no price snapshot and are excluded from cost",
    unpricedShort: "{{tokens}} unpriced",
    trend: {
      title: "Token usage trend",
      description:
        "Token totals for the selected period grouped {{granularity}} and stacked by model workload.",
      empty: "No token usage in the selected period.",
      ariaLabel: "Token usage trend for the selected period",
      granularity: {
        day: "daily",
        month: "monthly",
        year: "yearly",
      },
    },
    costTrend: {
      title: "Cost trend",
      description:
        "Historical costs captured at call time, grouped {{granularity}} and stacked by model workload.",
      empty: "No model cost in the selected period.",
      ariaLabel: "Model cost trend for the selected period",
    },
    tabsLabel: "Usage analytics dimensions",
    tabs: {
      models: "By model",
      workloads: "By workload",
      applications: "By application",
      groups: "By group",
      users: "By user",
    },
    modelsTitle: "All model usage",
    modelsDescription:
      "Calls, token composition, and cost for every generation, embedding, and rerank model.",
    tableCostUnit: "Cost unit: CNY (yuan).",
    modelsEmpty: "No model usage in the selected period.",
    workloadsTitle: "Model workload usage",
    workloadsDescription:
      "Separates AI responses, task auto naming, memory generation, knowledge-document embeddings, retrieval-query embeddings, and result reranking. Usage is marked as estimated when the provider does not return it.",
    workloadsEmpty: "No model workload usage in the selected period.",
    applicationsTitle: "Application usage",
    applicationsDescription:
      "Summarizes tasks, turns, model calls, tokens, and cost by the application linked when each task was created. Usage created outside an application is listed separately.",
    applicationsEmpty: "No application usage in the selected period.",
    applicationDetailDescription:
      "Model usage for tasks linked to this application",
    application: "Application",
    unattributedApplication: "Not linked to an application",
    workload: "Model workload",
    workloads: {
      assistant_response: "AI responses",
      memory_generation: "Memory generation",
      task_title_generation: "Task auto naming",
      document_embedding: "Document embeddings",
      query_embedding: "Query embeddings",
      rerank: "Retrieval reranking",
      image_generation: "Image generation",
    },
    modelKinds: {
      generation: "Generation model",
      embedding: "Embedding model",
      rerank: "Rerank model",
      image: "Image model",
    },
    measurementMethod: "Measurement",
    measurementMethods: {
      provider: "Provider reported",
      estimated: "Locally estimated",
    },
    groupsTitle: "Group usage",
    groupsDescription:
      "Calculated from current active membership. A user may appear in multiple groups, so group rows must not be added together to derive the global total.",
    currentMembership: "Current membership",
    groupDetailDescription: "Model usage for {{count}} current members",
    usersTitle: "User usage",
    usersDescription: "Tasks, turns, and model token usage for every user.",
    searchUsers: "Search users by name or email",
    usersEmpty: "No matching users.",
    modelBreakdown: "Model breakdown",
    model: "Model",
    inputTokens: "Input tokens",
    cachedInputTokens: "Cached input tokens",
    outputTokens: "Output tokens",
    reasoningOutputTokens: "Reasoning output tokens",
    group: "Group",
    members: "Members",
    ungrouped: "Ungrouped users",
    unknownModel: "Unknown model",
    noSelection: "No data available",
    tokenCompositionNote:
      "Cached input tokens are a subset of input tokens, and reasoning output tokens are a subset of output tokens; neither is added to total tokens again. Task and turn counts use immutable creation records, so later task deletion does not reduce history.",
    costCompositionNote:
      "Costs retain full precision for storage and aggregation and are displayed with two decimal places. Rounding differences are allocated proportionally within each total so displayed details add up to the displayed total. Regular input cost excludes cached input, which is charged at its own rate. Prices and costs are fixed when each call is recorded, so later price changes never recalculate history.",
  },
  myFeedback: {
    title: "My feedback",
    description: "View your feedback and administrator replies.",
    empty: "No feedback yet",
    emptyDescription: "Use the help menu to share an issue or suggestion.",
    replyStatus: "Reply status",
    replied: "Replied",
    awaitingReply: "Awaiting reply",
    detailsDescription: "View the feedback and its reply history.",
    replies: "Replies",
    noReplies: "No replies yet",
    administrator: "Administrator",
    writeReply: "Reply to user",
    replyHint: "Send text, images, or both.",
    replyPlaceholder: "Write a reply…",
    replyImages: "Reply images",
    replySuccess: "Reply sent",
    sendingReply: "Sending…",
    sendReply: "Send reply",
  },
  adminFeedback: {
    title: "User feedback",
    description:
      "Review feedback text and issue screenshots submitted by users.",
    empty: "No user feedback yet.",
    submitter: "Submitted by",
    content: "Feedback",
    images: "Images",
    submittedAt: "Submitted",
    imageCount: "{{count}} image",
    imageCount_other: "{{count}} images",
    detailsTitle: "Feedback details",
    detailsDescription: "Submitted by {{name}} at {{time}}",
    imageList: "Feedback images",
    imageAlt: "Feedback image {{name}}",
    openImage: "Open a larger view of {{name}}",
    imagePreviewTitle: "Image preview",
    imageLoading: "Loading image",
    imageUnavailable: "This image is temporarily unavailable.",
    pagination: "User feedback list pagination",
    deleteLabel: "Delete feedback submitted by {{name}}",
    deleteTitle: "Delete this feedback?",
    deleteDescription:
      "This will delete the feedback submitted by {{name}}, every reply, and all their images. This action cannot be undone.",
    deleting: "Deleting…",
    deleteSuccess: "Feedback deleted.",
  },
  systemUpdate: {
    notice: {
      title: "LinkSense {{version}} is available",
      description:
        "Administrators can review the release and follow the guided upgrade process.",
      action: "View update",
      dismiss: "Dismiss the update notice for this version",
    },
    status: {
      update_available: "Update available",
      up_to_date: "Up to date",
      check_failed: "Check failed",
    },
    overview: {
      title: "Version status",
      description: "Automatically check official LinkSense GitHub releases.",
    },
    currentVersion: "Current version",
    latestVersion: "Latest version",
    checkedAt: "Last checked",
    publishedAt: "Published",
    checkNow: "Check now",
    openRelease: "View GitHub release",
    releaseNotes: "Release notes",
    refreshFailed: "Could not check for updates again",
    checkFailed: {
      title: "The latest version is temporarily unavailable",
      GITHUB_UNAVAILABLE:
        "The server could not reach GitHub. Check its network access and try again.",
      GITHUB_RATE_LIMITED:
        "GitHub temporarily limited update checks. Try again later.",
      GITHUB_RESPONSE_INVALID:
        "GitHub returned release information that LinkSense could not recognize. Try again later.",
    },
    tutorial: {
      title: "Update guide",
      description:
        "The upgrade script detects the Core or Full edition, waits for running work, and creates a validated database backup before migration.",
      safetyTitle: "The web application never starts the upgrade automatically",
      safetyDescription:
        "Run the command in a terminal on the LinkSense host. Schedule a maintenance window first and make sure an administrator can inspect service health.",
      linux: "Linux",
      macos: "macOS (do not use sudo)",
      steps: {
        maintenance:
          "Schedule a maintenance window during a quiet period and notify active users.",
        run: "Sign in to the LinkSense host and run the command for its operating system.",
        backup:
          "Save the PostgreSQL backup location printed by the script. A failure after database migration begins does not automatically roll the database back.",
        health:
          "After the upgrade finishes, open System health and confirm that every service has recovered.",
      },
    },
  },
  admin: {
    usersAndGroupsTitle: "Users & groups",
    usersAndGroupsDescription:
      "Manage user accounts, roles, status, groups, and members in one place.",
    usersAndGroupsTabsLabel: "Users and groups management",
    usersTitle: "Users",
    usersDescription:
      "Create, import, and manage admitted users. Administrators cannot view or reset user passwords.",
    rolesTitle: "Roles and permissions",
    rolesDescription:
      "Review the fixed roles and permission boundaries for {{productName}}'s current features. Permissions apply only to active accounts; assign roles from User management.",
    roleUserDescription:
      "Manages their own tasks, personal settings, plugins/Skills, and credentials; uses Plugin Center; and creates or manages owned knowledge bases or uses shared knowledge bases.",
    roleAdminDescription:
      "An active administrator has user permissions and governs users and groups, Plugin Center, knowledge base metadata and sources, models and pricing, system settings, health, audit metadata, and usage. The administrator role alone does not grant access to other users' task or knowledge base content.",
    permissionMatrix: "Permission matrix",
    permission: "Permission",
    roleAccountBreakdown: "Role account counts",
    roleAccountCount: "{{count}} accounts",
    roleActiveAccountCount: "{{count}} active",
    roleDisabledAccountCount: "{{count}} disabled",
    rolePermissions: {
      ownConversations: "Manage own tasks",
      personalSettings: "Manage profile, appearance, and security settings",
      personalCapabilities:
        "Create, import, and manage personal plugins/Skills",
      usePluginCenter:
        "Browse, install, and update plugins and submit listings for review",
      personalCredentials: "Manage personal credentials",
      personalKnowledgeBases:
        "Manage owned knowledge bases and use shared knowledge bases",
      manageUsersAndGroups: "Manage users and user groups",
      governStoreCapabilities: "Review and govern Plugin Center listings",
      governKnowledgeBases:
        "Govern knowledge base metadata and lifecycle without automatic content access",
      manageKnowledgeSources: "Configure knowledge sources and synchronization",
      manageModelsAndPricing:
        "Configure generation, image understanding, embedding, and rerank models and token pricing",
      manageSystemSettings: "Manage product settings and sign-in providers",
      manageSystemHealth:
        "Review system health and run knowledge base maintenance",
      viewAuditMetadata:
        "View redacted cross-user audit and task metadata without content",
      viewUsageAnalytics:
        "View model usage and cost globally, by group, and by user",
    },
    createUser: "Create user",
    importUsers: "Import Excel",
    role: "Role",
    registrationSource: "User source",
    registrationSources: {
      selfRegistration: "Self-registered",
      organizationInvitation: "Organization invitation",
    },
    loginMethod: "Sign-in method",
    lastLogin: "Last sign-in",
    totalCreditLimit: "Total quota (credits)",
    weeklyCreditLimit: "Weekly quota (credits)",
    monthlyCreditLimit: "Monthly quota (credits)",
    creditLimitDisplay: "{{value}} credits",
    creditQuotaRemainingFilter: "Quota remaining",
    totalCreditQuotaRemainingZero: "Total quota remaining is 0",
    weeklyCreditQuotaRemainingZero: "Weekly remaining is 0",
    monthlyCreditQuotaRemainingZero: "Monthly remaining is 0",
    creditQuotaRemainingAmount: "{{value}} credits remaining ({{percentage}}%)",
    creditQuotaRemainingUnavailable: "Quota remaining -",
    noCreditLimit: "Unlimited",
    inheritCreditLimit: "Unlimited",
    clearCreditLimit: "Leave blank to clear per-user quota",
    creditLimitHint:
      "Enter a positive number. Decimals are allowed. Unit: credits. Blank means no per-user quota setting.",
    creditLimitInputInvalid:
      "Enter a number greater than 0 with at most 6 decimal places. Unit: credits.",
    userCreditLimits: "Per-user credit quotas",
    userCreditLimitsDescription:
      "The total quota never resets; weekly and monthly quota reset on their respective schedules. When any configured quota is exhausted, the user cannot start new tasks. Running tasks are not affected.",
    adjustCreditLimits: "Adjust quota",
    adjustUserCreditLimits: "Adjust quota for {{name}}",
    singleCreditLimitsTitle: "Adjust per-user credit quotas",
    singleCreditLimitsDescription:
      "Update the total, weekly, and monthly quota for {{name}}. Leave a field blank for no corresponding per-user quota setting.",
    selfRegisteredTotalQuotaOverrideHint:
      "This account was self-registered. Saving a new open-registration total quota later will also update this total quota.",
    batchCreditLimits: "Set quota ({{count}})",
    batchCreditLimitsTitle: "Batch set user credit quotas",
    batchCreditLimitsDescription:
      "Apply the checked quota fields to {{count}} selected users. Unchecked fields stay unchanged.",
    creditLimitFields: "Usage to update",
    updateTotalCreditLimit: "Update total quota",
    updateWeeklyCreditLimit: "Update weekly quota",
    updateMonthlyCreditLimit: "Update monthly quota",
    singleCreditLimitsSaved: "Updated credit quotas for {{name}}.",
    creditLimitsSaved: "Updated credit quotas for {{count}} users.",
    selectVisibleUsers: "Select users in the current list",
    selectUser: "Select user {{name}}",
    groups: "User groups",
    selectGroups: "Select user groups",
    searchGroups: "Search user groups",
    groupSearchEmpty: "No matching user groups found.",
    removeGroup: "Remove user group {{name}}",
    additionalGroups: "{{count}} more user groups",
    userStatus: "User status",
    usersEmpty: "No users found.",
    groupsTitle: "User groups",
    groupsDescription: "Manage flat user groups and members.",
    createGroup: "Create user group",
    members: "Members",
    viewGroupMembers: "View {{count}} members in {{name}}",
    groupMembersTitle: "Members of {{name}}",
    groupMembersDescription: "{{count}} members",
    groupMembersEmpty: "This user group has no members.",
    memberListLabel: "User group members",
    loadMoreMembers: "Load more members",
    memberSelector: "Members",
    selectMembers: "Select members",
    selectedMembers: "{{count}} members selected",
    memberSearchPlaceholder: "Search members by name or email",
    memberSearchEmpty: "No matching members found.",
    groupsEmpty: "No user groups.",
    auditTitle: "Audit logs",
    auditDescription:
      "Only permitted cross-user metadata is shown. Task text, attachment content, and download links are excluded.",
    action: "Action",
    actionCode: "Action code",
    actionSearchPlaceholder: "Search or select an action",
    actionSearchEmpty: "No matching actions.",
    actor: "Actor",
    target: "Target",
    targetTypeCode: "Target type code",
    result: "Result",
    resultCode: "Result code",
    sourceIp: "Source IP",
    exportCreatedAt: "Created at",
    exportActorId: "Actor ID",
    exportTargetType: "Target type",
    exportTargetId: "Target ID",
    exportMetadata: "Metadata",
    auditId: "Log ID",
    userAgent: "User-Agent",
    auditDetailsTitle: "Audit log details",
    auditDetailsDescription:
      "All redacted information available for this audit log entry is shown below.",
    auditEventInformation: "Log information",
    auditSubjectInformation: "Actor and target",
    auditRequestInformation: "Request information",
    auditMetadataTitle: "Redacted metadata",
    auditMetadataEmpty: "No additional metadata.",
    auditConversationDetailsTitle: "Task execution details",
    auditConversationDetailsDescription:
      "All redacted execution metadata available for this task is shown below.",
    retainedArtifactDetailsTitle: "Deleted-task artifact details",
    retainedArtifactDetailsDescription:
      "All available summary information for permanently retained artifacts from this deleted task is shown below.",
    auditExecutionInformation: "Execution information",
    auditArtifactInformation: "Artifact information",
    ownerId: "Owner ID",
    ownerName: "Owner name",
    ownerEmail: "Owner email",
    executionDuration: "Execution duration",
    executionErrorType: "Error type",
    attachmentCount: "Attachment count",
    attachmentSize: "Total attachment size",
    artifactCount: "Artifact count",
    artifactSize: "Total artifact size",
    firstArtifactCreatedAt: "First artifact created",
    lastArtifactCreatedAt: "Last artifact created",
    export: "Export CSV",
    exporting: "Exporting…",
    auditEmpty: "No matching audit records.",
    settingsTitle: "System settings",
    managementTitle: "Management",
    settingsDescription:
      "Manage product display, task concurrency, authentication email, and sign-in features. Secrets are encrypted and never shown again.",
    settingsTabsLabel: "System settings categories",
    settingsTabs: {
      product: "Product settings",
      concurrency: "Task concurrency",
      smtp: "Authentication email",
      registration: "Open registration",
      sso: "Single sign-on",
      maintenance: "System maintenance",
    },
    concurrency: {
      title: "Task concurrency",
      description:
        "Set the number of tasks that can run across the system and for each user. Leave a field blank to use the deployment default.",
      globalLimit: "System-wide running task limit",
      globalLimitDescription:
        "Maximum number of running tasks across all users. Leave blank to use the deployment default of {{defaultValue}}; the current effective value is {{effectiveValue}}.",
      processLimit: "Per-user task process limit",
      processLimitDescription:
        "Maximum number of task processes loaded for each user. Leave blank to use the deployment default of {{defaultValue}}; the current effective value is {{effectiveValue}}.",
      loweringBehavior:
        "Lowering a limit does not stop running tasks. New tasks can start again after current usage falls below the new limit.",
      saved: "Task concurrency settings updated.",
      errors: {
        positiveInteger:
          "Enter an integer greater than 0, or leave blank to use the deployment default.",
      },
    },
    registration: {
      enabled: "Allow self-service registration",
      enabledDescription:
        "When enabled, the sign-in page shows a registration entry. Turning it off blocks new requests and activation links that were already sent.",
      saved: "Open registration settings updated.",
    },
    systemName: "System display name",
    systemLogo: "System logo",
    systemLogoDescription:
      "Used on the sign-in page, sidebar, and maintenance page.",
    systemLogoHint:
      "Supports PNG, JPEG, WebP, or GIF. A horizontal transparent image under 2 MB is recommended.",
    uploadSystemLogo: "Upload logo",
    replaceSystemLogo: "Replace logo",
    removeSystemLogo: "Restore default logo",
    deploymentStatus: "Deployment configuration status",
    settingsSaved: "System settings updated.",
    systemLogoSaved: "System logo updated.",
    systemLogoRemoved: "Default logo restored.",
    maintenance: {
      title: "System maintenance",
      description:
        "Schedule maintenance for the entire system. Regular users see only the maintenance page during the window, while administrators retain access.",
      enabled: "Enable scheduled maintenance",
      enabledDescription:
        "Maintenance is active only between the configured start and end times.",
      reason: "Maintenance reason",
      reasonPlaceholder:
        "Optional: explain why maintenance is needed and how users are affected…",
      duration: "Maintenance duration",
      durationHint:
        "After you choose or enter a duration, the end time is calculated from the start time. You can still adjust the start and end times manually.",
      durationPresetsLabel: "Maintenance duration shortcuts",
      durationPresets: {
        "10m": "10 min",
        "30m": "30 min",
        "1h": "1 hour",
        "2h": "2 hours",
        "4h": "4 hours",
      },
      durationCustomPlaceholder: "Enter manually",
      durationUnit: "Maintenance duration unit",
      durationUnits: {
        minute: "minutes",
        hour: "hours",
      },
      startAt: "Start time",
      endAt: "End time",
      datePlaceholder: "Select date",
      clearStartDate: "Clear start date",
      clearEndDate: "Clear end date",
      startHour: "Start time · hour",
      startMinute: "Start time · minute",
      endHour: "End time · hour",
      endMinute: "End time · minute",
      timezoneHint:
        "Times use the current device time zone and are converted to system time when saved.",
      save: "Save maintenance settings",
      saved: "Maintenance settings saved",
      closed: "System maintenance turned off",
      status: {
        active: "In maintenance",
        scheduled: "Scheduled",
        disabled: "Not enabled",
      },
      errors: {
        startRequired: "Select a start time before enabling maintenance.",
        endRequired: "Select an end time before enabling maintenance.",
        endAfterStart: "The end time must be later than the start time.",
      },
    },
    modelTabs: {
      label: "Model setting categories",
      channels: "Model channels",
      conversation: "Conversation models",
      knowledge: "Knowledge retrieval models",
      voiceTranscription: "Speech-to-text model",
      imageGeneration: "Image generation model",
    },
    modelProvider: {
      catalogDescription:
        "Manage model connections, pricing, and their order in the composer.",
      currentChannel: "Current channel",
      editChannel: "Edit channel",
      connectionDescription:
        "Models in this channel share these connection settings.",
      channelActions: "Channel actions",
      channelSummaryConfigured_one:
        "This channel connects through {{provider}} and includes {{count}} model. The API key is configured",
      channelSummaryConfigured_other:
        "This channel connects through {{provider}} and includes {{count}} models. The API key is configured",
      channelSummaryNotConfigured_one:
        "This channel connects through {{provider}} and includes {{count}} model. No API key is configured yet",
      channelSummaryNotConfigured_other:
        "This channel connects through {{provider}} and includes {{count}} models. No API key is configured yet",
      channelSummaryEnd: ".",
      noChannels: "No model channels yet",
      noChannelsDescription:
        "Add a channel and configure its first model to get started.",
      noModelsDescription:
        "Use Add model to configure a model for this channel.",
      editModel: "Edit model {{name}}",
      modelEditorDescription:
        "Channel: {{name}}. Saving updates only this model.",
      basicInformation: "Basic information",
      pricing: "Model pricing",
      capabilities: "Capabilities",
      modelName: "Model",
      priceSummary: "Input / cached input / output price",
      modelActions: "Actions for model {{name}}",
      modelAvailability: "Available in conversations: {{name}}",
      modelOrder: "Model order",
      moveUp: "Move up",
      moveDown: "Move down",
      moveChannelUp: "Move channel up",
      moveChannelDown: "Move channel down",
      orderHint:
        "Drag a handle or use Move up and Move down. The composer lists available chat models in channel order, then model order within each channel.",
      reorderModel: "Reorder model {{name}}",
      reorderInstructions:
        "Press Space to start sorting, use the up and down arrow keys to move, press Space to confirm, or Escape to cancel.",
      reorderStarted: "Started reordering {{name}}.",
      reorderPosition: "{{name}} moved to position {{position}}.",
      reorderCancelled: "Reordering cancelled.",
      discardTitle: "Discard unsaved changes?",
      discardDescription:
        "Closing will discard the changes made in this editor.",
      discardAction: "Discard changes",
      selectionsHint:
        "The default conversation model is used before a user makes a selection. The task naming model generates task titles.",
      title: "Model service",
      description:
        "Manage conversation, knowledge retrieval, and other models with their service channels. The system uses the right service for each selected model, and administrators can set the reasoning levels available for chat models.",
      readOnlyNotice:
        "Model settings are currently read-only. You can view existing settings, but cannot add, edit, or delete models or change their conversation availability.",
      providers: "Model channels",
      providersDescription:
        "Manage models and their connections in one place. Model IDs cannot be reused, so the system always selects the intended model.",
      addProvider: "Add model channel",
      providerTitle: "Model channel {{index}}",
      providerName: "Channel name",
      renameProvider: "Rename model channel {{name}}",
      renameProviderTitle: "Rename model channel",
      renameProviderDescription:
        "The channel name is only used for administrator identification and takes effect after you save the model settings.",
      renameProviderAction: "Rename",
      unnamedProvider: "Unconfigured model channel",
      deleteProvider: "Delete channel",
      saveProvider: "Save model channel {{name}}",
      deleteProviderTitle: "Delete model channel “{{name}}”?",
      deleteProviderDescription:
        "This model channel and all of its models will be deleted immediately after confirmation. Historical tasks and usage records are not affected.",
      providerDeleted: "Model channel deleted.",
      baseUrl: "Base URL",
      apiKey: "API_KEY",
      apiKeyConfiguredHint:
        "The key is stored securely. Enter a new key only when replacing it.",
      apiKeyRequiredHint:
        "Enter a key before the first save. It will not be displayed again.",
      apiKeyOptionalHint:
        "Enter a key if the provider requires authentication. It will not be displayed after saving.",
      protocolMode: "Protocol compatibility mode",
      protocolModes: {
        native_responses: "Native Responses",
        responses_tool_compat: "Responses tool compatibility",
        chat_completions_bridge: "Chat Completions bridge",
      },
      protocolModeHints: {
        native_responses:
          "Best for services with native Responses support and the full conversation and tool experience.",
        responses_tool_compat:
          "Best for services that support Responses with a more limited set of tools.",
        chat_completions_bridge:
          "Best for compatible services that only support Chat Completions. Some advanced capabilities may be unavailable.",
      },
      models: "Models",
      modelsDescription:
        "Models here share this channel's connection and key. Chat models can appear in the user's model choices, while retrieval and other models are used automatically when needed.",
      addModel: "Add model",
      noModels: "No models in this channel",
      newModelName: "Model {{index}}",
      unnamedModel: "Unnamed model",
      modelId: "Model ID",
      modelIdConflict:
        "This model ID already exists in the model catalog. Use a different ID.",
      modelNameConflict:
        "A model with this display name already exists. Consider a different name to distinguish them.",
      channelNameConflict:
        "A model channel with this name already exists. Consider a different name to distinguish them.",
      displayName: "Display name",
      modelKind: "Model type",
      modelKinds: {
        chat: "Chat model",
        embedding: "Embedding model",
        reranker: "Ranker model",
      },
      serviceProvider: "Model provider",
      supportsImageInput: "Supports image understanding",
      inputPrice: "Input price",
      cachedInputPrice: "Cached input price",
      outputPrice: "Output price",
      contextWindow: "Model context length",
      contextWindowPlaceholder: "Auto detect",
      contextWindowInvalid:
        "Enter an integer greater than 0, or leave blank to auto-detect.",
      priceUnit: "CNY / 1M tokens",
      priceUnitSummary: ". Prices are shown in {{unit}}.",
      showInComposer: "Available in conversations",
      saveModel: "Save model {{name}}",
      deleteModel: "Delete model",
      deleteModelTitle: "Delete model “{{name}}”?",
      deleteModelDescription:
        "The model will be deleted immediately after confirmation. Historical tasks and usage records are not affected.",
      modelDeleted: "Model deleted.",
      supportedEfforts: "Supported reasoning efforts",
      selectedEfforts: "{{count}} selected",
      defaultEffort: "Default reasoning effort",
      defaultModel: "Conversation default model",
      defaultModelHint:
        "The system uses this model when a user has not chosen one or their previous model is unavailable.",
      modelSelections: "Conversation and system model selections",
      saveModelSelections: "Save conversation and system model selections",
      titleModel: "Task auto-naming model",
      titleModelHint:
        "Creates recognizable task names automatically. Its usage is included in analytics.",
      saved: "Model channel settings updated.",
    },
    knowledgeModels: {
      title: "Knowledge retrieval models",
      description:
        "Choose the models that help knowledge bases understand documents, answer questions, and improve search results.",
      selectionDescription:
        "Choose the models used to process documents and improve search results. Add and manage available models under Model channels.",
      noEmbeddingModels:
        "No model is ready for knowledge retrieval. Add and configure an embedding model under Model channels first.",
      embeddingTitle: "Embedding model",
      embeddingSelectionDescription:
        "This required model helps the knowledge base understand documents and user questions. The system checks availability when you save.",
      selectEmbeddingModel: "Select embedding model",
      embeddingModelPlaceholder: "Select an embedding model",
      embeddingDescription:
        "This required model helps the knowledge base understand documents and user questions.",
      rerankTitle: "Rank model",
      rerankSelectionDescription:
        "Moves more relevant results to the top. Search still returns results when this is off or temporarily unavailable.",
      selectRerankerModel: "Select ranker model",
      rerankerModelPlaceholder: "Select a ranker model",
      rerankDescription:
        "Moves more relevant results to the top. Knowledge retrieval still works when this is off.",
      enabled: "Enable during search",
      baseUrl: "Base URL",
      embeddingBaseUrlHint:
        "Enter the embedding model connection address supplied by the provider.",
      rerankBaseUrlHint:
        "Enter the result-ranking model connection address supplied by the provider.",
      modelId: "Model ID",
      inputPrice: "Input price",
      priceUnit: "CNY / 1M tokens",
      embeddingApiKey: "Embedding API key",
      rerankApiKey: "Rerank API key",
      apiKeyConfiguredHint:
        "A key is configured. Enter a new key only to replace it.",
      apiKeyEndpointChangedHint:
        "The connection address changed, so the existing key will not be reused. Enter the matching key if the new address requires authentication.",
      apiKeyOptionalHint:
        "Leave blank if the provider does not require authentication. The key is not displayed after saving.",
      embeddingRuntime:
        "The system processes content at {{dimensions}} dimensions, with up to {{tokens}} tokens at a time.",
      rerankRuntime:
        "Processes up to {{tokens}} tokens at a time. If the service takes longer than {{timeout}} ms, this optimization is skipped.",
      rebuildHint:
        "After changing the embedding model, you must fully rebuild every knowledge-base index. Retrieval is temporarily unavailable until you finish the rebuild under System health.",
      embeddingChangeConfirmTitle:
        "Dangerous operation: change embedding model?",
      embeddingChangeConfirmDescription:
        "The embedding model determines how knowledge bases interpret and retrieve content. Saving this change invalidates all existing indexes. You must go to System health and fully rebuild every knowledge-base index; all knowledge-base retrieval remains unavailable until the rebuild finishes. The system does not start the rebuild automatically.",
      embeddingChangeDangerNotice:
        "Changing the embedding model is dangerous. A partial knowledge-base rebuild is not sufficient.",
      embeddingChangeConfirmAction: "Change model and save",
      rebuildRequiredTitle:
        "Embedding model switched; knowledge-base indexes must be rebuilt",
      rebuildRequiredDescription:
        "Go to System health and rebuild all knowledge-base indexes. Retrieval is temporarily unavailable until the rebuild finishes.",
      openSystemHealth: "Go to System health",
      validating: "Checking and saving…",
      save: "Save knowledge retrieval models",
      saved: "Knowledge retrieval model settings updated.",
      savedDescription:
        "New document processing and semantic retrieval will use this configuration.",
      savedAfterEmbeddingChangeDescription:
        "The model setting was saved. Go to System health and rebuild all knowledge-base indexes; retrieval is temporarily unavailable until it finishes.",
    },
    voiceTranscription: {
      title: "Speech-to-text model",
      description:
        "Configure the model service used for voice input transcription. Once enabled, regular tasks and embedded apps use these settings. The key is stored securely and never displayed again.",
      enabled: "Enable speech to text",
      provider: "Model provider",
      providerHint:
        "Choose the speech-to-text service you have activated and want to use.",
      providerPlaceholder: "Select a model provider",
      providers: {
        dashscope: "Alibaba Cloud Bailian",
        openai: "OpenAI",
        openai_compatible: "OpenAI-compatible service",
        azure_openai: "Azure OpenAI",
        groq: "Groq",
        deepgram: "Deepgram",
        assemblyai: "AssemblyAI",
        elevenlabs: "ElevenLabs",
        revai: "Rev.ai",
        gladia: "Gladia",
        fal: "fal.ai",
      },
      baseUrl: "Base URL",
      baseUrlHint:
        "Enter the speech-to-text connection address supplied by the provider.",
      apiVersion: "API version",
      apiVersionHint:
        "Enter the API version used by your Azure OpenAI deployment.",
      apiKey: "API key",
      apiKeyConfiguredHint:
        "A key is configured. Leave this blank to keep the existing key.",
      apiKeyRequiredHint:
        "A key is required when enabling this for the first time or after switching providers. It is never displayed again.",
      model: "Speech-to-text model name",
      modelHint: "Enter the model or deployment name supplied by the provider.",
      save: "Save speech-to-text model",
      saving: "Saving…",
      saved: "Speech-to-text model settings updated.",
    },
    imageGeneration: {
      title: "Image generation model",
      description:
        "Configure the model service used to generate images. Once enabled, the system uses these settings for image creation. The key is stored securely and never displayed again.",
      enabled: "Enable image generation",
      provider: "Model provider",
      providerHint:
        "Choose the image generation service you have activated and want to use.",
      providerPlaceholder: "Select a model provider",
      providers: {
        alibaba_bailian: "Alibaba Cloud Bailian",
        openai: "OpenAI",
        google_gemini: "Google Gemini",
        stability: "Stability AI",
        fal: "fal.ai",
        replicate: "Replicate",
        together: "Together AI",
      },
      baseUrl: "Base URL",
      baseUrlHint:
        "Filled automatically for the selected provider. No manual editing is needed.",
      workspaceId: "Bailian Workspace ID",
      workspaceIdHint:
        "Connects to your dedicated workspace in Alibaba Cloud Bailian.",
      region: "Bailian region",
      regionHint:
        "Choose the region where the service is active. Beijing is used by default.",
      apiKey: "API key",
      apiKeyConfiguredHint:
        "A key is configured. Leave this blank to keep the existing key.",
      apiKeyRequiredHint:
        "A key is required when enabling this for the first time or after switching providers. It is never displayed again.",
      model: "Image generation model name",
      modelHint:
        "Enter the model name supplied by the provider, such as qwen-image-3.0.",
      pricePerImage: "Price per image",
      pricePerImageHint:
        "Used to track image generation costs. Unit: CNY per image.",
      save: "Save image generation model",
      saving: "Saving…",
      saved: "Image generation model settings updated.",
    },
    imageUnderstanding: {
      title: "Document image understanding",
      description:
        "When enabled, the system understands images in documents and uses that information in knowledge retrieval. The original document content is not changed.",
      selectionDescription:
        "When enabled, the system understands document images so users can find information shown inside them. Choose a chat model that supports image understanding.",
      noImageModels:
        "No image-capable model is available. Turn on Supports image understanding for a chat model under Model channels first.",
      selectModel: "Select image-understanding model",
      selectModelHint:
        "The system checks that the selected model can recognize images when you save.",
      modelPlaceholder: "Select an image-understanding model",
      enabled: "Enable during processing",
      provider: "Model provider",
      providerPlaceholder: "Select a model provider",
      providers: {
        openai: "OpenAI",
        azure_openai: "Azure OpenAI",
        anthropic: "Anthropic",
        google: "Google Gemini",
        google_vertex: "Google Vertex AI",
        alibaba: "Alibaba / Qwen",
        deepseek: "DeepSeek",
        openrouter: "OpenRouter",
        openai_compatible: "OpenAI-compatible / vLLM",
      },
      model: "Multimodal model ID",
      modelHint:
        "Choose a model confirmed to support image understanding. The system checks availability when you save.",
      baseUrl: "Base URL",
      baseUrlRequiredHint:
        "Enter the complete connection address supplied by the provider.",
      baseUrlOptionalHint: "Leave blank to use the provider's default address.",
      apiKey: "API key",
      apiKeyConfiguredHint:
        "A key is configured. Leave this blank to keep the existing key.",
      apiKeyRequiredHint:
        "A key is required when enabling this for the first time and is never displayed again.",
      project: "Vertex project ID",
      location: "Vertex location",
      activeStrategy: "The current model passed the image-understanding check.",
      strategyAfterValidation:
        "The system checks the selected model's image-understanding capability after you save.",
      validating: "Checking and saving…",
      save: "Save image-understanding settings",
      saved:
        "Image-understanding settings updated. New processing and rebuilds will use this configuration.",
    },
    authSettings: {
      smtpTitle: "Authentication email",
      smtpDescription:
        "Configure the SMTP service used for first-time password setup and password reset email. Connection checks remain on System health.",
      oidcTitle: "OIDC sign-in",
      oidcDescription:
        "Configure the standard OIDC authorization-code flow. Successful sign-in still matches only an existing enabled user by email.",
      teamsTitle: "Teams sign-in",
      teamsDescription:
        "Configure the Microsoft Entra tenant and application identifiers used for Teams Tab single sign-on.",
      modeLabel: "Configuration source",
      modes: {
        inherit: "Inherit deployment environment",
        managed: "Manage in system settings",
        disabled: "Disable this feature",
      },
      modeNotices: {
        inherit:
          "The deployment environment is currently used. Re-enter the secret when switching to system management.",
        disabled:
          "This feature is explicitly disabled and does not fall back to deployment configuration.",
      },
      status: {
        configured: "Configured",
        notConfigured: "Not configured",
        invalid: "Invalid configuration",
      },
      smtpHost: "SMTP host",
      smtpPort: "SMTP port",
      smtpSecurity: "Connection security",
      starttls: "STARTTLS",
      tls: "Direct TLS",
      smtpFrom: "From address",
      smtpUsername: "Username",
      smtpUsernameHint:
        "Leave blank when the SMTP service requires no authentication.",
      smtpPassword: "Password",
      oidcIssuer: "Issuer URL",
      oidcClientId: "Client ID",
      oidcClientSecret: "Client secret",
      oidcRedirectUri: "Redirect URI",
      oidcRedirectHint:
        "Register this fixed URI with the OIDC provider. It cannot be changed here.",
      teamsTenantId: "Tenant ID",
      teamsClientId: "Application (client) ID",
      teamsExternalHint:
        "Use the same application ID in Microsoft Entra and the Teams app manifest, expose the API, and complete required consent.",
      secretPreserved: "A secret is stored. Leave this blank to keep it.",
      secretRequired:
        "Re-enter the secret when switching to system management.",
      secretRequiredWhenUsed: "A password is required when a username is set.",
      saved: "Authentication settings updated and applied immediately.",
      confirmTitle: "Change the configuration source?",
      confirmDescription:
        "Continuing stops use of the current configuration. Disabling a sign-in method can lock out users who rely on it.",
    },
    editUser: "Edit user",
    userSaved: "User saved.",
    enableUserNamed: "Enable user {{name}}",
    disableUserNamed: "Disable user {{name}}",
    userEnabled: "Enabled user {{name}}.",
    userDisabled: "Disabled user {{name}}.",
    userStatusSelfLocked: "Administrators cannot enable or disable themselves.",
    lastEnabledAdminStatusLocked:
      "At least one enabled administrator must remain.",
    userStatusVerifyingAdmins:
      "Checking the enabled administrator count. Please wait.",
    emailUpdated: "Email updated. The user must sign in again.",
    accountMetadata: "Account and resource metadata",
    passwordUpdated: "Password updated",
    personalPlugins: "Personal plugins",
    personalSkills: "Personal Skills",
    personalCredentials: "Personal credentials",
    noPasswordNotice:
      "Administrators cannot set, view, import, or reset user passwords. New users can sign in with SSO, Teams, or the forgot-password flow.",
    userPrivilegeChangeWarning:
      "This immediately revokes the user's sessions. Disabling the user also cancels pending requests that have not started. You cannot disable or demote yourself, and at least one enabled administrator must remain.",
    userSearchPlaceholder: "Search name or email…",
    downloadTemplate: "Download Excel template",
    chooseExcel: "Choose Excel file",
    templateFilename: "{{productPrefix}}-user-import-template.xlsx",
    importDescription:
      "Use the Excel template for name, email, role, and user groups. Its Instructions sheet includes sample data. The template has no password field, and invalid rows are reported separately.",
    importSubmit: "Start import",
    importResult: "Import result",
    importCounts: "Imported {{imported}} and skipped {{skipped}}.",
    importErrorRow: "Row {{row}}: {{message}}",
    editGroup: "Edit user group",
    deleteGroupTitle: "Permanently delete this user group?",
    importErrors: {
      duplicateInFile: "The Excel workbook contains a duplicate email address.",
      emailExists: "The email is already used by an existing user.",
      groupNotFound: "The specified user group does not exist.",
      invalidEmail: "The email format is invalid.",
      invalidRole: "Role must be user or admin.",
      invalidName: "The name is missing or invalid.",
      invalidRow: "A field value is invalid.",
    },
    parentDeleteDescription:
      "Related memberships and knowledge-base grants will be permanently deleted. This action cannot be undone.",
    auditSearchPlaceholder:
      "Search task ID, user, plugin/Skill, or error code…",
    dateFrom: "Start date",
    dateTo: "End date",
    auditDataSurfaces: "Audit data scope",
    auditSurfaces: {
      events: "Permanent audit log",
      conversations: "Task execution metadata",
      retainedArtifacts: "Deleted-task artifacts",
    },
    auditConversationDescription:
      "Shows redacted cross-user execution summaries without titles, messages, file content, complete events, or download links.",
    auditConversationSearchPlaceholder:
      "Search task ID, user, plugin/Skill, or error code…",
    advancedFilters: "More filters",
    pluginName: "Plugin name",
    skillName: "Skill name",
    errorCode: "Error code",
    runnerStatus: "Runner status",
    archiveStatus: "Archive status",
    createdFrom: "Created from",
    createdTo: "Created to",
    lastRunFrom: "Last run from",
    lastRunTo: "Last run to",
    auditConversationsEmpty: "No matching task execution metadata.",
    retainedArtifactsDescription:
      "Shows only redacted summaries of permanently retained artifacts from deleted tasks. Content viewing, recovery, and downloads are unavailable.",
    retainedArtifactsSearchPlaceholder:
      "Search task ID, owner ID, or deletion time…",
    retainedArtifactsEmpty: "No matching deleted-task artifact summaries.",
    conversation: "Task ID",
    owner: "Owner",
    capabilitiesUsed: "Plugins/Skills used",
    files: "File metadata",
    execution: "Execution summary",
    lastRun: "Last run",
    activeConversation: "Not archived",
    archivedConversation: "Archived",
    attachmentsSummary: "{{count}} attachments · {{size}}",
    artifactsSummary: "{{count}} artifacts · {{size}}",
    runnerStatuses: {
      initialized: "Runner initialized",
      not_started: "Runner not started",
      available: "Runner available",
      unavailable: "Runner unavailable",
    },
    executionError: "Execution error",
    errorTypes: { codex_turn: "Task execution error" },
    retainedArtifactCount: "Retained artifacts",
    totalSize: "Total size",
    checksum: "Checksums present",
    deletedAt: "Task deleted",
    editableSettings: "Editable product settings",
    deploymentReadOnly:
      "Infrastructure, authentication, secrets, concurrency, and file limits are deployment-managed. Only redacted status is shown here.",
  },
  health: {
    title: "System health",
    description:
      "Read-only summary of {{productName}} services and managed directories.",
    overall: "Overall status",
    checkedAt: "Checked",
    runningTurns: "Running turns",
    processes: "app-server processes",
    concurrency: "Concurrency limit",
    healthy: "Healthy",
    warning: "Warning",
    unavailable: "Unavailable",
    notConfigured: "Not configured",
    notObserved: "Not observed",
    degraded: "Degraded",
    available: "Available",
    cleanupFailures: "Cleanup failures",
    cleanupDescription:
      "Automatic retries have stopped for these resources. Retrying only handles the affected task and does not interrupt other active tasks.",
    retryCleanup: "Retry cleanup",
    retryAllCleanup: "Retry all",
    retryingCleanup: "Retrying cleanup",
    cleanupRetryAllConfirmTitle: "Retry all failed cleanup",
    cleanupRetryAllConfirmDescription:
      "The system will reconcile and retry each item. An affected task that is still active will be deferred, and other tasks will not be interrupted.",
    cleanupAttempts: "Attempted {{current}} / {{total}} times",
    cleanupFailed: "Needs attention",
    cleanupStages: {
      reconcile: "Reconciling resource state",
      stop_runtime: "Safely stopping the affected task",
      delete_workspace: "Removing task files",
      delete_control: "Removing task runtime state",
      verify_absent: "Verifying cleanup",
    },
    cleanupReasons: {
      CLEANUP_RUNNER_UNAVAILABLE:
        "The cleanup service is temporarily unavailable",
      CLEANUP_RUNTIME_ACTIVE:
        "The affected task is still active and its resources were protected",
      CLEANUP_RUNTIME_STATE_UNCERTAIN:
        "The task could not yet be confirmed as safely stopped",
      CLEANUP_PERMISSION_DENIED:
        "The resource could not be removed; check storage permissions",
      CLEANUP_PATH_BOUNDARY_INVALID:
        "The resource location could not be validated",
      CLEANUP_DIRECTORY_REMOVE_FAILED:
        "The task files could not be fully removed",
      CLEANUP_VERIFICATION_FAILED: "The cleanup result could not be verified",
      CLEANUP_QUEUE_UNAVAILABLE: "The cleanup request could not be queued",
      CLEANUP_OPERATION_FAILED: "Resource cleanup did not complete",
      unknown: "Resource cleanup did not complete",
    },
    resources: {
      title: "Service resource usage",
      description:
        "Live CPU, memory, and process usage for Docker-deployed service containers.",
      empty: "No Docker service resource usage has been observed.",
      cpu: "CPU",
      memory: "Memory",
      containers: "{{running}} / {{total}} containers running",
      pids: "PIDs {{count}}",
      state: "State {{state}}",
      checkedAt: "Resource sampled",
      status: {
        available: "Observed",
        unavailable: "Unavailable",
        notObserved: "Not observed",
      },
      reasons: {
        unavailable:
          "Docker resource snapshots cannot be read. Check the runner controller Docker socket mount and permissions.",
        notObserved:
          "No usable Docker container resource snapshot has been observed.",
      },
      services: {
        api: "API container",
        runner: "Runner controller",
        workerPool: "Runner worker pool",
        web: "Web container",
        gateway: "Gateway container",
        postgres: "PostgreSQL container",
        redis: "Redis container",
        postgresBackup: "PostgreSQL backup container",
        migrate: "Migration container",
        backupInit: "Backup init container",
        storageInit: "Storage init container",
        runnerWorkerImage: "Worker image build container",
      },
    },
    knowledgeRebuild: {
      title: "Full knowledge vector-index rebuild",
      description:
        "Explicit maintenance for embedding-model or vector-dimension changes. Only deployment-wide aggregate progress is shown.",
      action: "Start full rebuild",
      retry: "Retry manually",
      empty: "No deployment-wide knowledge rebuild has been started.",
      confirmTitle: "Confirm full knowledge vector-index rebuild",
      confirmDescription:
        "This always covers every non-deleted document, including archived knowledge bases, and pauses global vector search while it runs.",
      confirmWarning:
        "This clears and recreates the knowledge vector index. It does not delete original files, Docling results, or parsed content, and the previous index cannot be rolled back.",
      confirmAction: "Confirm and start rebuild",
      reason: "Reason",
      reasonHint: "Required. The reason is recorded in a redacted audit entry.",
      total: "Total",
      succeeded: "Succeeded",
      failed: "Failed",
      errorSummary: "Stable error code: {{code}}",
      status: {
        pending: "Pending",
        queued: "Queued",
        running: "Running",
        completed: "Completed",
        failed: "Failed",
      },
      stage: {
        queued: "Waiting to start",
        preparing: "Preparing the full rebuild",
        recreating_index: "Recreating the vector index",
        rebuilding_documents: "Rebuilding all document indexes",
        validating: "Validating rebuild results",
        activating: "Activating the new index",
        completed: "Full rebuild completed",
        failed: "Full rebuild failed",
        processing: "Processing the full rebuild",
      },
    },
    components: {
      api: "API service",
      public_url: "Connection security",
      database: "Database",
      redis: "Redis and local sign-in protection",
      running_turn_capacity: "Running-turn capacity",
      running_turn_recovery: "Running-turn recovery",
      smtp: "Authentication email",
      auth_email: "Password email feature",
      local_password_login: "Local password sign-in",
      runner: "Runner",
      workspace: "Workspace root",
      capability_root: "Plugin/Skill installation root",
      oidc: "OIDC sign-in",
      teams: "Teams sign-in",
      workspace_root: "Workspace root",
      document_parsing: "Knowledge document parsing",
      knowledge_search_and_indexing: "Knowledge search and indexing",
      rerank: "Knowledge result reranking",
    },
    reasons: {
      public_url_insecure:
        "This site is using HTTP, so sign-in details, conversations, and files are not encrypted in transit. Core features remain available; configure HTTPS before exposing it to the internet.",
      auth_https_required:
        "This site is using HTTP. Configure HTTPS to use OIDC or Teams sign-in.",
      not_configured: "This optional feature is not configured.",
      not_observed:
        "No successful shared recovery cycle has been observed yet.",
      connection_failed:
        "The connection check failed. Check the deployment configuration and service.",
      read_write_failed:
        "The directory read/write check failed. Check mounts and permissions.",
      login_protection_unavailable:
        "Redis is unavailable, so local sign-in protection and local password sign-in are unavailable.",
      email_unavailable:
        "New first-time password and password-reset email requests are unavailable.",
      available: "The check passed.",
      document_parsing_unavailable:
        "Document parsing is unavailable. Check the Docling Serve configuration and service.",
      knowledge_search_and_indexing_unavailable:
        "Knowledge search and indexing are unavailable. Check Elasticsearch, the embedding model configuration, and their services.",
      embedding_dimension_mismatch:
        "The embedding output dimension does not match the Elasticsearch vector-index dimension. Correct the configuration and manually rebuild the vector index.",
      rerank_unavailable:
        "Result reranking is unavailable. Check the reranking model configuration and service.",
    },
    cleanupTypes: {
      workspace: "Task workspace",
      codex_home: "User runtime directory",
      object_storage: "Object-storage resource",
      capability_directory: "Plugin/Skill directory",
    },
  },
  statuses: {
    idle: "Idle",
    running: "Running",
    pending: "Pending",
    completed: "Completed",
    failed: "Failed",
    declined: "Declined",
    interrupted: "Interrupted",
    active: "Active",
    disabled: "Disabled",
    approved: "Approved",
    rejected: "Rejected",
    pendingApproval: "Pending approval",
    revoked: "Revoked",
    cancelled: "Cancelled",
    success: "Success",
    failure: "Failure",
  },
  validation: {
    required: "This field is required.",
    email: "Enter a valid email address.",
    passwordMismatch: "The passwords do not match.",
    riskRequired: "Review and confirm the source and risk notice first.",
  },
  errors: {
    feishu: {
      connectionNotFound:
        "The Feishu connection was not found. Connect it again.",
      connectionConflict:
        "The Feishu connection changed. Refresh and try again.",
      registrationNotFound:
        "The Feishu connection QR code expired. Generate a new one.",
      registrationUnavailable:
        "Feishu cannot create the bot automatically right now. Try again later.",
      protocolInvalid:
        "Feishu returned unrecognized connection data. Reconnect or contact an administrator.",
      coordinationUnavailable:
        "Feishu connection state is temporarily unavailable. Try again later.",
    },
    automationNotFound: "The automation was not found.",
    automationLimitReached:
      "You have reached the automation limit. Delete an automation you no longer need and try again.",
    automationTaskNotPinned:
      "Automations can only use active pinned tasks owned by your account.",
    automationTaskInUse:
      "This task is still used by an automation. Delete or reassign the automation first.",
    conversationOrderConflict:
      "The task list changed. Refresh it before sorting again.",
    unknown: "The operation could not be completed. Try again later.",
    networkUnavailable:
      "The service could not be reached. Check your network and try again.",
    invalidResponse:
      "The service returned invalid data. Contact an administrator.",
    imageUnderstanding: {
      validationFailed:
        "The image-understanding model failed image input, structured output, or thinking-disable validation. Check the model and provider configuration.",
    },
    imageGeneration: {
      notConfigured:
        "The image generation model is not configured or is not enabled.",
      forbidden: "This task cannot call image generation.",
      turnInactive:
        "The current task run has ended and cannot continue generating images.",
      providerRejected:
        "The image generation provider rejected the request. Check the model, prompt, or key configuration.",
      outputInvalid:
        "The image generation provider did not return a usable image. Retry or check the provider configuration.",
      unavailable:
        "Image generation is temporarily unavailable. Try again later.",
    },
    authInvalidCredentials: "Invalid email or password.",
    authRateLimited: "Too many login attempts. Please try again later.",
    authProtectionUnavailable:
      "Login protection is temporarily unavailable. Please try again later.",
    sessionExpired: "Your session has expired. Please sign in again.",
    passwordPolicy:
      "Password must be 8–16 characters and include uppercase, lowercase, a number, and punctuation or a symbol.",
    passwordEmailUnavailable:
      "The password setup or reset email service is temporarily unavailable. Try again later, or use SSO or Teams if configured.",
    passwordResetDeliveryFailed:
      "The secure link could not be sent. Please try again later.",
    passwordResetProtectionUnavailable:
      "Password request protection is temporarily unavailable. Please try again later.",
    auth: {
      registrationProtectionUnavailable:
        "Registration request protection is temporarily unavailable. Please try again later.",
    },
    passwordResetInvalid:
      "The password setup link is invalid or has expired. Request a new one.",
    concurrencyLimit:
      "The system is currently at capacity. Please try again later.",
    pendingLimit:
      "The pending request limit has been reached. Handle an existing request first.",
    pendingNotHead: "Only the first pending request can be continued.",
    interruptFailed: "Unable to interrupt the current run. Please try again.",
    conversation: {
      collaborationModeUnavailable:
        "Plan mode cannot be changed while the task is running, has queued requests, has an active Goal, or is bound to an automation.",
      compactionUnavailable:
        "Context can only be compacted after the current task has stopped.",
      userInputRequestUnavailable:
        "This question has already ended or expired. Refresh the task and try again.",
      planReviewPending:
        "Implement, revise, skip, or exit the current plan before continuing.",
      planReviewUnavailable:
        "This plan review has already ended or is no longer available. Refresh the task and try again.",
      planOutputMissing:
        "Plan mode did not produce a plan you can review. Start the request again.",
      steerRequestFailed:
        "Unable to guide the current run. Confirm it is still running and try again.",
      steerRequestUncertain:
        "The guide request result is temporarily uncertain. Keep the current input and retry to reconcile it.",
    },
    composer: {
      voiceTranscriptionFailed:
        "Speech-to-text failed. Try again or enter the text manually.",
      voiceTranscriptionRateLimited:
        "Voice input can be used up to 20 times per minute. Try again shortly.",
    },
    mcp: {
      insecureHttpAcknowledgementRequired:
        "You must acknowledge the unencrypted transport risk before using an HTTP MCP server.",
      credentialRequired:
        "A credential is required for this authentication method.",
      destinationForbidden:
        "This MCP destination cannot be accessed. Cloud deployments allow only public HTTP or HTTPS addresses.",
      connectionFailed:
        "The MCP server could not be connected and initialized. Check its URL, credential, and availability.",
    },
    clawhub: {
      skillNotFound: "The skill was not found in the skill repository.",
      skillNotInstallable:
        "This skill cannot currently be installed. Check its availability and security status.",
      skillAlreadyInstalled: "You have already installed this skill.",
      serviceUnavailable:
        "The skill could not be fetched from ClawHub. Try again later.",
      installPreviewBusy:
        "Another skill installation preview is being prepared. Wait for it to finish and try again.",
      installPreviewRateLimited:
        "Too many installation previews were requested. Try again later.",
      installPreviewQuotaExceeded:
        "The active skill installation preview limit has been reached. Try again later.",
      packageIntegrityFailed:
        "ClawHub skill file integrity verification failed. Installation was blocked.",
    },
    feedback: {
      submissionInvalid:
        "The feedback text or images do not meet the requirements. Check them and try again.",
      submissionFailed:
        "Feedback could not be submitted right now. Try again later.",
    },
    knowledge: {
      archiveRequired: "Only archived knowledge bases can be deleted.",
      inUse:
        "This knowledge base is still used by applications. Remove it from those applications first.",
      archived:
        "This knowledge base is archived. Restore it before performing this action.",
      disabled: "This knowledge base is disabled.",
      quotaExceeded:
        "This knowledge base does not have enough storage for the file.",
      duplicate:
        "A document with identical content already exists in this knowledge base.",
      nameConflict:
        "A document with the same name already exists in this knowledge base.",
      actionConflict:
        "The document's current state does not allow this action. Refresh and try again.",
      activating: "The new index is being activated. Try again shortly.",
      unsupportedFormat: "This document format is not supported.",
      fileTooLarge: "The document exceeds the per-file size limit.",
      processingFailed: "Document processing failed. Retry or reprocess it.",
      previewUnavailable:
        "The original preview is unavailable right now. Try again later.",
      embeddingConfiguration:
        "The embedding model configuration is invalid. Contact an administrator.",
    },
    knowledgeModel: {
      validationFailed:
        "The knowledge embedding or rerank model failed validation. Check the endpoint, key, model ID, and vector dimensions.",
      authenticationFailed:
        "The model service did not accept the current API key. If you changed the Base URL, enter a valid key for the new endpoint.",
      serviceUnavailable:
        "The model service rejected the validation request or is unavailable. Check the Base URL, model ID, network, and service status.",
      responseInvalid:
        "The model response is incompatible. Check the API compatibility, model ID, and embedding vector dimensions.",
      notConfigured:
        "An administrator has not configured the knowledge embedding model yet.",
    },
    knowledgeSource: {
      notConfigured:
        "The SharePoint knowledge source has not been configured by an administrator.",
      credentialValidationFailed:
        "SharePoint application authentication failed. Check the tenant, application ID, and secret.",
      urlInvalid:
        "The SharePoint folder URL is invalid or does not belong to the configured tenant domain.",
      folderNotFound:
        "The SharePoint folder could not be accessed. Check the URL and site permission assignment.",
      alreadyConnected:
        "This SharePoint folder is already connected to another knowledge base.",
      notFound: "The knowledge-base source was not found.",
      syncUnavailable:
        "SharePoint synchronization is temporarily unavailable and will be retried on schedule.",
      itemSyncFailed:
        "Some SharePoint documents failed to synchronize and will be retried on schedule.",
    },
    application: {
      notFound: "The application does not exist or you cannot access it.",
      disabled: "The application is disabled and cannot start new tasks.",
      dependencyUnavailable:
        "The application's model, plugin/Skill, or knowledge base is unavailable.",
      grantTargetInvalid:
        "Applications can only be shared with valid users or groups in the organization.",
      grantConflict:
        "This user or group already has access to the application.",
      packageInvalid:
        "The interactive application package is invalid. Check manifest.json, index.html, and the file structure.",
      packageVersionConflict:
        "This application package version has already been imported. Update the version number.",
      customEventInvalid:
        "The custom event name or payload does not match the application contract.",
    },
    credentialConflict:
      "Credential bindings conflict. Select an explicit credential before continuing.",
    credentialRequired:
      "A required credential is missing. Bind a credential before continuing.",
    avatarInvalid:
      "Avatar upload failed. Choose a supported image and try again.",
    applicationIconInvalid:
      "Application icon upload failed. Choose a supported image and try again.",
    capabilityLogoInvalid:
      "Logo upload failed. Choose a supported image and try again.",
    productLogoInvalid:
      "System logo upload failed. Choose a supported image and try again.",
    invalidPackage:
      "The plugin/Skill package is invalid or missing required files.",
    withReason: "{{message}} Reason: {{reason}}",
    importReasons: {
      archive_size_invalid: "The archive is empty or exceeds the size limit.",
      archive_unreadable:
        "The archive could not be read. Make sure it is a valid zip file.",
      archive_entry_count_invalid:
        "The archive is empty or contains too many files.",
      archive_path_invalid:
        "The archive contains an unsafe or invalid path: {{path}}.",
      archive_entry_symlink:
        "The archive contains a symbolic link, which cannot be imported: {{path}}.",
      archive_entry_too_large:
        "A file inside the archive is too large: {{path}}.",
      archive_compression_ratio_exceeded:
        "A file inside the archive has an abnormal compression ratio and may be unsafe: {{path}}.",
      archive_expanded_size_exceeded:
        "The archive exceeds the total extracted size limit.",
      archive_entry_read_failed:
        "A file inside the archive could not be read: {{path}}.",
      package_manifest_count_invalid:
        "The package must contain exactly one required entry file: SKILL.md or plugin.json.",
      package_multiple_roots:
        "The archive must contain a single root directory, but multiple roots were found.",
      package_json_invalid: "The plugin manifest is invalid.",
      plugin_mcp_configuration_invalid:
        "The plugin MCP configuration is invalid.",
      skill_frontmatter_missing:
        "SKILL.md is missing frontmatter or the required name field.",
      skill_display_name_invalid:
        "The skill display name is invalid. Use a single line of up to 64 characters.",
      skill_name_invalid:
        "Skill name {{value}} is invalid. Use lowercase letters, numbers, and hyphens only, with a maximum length of 64.",
      plugin_unsupported_component:
        "The plugin contains a component type that is not supported yet.",
      plugin_skills_invalid:
        "A Skill declared by the plugin is invalid or missing SKILL.md.",
      plugin_declared_path_invalid:
        "The plugin declares an invalid file path: {{path}}.",
      logo_file_invalid: "The logo file is invalid or exceeds the size limit.",
      requested_type_mismatch:
        "The selected type is {{expected}}, but the archive contains {{actual}}.",
    },
    importFailed:
      "The plugin/Skill import failed. Check the source and try again.",
    capabilityUpdateConflict:
      "This skill has changed. Reopen the update dialog and review the latest content before submitting.",
    capabilityUpdateUnchanged:
      "The content is identical to the current skill. No update is needed.",
    capabilityHomeSyncFailed:
      "The plugin/Skill state was saved, but the user directory could not be synchronized. The system will retry before the next task turn.",
    attachmentInvalid:
      "The attachment upload failed. Choose a readable file and try again.",
    attachmentTemporaryFileSkipped:
      "Temporary files were skipped. Choose another meaningful file.",
    fileLimitExceeded:
      "The file size or attachment count exceeds the allowed limit.",
    artifactNotFound: "The artifact was not found.",
    downloadForbidden: "You do not have permission to download this artifact.",
    runnerUnavailable: "The execution service is unavailable. Try again later.",
    turnStartClosed: errorCatalog.TURN_START_CLOSED.messages["en-US"],
    deploymentStopped:
      "This task was stopped for a system update. Existing content was kept. Review its progress before continuing manually.",
    creditLimitExceeded:
      "Your available credit quota is exhausted and you cannot start a new task right now.",
    lastAdminRequired:
      "At least one enabled administrator must remain. This operation cannot be completed.",
    lastModelRequired:
      "At least one chat model must remain available in conversations.",
    modelProvider: {
      inUseBySystemSetting:
        "This model is used by a system setting. Change or clear that selection before deleting it.",
      managementDisabled:
        "Model configuration is locked by the deployment environment and is read-only.",
    },
    adminSelfChangeForbidden:
      "Administrators cannot disable or demote themselves.",
    emailExists: "This email address is already used by another user.",
    settingsInvalid: "The system setting is invalid or cannot be changed here.",
    deploymentReadOnly:
      "This setting is managed by deployment configuration and is read-only.",
    systemAlreadyInitialized: "The system has already been initialized.",
    systemInitializationCredentialInvalid:
      "The initialization credential is invalid. Use the one-time credential shown after installation.",
    teamsFailed: "Teams sign-in failed. Retry or use another sign-in method.",
    codexTurnFailed: "This run failed. You can adjust the input and try again.",
    turnCompletedWithoutOutput:
      "This run finished without producing displayable output. Run it again.",
    automation: {
      emptyResult:
        "The automation finished without producing displayable output. Run it again.",
      expired: "This automation has expired and can no longer run.",
    },
    userDisabled: "This user is disabled. Contact an administrator.",
    conflict:
      "The current state conflicts with this action. Refresh and try again.",
    forbidden: "You do not have permission to perform this action.",
    notFound:
      "The requested resource does not exist or is not available to you.",
    validation: "The submitted data is invalid. Check it and try again.",
  },
  loginMethods: {
    password: "Local password",
    oidc: "Single sign-on",
    teams: "Teams SSO",
  },
} as const
