import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

/**
 * i18n foundation: en + ar bundles, language persisted to localStorage,
 * document dir/lang kept in sync (ar flips the whole app to RTL — the
 * stylesheet uses logical properties so layout mirrors automatically).
 *
 * Convention: nav.* for the shell, work.* for the Work screen, common.*
 * for shared verbs. New screens add their own namespace as they are
 * translated; untranslated literals keep working (fallback en).
 */

const en = {
  translation: {
    nav: {
      overview: 'Overview',
      newRequest: 'New request',
      myRequests: 'My requests',
      work: 'Work',
      projects: 'Projects',
      correspondence: 'Correspondence',
      insights: 'Insights',
      assets: 'IT assets',
      pmoAdmin: 'PMO Admin',
      admin: 'Admin console',
      workspace: 'Workspace',
      administration: 'Administration',
      signOut: 'Sign out',
    },
    work: {
      title: 'Work',
      subtitle: 'Everything that needs you — assigned items, your team’s queue, unrouted requests, and approvals — in one place.',
      myWork: 'My work',
      teamQueue: 'Team queue',
      unrouted: 'Unrouted',
      approvals: 'Approvals',
      savedViews: 'Saved views',
      team: 'Team',
      slaState: 'SLA state',
      breached: 'Breached',
      atRisk: 'At risk',
      paused: 'Paused',
      escalated: 'Escalated',
      assignee: 'Assignee',
      assignedToMe: 'Assigned to me',
      unassigned: 'Unassigned',
      priority: 'Priority',
      search: 'Search ref, title, requester…',
      sortSla: 'Sort: SLA due',
      sortNewest: 'Sort: Newest',
      sortPriority: 'Sort: Priority',
      comfortable: 'Comfortable',
      compact: 'Compact',
      saveView: 'Save view',
      saveViewAs: 'Save view as…',
      personal: 'personal',
      shown: '{{count}} shown',
      selected: '{{count}} selected',
      assignTo: 'Assign to…',
      setPriority: 'Priority…',
      moveToTeam: 'Move to team…',
      transition: 'Transition…',
      clearSelection: 'Clear selection',
      queueClear: 'Nothing here — the queue is clear.',
      unroutedClear: 'Nothing unrouted — routing rules are covering everything.',
      colRef: 'Priority · Ref',
      colRequest: 'Request',
      colAssignee: 'Assignee',
      colSla: 'SLA',
      colStatus: 'Status',
      assignToMe: 'Assign to me',
      handBack: 'Hand back',
      move: 'Move',
    },
    common: {
      loading: 'Loading…',
      back: '← Back',
      language: 'Language',
    },
  },
}

const ar = {
  translation: {
    nav: {
      overview: 'نظرة عامة',
      newRequest: 'طلب جديد',
      myRequests: 'طلباتي',
      work: 'العمل',
      projects: 'المشاريع',
      correspondence: 'المراسلات',
      insights: 'التحليلات',
      assets: 'أصول تقنية المعلومات',
      pmoAdmin: 'إدارة مكتب المشاريع',
      admin: 'وحدة التحكم',
      workspace: 'مساحة العمل',
      administration: 'الإدارة',
      signOut: 'تسجيل الخروج',
    },
    work: {
      title: 'العمل',
      subtitle: 'كل ما يحتاج إليك — المهام المسندة، قائمة فريقك، الطلبات غير الموجّهة، والموافقات — في مكان واحد.',
      myWork: 'عملي',
      teamQueue: 'قائمة الفريق',
      unrouted: 'غير موجّه',
      approvals: 'الموافقات',
      savedViews: 'طرق عرض محفوظة',
      team: 'الفريق',
      slaState: 'حالة اتفاقية الخدمة',
      breached: 'متجاوز',
      atRisk: 'معرض للخطر',
      paused: 'متوقف',
      escalated: 'مصعّد',
      assignee: 'المسند إليه',
      assignedToMe: 'مسند إليّ',
      unassigned: 'غير مسند',
      priority: 'الأولوية',
      search: 'ابحث بالرقم أو العنوان أو مقدم الطلب…',
      sortSla: 'الفرز: استحقاق الاتفاقية',
      sortNewest: 'الفرز: الأحدث',
      sortPriority: 'الفرز: الأولوية',
      comfortable: 'مريح',
      compact: 'مدمج',
      saveView: 'حفظ طريقة العرض',
      saveViewAs: 'حفظ باسم…',
      personal: 'شخصي',
      shown: 'عرض {{count}}',
      selected: '{{count}} محدد',
      assignTo: 'إسناد إلى…',
      setPriority: 'الأولوية…',
      moveToTeam: 'نقل إلى فريق…',
      transition: 'تغيير الحالة…',
      clearSelection: 'إلغاء التحديد',
      queueClear: 'لا شيء هنا — القائمة فارغة.',
      unroutedClear: 'لا توجد طلبات غير موجّهة — قواعد التوجيه تغطي كل شيء.',
      colRef: 'الأولوية · الرقم',
      colRequest: 'الطلب',
      colAssignee: 'المسند إليه',
      colSla: 'الاتفاقية',
      colStatus: 'الحالة',
      assignToMe: 'إسناد إليّ',
      handBack: 'إعادة',
      move: 'نقل',
    },
    common: {
      loading: 'جارٍ التحميل…',
      back: 'رجوع',
      language: 'اللغة',
    },
  },
}

export type Lang = 'en' | 'ar'

export function applyLang(lang: Lang) {
  void i18n.changeLanguage(lang)
  localStorage.setItem('lang', lang)
  document.documentElement.lang = lang
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
}

const initial = (localStorage.getItem('lang') as Lang | null) ?? 'en'

void i18n.use(initReactI18next).init({
  resources: { en, ar },
  lng: initial,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

document.documentElement.lang = initial
document.documentElement.dir = initial === 'ar' ? 'rtl' : 'ltr'

export default i18n
