import type { Locale } from "./types";

const copy = {
  ko: {
    brand: "지갑의 일기", overview: "요약", entries: "내역", statistics: "통계", people: "참여자", settle: "정산",
    recentEntries: "최근 기록", viewAll: "전체 보기", recordExpense: "지출 기록", dailyPurpose: "일상의 소비와 예산을 한눈에", travelPurpose: "함께 쓴 여행 경비, 간편한 정산",
    emptyTitle: "당신의 첫 번째 기록장", emptyBody: "일상의 소비도, 함께 떠난 여행도. 나에게 맞는 가계부로 시작해 보세요.",
    notebooks: "나의 가계부", monthlyBudget: "이번 달 예산", selectedMonthBudget: "월 예산", automationTitle: "카드·이체 자동기록", budgetNotSet: "예산을 정하고 소비를 살펴보세요", automationReview: "확인할 내역", automationOpen: "자동기록 관리",
    travelTotal: "여행에서 쓴 금액", peopleFirst: "함께 여행하는 사람을 추가해 주세요", peopleFirstHelp: "누가 결제했는지 기록하고 나눌 금액을 계산할 수 있어요.",
    sharePdf: "PDF 공유", mergeEntries: "내역 합치기", savePdf: "PDF 저장", monthlyCategories: "월별 카테고리", yearlyCategories: "연도별 카테고리", welcomeNote: "작은 기록이 만드는 여유", noRecentEntries: "아직 이번 달의 기록이 없어요", noRecentHelp: "첫 지출을 기록하면 소비 흐름이 보이기 시작해요.",
  },
  en: {
    brand: "Wallet Diary", overview: "Overview", entries: "Entries", statistics: "Insights", people: "People", settle: "Settle up",
    recentEntries: "Recent entries", viewAll: "View all", recordExpense: "Record expense", dailyPurpose: "Everyday spending and budgets at a glance", travelPurpose: "Shared travel expenses, simple settling up",
    emptyTitle: "Your first notebook", emptyBody: "Everyday spending or a trip together. Start with a notebook that fits your life.",
    notebooks: "My notebooks", monthlyBudget: "This month’s budget", selectedMonthBudget: "Monthly budget", automationTitle: "Payment auto-recording", budgetNotSet: "Set a budget to keep spending in view", automationReview: "Entries to review", automationOpen: "Manage auto-recording",
    travelTotal: "Spent on this trip", peopleFirst: "Add your travel companions", peopleFirstHelp: "Track who paid and calculate how much everyone owes.",
    sharePdf: "Share PDF", mergeEntries: "Merge entries", savePdf: "Save PDF", monthlyCategories: "Monthly categories", yearlyCategories: "Yearly categories", welcomeNote: "Small entries. A clearer picture.", noRecentEntries: "No entries this month yet", noRecentHelp: "Record your first expense to start seeing your spending habits.",
  },
  fr: {
    brand: "Journal du portefeuille", overview: "Résumé", entries: "Dépenses", statistics: "Statistiques", people: "Participants", settle: "Règlements",
    recentEntries: "Dépenses récentes", viewAll: "Tout voir", recordExpense: "Noter une dépense", dailyPurpose: "Dépenses et budget du quotidien en un clin d’œil", travelPurpose: "Frais de voyage partagés, comptes simplifiés",
    emptyTitle: "Votre premier carnet", emptyBody: "Les dépenses du quotidien ou un voyage à plusieurs. Commencez avec le carnet qui vous ressemble.",
    notebooks: "Mes carnets", monthlyBudget: "Budget du mois", selectedMonthBudget: "Budget mensuel", automationTitle: "Enregistrement automatique", budgetNotSet: "Fixez un budget pour suivre vos dépenses", automationReview: "Dépenses à vérifier", automationOpen: "Gérer l’enregistrement automatique",
    travelTotal: "Dépenses du voyage", peopleFirst: "Ajoutez vos compagnons de voyage", peopleFirstHelp: "Notez qui a payé et calculez la part de chacun.",
    sharePdf: "Partager le PDF", mergeEntries: "Fusionner", savePdf: "Enregistrer le PDF", monthlyCategories: "Catégories du mois", yearlyCategories: "Catégories de l’année", welcomeNote: "De petites notes pour y voir plus clair.", noRecentEntries: "Aucune dépense ce mois-ci", noRecentHelp: "Notez une première dépense pour découvrir vos habitudes.",
  },
} as const;

export function designText(locale: Locale, key: keyof typeof copy.en): string { return copy[locale][key]; }
