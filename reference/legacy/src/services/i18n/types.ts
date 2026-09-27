/**
 * ============================================================================
 * LegacyLock 国际化 (i18n) 类型规范定义
 * ============================================================================
 */

export type SupportedLanguage = "en" | "zh" | "ja";

export interface LanguageOption {
  code: SupportedLanguage;
  name: string;
  nativeName: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "zh", name: "Chinese (Simplified)", nativeName: "简体中文" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
];

export interface TranslationDictionary {
  brand: {
    title: string;
    sub: string;
    coldStorage: string;
  };
  nav: {
    coreGroup: string;
    devGroup: string;
    infraGroup: string;
    personalGroup: string;
    sysGroup: string;
    all: string;
    login: string;
    note: string;
    identity: string;
    card: string;
    password: string;
    document: string;
    sshKey: string;
    apiCredential: string;
    cryptoWallet: string;
    server: string;
    router: string;
    email: string;
    membership: string;
    importExport: string;
    settings: string;
  };
  topBar: {
    addNew: string;
    searchPlaceholder: string;
    theme: string;
    usbPassword: string;
    healthCheck: string;
    lockNow: string;
    rescanDrives: string;
    scanning: string;
    readOnlyBanner: string;
    takeoverBtn: string;
    heirModeBadge: string;
    ownerModeBadge: string;
    trialBadge: string;
    vipBadge: string;
    expiredBadge: string;
    manageSub: string;
    upgradeSub: string;
  };
  itemCard: {
    emptyTitle: string;
    emptyDesc: string;
    emptyBtn: string;
    copyUser: string;
    copyPass: string;
    copied: string;
    show: string;
    hide: string;
    edit: string;
    delete: string;
    deleteConfirm: string;
    notes: string;
    customFields: string;
    attachments: string;
    download: string;
    website: string;
    created: string;
    updated: string;
  };
  categoryPicker: {
    title: string;
    subtitle: string;
    searchPlaceholder: string;
    allAssets: string;
    popularTab: string;
    techTab: string;
    financeTab: string;
    docsTab: string;
    searchFoundPrefix: string;
    searchFoundSuffix: string;
    returnAll: string;
    emptyTitle: string;
    emptyDesc: string;
    resetBtn: string;
  };
  itemModal: {
    viewTitlePrefix: string;
    editTitle: string;
    newTitlePrefix: string;
    readOnlyBadge: string;
    readOnlyBanner: string;
    titleLabel: string;
    titlePlaceholder: string;
    categoryLabel: string;
    usernameLabel: string;
    usernamePlaceholder: string;
    passwordLabel: string;
    passwordPlaceholder: string;
    generatePassBtn: string;
    urlLabel: string;
    urlPlaceholder: string;
    notesLabel: string;
    notesPlaceholder: string;
    heirNotesLabel: string;
    heirNotesPlaceholder: string;
    customFieldsTitle: string;
    addFieldBtn: string;
    attachmentsTitle: string;
    uploadAttachmentBtn: string;
    deleteItemBtn: string;
    cancelBtn: string;
    closeViewBtn: string;
    saveChangesBtn: string;
    createItemBtn: string;
    heirReadOnlyTakeover: string;
    upgradeBtn: string;
  };
  categories: Record<string, { name: string; desc: string }>;
  common: {
    save: string;
    cancel: string;
    confirm: string;
    close: string;
    loading: string;
    success: string;
    error: string;
    warning: string;
    offline: string;
    online: string;
    enabled: string;
    disabled: string;
    yes: string;
    no: string;
    daysRemaining: string;
  };
}
