import type { SupportedLocale } from "./domain";

export const LANGUAGE_TAGS: Readonly<Record<SupportedLocale, string>> = {
  ko: "ko-KR",
  en: "en-US",
  fr: "fr-FR",
  ja: "ja-JP",
  zh: "zh-CN",
};

/** Language names are translated into the currently selected language. */
export const LOCALE_NAMES: Readonly<Record<SupportedLocale, Readonly<Record<SupportedLocale, string>>>> = {
  ko: { ko: "한국어", en: "영어", fr: "프랑스어", ja: "일본어", zh: "중국어 간체" },
  en: { ko: "Korean", en: "English", fr: "French", ja: "Japanese", zh: "Simplified Chinese" },
  fr: { ko: "coréen", en: "anglais", fr: "français", ja: "japonais", zh: "chinois simplifié" },
  ja: { ko: "韓国語", en: "英語", fr: "フランス語", ja: "日本語", zh: "簡体字中国語" },
  zh: { ko: "韩语", en: "英语", fr: "法语", ja: "日语", zh: "简体中文" },
};

export const MESSAGES = {
  ko: {
    route: "경로", trips: "내 여행", expenses: "가계부", profile: "프로필", signIn: "로그인", signOut: "로그아웃",
    routeTitle: "여러 도시를, 가장 빠른 순서로.", routeDescription: "도심 이동, 터미널 대기, 체크인과 보안, 환승, 도착 후 이동까지 모두 더해 비교합니다.",
    cities: "여행할 도시", addCity: "도시 추가", searchCity: "도시 또는 국가 검색", searchWorldCities: "전 세계 도시 검색", citySearchPlaceholder: "전 세계 도시 이름 입력", citySearchHint: "2글자 이상 입력해 도시를 추가하세요.", noCityResults: "검색된 도시가 없습니다.", citySearchError: "도시 검색을 불러오지 못했습니다.", geocodingCredit: "도시 데이터: GeoNames · Open‑Meteo", departure: "출발일", fixedStart: "첫 도시에서 시작", findRoute: "가장 빠른 동선 찾기",
    optimizedOrder: "계산된 여행 순서", exactOptimization: "정확 최적화 · 최대 10개 도시", totalTravel: "총 이동", legs: "구간", estimatedLabel: "계획 모델 추정치", estimatedHelp: "실제 공급자 키가 연결되기 전에는 거리와 표준 환승 시간을 사용한 추정치입니다. 실제 평균으로 표시하지 않습니다.",
    observed: "관측 평균", scheduled: "공개 운행표", estimated: "추정치", mixedData: "운행표 + 계획 추정", unavailable: "데이터 없음", dataSource: "데이터 기준", expand: "세부 시간 보기", collapse: "세부 시간 닫기",
    share: "링크 공유", pdf: "PDF 저장", save: "내 여행에 저장", copied: "공유 링크를 복사했습니다.", pdfReady: "PDF 파일을 저장했습니다.", saved: "나만 볼 수 있게 저장했습니다.", signInToSave: "로그인하면 여행을 비공개로 저장할 수 있어요.",
    savedTrips: "저장한 여행", savedTripsDesc: "저장한 동선은 로그인한 본인에게만 보입니다.", noTrips: "아직 저장한 여행이 없습니다.", open: "열기", remove: "삭제", private: "비공개", updated: "업데이트",
    expenseTitle: "함께 쓴 여행비, 깔끔하게 정산.", expenseDescription: "누가 결제했는지 기록하고 선택한 사람끼리 정확히 나눕니다.", totalExpense: "총 지출", myExpense: "내 지출", receiveAfter: "정산 후 받을 금액", addExpense: "지출 추가", category: "카테고리", description: "설명", amount: "금액", paidBy: "결제한 사람", splitWith: "나눌 사람", splitMethod: "분할 방법", equal: "균등", saveExpense: "지출 저장", settlement: "누가 누구에게", settleDone: "정산 완료로 표시", all: "전체", accommodation: "숙박", transport: "교통", food: "식비", activities: "관광", shopping: "쇼핑", other: "기타", expenseSaved: "가계부를 비공개로 저장했습니다.",
    profileTitle: "함께 여행할 나를 소개해요.", profileDescription: "모든 항목은 선택 사항이며, 공개하지 않으면 다른 사람에게 보이지 않습니다.", name: "이름", ageBand: "나이대", smoking: "흡연", drinking: "음주", mbti: "MBTI", unspecified: "공개 안 함", yes: "예", no: "아니요", profileSave: "프로필 저장", profileSaved: "프로필을 저장했습니다.",
    privacyTitle: "개인정보와 공개 범위", privacyText: "여행, 가계부, 프로필은 기본 비공개입니다. 공유 링크에는 선택한 동선 정보만 포함되고 가계부와 프로필은 포함되지 않습니다.",
    tripName: "유럽 여름 여행", members: "4명", currency: "유로", language: "언어", menu: "메뉴", close: "닫기", retry: "다시 시도", loading: "불러오는 중", guest: "게스트", cityLimit: "도시는 2개 이상 10개 이하로 선택해 주세요.", duplicateCity: "같은 도시는 한 번만 선택할 수 있어요.", providerRequired: "공개 운행표를 사용할 수 없는 구간은 지역별 이동 모델의 추정치로 표시합니다.", dataUpdated: "계산 시각", noAccountData: "로그인 후 본인만 볼 수 있는 데이터를 저장할 수 있습니다.",
    brandHome: "Together 홈", primaryNavigation: "주요 메뉴", mobileNavigation: "모바일 메뉴", mobilePrimaryNavigation: "모바일 주요 메뉴", moveUp: "위로 이동", moveDown: "아래로 이동", pdfError: "PDF를 만들지 못했습니다. 다시 시도해 주세요.",
    scheduleLoading: "공개 운행표를 확인하는 중", scheduleFound: "선택 경로에 공개 운행표 반영", schedulePartial: "일부 구간의 공개 운행표를 반영했으며 나머지는 계획 추정치입니다.", scheduleChecked: "공개 운행표를 확인했지만 선택 경로에는 계획 추정치가 사용됐습니다.", scheduleUnavailable: "운행표를 불러오지 못해 지역 추정치를 사용했습니다.", scheduleLimit: "무료 운행표 조회는 한 번에 최대 4개 도시까지 지원합니다. 이 동선은 계획 추정치로 계산했습니다.", scheduleHelp: "유럽과 지원 지역의 철도·버스는 최대 4개 도시까지 선택한 출발일의 공개 운행표로 검증합니다. 항공은 도심 이동과 탑승 절차를 모두 포함하되 운항 여부를 보장하지 않는 계획 추정치입니다.", regionalFocus: "같은 나라와 가까운 유럽 도시는 고속철·국제철도·장거리 버스 연결을 우선 비교합니다.", transitDataCredit: "대중교통 데이터: Transitous · OpenStreetMap", selectedPeople: "{count}명 균등 분할",
    sampleStay: "파리 숙소", sampleRail: "고속철도 승차권", sampleDinner: "함께한 저녁 식사", sampleMuseum: "루브르 박물관 입장권", sampleGroceries: "여행 장보기", euro: "유로",
    metadataTitle: "Together | 여러 도시를 가장 빠른 순서로", metadataDescription: "항공·기차·버스의 문전 간 이동시간을 비교해 여러 도시의 효율적인 순서를 찾고, 공유·저장·정산까지 한곳에서 관리하세요.", ogAlt: "에펠탑을 배경으로 한 Together 여행 계획", offlineTitle: "인터넷 연결이 필요합니다", offlineDescription: "연결 상태를 확인한 뒤 Together를 다시 열어 주세요.",
  },
  en: {
    route: "Route", trips: "My trips", expenses: "Expenses", profile: "Profile", signIn: "Sign in", signOut: "Sign out",
    routeTitle: "Many cities. The fastest order.", routeDescription: "We compare city transfers, terminal waits, check-in and security, connections, and arrival transfers — not just time in motion.",
    cities: "Cities to visit", addCity: "Add city", searchCity: "Search city or country", searchWorldCities: "Search cities worldwide", citySearchPlaceholder: "Enter any city worldwide", citySearchHint: "Type at least two characters to add a city.", noCityResults: "No cities found.", citySearchError: "City search is temporarily unavailable.", geocodingCredit: "City data: GeoNames · Open‑Meteo", departure: "Departure", fixedStart: "Start with first city", findRoute: "Find fastest route",
    optimizedOrder: "Calculated travel order", exactOptimization: "Exact optimization · up to 10 cities", totalTravel: "Total travel", legs: "legs", estimatedLabel: "Planning-model estimate", estimatedHelp: "Until live providers are connected, this uses distance and standard transfer assumptions. It is never presented as an observed average.",
    observed: "Observed average", scheduled: "Published schedule", estimated: "Estimate", mixedData: "Timetable + planning estimate", unavailable: "Unavailable", dataSource: "Data basis", expand: "View breakdown", collapse: "Close breakdown",
    share: "Share link", pdf: "Save PDF", save: "Save privately", copied: "Share link copied.", pdfReady: "PDF downloaded.", saved: "Saved for your account only.", signInToSave: "Sign in to save trips privately.",
    savedTrips: "Saved trips", savedTripsDesc: "Only you can see trips saved to your signed-in account.", noTrips: "No saved trips yet.", open: "Open", remove: "Delete", private: "Private", updated: "Updated",
    expenseTitle: "Shared travel costs, settled clearly.", expenseDescription: "Record who paid and split each expense precisely among selected people.", totalExpense: "Total spend", myExpense: "My spend", receiveAfter: "To receive", addExpense: "Add expense", category: "Category", description: "Description", amount: "Amount", paidBy: "Paid by", splitWith: "Split with", splitMethod: "Split method", equal: "Equal", saveExpense: "Save expense", settlement: "Who pays whom", settleDone: "Mark settled", all: "All", accommodation: "Stay", transport: "Transport", food: "Food", activities: "Activities", shopping: "Shopping", other: "Other", expenseSaved: "Expense ledger saved privately.",
    profileTitle: "Introduce your travel style.", profileDescription: "Every field is optional and stays private unless you choose to share it.", name: "Name", ageBand: "Age range", smoking: "Smoking", drinking: "Drinking", mbti: "MBTI", unspecified: "Prefer not to say", yes: "Yes", no: "No", profileSave: "Save profile", profileSaved: "Profile saved.",
    privacyTitle: "Privacy and visibility", privacyText: "Trips, expenses, and profile data are private by default. Shared links include only the selected route, never your ledger or profile.",
    tripName: "European summer trip", members: "4 people", currency: "euro", language: "Language", menu: "Menu", close: "Close", retry: "Retry", loading: "Loading", guest: "Guest", cityLimit: "Choose between 2 and 10 cities.", duplicateCity: "Each city can only be selected once.", providerRequired: "Routes without a public timetable are clearly shown as regional planning estimates.", dataUpdated: "Calculated", noAccountData: "Sign in to save private account data.",
    brandHome: "Together home", primaryNavigation: "Primary navigation", mobileNavigation: "Mobile navigation", mobilePrimaryNavigation: "Mobile primary navigation", moveUp: "Move up", moveDown: "Move down", pdfError: "We could not create the PDF. Please try again.",
    scheduleLoading: "Checking published timetables", scheduleFound: "Published timetable used in the selected route", schedulePartial: "Published timetables cover part of this route; the remaining legs use planning estimates.", scheduleChecked: "Timetables were checked, but the selected route uses planning estimates.", scheduleUnavailable: "The timetable was unavailable, so a regional estimate was used.", scheduleLimit: "Free timetable lookup supports up to four cities per calculation. This route uses planning estimates.", scheduleHelp: "For up to four cities, rail and coach trips in Europe and supported regions are checked against public timetables for your departure date. Flights are door-to-door planning estimates and do not guarantee that a service operates.", regionalFocus: "For cities in one country or nearby European countries, high-speed rail, cross-border trains and coaches are compared first.", transitDataCredit: "Transit data: Transitous · OpenStreetMap", selectedPeople: "Split equally among {count} people",
    sampleStay: "Paris accommodation", sampleRail: "High-speed rail tickets", sampleDinner: "Group dinner", sampleMuseum: "Louvre Museum tickets", sampleGroceries: "Travel groceries", euro: "euro",
    metadataTitle: "Together | Multi-city travel in the fastest order", metadataDescription: "Compare door-to-door travel times by air, rail and coach, optimize a multi-city trip, then share, save and settle costs in one place.", ogAlt: "Together travel planning with the Eiffel Tower", offlineTitle: "An internet connection is required", offlineDescription: "Check your connection, then open Together again.",
  },
  fr: {
    route: "Itinéraire", trips: "Mes voyages", expenses: "Dépenses", profile: "Profil", signIn: "Se connecter", signOut: "Se déconnecter",
    routeTitle: "Plusieurs villes, dans l’ordre le plus rapide.", routeDescription: "Nous comparons les trajets urbains, l’attente, l’enregistrement et les contrôles de sûreté, les correspondances et l’arrivée — pas seulement le temps à bord.",
    cities: "Villes à visiter", addCity: "Ajouter une ville", searchCity: "Rechercher une ville ou un pays", searchWorldCities: "Rechercher une ville dans le monde", citySearchPlaceholder: "Saisissez une ville du monde", citySearchHint: "Saisissez au moins deux caractères pour ajouter une ville.", noCityResults: "Aucune ville trouvée.", citySearchError: "La recherche de villes est momentanément indisponible.", geocodingCredit: "Données urbaines : GeoNames · Open‑Meteo", departure: "Départ", fixedStart: "Commencer par la première ville", findRoute: "Trouver l’itinéraire le plus rapide",
    optimizedOrder: "Ordre de voyage calculé", exactOptimization: "Optimisation exacte · 10 villes maximum", totalTravel: "Trajet total", legs: "étapes", estimatedLabel: "Estimation du modèle", estimatedHelp: "Avant la connexion des fournisseurs, le calcul utilise la distance et des temps de correspondance standards. Ce n’est jamais présenté comme une moyenne observée.",
    observed: "Moyenne observée", scheduled: "Horaire publié", estimated: "Estimation", mixedData: "Horaire + estimation de trajet", unavailable: "Indisponible", dataSource: "Base des données", expand: "Voir le détail", collapse: "Fermer le détail",
    share: "Partager le lien", pdf: "Enregistrer le PDF", save: "Enregistrer en privé", copied: "Lien copié.", pdfReady: "PDF téléchargé.", saved: "Enregistré uniquement pour votre compte.", signInToSave: "Connectez-vous pour enregistrer vos voyages en privé.",
    savedTrips: "Voyages enregistrés", savedTripsDesc: "Vous seul pouvez voir les voyages de votre compte.", noTrips: "Aucun voyage enregistré.", open: "Ouvrir", remove: "Supprimer", private: "Privé", updated: "Mis à jour",
    expenseTitle: "Les dépenses partagées, réglées simplement.", expenseDescription: "Notez qui a payé et répartissez chaque dépense précisément.", totalExpense: "Dépenses totales", myExpense: "Mes dépenses", receiveAfter: "À recevoir", addExpense: "Ajouter", category: "Catégorie", description: "Description", amount: "Montant", paidBy: "Payé par", splitWith: "À partager avec", splitMethod: "Méthode", equal: "Égal", saveExpense: "Enregistrer", settlement: "Qui paie qui", settleDone: "Marquer comme réglé", all: "Tout", accommodation: "Hébergement", transport: "Transport", food: "Repas", activities: "Visites", shopping: "Achats", other: "Autre", expenseSaved: "Livre de dépenses enregistré en privé.",
    profileTitle: "Présentez votre façon de voyager.", profileDescription: "Chaque champ est facultatif et reste privé sauf choix contraire.", name: "Nom", ageBand: "Tranche d’âge", smoking: "Tabac", drinking: "Alcool", mbti: "MBTI", unspecified: "Ne pas indiquer", yes: "Oui", no: "Non", profileSave: "Enregistrer le profil", profileSaved: "Profil enregistré.",
    privacyTitle: "Confidentialité et visibilité", privacyText: "Voyages, dépenses et profil sont privés par défaut. Un lien partagé contient uniquement l’itinéraire sélectionné.",
    tripName: "Voyage d’été en Europe", members: "4 personnes", currency: "euro", language: "Langue", menu: "Menu", close: "Fermer", retry: "Réessayer", loading: "Chargement", guest: "Invité", cityLimit: "Choisissez entre 2 et 10 villes.", duplicateCity: "Chaque ville ne peut être sélectionnée qu’une fois.", providerRequired: "Les trajets sans horaire public sont clairement signalés comme des estimations régionales.", dataUpdated: "Calculé", noAccountData: "Connectez-vous pour enregistrer vos données privées.",
    brandHome: "Accueil Together", primaryNavigation: "Navigation principale", mobileNavigation: "Navigation mobile", mobilePrimaryNavigation: "Navigation principale sur mobile", moveUp: "Déplacer vers le haut", moveDown: "Déplacer vers le bas", pdfError: "Impossible de créer le PDF. Veuillez réessayer.",
    scheduleLoading: "Consultation des horaires publiés", scheduleFound: "Horaire publié utilisé dans l’itinéraire choisi", schedulePartial: "Les horaires publiés couvrent une partie de l’itinéraire ; les autres trajets sont estimés.", scheduleChecked: "Les horaires ont été consultés, mais l’itinéraire choisi utilise des estimations.", scheduleUnavailable: "L’horaire étant indisponible, une estimation régionale a été utilisée.", scheduleLimit: "La consultation gratuite des horaires accepte jusqu’à quatre villes par calcul. Cet itinéraire utilise des estimations.", scheduleHelp: "Pour quatre villes au maximum, les trains et autocars d’Europe et des régions compatibles sont vérifiés selon les horaires publics à la date choisie. L’avion est une estimation porte à porte qui ne garantit pas qu’un vol soit assuré.", regionalFocus: "Pour un même pays ou des pays européens voisins, le train à grande vitesse, les liaisons internationales et les autocars sont comparés en priorité.", transitDataCredit: "Données de transport : Transitous · OpenStreetMap", selectedPeople: "Répartition égale entre {count} personnes",
    sampleStay: "Hébergement à Paris", sampleRail: "Billets de train à grande vitesse", sampleDinner: "Dîner en groupe", sampleMuseum: "Billets pour le musée du Louvre", sampleGroceries: "Courses du voyage", euro: "euro",
    metadataTitle: "Together | Plusieurs villes dans l’ordre le plus rapide", metadataDescription: "Comparez les temps porte à porte en avion, train et autocar, optimisez votre voyage, puis partagez-le, enregistrez-le et répartissez les dépenses.", ogAlt: "Planification de voyage Together avec la tour Eiffel", offlineTitle: "Une connexion Internet est nécessaire", offlineDescription: "Vérifiez votre connexion, puis ouvrez de nouveau Together.",
  },
  ja: {
    route: "ルート", trips: "旅行", expenses: "家計簿", profile: "プロフィール", signIn: "ログイン", signOut: "ログアウト",
    routeTitle: "複数の都市を、最も速い順番で。", routeDescription: "市内移動、待ち時間、チェックインと保安検査、乗り換え、到着後の移動まで含めて比較します。",
    cities: "訪問する都市", addCity: "都市を追加", searchCity: "都市・国を検索", searchWorldCities: "世界の都市を検索", citySearchPlaceholder: "世界の都市名を入力", citySearchHint: "2文字以上入力して都市を追加してください。", noCityResults: "都市が見つかりません。", citySearchError: "都市検索を一時的に利用できません。", geocodingCredit: "都市データ：GeoNames・Open‑Meteo", departure: "出発日", fixedStart: "最初の都市から開始", findRoute: "最速ルートを検索",
    optimizedOrder: "計算した旅行順序", exactOptimization: "厳密最適化・最大10都市", totalTravel: "総移動時間", legs: "区間", estimatedLabel: "計画モデルの推定値", estimatedHelp: "交通データ提供元の接続前は距離と標準的な乗換時間による推定です。観測平均としては表示しません。",
    observed: "観測平均", scheduled: "公開時刻表", estimated: "推定値", mixedData: "時刻表＋計画推定", unavailable: "データなし", dataSource: "データ基準", expand: "内訳を見る", collapse: "内訳を閉じる",
    share: "リンク共有", pdf: "PDF保存", save: "非公開で保存", copied: "共有リンクをコピーしました。", pdfReady: "PDFを保存しました。", saved: "自分だけに保存しました。", signInToSave: "ログインすると旅行を非公開で保存できます。",
    savedTrips: "保存した旅行", savedTripsDesc: "保存した旅行はログインした本人だけが見られます。", noTrips: "保存した旅行はまだありません。", open: "開く", remove: "削除", private: "非公開", updated: "更新",
    expenseTitle: "旅行費用を、すっきり精算。", expenseDescription: "誰が支払ったかを記録し、選んだメンバーで正確に分割します。", totalExpense: "総支出", myExpense: "自分の支出", receiveAfter: "受取予定", addExpense: "支出を追加", category: "カテゴリ", description: "説明", amount: "金額", paidBy: "支払った人", splitWith: "分ける人", splitMethod: "分割方法", equal: "均等", saveExpense: "支出を保存", settlement: "誰が誰に", settleDone: "精算済みにする", all: "すべて", accommodation: "宿泊", transport: "交通", food: "食費", activities: "観光", shopping: "買い物", other: "その他", expenseSaved: "家計簿を非公開で保存しました。",
    profileTitle: "一緒に旅する自分を紹介。", profileDescription: "すべて任意項目です。公開しない限り他の人には見えません。", name: "名前", ageBand: "年代", smoking: "喫煙", drinking: "飲酒", mbti: "MBTI", unspecified: "非公開", yes: "はい", no: "いいえ", profileSave: "プロフィール保存", profileSaved: "プロフィールを保存しました。",
    privacyTitle: "プライバシーと公開範囲", privacyText: "旅行、家計簿、プロフィールは初期状態で非公開です。共有リンクには選択したルートだけが含まれます。",
    tripName: "ヨーロッパ夏旅行", members: "4人", currency: "ユーロ", language: "言語", menu: "メニュー", close: "閉じる", retry: "再試行", loading: "読み込み中", guest: "ゲスト", cityLimit: "都市は2〜10件選んでください。", duplicateCity: "同じ都市は一度だけ選べます。", providerRequired: "公開時刻表がない区間は、地域別の計画推定値として明示します。", dataUpdated: "計算時刻", noAccountData: "ログインすると非公開データを保存できます。",
    brandHome: "Together ホーム", primaryNavigation: "メインナビゲーション", mobileNavigation: "モバイルナビゲーション", mobilePrimaryNavigation: "モバイルのメインナビゲーション", moveUp: "上へ移動", moveDown: "下へ移動", pdfError: "PDFを作成できませんでした。もう一度お試しください。",
    scheduleLoading: "公開時刻表を確認中", scheduleFound: "選択ルートに公開時刻表を反映", schedulePartial: "一部区間に公開時刻表を反映し、残りの区間には計画推定値を使用しています。", scheduleChecked: "公開時刻表を確認しましたが、選択ルートには計画推定値が使われています。", scheduleUnavailable: "時刻表を取得できないため、地域別推定値を使用しました。", scheduleLimit: "無料の時刻表検索は1回につき最大4都市です。このルートには計画推定値を使用しています。", scheduleHelp: "最大4都市まで、ヨーロッパなど対応地域の鉄道・バスを選択した出発日の公開時刻表で確認します。航空は運航を保証しないドアツードアの計画推定値です。", regionalFocus: "同一国内や近隣のヨーロッパ都市では、高速鉄道・国際鉄道・長距離バスを優先して比較します。", transitDataCredit: "公共交通データ：Transitous・OpenStreetMap", selectedPeople: "{count}人で均等に分割",
    sampleStay: "パリの宿泊費", sampleRail: "高速鉄道の乗車券", sampleDinner: "みんなでの夕食", sampleMuseum: "ルーヴル美術館の入場券", sampleGroceries: "旅行中の買い物", euro: "ユーロ",
    metadataTitle: "Together | 複数都市を最速の順番で", metadataDescription: "航空・鉄道・バスのドアツードア時間を比較して周遊順を最適化し、共有・保存・旅費精算まで一か所で管理できます。", ogAlt: "エッフェル塔を背景にしたTogetherの旅行計画", offlineTitle: "インターネット接続が必要です", offlineDescription: "接続を確認してから、Togetherをもう一度開いてください。",
  },
  zh: {
    route: "路线", trips: "我的旅行", expenses: "旅行账本", profile: "个人资料", signIn: "登录", signOut: "退出",
    routeTitle: "多个城市，按最快顺序出发。", routeDescription: "综合比较市区接驳、候车、值机安检、换乘及抵达市区的全部时间。",
    cities: "要去的城市", addCity: "添加城市", searchCity: "搜索城市或国家", searchWorldCities: "搜索全球城市", citySearchPlaceholder: "输入全球任一城市", citySearchHint: "输入至少两个字符即可添加城市。", noCityResults: "未找到城市。", citySearchError: "城市搜索暂时不可用。", geocodingCredit: "城市数据：GeoNames · Open‑Meteo", departure: "出发日期", fixedStart: "从第一个城市开始", findRoute: "查找最快路线",
    optimizedOrder: "计算出的旅行顺序", exactOptimization: "精确优化 · 最多10个城市", totalTravel: "总移动时间", legs: "段", estimatedLabel: "规划模型估算", estimatedHelp: "交通数据源接入前，使用距离与标准换乘时间进行估算，不会标为观测平均。",
    observed: "观测平均", scheduled: "公开时刻表", estimated: "估算", mixedData: "时刻表＋规划估算", unavailable: "暂无数据", dataSource: "数据依据", expand: "查看明细", collapse: "收起明细",
    share: "分享链接", pdf: "保存 PDF", save: "私密保存", copied: "分享链接已复制。", pdfReady: "PDF 已下载。", saved: "已仅为本人保存。", signInToSave: "登录后可私密保存旅行。",
    savedTrips: "已保存的旅行", savedTripsDesc: "只有登录的本人可以查看已保存旅行。", noTrips: "还没有保存的旅行。", open: "打开", remove: "删除", private: "私密", updated: "更新",
    expenseTitle: "共同旅行开支，清楚结算。", expenseDescription: "记录付款人，并在选定成员之间准确分摊。", totalExpense: "总支出", myExpense: "我的支出", receiveAfter: "应收金额", addExpense: "添加支出", category: "类别", description: "说明", amount: "金额", paidBy: "付款人", splitWith: "分摊成员", splitMethod: "分摊方式", equal: "平均", saveExpense: "保存支出", settlement: "谁付给谁", settleDone: "标记已结算", all: "全部", accommodation: "住宿", transport: "交通", food: "餐饮", activities: "景点", shopping: "购物", other: "其他", expenseSaved: "旅行账本已私密保存。",
    profileTitle: "介绍你的旅行方式。", profileDescription: "所有项目均为选填，除非主动公开，否则他人不可见。", name: "姓名", ageBand: "年龄段", smoking: "吸烟", drinking: "饮酒", mbti: "MBTI", unspecified: "不公开", yes: "是", no: "否", profileSave: "保存资料", profileSaved: "个人资料已保存。",
    privacyTitle: "隐私与可见范围", privacyText: "旅行、账本和个人资料默认私密。分享链接只包含所选路线，不包含账本和个人资料。",
    tripName: "欧洲夏日旅行", members: "4人", currency: "欧元", language: "语言", menu: "菜单", close: "关闭", retry: "重试", loading: "加载中", guest: "访客", cityLimit: "请选择2到10个城市。", duplicateCity: "同一城市只能选择一次。", providerRequired: "没有公开时刻表的区段会明确标为区域规划估算。", dataUpdated: "计算时间", noAccountData: "登录后可保存仅本人可见的数据。",
    brandHome: "Together 首页", primaryNavigation: "主导航", mobileNavigation: "移动端导航", mobilePrimaryNavigation: "移动端主导航", moveUp: "上移", moveDown: "下移", pdfError: "无法生成 PDF，请重试。",
    scheduleLoading: "正在查询公开时刻表", scheduleFound: "所选路线已采用公开时刻表", schedulePartial: "部分区段采用公开时刻表，其余区段使用规划估算。", scheduleChecked: "已查询公开时刻表，但所选路线使用的是规划估算。", scheduleUnavailable: "未能获取时刻表，已改用区域估算。", scheduleLimit: "免费时刻表查询每次最多支持4个城市，本路线使用规划估算。", scheduleHelp: "最多选择4个城市时，欧洲及支持地区的铁路和长途巴士会按所选日期查询公开时刻表；航班为不保证实际执飞的门到门规划估算。", regionalFocus: "对于同一国家或相邻欧洲国家的城市，优先比较高铁、跨境铁路和长途巴士。", transitDataCredit: "公共交通数据：Transitous · OpenStreetMap", selectedPeople: "由{count}人平均分摊",
    sampleStay: "巴黎住宿", sampleRail: "高速铁路车票", sampleDinner: "共同晚餐", sampleMuseum: "卢浮宫门票", sampleGroceries: "旅行采购", euro: "欧元",
    metadataTitle: "Together | 多城市最快旅行顺序", metadataDescription: "比较飞机、铁路和长途巴士的门到门时间，优化多城市旅行顺序，并在一处完成分享、保存和费用分摊。", ogAlt: "以埃菲尔铁塔为背景的 Together 旅行规划", offlineTitle: "需要连接互联网", offlineDescription: "请检查网络连接，然后重新打开 Together。",
  },
} as const;

export type MessageKey = keyof (typeof MESSAGES)["en"];

export function translate(locale: SupportedLocale, key: MessageKey): string {
  return MESSAGES[locale][key];
}

export function translateWith(locale: SupportedLocale, key: MessageKey, values: Readonly<Record<string, string | number>>): string {
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), translate(locale, key));
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

export function formatDateTime(value: string | Date, locale: SupportedLocale): string {
  return new Intl.DateTimeFormat(LANGUAGE_TAGS[locale], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "long",
  }).format(typeof value === "string" ? new Date(value) : value);
}
