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
    route: "경로", trips: "내 여행", expenses: "가계부", profile: "프로필",
    routeTitle: "여러 도시를, 가장 빠른 순서로.", routeDescription: "기차·버스는 도시 간 이동시간을, 항공은 공항 이동과 체크인·보안검색을 포함한 문전 간 시간으로 비교합니다.",
    cities: "여행할 도시", addCity: "도시 추가", searchCity: "도시 또는 국가 검색", searchWorldCities: "전 세계 도시 검색", citySearchPlaceholder: "전 세계 도시 이름 입력", citySearchHint: "2글자 이상 입력해 도시를 추가하세요.", noCityResults: "검색된 도시가 없습니다.", citySearchError: "도시 검색을 불러오지 못했습니다.", geocodingCredit: "도시 데이터: GeoNames · Open‑Meteo", departure: "출발일", startCity: "시작 도시", endCity: "마지막 도시", findRoute: "가장 빠른 동선 찾기",
    optimizedOrder: "계산된 여행 순서", exactOptimization: "정확 최적화 방식", fastApproximation: "빠른 근사 최적화 · 도시 수 제한 없음", totalTravel: "총 이동", legs: "구간", estimatedLabel: "계획 모델 추정치", estimatedHelp: "실제 공급자 키가 연결되기 전에는 거리와 표준 환승 시간을 사용한 추정치입니다. 실제 평균으로 표시하지 않습니다.",
    observed: "관측 평균", scheduled: "공개 운행표", estimated: "추정치", mixedData: "운행표 + 계획 추정", unavailable: "데이터 없음", dataSource: "데이터 기준", expand: "세부 시간 보기", collapse: "세부 시간 닫기",
    share: "링크 공유", pdf: "PDF 저장", save: "내 여행에 저장", copied: "공유 링크를 복사했습니다.", pdfReady: "PDF 파일을 저장했습니다.", saved: "이 기기의 내 여행에 저장했습니다.",
    savedTrips: "저장한 여행", savedTripsDesc: "이 기기의 현재 브라우저에 저장한 동선입니다.", noTrips: "아직 저장한 여행이 없습니다.", open: "열기", remove: "삭제", private: "비공개", updated: "업데이트",
    expenseTitle: "함께 쓴 여행비, 깔끔하게 정산.", expenseDescription: "직접 사람과 지출을 추가하고 선택한 사람끼리 정확히 나눕니다.", totalExpense: "총 지출", myExpense: "내 지출", receiveAfter: "정산 후 받을 금액", addExpense: "지출 추가", category: "카테고리", description: "설명", amount: "금액", paidBy: "결제한 사람", splitWith: "나눌 사람", splitMethod: "분할 방법", equal: "균등", saveExpense: "지출 저장", settlement: "누가 누구에게", settleDone: "정산 완료로 표시", all: "전체", accommodation: "숙박", transport: "교통", food: "식비", activities: "관광", shopping: "쇼핑", other: "기타", expenseSaved: "가계부를 이 기기에 저장했습니다.",
    people: "사람", personName: "이름 입력", addPerson: "사람 추가", chooseYourself: "본인은 누구인가요?", duplicatePerson: "같은 이름의 사람이 이미 있습니다.", personInUse: "이 사람은 지출 내역에 포함되어 있어 삭제할 수 없습니다.", addPeopleFirst: "먼저 한 명 이상 추가해 주세요.", membersCount: "{count}명", noExpenses: "아직 지출이 없습니다. 실제로 쓴 내역만 추가해 주세요.", noSettlement: "아직 정산할 내역이 없습니다.",
    profileTitle: "함께 여행할 나를 소개해요.", profileDescription: "모든 항목은 선택 사항이며 이 기기에만 저장됩니다.", name: "이름", ageBand: "나이대", smoking: "흡연", drinking: "음주", mbti: "MBTI", unspecified: "선택 안 함", yes: "예", no: "아니요", profileSave: "프로필 저장", profileSaved: "프로필을 이 기기에 저장했습니다.",
    privacyTitle: "기기 저장과 공개 범위", privacyText: "여행, 가계부, 프로필은 이 기기의 브라우저에만 저장됩니다. 공유 링크에는 선택한 동선 정보만 포함되고 가계부와 프로필은 포함되지 않습니다.",
    currency: "유로", language: "언어", menu: "메뉴", close: "닫기", retry: "다시 시도", loading: "불러오는 중", guest: "이름 없음", cityLimit: "도시를 2개 이상 선택해 주세요.", duplicateCity: "같은 도시는 한 번만 선택할 수 있어요.", providerRequired: "공개 운행표를 사용할 수 없는 구간은 지역별 이동 모델의 추정치로 표시합니다.", dataUpdated: "계산 시각",
    deviceOnly: "이 기기에만 저장", deviceStorageHelp: "이 기기의 현재 브라우저에만 저장됩니다. 브라우저 데이터를 삭제하면 함께 지워집니다.", deviceSaveError: "이 기기에 저장하지 못했습니다. 브라우저 저장소 설정을 확인해 주세요.", storageLimit: "이 기기의 저장 한도에 도달해 더 추가할 수 없습니다.",
    brandHome: "Together 홈", primaryNavigation: "주요 메뉴", mobileNavigation: "모바일 메뉴", mobilePrimaryNavigation: "모바일 주요 메뉴", moveUp: "위로 이동", moveDown: "아래로 이동", pdfError: "PDF를 만들지 못했습니다. 다시 시도해 주세요.",
    scheduleLoading: "공개 운행표를 확인하는 중", scheduleFound: "선택 경로에 공개 운행표 반영", schedulePartial: "일부 구간의 공개 운행표를 반영했으며 나머지는 계획 추정치입니다.", scheduleChecked: "공개 운행표를 확인했지만 선택 경로에는 계획 추정치가 사용됐습니다.", scheduleUnavailable: "운행표를 불러오지 못해 지역 추정치를 사용했습니다.", scheduleHelp: "철도·버스는 선택한 출발일의 공개 운행표를 우선 확인하며 구간 이동시간만 표시합니다. 항공만 공항 이동·체크인·보안검색·도착 후 이동을 포함한 문전 간 계획 추정치로 비교합니다.", regionalFocus: "같은 나라와 가까운 유럽 도시는 고속철·국제철도·장거리 버스 연결을 우선 비교합니다.", transitDataCredit: "대중교통 데이터: Transitous · OpenStreetMap", selectedPeople: "{count}명 균등 분할",
    routeMap: "여행 동선 지도", mapControls: "지도 조작", zoomIn: "지도 확대", zoomOut: "지도 축소", fitMap: "전체 동선 맞춤", mapHelp: "버튼이나 마우스 휠로 확대·축소하고, 지도를 끌어 이동할 수 있습니다.", mapAttribution: "지도 데이터: Natural Earth",
    metadataTitle: "Together | 여러 도시를 가장 빠른 순서로", metadataDescription: "기차·버스의 도시 간 이동시간과 항공의 문전 간 시간을 비교해 효율적인 여행 순서를 찾고, 공유·저장·정산까지 한곳에서 관리하세요.", ogAlt: "에펠탑을 배경으로 한 Together 여행 계획", offlineTitle: "인터넷 연결이 필요합니다", offlineDescription: "연결 상태를 확인한 뒤 Together를 다시 열어 주세요.",
  },
  en: {
    route: "Route", trips: "My trips", expenses: "Expenses", profile: "Profile",
    routeTitle: "Many cities. The fastest order.", routeDescription: "We compare intercity time for trains and coaches with door-to-door flight time, including airport transfers, check-in, and security.",
    cities: "Cities to visit", addCity: "Add city", searchCity: "Search city or country", searchWorldCities: "Search cities worldwide", citySearchPlaceholder: "Enter any city worldwide", citySearchHint: "Type at least two characters to add a city.", noCityResults: "No cities found.", citySearchError: "City search is temporarily unavailable.", geocodingCredit: "City data: GeoNames · Open‑Meteo", departure: "Departure date", startCity: "Start city", endCity: "Final city", findRoute: "Find fastest route",
    optimizedOrder: "Calculated travel order", exactOptimization: "Exact optimization", fastApproximation: "Fast approximate optimization · no city limit", totalTravel: "Total travel", legs: "legs", estimatedLabel: "Planning-model estimate", estimatedHelp: "Until live providers are connected, this uses distance and standard transfer assumptions. It is never presented as an observed average.",
    observed: "Observed average", scheduled: "Published schedule", estimated: "Estimate", mixedData: "Timetable + planning estimate", unavailable: "Unavailable", dataSource: "Data basis", expand: "View breakdown", collapse: "Close breakdown",
    share: "Share link", pdf: "Save PDF", save: "Save to My trips", copied: "Share link copied.", pdfReady: "PDF downloaded.", saved: "Saved to My trips on this device.",
    savedTrips: "Saved trips", savedTripsDesc: "Trips saved in this browser on this device.", noTrips: "No saved trips yet.", open: "Open", remove: "Delete", private: "Private", updated: "Updated",
    expenseTitle: "Shared travel costs, settled clearly.", expenseDescription: "Add people and expenses yourself, then split each expense precisely among the selected people.", totalExpense: "Total spend", myExpense: "My spend", receiveAfter: "To receive", addExpense: "Add expense", category: "Category", description: "Description", amount: "Amount", paidBy: "Paid by", splitWith: "Split with", splitMethod: "Split method", equal: "Equal", saveExpense: "Save expense", settlement: "Who pays whom", settleDone: "Mark settled", all: "All", accommodation: "Stay", transport: "Transport", food: "Food", activities: "Activities", shopping: "Shopping", other: "Other", expenseSaved: "Expense ledger saved on this device.",
    people: "People", personName: "Enter a name", addPerson: "Add person", chooseYourself: "Which person are you?", duplicatePerson: "A person with that name already exists.", personInUse: "This person is included in an expense and cannot be deleted.", addPeopleFirst: "Add at least one person first.", membersCount: "{count} people", noExpenses: "No expenses yet. Add only what you actually spent.", noSettlement: "There is nothing to settle yet.",
    profileTitle: "Introduce your travel style.", profileDescription: "Every field is optional and is stored only on this device.", name: "Name", ageBand: "Age range", smoking: "Smoking", drinking: "Drinking", mbti: "MBTI", unspecified: "Not selected", yes: "Yes", no: "No", profileSave: "Save profile", profileSaved: "Profile saved on this device.",
    privacyTitle: "Device storage and visibility", privacyText: "Trips, expenses, and profile data are stored only in this browser on this device. Shared links include only the selected route, never your ledger or profile.",
    currency: "euro", language: "Language", menu: "Menu", close: "Close", retry: "Retry", loading: "Loading", guest: "No name", cityLimit: "Choose at least two cities.", duplicateCity: "Each city can only be selected once.", providerRequired: "Routes without a public timetable are clearly shown as regional planning estimates.", dataUpdated: "Calculated",
    deviceOnly: "Stored on this device", deviceStorageHelp: "Saved only in this browser on this device. Clearing browser data will remove it.", deviceSaveError: "Could not save on this device. Check your browser storage settings.", storageLimit: "This device’s storage limit has been reached. No more items can be added.",
    brandHome: "Together home", primaryNavigation: "Primary navigation", mobileNavigation: "Mobile navigation", mobilePrimaryNavigation: "Mobile primary navigation", moveUp: "Move up", moveDown: "Move down", pdfError: "We could not create the PDF. Please try again.",
    scheduleLoading: "Checking published timetables", scheduleFound: "Published timetable used in the selected route", schedulePartial: "Published timetables cover part of this route; the remaining legs use planning estimates.", scheduleChecked: "Timetables were checked, but the selected route uses planning estimates.", scheduleUnavailable: "The timetable was unavailable, so a regional estimate was used.", scheduleHelp: "Rail and coach options are checked against published timetables for the selected date and show only intercity travel time. Only flights include airport transfers, check-in, security, and arrival transfers in a door-to-door planning estimate.", regionalFocus: "For cities in one country or nearby European countries, high-speed rail, cross-border trains and coaches are compared first.", transitDataCredit: "Transit data: Transitous · OpenStreetMap", selectedPeople: "Split equally among {count} people",
    routeMap: "Travel route map", mapControls: "Map controls", zoomIn: "Zoom in", zoomOut: "Zoom out", fitMap: "Fit the full route", mapHelp: "Zoom with the buttons or mouse wheel. Drag to move the map.", mapAttribution: "Map data: Natural Earth",
    metadataTitle: "Together | Multi-city travel in the fastest order", metadataDescription: "Compare intercity rail and coach time with door-to-door flight time, optimize any number of cities, then share, save and settle costs in one place.", ogAlt: "Together travel planning with the Eiffel Tower", offlineTitle: "An internet connection is required", offlineDescription: "Check your connection, then open Together again.",
  },
  fr: {
    route: "Itinéraire", trips: "Mes voyages", expenses: "Dépenses", profile: "Profil",
    routeTitle: "Plusieurs villes, dans l’ordre le plus rapide.", routeDescription: "Nous comparons le temps entre les villes en train ou en autocar au temps porte à porte en avion, transferts aéroportuaires, enregistrement et contrôles de sûreté compris.",
    cities: "Villes à visiter", addCity: "Ajouter une ville", searchCity: "Rechercher une ville ou un pays", searchWorldCities: "Rechercher une ville dans le monde", citySearchPlaceholder: "Saisissez une ville du monde", citySearchHint: "Saisissez au moins deux caractères pour ajouter une ville.", noCityResults: "Aucune ville trouvée.", citySearchError: "La recherche de villes est momentanément indisponible.", geocodingCredit: "Données urbaines : GeoNames · Open‑Meteo", departure: "Date de départ", startCity: "Ville de départ", endCity: "Ville d’arrivée", findRoute: "Trouver l’itinéraire le plus rapide",
    optimizedOrder: "Ordre de voyage calculé", exactOptimization: "Optimisation exacte", fastApproximation: "Optimisation approchée rapide · nombre de villes illimité", totalTravel: "Trajet total", legs: "étapes", estimatedLabel: "Estimation du modèle", estimatedHelp: "Avant la connexion des fournisseurs, le calcul utilise la distance et des temps de correspondance standards. Ce n’est jamais présenté comme une moyenne observée.",
    observed: "Moyenne observée", scheduled: "Horaire publié", estimated: "Estimation", mixedData: "Horaire + estimation de trajet", unavailable: "Indisponible", dataSource: "Base des données", expand: "Voir le détail", collapse: "Fermer le détail",
    share: "Partager le lien", pdf: "Enregistrer le PDF", save: "Ajouter à Mes voyages", copied: "Lien copié.", pdfReady: "PDF téléchargé.", saved: "Voyage enregistré sur cet appareil.",
    savedTrips: "Voyages enregistrés", savedTripsDesc: "Voyages enregistrés dans ce navigateur sur cet appareil.", noTrips: "Aucun voyage enregistré.", open: "Ouvrir", remove: "Supprimer", private: "Privé", updated: "Mis à jour",
    expenseTitle: "Les dépenses partagées, réglées simplement.", expenseDescription: "Ajoutez vous-même les participants et les dépenses, puis répartissez précisément chaque montant.", totalExpense: "Dépenses totales", myExpense: "Mes dépenses", receiveAfter: "À recevoir", addExpense: "Ajouter une dépense", category: "Catégorie", description: "Description", amount: "Montant", paidBy: "Payé par", splitWith: "À partager avec", splitMethod: "Méthode", equal: "Égal", saveExpense: "Enregistrer", settlement: "Qui paie qui", settleDone: "Marquer comme réglé", all: "Tout", accommodation: "Hébergement", transport: "Transport", food: "Repas", activities: "Visites", shopping: "Achats", other: "Autre", expenseSaved: "Livre de dépenses enregistré sur cet appareil.",
    people: "Participants", personName: "Saisissez un nom", addPerson: "Ajouter", chooseYourself: "Quel participant êtes-vous ?", duplicatePerson: "Une personne portant ce nom existe déjà.", personInUse: "Cette personne figure dans une dépense et ne peut pas être supprimée.", addPeopleFirst: "Ajoutez d’abord au moins une personne.", membersCount: "Participants : {count}", noExpenses: "Aucune dépense pour le moment. Ajoutez uniquement vos dépenses réelles.", noSettlement: "Aucun règlement à effectuer pour le moment.",
    profileTitle: "Présentez votre façon de voyager.", profileDescription: "Chaque champ est facultatif et n’est enregistré que sur cet appareil.", name: "Nom", ageBand: "Tranche d’âge", smoking: "Tabac", drinking: "Alcool", mbti: "MBTI", unspecified: "Non renseigné", yes: "Oui", no: "Non", profileSave: "Enregistrer le profil", profileSaved: "Profil enregistré sur cet appareil.",
    privacyTitle: "Stockage sur l’appareil et visibilité", privacyText: "Les voyages, les dépenses et le profil sont enregistrés uniquement dans ce navigateur sur cet appareil. Un lien partagé contient seulement l’itinéraire sélectionné, jamais le livre de dépenses ni le profil.",
    currency: "euro", language: "Langue", menu: "Menu", close: "Fermer", retry: "Réessayer", loading: "Chargement", guest: "Sans nom", cityLimit: "Choisissez au moins deux villes.", duplicateCity: "Chaque ville ne peut être sélectionnée qu’une fois.", providerRequired: "Les trajets sans horaire public sont clairement signalés comme des estimations régionales.", dataUpdated: "Calculé",
    deviceOnly: "Enregistré sur cet appareil", deviceStorageHelp: "Ces données sont enregistrées uniquement dans ce navigateur sur cet appareil. Elles seront supprimées si vous effacez les données du navigateur.", deviceSaveError: "Impossible d’enregistrer sur cet appareil. Vérifiez les paramètres de stockage du navigateur.", storageLimit: "La limite de stockage de cet appareil est atteinte. Vous ne pouvez plus ajouter d’éléments.",
    brandHome: "Accueil Together", primaryNavigation: "Navigation principale", mobileNavigation: "Navigation mobile", mobilePrimaryNavigation: "Navigation principale sur mobile", moveUp: "Déplacer vers le haut", moveDown: "Déplacer vers le bas", pdfError: "Impossible de créer le PDF. Veuillez réessayer.",
    scheduleLoading: "Consultation des horaires publiés", scheduleFound: "Horaire publié utilisé dans l’itinéraire choisi", schedulePartial: "Les horaires publiés couvrent une partie de l’itinéraire ; les autres trajets sont estimés.", scheduleChecked: "Les horaires ont été consultés, mais l’itinéraire choisi utilise des estimations.", scheduleUnavailable: "L’horaire étant indisponible, une estimation régionale a été utilisée.", scheduleHelp: "Les trains et autocars sont recherchés dans les horaires publiés à la date choisie et n’affichent que le temps de trajet entre les villes. Seul l’avion inclut les transferts vers l’aéroport, l’enregistrement, les contrôles de sûreté et le trajet jusqu’à la ville d’arrivée dans une estimation porte à porte.", regionalFocus: "Pour un même pays ou des pays européens voisins, le train à grande vitesse, les liaisons internationales et les autocars sont comparés en priorité.", transitDataCredit: "Données de transport : Transitous · OpenStreetMap", selectedPeople: "Répartition égale entre {count} personnes",
    routeMap: "Carte de l’itinéraire", mapControls: "Commandes de la carte", zoomIn: "Agrandir la carte", zoomOut: "Réduire la carte", fitMap: "Afficher tout l’itinéraire", mapHelp: "Utilisez les boutons ou la molette pour zoomer. Faites glisser la carte pour la déplacer.", mapAttribution: "Données cartographiques : Natural Earth",
    metadataTitle: "Together | Plusieurs villes dans l’ordre le plus rapide", metadataDescription: "Comparez le temps entre les villes en train ou en autocar au temps porte à porte en avion, optimisez le voyage, puis partagez-le, enregistrez-le et répartissez les dépenses.", ogAlt: "Planification de voyage Together avec la tour Eiffel", offlineTitle: "Une connexion Internet est nécessaire", offlineDescription: "Vérifiez votre connexion, puis ouvrez de nouveau Together.",
  },
  ja: {
    route: "ルート", trips: "旅行", expenses: "家計簿", profile: "プロフィール",
    routeTitle: "複数の都市を、最も速い順番で。", routeDescription: "鉄道・長距離バスの都市間移動時間と、空港移動・チェックイン・保安検査を含む航空のドアツードア時間を比較します。",
    cities: "訪問する都市", addCity: "都市を追加", searchCity: "都市・国を検索", searchWorldCities: "世界の都市を検索", citySearchPlaceholder: "世界の都市名を入力", citySearchHint: "2文字以上入力して都市を追加してください。", noCityResults: "都市が見つかりません。", citySearchError: "都市検索を一時的に利用できません。", geocodingCredit: "都市データ：GeoNames・Open‑Meteo", departure: "出発日", startCity: "出発都市", endCity: "到着都市", findRoute: "最速ルートを検索",
    optimizedOrder: "計算した旅行順序", exactOptimization: "厳密最適化", fastApproximation: "高速近似最適化・都市数制限なし", totalTravel: "総移動時間", legs: "区間", estimatedLabel: "計画モデルの推定値", estimatedHelp: "交通データ提供元の接続前は距離と標準的な乗換時間による推定です。観測平均としては表示しません。",
    observed: "観測平均", scheduled: "公開時刻表", estimated: "推定値", mixedData: "時刻表＋計画推定", unavailable: "データなし", dataSource: "データ基準", expand: "内訳を見る", collapse: "内訳を閉じる",
    share: "リンク共有", pdf: "PDF保存", save: "旅行に保存", copied: "共有リンクをコピーしました。", pdfReady: "PDFを保存しました。", saved: "この端末の旅行に保存しました。",
    savedTrips: "保存した旅行", savedTripsDesc: "この端末の現在のブラウザに保存した旅行です。", noTrips: "保存した旅行はまだありません。", open: "開く", remove: "削除", private: "非公開", updated: "更新",
    expenseTitle: "旅行費用を、すっきり精算。", expenseDescription: "自分でメンバーと支出を追加し、選んだ人の間で正確に分割します。", totalExpense: "総支出", myExpense: "自分の支出", receiveAfter: "受取予定", addExpense: "支出を追加", category: "カテゴリ", description: "説明", amount: "金額", paidBy: "支払った人", splitWith: "分ける人", splitMethod: "分割方法", equal: "均等", saveExpense: "支出を保存", settlement: "誰が誰に", settleDone: "精算済みにする", all: "すべて", accommodation: "宿泊", transport: "交通", food: "食費", activities: "観光", shopping: "買い物", other: "その他", expenseSaved: "家計簿をこの端末に保存しました。",
    people: "メンバー", personName: "名前を入力", addPerson: "追加", chooseYourself: "あなたはどの人ですか？", duplicatePerson: "同じ名前の人がすでにいます。", personInUse: "この人は支出に含まれているため削除できません。", addPeopleFirst: "先に1人以上追加してください。", membersCount: "{count}人", noExpenses: "支出はまだありません。実際に使った分だけ追加してください。", noSettlement: "精算する項目はまだありません。",
    profileTitle: "一緒に旅する自分を紹介。", profileDescription: "すべて任意項目で、この端末だけに保存されます。", name: "名前", ageBand: "年代", smoking: "喫煙", drinking: "飲酒", mbti: "MBTI", unspecified: "未選択", yes: "はい", no: "いいえ", profileSave: "プロフィール保存", profileSaved: "プロフィールをこの端末に保存しました。",
    privacyTitle: "端末への保存と公開範囲", privacyText: "旅行、家計簿、プロフィールは、この端末のブラウザだけに保存されます。共有リンクには選択したルートだけが含まれ、家計簿やプロフィールは含まれません。",
    currency: "ユーロ", language: "言語", menu: "メニュー", close: "閉じる", retry: "再試行", loading: "読み込み中", guest: "名前未設定", cityLimit: "都市を2件以上選んでください。", duplicateCity: "同じ都市は一度だけ選べます。", providerRequired: "公開時刻表がない区間は、地域別の計画推定値として明示します。", dataUpdated: "計算時刻",
    deviceOnly: "この端末だけに保存", deviceStorageHelp: "この端末の現在のブラウザだけに保存されます。ブラウザのデータを消去すると、このデータも削除されます。", deviceSaveError: "この端末に保存できませんでした。ブラウザのストレージ設定を確認してください。", storageLimit: "この端末の保存上限に達したため、これ以上追加できません。",
    brandHome: "Together ホーム", primaryNavigation: "メインナビゲーション", mobileNavigation: "モバイルナビゲーション", mobilePrimaryNavigation: "モバイルのメインナビゲーション", moveUp: "上へ移動", moveDown: "下へ移動", pdfError: "PDFを作成できませんでした。もう一度お試しください。",
    scheduleLoading: "公開時刻表を確認中", scheduleFound: "選択ルートに公開時刻表を反映", schedulePartial: "一部区間に公開時刻表を反映し、残りの区間には計画推定値を使用しています。", scheduleChecked: "公開時刻表を確認しましたが、選択ルートには計画推定値が使われています。", scheduleUnavailable: "時刻表を取得できないため、地域別推定値を使用しました。", scheduleHelp: "鉄道と長距離バスは、選択した日付の公開時刻表を確認し、都市間の移動時間だけを表示します。航空だけが空港への移動、チェックイン、保安検査、到着後の市内移動を含むドアツードアの計画推定値です。", regionalFocus: "同一国内や近隣のヨーロッパ都市では、高速鉄道・国際鉄道・長距離バスを優先して比較します。", transitDataCredit: "公共交通データ：Transitous・OpenStreetMap", selectedPeople: "{count}人で均等に分割",
    routeMap: "旅行ルート地図", mapControls: "地図操作", zoomIn: "地図を拡大", zoomOut: "地図を縮小", fitMap: "ルート全体を表示", mapHelp: "ボタンまたはマウスホイールで拡大・縮小できます。ドラッグすると地図を移動できます。", mapAttribution: "地図データ：Natural Earth",
    metadataTitle: "Together | 複数都市を最速の順番で", metadataDescription: "鉄道・長距離バスの都市間移動時間と航空のドアツードア時間を比較して周遊順を最適化し、共有・保存・旅費精算まで一か所で管理できます。", ogAlt: "エッフェル塔を背景にしたTogetherの旅行計画", offlineTitle: "インターネット接続が必要です", offlineDescription: "接続を確認してから、Togetherをもう一度開いてください。",
  },
  zh: {
    route: "路线", trips: "我的旅行", expenses: "旅行账本", profile: "个人资料",
    routeTitle: "多个城市，按最快顺序出发。", routeDescription: "比较铁路、长途巴士的城市间行程时间与航班的门到门时间；只有航班计入机场接驳、值机和安检。",
    cities: "要去的城市", addCity: "添加城市", searchCity: "搜索城市或国家", searchWorldCities: "搜索全球城市", citySearchPlaceholder: "输入全球任一城市", citySearchHint: "输入至少两个字符即可添加城市。", noCityResults: "未找到城市。", citySearchError: "城市搜索暂时不可用。", geocodingCredit: "城市数据：GeoNames · Open‑Meteo", departure: "出发日期", startCity: "出发城市", endCity: "终点城市", findRoute: "查找最快路线",
    optimizedOrder: "计算出的旅行顺序", exactOptimization: "精确优化", fastApproximation: "快速近似优化 · 城市数量不限", totalTravel: "总移动时间", legs: "段", estimatedLabel: "规划模型估算", estimatedHelp: "交通数据源接入前，使用距离与标准换乘时间进行估算，不会标为观测平均。",
    observed: "观测平均", scheduled: "公开时刻表", estimated: "估算", mixedData: "时刻表＋规划估算", unavailable: "暂无数据", dataSource: "数据依据", expand: "查看明细", collapse: "收起明细",
    share: "分享链接", pdf: "保存 PDF", save: "保存到我的旅行", copied: "分享链接已复制。", pdfReady: "PDF 已下载。", saved: "已保存到本设备的我的旅行。",
    savedTrips: "已保存的旅行", savedTripsDesc: "旅行保存在本设备的当前浏览器中。", noTrips: "还没有保存的旅行。", open: "打开", remove: "删除", private: "私密", updated: "更新",
    expenseTitle: "共同旅行开支，清楚结算。", expenseDescription: "请自行添加成员和支出，再在选定成员之间准确分摊。", totalExpense: "总支出", myExpense: "我的支出", receiveAfter: "应收金额", addExpense: "添加支出", category: "类别", description: "说明", amount: "金额", paidBy: "付款人", splitWith: "分摊成员", splitMethod: "分摊方式", equal: "平均", saveExpense: "保存支出", settlement: "谁付给谁", settleDone: "标记已结算", all: "全部", accommodation: "住宿", transport: "交通", food: "餐饮", activities: "景点", shopping: "购物", other: "其他", expenseSaved: "旅行账本已保存到本设备。",
    people: "成员", personName: "输入姓名", addPerson: "添加成员", chooseYourself: "哪位成员是你？", duplicatePerson: "已存在同名成员。", personInUse: "该成员已包含在支出中，无法删除。", addPeopleFirst: "请先添加至少一名成员。", membersCount: "{count}名成员", noExpenses: "还没有支出。请仅添加实际发生的支出。", noSettlement: "目前没有需要结算的款项。",
    profileTitle: "介绍你的旅行方式。", profileDescription: "所有项目均为选填，并且仅保存在本设备上。", name: "姓名", ageBand: "年龄段", smoking: "吸烟", drinking: "饮酒", mbti: "MBTI", unspecified: "未选择", yes: "是", no: "否", profileSave: "保存资料", profileSaved: "个人资料已保存到本设备。",
    privacyTitle: "设备存储与可见范围", privacyText: "旅行、账本和个人资料仅保存在本设备的当前浏览器中。分享链接只包含所选路线，不包含账本和个人资料。",
    currency: "欧元", language: "语言", menu: "菜单", close: "关闭", retry: "重试", loading: "加载中", guest: "未填写姓名", cityLimit: "请至少选择2个城市。", duplicateCity: "同一城市只能选择一次。", providerRequired: "没有公开时刻表的区段会明确标为区域规划估算。", dataUpdated: "计算时间",
    deviceOnly: "仅保存在本设备", deviceStorageHelp: "数据仅保存在本设备的当前浏览器中。清除浏览器数据时也会被删除。", deviceSaveError: "无法保存到本设备，请检查浏览器的存储设置。", storageLimit: "已达到本设备的存储上限，无法继续添加。",
    brandHome: "Together 首页", primaryNavigation: "主导航", mobileNavigation: "移动端导航", mobilePrimaryNavigation: "移动端主导航", moveUp: "上移", moveDown: "下移", pdfError: "无法生成 PDF，请重试。",
    scheduleLoading: "正在查询公开时刻表", scheduleFound: "所选路线已采用公开时刻表", schedulePartial: "部分区段采用公开时刻表，其余区段使用规划估算。", scheduleChecked: "已查询公开时刻表，但所选路线使用的是规划估算。", scheduleUnavailable: "未能获取时刻表，已改用区域估算。", scheduleHelp: "铁路和长途巴士会优先查询所选日期的公开时刻表，并且只显示城市间行程时间。只有航班会在门到门规划估算中计入前往机场、值机、安检和抵达后的市区接驳时间。", regionalFocus: "对于同一国家或相邻欧洲国家的城市，优先比较高铁、跨境铁路和长途巴士。", transitDataCredit: "公共交通数据：Transitous · OpenStreetMap", selectedPeople: "由{count}人平均分摊",
    routeMap: "旅行路线地图", mapControls: "地图控制", zoomIn: "放大地图", zoomOut: "缩小地图", fitMap: "显示完整路线", mapHelp: "可使用按钮或鼠标滚轮缩放地图，拖动可移动地图。", mapAttribution: "地图数据：Natural Earth",
    metadataTitle: "Together | 多城市最快旅行顺序", metadataDescription: "比较铁路、长途巴士的城市间行程时间与航班的门到门时间，优化不限数量的城市，并在一处完成分享、保存和费用分摊。", ogAlt: "以埃菲尔铁塔为背景的 Together 旅行规划", offlineTitle: "需要连接互联网", offlineDescription: "请检查网络连接，然后重新打开 Together。",
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
