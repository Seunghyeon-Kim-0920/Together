import type { SupportedLocale } from "./domain";

export const LOCALE_NAMES: Readonly<Record<SupportedLocale, string>> = {
  ko: "한국어",
  en: "English",
  fr: "Français",
  ja: "日本語",
  zh: "简体中文",
};

const messages = {
  ko: {
    route: "경로", trips: "내 여행", expenses: "가계부", profile: "프로필", signIn: "로그인", signOut: "로그아웃",
    routeTitle: "여러 도시를, 가장 빠른 순서로.", routeDescription: "도심 이동, 터미널 대기, 체크인과 보안, 환승, 도착 후 이동까지 모두 더해 비교합니다.",
    cities: "여행할 도시", addCity: "도시 추가", searchCity: "도시 또는 국가 검색", departure: "출발일", fixedStart: "첫 도시에서 시작", findRoute: "가장 빠른 동선 찾기",
    optimizedOrder: "계산된 여행 순서", exactOptimization: "정확 최적화 · 최대 10개 도시", totalTravel: "총 이동", legs: "구간", estimatedLabel: "계획 모델 추정치", estimatedHelp: "실제 공급자 키가 연결되기 전에는 거리와 표준 환승 시간을 사용한 추정치입니다. 실제 평균으로 표시하지 않습니다.",
    observed: "관측 평균", scheduled: "공식 운행표", estimated: "추정치", unavailable: "데이터 없음", dataSource: "데이터 기준", expand: "세부 시간 보기", collapse: "세부 시간 닫기",
    share: "링크 공유", pdf: "PDF 저장", save: "내 여행에 저장", copied: "공유 링크를 복사했습니다.", pdfReady: "PDF 파일을 저장했습니다.", saved: "나만 볼 수 있게 저장했습니다.", signInToSave: "로그인하면 여행을 비공개로 저장할 수 있어요.",
    savedTrips: "저장한 여행", savedTripsDesc: "저장한 동선은 로그인한 본인에게만 보입니다.", noTrips: "아직 저장한 여행이 없습니다.", open: "열기", remove: "삭제", private: "비공개", updated: "업데이트",
    expenseTitle: "함께 쓴 여행비, 깔끔하게 정산.", expenseDescription: "누가 결제했는지 기록하고 선택한 사람끼리 정확히 나눕니다.", totalExpense: "총 지출", myExpense: "내 지출", receiveAfter: "정산 후 받을 금액", addExpense: "지출 추가", category: "카테고리", description: "설명", amount: "금액", paidBy: "결제한 사람", splitWith: "나눌 사람", splitMethod: "분할 방법", equal: "균등", saveExpense: "지출 저장", settlement: "누가 누구에게", settleDone: "정산 완료로 표시", all: "전체", accommodation: "숙박", transport: "교통", food: "식비", activities: "관광", shopping: "쇼핑", other: "기타", expenseSaved: "가계부를 비공개로 저장했습니다.",
    profileTitle: "함께 여행할 나를 소개해요.", profileDescription: "모든 항목은 선택 사항이며, 공개하지 않으면 다른 사람에게 보이지 않습니다.", name: "이름", ageBand: "나이대", smoking: "흡연", drinking: "음주", mbti: "MBTI", unspecified: "공개 안 함", yes: "예", no: "아니요", profileSave: "프로필 저장", profileSaved: "프로필을 저장했습니다.",
    privacyTitle: "개인정보와 공개 범위", privacyText: "여행, 가계부, 프로필은 기본 비공개입니다. 공유 링크에는 선택한 동선 정보만 포함되고 가계부와 프로필은 포함되지 않습니다.",
    tripName: "유럽 여름 여행", members: "4명", currency: "EUR", language: "언어", menu: "메뉴", close: "닫기", retry: "다시 시도", loading: "불러오는 중", guest: "게스트", cityLimit: "도시는 2개 이상 10개 이하로 선택해 주세요.", duplicateCity: "같은 도시는 한 번만 선택할 수 있어요.", providerRequired: "라이브 평균 시간은 교통 데이터 공급자 연결 후 제공됩니다.", dataUpdated: "계산 시각", noAccountData: "로그인 후 본인만 볼 수 있는 데이터를 저장할 수 있습니다.",
  },
  en: {
    route: "Route", trips: "My trips", expenses: "Expenses", profile: "Profile", signIn: "Sign in", signOut: "Sign out",
    routeTitle: "Many cities. The fastest order.", routeDescription: "We compare city transfers, terminal waits, check-in and security, connections, and arrival transfers — not just time in motion.",
    cities: "Cities to visit", addCity: "Add city", searchCity: "Search city or country", departure: "Departure", fixedStart: "Start with first city", findRoute: "Find fastest route",
    optimizedOrder: "Calculated travel order", exactOptimization: "Exact optimization · up to 10 cities", totalTravel: "Total travel", legs: "legs", estimatedLabel: "Planning-model estimate", estimatedHelp: "Until live providers are connected, this uses distance and standard transfer assumptions. It is never presented as an observed average.",
    observed: "Observed average", scheduled: "Published schedule", estimated: "Estimate", unavailable: "Unavailable", dataSource: "Data basis", expand: "View breakdown", collapse: "Close breakdown",
    share: "Share link", pdf: "Save PDF", save: "Save privately", copied: "Share link copied.", pdfReady: "PDF downloaded.", saved: "Saved for your account only.", signInToSave: "Sign in to save trips privately.",
    savedTrips: "Saved trips", savedTripsDesc: "Only you can see trips saved to your signed-in account.", noTrips: "No saved trips yet.", open: "Open", remove: "Delete", private: "Private", updated: "Updated",
    expenseTitle: "Shared travel costs, settled clearly.", expenseDescription: "Record who paid and split each expense precisely among selected people.", totalExpense: "Total spend", myExpense: "My spend", receiveAfter: "To receive", addExpense: "Add expense", category: "Category", description: "Description", amount: "Amount", paidBy: "Paid by", splitWith: "Split with", splitMethod: "Split method", equal: "Equal", saveExpense: "Save expense", settlement: "Who pays whom", settleDone: "Mark settled", all: "All", accommodation: "Stay", transport: "Transport", food: "Food", activities: "Activities", shopping: "Shopping", other: "Other", expenseSaved: "Expense ledger saved privately.",
    profileTitle: "Introduce your travel style.", profileDescription: "Every field is optional and stays private unless you choose to share it.", name: "Name", ageBand: "Age range", smoking: "Smoking", drinking: "Drinking", mbti: "MBTI", unspecified: "Prefer not to say", yes: "Yes", no: "No", profileSave: "Save profile", profileSaved: "Profile saved.",
    privacyTitle: "Privacy and visibility", privacyText: "Trips, expenses, and profile data are private by default. Shared links include only the selected route, never your ledger or profile.",
    tripName: "European summer trip", members: "4 people", currency: "EUR", language: "Language", menu: "Menu", close: "Close", retry: "Retry", loading: "Loading", guest: "Guest", cityLimit: "Choose between 2 and 10 cities.", duplicateCity: "Each city can only be selected once.", providerRequired: "Live average times appear after transport providers are connected.", dataUpdated: "Calculated", noAccountData: "Sign in to save private account data.",
  },
  fr: {
    route: "Itinéraire", trips: "Mes voyages", expenses: "Dépenses", profile: "Profil", signIn: "Se connecter", signOut: "Se déconnecter",
    routeTitle: "Plusieurs villes, dans l’ordre le plus rapide.", routeDescription: "Nous comparons les trajets urbains, l’attente, l’enregistrement, les correspondances et l’arrivée — pas seulement le temps à bord.",
    cities: "Villes à visiter", addCity: "Ajouter une ville", searchCity: "Rechercher une ville ou un pays", departure: "Départ", fixedStart: "Commencer par la première ville", findRoute: "Trouver l’itinéraire le plus rapide",
    optimizedOrder: "Ordre de voyage calculé", exactOptimization: "Optimisation exacte · 10 villes maximum", totalTravel: "Trajet total", legs: "étapes", estimatedLabel: "Estimation du modèle", estimatedHelp: "Avant la connexion des fournisseurs, le calcul utilise la distance et des temps de correspondance standards. Ce n’est jamais présenté comme une moyenne observée.",
    observed: "Moyenne observée", scheduled: "Horaire publié", estimated: "Estimation", unavailable: "Indisponible", dataSource: "Base des données", expand: "Voir le détail", collapse: "Fermer le détail",
    share: "Partager le lien", pdf: "Enregistrer le PDF", save: "Enregistrer en privé", copied: "Lien copié.", pdfReady: "PDF téléchargé.", saved: "Enregistré uniquement pour votre compte.", signInToSave: "Connectez-vous pour enregistrer vos voyages en privé.",
    savedTrips: "Voyages enregistrés", savedTripsDesc: "Vous seul pouvez voir les voyages de votre compte.", noTrips: "Aucun voyage enregistré.", open: "Ouvrir", remove: "Supprimer", private: "Privé", updated: "Mis à jour",
    expenseTitle: "Les dépenses partagées, réglées simplement.", expenseDescription: "Notez qui a payé et répartissez chaque dépense précisément.", totalExpense: "Dépenses totales", myExpense: "Mes dépenses", receiveAfter: "À recevoir", addExpense: "Ajouter", category: "Catégorie", description: "Description", amount: "Montant", paidBy: "Payé par", splitWith: "À partager avec", splitMethod: "Méthode", equal: "Égal", saveExpense: "Enregistrer", settlement: "Qui paie qui", settleDone: "Marquer comme réglé", all: "Tout", accommodation: "Hébergement", transport: "Transport", food: "Repas", activities: "Visites", shopping: "Achats", other: "Autre", expenseSaved: "Livre de dépenses enregistré en privé.",
    profileTitle: "Présentez votre façon de voyager.", profileDescription: "Chaque champ est facultatif et reste privé sauf choix contraire.", name: "Nom", ageBand: "Tranche d’âge", smoking: "Tabac", drinking: "Alcool", mbti: "MBTI", unspecified: "Ne pas indiquer", yes: "Oui", no: "Non", profileSave: "Enregistrer le profil", profileSaved: "Profil enregistré.",
    privacyTitle: "Confidentialité et visibilité", privacyText: "Voyages, dépenses et profil sont privés par défaut. Un lien partagé contient uniquement l’itinéraire sélectionné.",
    tripName: "Voyage d’été en Europe", members: "4 personnes", currency: "EUR", language: "Langue", menu: "Menu", close: "Fermer", retry: "Réessayer", loading: "Chargement", guest: "Invité", cityLimit: "Choisissez entre 2 et 10 villes.", duplicateCity: "Chaque ville ne peut être sélectionnée qu’une fois.", providerRequired: "Les moyennes réelles seront disponibles après connexion des fournisseurs.", dataUpdated: "Calculé", noAccountData: "Connectez-vous pour enregistrer vos données privées.",
  },
  ja: {
    route: "ルート", trips: "旅行", expenses: "家計簿", profile: "プロフィール", signIn: "ログイン", signOut: "ログアウト",
    routeTitle: "複数の都市を、最も速い順番で。", routeDescription: "市内移動、待ち時間、チェックインと保安検査、乗り換え、到着後の移動まで含めて比較します。",
    cities: "訪問する都市", addCity: "都市を追加", searchCity: "都市・国を検索", departure: "出発日", fixedStart: "最初の都市から開始", findRoute: "最速ルートを検索",
    optimizedOrder: "計算した旅行順序", exactOptimization: "厳密最適化・最大10都市", totalTravel: "総移動時間", legs: "区間", estimatedLabel: "計画モデルの推定値", estimatedHelp: "交通データ提供元の接続前は距離と標準的な乗換時間による推定です。観測平均としては表示しません。",
    observed: "観測平均", scheduled: "公式時刻表", estimated: "推定値", unavailable: "データなし", dataSource: "データ基準", expand: "内訳を見る", collapse: "内訳を閉じる",
    share: "リンク共有", pdf: "PDF保存", save: "非公開で保存", copied: "共有リンクをコピーしました。", pdfReady: "PDFを保存しました。", saved: "自分だけに保存しました。", signInToSave: "ログインすると旅行を非公開で保存できます。",
    savedTrips: "保存した旅行", savedTripsDesc: "保存した旅行はログインした本人だけが見られます。", noTrips: "保存した旅行はまだありません。", open: "開く", remove: "削除", private: "非公開", updated: "更新",
    expenseTitle: "旅行費用を、すっきり精算。", expenseDescription: "誰が支払ったかを記録し、選んだメンバーで正確に分割します。", totalExpense: "総支出", myExpense: "自分の支出", receiveAfter: "受取予定", addExpense: "支出を追加", category: "カテゴリ", description: "説明", amount: "金額", paidBy: "支払った人", splitWith: "分ける人", splitMethod: "分割方法", equal: "均等", saveExpense: "支出を保存", settlement: "誰が誰に", settleDone: "精算済みにする", all: "すべて", accommodation: "宿泊", transport: "交通", food: "食費", activities: "観光", shopping: "買い物", other: "その他", expenseSaved: "家計簿を非公開で保存しました。",
    profileTitle: "一緒に旅する自分を紹介。", profileDescription: "すべて任意項目です。公開しない限り他の人には見えません。", name: "名前", ageBand: "年代", smoking: "喫煙", drinking: "飲酒", mbti: "MBTI", unspecified: "非公開", yes: "はい", no: "いいえ", profileSave: "プロフィール保存", profileSaved: "プロフィールを保存しました。",
    privacyTitle: "プライバシーと公開範囲", privacyText: "旅行、家計簿、プロフィールは初期状態で非公開です。共有リンクには選択したルートだけが含まれます。",
    tripName: "ヨーロッパ夏旅行", members: "4人", currency: "EUR", language: "言語", menu: "メニュー", close: "閉じる", retry: "再試行", loading: "読み込み中", guest: "ゲスト", cityLimit: "都市は2〜10件選んでください。", duplicateCity: "同じ都市は一度だけ選べます。", providerRequired: "実測平均は交通データ提供元の接続後に表示されます。", dataUpdated: "計算時刻", noAccountData: "ログインすると非公開データを保存できます。",
  },
  zh: {
    route: "路线", trips: "我的旅行", expenses: "旅行账本", profile: "个人资料", signIn: "登录", signOut: "退出",
    routeTitle: "多个城市，按最快顺序出发。", routeDescription: "综合比较市区接驳、候车、值机安检、换乘及抵达市区的全部时间。",
    cities: "要去的城市", addCity: "添加城市", searchCity: "搜索城市或国家", departure: "出发日期", fixedStart: "从第一个城市开始", findRoute: "查找最快路线",
    optimizedOrder: "计算出的旅行顺序", exactOptimization: "精确优化 · 最多10个城市", totalTravel: "总移动时间", legs: "段", estimatedLabel: "规划模型估算", estimatedHelp: "交通数据源接入前，使用距离与标准换乘时间进行估算，不会标为观测平均。",
    observed: "观测平均", scheduled: "官方时刻表", estimated: "估算", unavailable: "暂无数据", dataSource: "数据依据", expand: "查看明细", collapse: "收起明细",
    share: "分享链接", pdf: "保存 PDF", save: "私密保存", copied: "分享链接已复制。", pdfReady: "PDF 已下载。", saved: "已仅为本人保存。", signInToSave: "登录后可私密保存旅行。",
    savedTrips: "已保存的旅行", savedTripsDesc: "只有登录的本人可以查看已保存旅行。", noTrips: "还没有保存的旅行。", open: "打开", remove: "删除", private: "私密", updated: "更新",
    expenseTitle: "共同旅行开支，清楚结算。", expenseDescription: "记录付款人，并在选定成员之间准确分摊。", totalExpense: "总支出", myExpense: "我的支出", receiveAfter: "应收金额", addExpense: "添加支出", category: "类别", description: "说明", amount: "金额", paidBy: "付款人", splitWith: "分摊成员", splitMethod: "分摊方式", equal: "平均", saveExpense: "保存支出", settlement: "谁付给谁", settleDone: "标记已结算", all: "全部", accommodation: "住宿", transport: "交通", food: "餐饮", activities: "景点", shopping: "购物", other: "其他", expenseSaved: "旅行账本已私密保存。",
    profileTitle: "介绍你的旅行方式。", profileDescription: "所有项目均为选填，除非主动公开，否则他人不可见。", name: "姓名", ageBand: "年龄段", smoking: "吸烟", drinking: "饮酒", mbti: "MBTI", unspecified: "不公开", yes: "是", no: "否", profileSave: "保存资料", profileSaved: "个人资料已保存。",
    privacyTitle: "隐私与可见范围", privacyText: "旅行、账本和个人资料默认私密。分享链接只包含所选路线，不包含账本和个人资料。",
    tripName: "欧洲夏日旅行", members: "4人", currency: "EUR", language: "语言", menu: "菜单", close: "关闭", retry: "重试", loading: "加载中", guest: "访客", cityLimit: "请选择2到10个城市。", duplicateCity: "同一城市只能选择一次。", providerRequired: "接入交通数据提供商后才会显示实际平均时间。", dataUpdated: "计算时间", noAccountData: "登录后可保存仅本人可见的数据。",
  },
} as const;

export type MessageKey = keyof (typeof messages)["en"];

export function translate(locale: SupportedLocale, key: MessageKey): string {
  return messages[locale][key];
}

export function formatDuration(totalMinutes: number, locale: SupportedLocale): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (locale === "ko") return `${hours}시간 ${String(minutes).padStart(2, "0")}분`;
  if (locale === "fr") return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  if (locale === "ja") return `${hours}時間${String(minutes).padStart(2, "0")}分`;
  if (locale === "zh") return `${hours}小时${String(minutes).padStart(2, "0")}分`;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}
