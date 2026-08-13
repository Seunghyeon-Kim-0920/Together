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
    routeTitle: "공개 운행표로 확인하는 여러 도시 동선.", routeDescription: "선택한 날짜의 공개 운행표에 출발·도착 시간이 확인된 철도와 장거리 버스만 비교합니다.",
    cities: "여행할 도시", addCity: "도시 추가", searchCity: "도시 또는 국가 검색", searchWorldCities: "전 세계 도시 검색", citySearchPlaceholder: "전 세계 도시 이름 입력", citySearchHint: "한 글자부터 입력해 도시를 추가하세요.", noCityResults: "검색된 도시가 없습니다.", citySearchError: "도시 검색을 불러오지 못했습니다.", geocodingCredit: "도시 데이터: GeoNames · Open‑Meteo", wikidataCredit: "다국어 별칭: Wikidata", departure: "출발일", startCity: "시작 도시", endCity: "마지막 도시", findRoute: "가장 빠른 동선 찾기",
    optimizedOrder: "확인된 여행 순서", exactOptimization: "확인된 전체 구간의 정확 최적화", fastApproximation: "확인된 운행표 기반 근사 순서 · 최단 순서 보장 없음", totalTravel: "총 이동", legs: "구간",
    observed: "검증된 이동 데이터", scheduled: "공개 운행표", estimated: "검증되지 않은 데이터", mixedData: "혼합 데이터", unavailable: "데이터 없음", dataSource: "데이터 기준", expand: "세부 시간 보기", collapse: "세부 시간 닫기",
    share: "링크 공유", pdf: "PDF 저장", save: "내 여행에 저장", copied: "공유 링크를 복사했습니다.", pdfReady: "PDF 파일을 저장했습니다.", saved: "이 기기의 내 여행에 저장했습니다.", shareLedger: "가계부 링크 공유", ledgerCopied: "가계부 공유 링크를 복사했습니다.", ledgerPdf: "가계부 PDF 저장", ledgerSharePrivacy: "가계부 링크를 가진 사람은 참가자 이름과 지출 내역을 볼 수 있습니다.", sharedLedgerPreview: "공유 가계부 미리보기", sharedLedgerPreviewHelp: "이 링크의 가계부는 읽기 전용이며 프로필과 본인 지정 정보는 포함하지 않습니다.", saveSharedLedger: "이 기기에 가계부 저장", sharedLedgerSaved: "공유 가계부를 이 기기에 저장했습니다.", sharedLedgerConflict: "이 기기에 기존 가계부가 있어 덮어쓰지 않았습니다. 기존 가계부를 먼저 공유하거나 PDF로 저장한 뒤 직접 비워 주세요.", ledgerShareError: "가계부를 공유할 수 없습니다. 데이터 크기와 브라우저 설정을 확인해 주세요.",
    savedTrips: "저장한 여행", savedTripsDesc: "이 기기의 현재 브라우저에 저장한 동선입니다.", noTrips: "아직 저장한 여행이 없습니다.", open: "열기", remove: "삭제", private: "비공개", updated: "업데이트", recheckTimetable: "운행표 다시 확인 필요",
    expenseTitle: "함께 쓴 여행비, 깔끔하게 정산.", expenseDescription: "직접 사람과 지출을 추가하고 선택한 사람끼리 정확히 나눕니다.", totalExpense: "총 지출", myExpense: "내 지출", receiveAfter: "정산 후 받을 금액", addExpense: "지출 추가", category: "카테고리", description: "설명", amount: "금액", paidBy: "결제한 사람", splitWith: "나눌 사람", splitMethod: "분할 방법", equal: "균등", saveExpense: "지출 저장", settlement: "누가 누구에게", settleDone: "정산 완료로 표시", all: "전체", accommodation: "숙박", transport: "교통", food: "식비", activities: "관광", shopping: "쇼핑", other: "기타", expenseSaved: "가계부를 이 기기에 저장했습니다.",
    people: "사람", personName: "이름 입력", addPerson: "사람 추가", chooseYourself: "본인은 누구인가요?", duplicatePerson: "같은 이름의 사람이 이미 있습니다.", personInUse: "이 사람은 지출 내역에 포함되어 있어 삭제할 수 없습니다.", addPeopleFirst: "먼저 한 명 이상 추가해 주세요.", membersCount: "{count}명", noExpenses: "아직 지출이 없습니다. 실제로 쓴 내역만 추가해 주세요.", noSettlement: "아직 정산할 내역이 없습니다.",
    profileTitle: "함께 여행할 나를 소개해요.", profileDescription: "모든 항목은 선택 사항이며 이 기기에만 저장됩니다.", name: "이름", ageBand: "나이대", smoking: "흡연", drinking: "음주", mbti: "MBTI", unspecified: "선택 안 함", yes: "예", no: "아니요", profileSave: "프로필 저장", profileSaved: "프로필을 이 기기에 저장했습니다.",
    privacyTitle: "기기 저장과 공개 범위", privacyText: "여행, 가계부, 프로필은 이 기기의 브라우저에만 저장됩니다. 공유 기능에는 사용자가 선택한 동선 또는 가계부만 포함되며 프로필은 포함되지 않습니다.",
    currency: "유로", language: "언어", menu: "메뉴", close: "닫기", retry: "다시 시도", loading: "불러오는 중", guest: "이름 없음", cityLimit: "도시를 2개 이상 선택해 주세요.", duplicateCity: "같은 도시는 한 번만 선택할 수 있어요.", providerRequired: "표시된 구간은 공개 출발·도착 시각이 확인된 운행표입니다.", dataUpdated: "확인 시각",
    deviceOnly: "이 기기에만 저장", deviceStorageHelp: "이 기기의 현재 브라우저에만 저장됩니다. 브라우저 데이터를 삭제하면 함께 지워집니다.", deviceSaveError: "이 기기에 저장하지 못했습니다. 브라우저 저장소 설정을 확인해 주세요.", storageLimit: "이 기기의 저장 한도에 도달해 더 추가할 수 없습니다.",
    brandHome: "Together 홈", primaryNavigation: "주요 메뉴", mobileNavigation: "모바일 메뉴", mobilePrimaryNavigation: "모바일 주요 메뉴", moveUp: "위로 이동", moveDown: "아래로 이동", pdfError: "PDF를 만들지 못했습니다. 다시 시도해 주세요.",
    scheduleLoading: "공개 운행표를 확인하는 중", scheduleFound: "모든 후보 구간의 출발·도착 시간을 확인했습니다.", schedulePartial: "검증에 필요한 모든 구간을 확인하지 못했습니다.", scheduleChecked: "공개 운행표 확인을 마쳤습니다.", scheduleUnavailable: "확인된 운행표가 없습니다.", verifiedRouteUnavailable: "확인 가능한 전체 경로가 없습니다", verifiedRouteUnavailableHelp: "모든 후보 구간의 공개 출발·도착 시간이 확인되어야 결과를 표시합니다. 현재 항공 운행표 공급자가 연결되지 않아 항공 구간은 만들지 않습니다.", transitDataCredit: "대중교통 데이터: Transitous · OpenStreetMap", selectedPeople: "{count}명 균등 분할",
    routeMap: "여행 동선 지도", mapControls: "지도 조작", zoomIn: "지도 확대", zoomOut: "지도 축소", fitMap: "전체 동선 맞춤", mapHelp: "버튼이나 마우스 휠로 확대·축소하고, 지도를 끌어 이동할 수 있습니다.", mapAttribution: "지도 데이터: Natural Earth",
    metadataTitle: "Together | 공개 운행표 기반 다도시 여행", metadataDescription: "공개 출발·도착 시각이 확인된 철도와 장거리 버스로 다도시 동선을 만들고 공유·저장·정산하세요.", ogAlt: "에펠탑을 배경으로 한 Together 여행 계획", offlineTitle: "인터넷 연결이 필요합니다", offlineDescription: "연결 상태를 확인한 뒤 Together를 다시 열어 주세요.",
  },
  en: {
    route: "Route", trips: "My trips", expenses: "Expenses", profile: "Profile",
    routeTitle: "Multi-city routes verified by published timetables.", routeDescription: "We compare only rail and coach services with published departure and arrival times for your selected date.",
    cities: "Cities to visit", addCity: "Add city", searchCity: "Search city or country", searchWorldCities: "Search cities worldwide", citySearchPlaceholder: "Enter any city worldwide", citySearchHint: "Type one or more characters to add a city.", noCityResults: "No cities found.", citySearchError: "City search is temporarily unavailable.", geocodingCredit: "City data: GeoNames · Open‑Meteo", wikidataCredit: "Multilingual aliases: Wikidata", departure: "Departure date", startCity: "Start city", endCity: "Final city", findRoute: "Find fastest route",
    optimizedOrder: "Verified travel order", exactOptimization: "Exact optimization of all verified pairs", fastApproximation: "Approximate order from verified schedules · shortest order not guaranteed", totalTravel: "Total travel", legs: "legs",
    observed: "Verified transport data", scheduled: "Published schedule", estimated: "Unverified data", mixedData: "Mixed data", unavailable: "Unavailable", dataSource: "Data basis", expand: "View breakdown", collapse: "Close breakdown",
    share: "Share link", pdf: "Save PDF", save: "Save to My trips", copied: "Share link copied.", pdfReady: "PDF downloaded.", saved: "Saved to My trips on this device.", shareLedger: "Share ledger link", ledgerCopied: "Ledger share link copied.", ledgerPdf: "Save ledger PDF", ledgerSharePrivacy: "Anyone with the ledger link can view participant names and expense details.", sharedLedgerPreview: "Shared ledger preview", sharedLedgerPreviewHelp: "This linked ledger is read-only and excludes profile and self-identification data.", saveSharedLedger: "Save ledger on this device", sharedLedgerSaved: "Shared ledger saved on this device.", sharedLedgerConflict: "An existing ledger is already stored on this device, so it was not overwritten. Share or export the existing ledger first, then clear it yourself.", ledgerShareError: "The ledger could not be shared. Check its size and your browser settings.",
    savedTrips: "Saved trips", savedTripsDesc: "Trips saved in this browser on this device.", noTrips: "No saved trips yet.", open: "Open", remove: "Delete", private: "Private", updated: "Updated", recheckTimetable: "Timetable recheck required",
    expenseTitle: "Shared travel costs, settled clearly.", expenseDescription: "Add people and expenses yourself, then split each expense precisely among the selected people.", totalExpense: "Total spend", myExpense: "My spend", receiveAfter: "To receive", addExpense: "Add expense", category: "Category", description: "Description", amount: "Amount", paidBy: "Paid by", splitWith: "Split with", splitMethod: "Split method", equal: "Equal", saveExpense: "Save expense", settlement: "Who pays whom", settleDone: "Mark settled", all: "All", accommodation: "Stay", transport: "Transport", food: "Food", activities: "Activities", shopping: "Shopping", other: "Other", expenseSaved: "Expense ledger saved on this device.",
    people: "People", personName: "Enter a name", addPerson: "Add person", chooseYourself: "Which person are you?", duplicatePerson: "A person with that name already exists.", personInUse: "This person is included in an expense and cannot be deleted.", addPeopleFirst: "Add at least one person first.", membersCount: "{count} people", noExpenses: "No expenses yet. Add only what you actually spent.", noSettlement: "There is nothing to settle yet.",
    profileTitle: "Introduce your travel style.", profileDescription: "Every field is optional and is stored only on this device.", name: "Name", ageBand: "Age range", smoking: "Smoking", drinking: "Drinking", mbti: "MBTI", unspecified: "Not selected", yes: "Yes", no: "No", profileSave: "Save profile", profileSaved: "Profile saved on this device.",
    privacyTitle: "Device storage and visibility", privacyText: "Trips, expenses, and profile data are stored only in this browser on this device. Sharing includes only the route or ledger you choose, never your profile.",
    currency: "euro", language: "Language", menu: "Menu", close: "Close", retry: "Retry", loading: "Loading", guest: "No name", cityLimit: "Choose at least two cities.", duplicateCity: "Each city can only be selected once.", providerRequired: "Every displayed leg has published departure and arrival times.", dataUpdated: "Verified",
    deviceOnly: "Stored on this device", deviceStorageHelp: "Saved only in this browser on this device. Clearing browser data will remove it.", deviceSaveError: "Could not save on this device. Check your browser storage settings.", storageLimit: "This device’s storage limit has been reached. No more items can be added.",
    brandHome: "Together home", primaryNavigation: "Primary navigation", mobileNavigation: "Mobile navigation", mobilePrimaryNavigation: "Mobile primary navigation", moveUp: "Move up", moveDown: "Move down", pdfError: "We could not create the PDF. Please try again.",
    scheduleLoading: "Checking published timetables", scheduleFound: "Departure and arrival times were verified for every candidate pair.", schedulePartial: "Not every pair required for verification could be checked.", scheduleChecked: "Published timetable check completed.", scheduleUnavailable: "No verified timetable is available.", verifiedRouteUnavailable: "No fully verified route is available", verifiedRouteUnavailableHelp: "Results appear only when published departure and arrival times are available for every candidate pair. No flight leg is created until a flight timetable provider is connected.", transitDataCredit: "Transit data: Transitous · OpenStreetMap", selectedPeople: "Split equally among {count} people",
    routeMap: "Travel route map", mapControls: "Map controls", zoomIn: "Zoom in", zoomOut: "Zoom out", fitMap: "Fit the full route", mapHelp: "Zoom with the buttons or mouse wheel. Drag to move the map.", mapAttribution: "Map data: Natural Earth",
    metadataTitle: "Together | Timetable-verified multi-city travel", metadataDescription: "Build, share, save and settle multi-city trips using rail and coach services with published departure and arrival times.", ogAlt: "Together travel planning with the Eiffel Tower", offlineTitle: "An internet connection is required", offlineDescription: "Check your connection, then open Together again.",
  },
  fr: {
    route: "Itinéraire", trips: "Mes voyages", expenses: "Dépenses", profile: "Profil",
    routeTitle: "Des itinéraires intervilles vérifiés par les horaires publiés.", routeDescription: "Nous comparons uniquement les trains et autocars dont les heures de départ et d’arrivée sont publiées pour la date choisie.",
    cities: "Villes à visiter", addCity: "Ajouter une ville", searchCity: "Rechercher une ville ou un pays", searchWorldCities: "Rechercher une ville dans le monde", citySearchPlaceholder: "Saisissez une ville du monde", citySearchHint: "Saisissez au moins un caractère pour ajouter une ville.", noCityResults: "Aucune ville trouvée.", citySearchError: "La recherche de villes est momentanément indisponible.", geocodingCredit: "Données urbaines : GeoNames · Open‑Meteo", wikidataCredit: "Alias multilingues : Wikidata", departure: "Date de départ", startCity: "Ville de départ", endCity: "Ville d’arrivée", findRoute: "Trouver l’itinéraire le plus rapide",
    optimizedOrder: "Ordre de voyage vérifié", exactOptimization: "Optimisation exacte de toutes les liaisons vérifiées", fastApproximation: "Ordre approché avec horaires vérifiés · trajet minimal non garanti", totalTravel: "Trajet total", legs: "étapes",
    observed: "Données de transport vérifiées", scheduled: "Horaire publié", estimated: "Données non vérifiées", mixedData: "Données mixtes", unavailable: "Indisponible", dataSource: "Base des données", expand: "Voir le détail", collapse: "Fermer le détail",
    share: "Partager le lien", pdf: "Enregistrer le PDF", save: "Ajouter à Mes voyages", copied: "Lien copié.", pdfReady: "PDF téléchargé.", saved: "Voyage enregistré sur cet appareil.", shareLedger: "Partager le livre de dépenses", ledgerCopied: "Lien du livre de dépenses copié.", ledgerPdf: "Enregistrer le livre en PDF", ledgerSharePrivacy: "Toute personne ayant le lien peut voir les noms des participants et le détail des dépenses.", sharedLedgerPreview: "Aperçu du livre partagé", sharedLedgerPreviewHelp: "Ce livre lié est en lecture seule et n’inclut ni le profil ni l’identification de votre propre participant.", saveSharedLedger: "Enregistrer ce livre sur cet appareil", sharedLedgerSaved: "Livre partagé enregistré sur cet appareil.", sharedLedgerConflict: "Un livre existe déjà sur cet appareil et n’a pas été remplacé. Partagez-le ou exportez-le d’abord, puis effacez-le vous-même.", ledgerShareError: "Impossible de partager le livre. Vérifiez sa taille et les réglages du navigateur.",
    savedTrips: "Voyages enregistrés", savedTripsDesc: "Voyages enregistrés dans ce navigateur sur cet appareil.", noTrips: "Aucun voyage enregistré.", open: "Ouvrir", remove: "Supprimer", private: "Privé", updated: "Mis à jour", recheckTimetable: "Nouvelle vérification des horaires requise",
    expenseTitle: "Les dépenses partagées, réglées simplement.", expenseDescription: "Ajoutez vous-même les participants et les dépenses, puis répartissez précisément chaque montant.", totalExpense: "Dépenses totales", myExpense: "Mes dépenses", receiveAfter: "À recevoir", addExpense: "Ajouter une dépense", category: "Catégorie", description: "Description", amount: "Montant", paidBy: "Payé par", splitWith: "À partager avec", splitMethod: "Méthode", equal: "Égal", saveExpense: "Enregistrer", settlement: "Qui paie qui", settleDone: "Marquer comme réglé", all: "Tout", accommodation: "Hébergement", transport: "Transport", food: "Repas", activities: "Visites", shopping: "Achats", other: "Autre", expenseSaved: "Livre de dépenses enregistré sur cet appareil.",
    people: "Participants", personName: "Saisissez un nom", addPerson: "Ajouter", chooseYourself: "Quel participant êtes-vous ?", duplicatePerson: "Une personne portant ce nom existe déjà.", personInUse: "Cette personne figure dans une dépense et ne peut pas être supprimée.", addPeopleFirst: "Ajoutez d’abord au moins une personne.", membersCount: "Participants : {count}", noExpenses: "Aucune dépense pour le moment. Ajoutez uniquement vos dépenses réelles.", noSettlement: "Aucun règlement à effectuer pour le moment.",
    profileTitle: "Présentez votre façon de voyager.", profileDescription: "Chaque champ est facultatif et n’est enregistré que sur cet appareil.", name: "Nom", ageBand: "Tranche d’âge", smoking: "Tabac", drinking: "Alcool", mbti: "MBTI", unspecified: "Non renseigné", yes: "Oui", no: "Non", profileSave: "Enregistrer le profil", profileSaved: "Profil enregistré sur cet appareil.",
    privacyTitle: "Stockage sur l’appareil et visibilité", privacyText: "Les voyages, les dépenses et le profil sont enregistrés uniquement dans ce navigateur sur cet appareil. Le partage contient uniquement l’itinéraire ou le livre choisi, jamais le profil.",
    currency: "euro", language: "Langue", menu: "Menu", close: "Fermer", retry: "Réessayer", loading: "Chargement", guest: "Sans nom", cityLimit: "Choisissez au moins deux villes.", duplicateCity: "Chaque ville ne peut être sélectionnée qu’une fois.", providerRequired: "Chaque trajet affiché dispose d’heures de départ et d’arrivée publiées.", dataUpdated: "Vérifié",
    deviceOnly: "Enregistré sur cet appareil", deviceStorageHelp: "Ces données sont enregistrées uniquement dans ce navigateur sur cet appareil. Elles seront supprimées si vous effacez les données du navigateur.", deviceSaveError: "Impossible d’enregistrer sur cet appareil. Vérifiez les paramètres de stockage du navigateur.", storageLimit: "La limite de stockage de cet appareil est atteinte. Vous ne pouvez plus ajouter d’éléments.",
    brandHome: "Accueil Together", primaryNavigation: "Navigation principale", mobileNavigation: "Navigation mobile", mobilePrimaryNavigation: "Navigation principale sur mobile", moveUp: "Déplacer vers le haut", moveDown: "Déplacer vers le bas", pdfError: "Impossible de créer le PDF. Veuillez réessayer.",
    scheduleLoading: "Consultation des horaires publiés", scheduleFound: "Les départs et arrivées de toutes les liaisons candidates ont été vérifiés.", schedulePartial: "Toutes les liaisons nécessaires n’ont pas pu être vérifiées.", scheduleChecked: "Consultation des horaires terminée.", scheduleUnavailable: "Aucun horaire vérifié n’est disponible.", verifiedRouteUnavailable: "Aucun itinéraire entièrement vérifié n’est disponible", verifiedRouteUnavailableHelp: "Un résultat n’est affiché que si les départs et arrivées publiés sont disponibles pour toutes les liaisons candidates. Aucun trajet aérien n’est créé tant qu’un fournisseur d’horaires aériens n’est pas connecté.", transitDataCredit: "Données de transport : Transitous · OpenStreetMap", selectedPeople: "Répartition égale entre {count} personnes",
    routeMap: "Carte de l’itinéraire", mapControls: "Commandes de la carte", zoomIn: "Agrandir la carte", zoomOut: "Réduire la carte", fitMap: "Afficher tout l’itinéraire", mapHelp: "Utilisez les boutons ou la molette pour zoomer. Faites glisser la carte pour la déplacer.", mapAttribution: "Données cartographiques : Natural Earth",
    metadataTitle: "Together | Voyage intervilles vérifié par les horaires", metadataDescription: "Créez, partagez, enregistrez et répartissez les dépenses de voyages en train et autocar dont les départs et arrivées sont publiés.", ogAlt: "Planification de voyage Together avec la tour Eiffel", offlineTitle: "Une connexion Internet est nécessaire", offlineDescription: "Vérifiez votre connexion, puis ouvrez de nouveau Together.",
  },
  ja: {
    route: "ルート", trips: "旅行", expenses: "家計簿", profile: "プロフィール",
    routeTitle: "公開時刻表で確認する複数都市ルート。", routeDescription: "選択日の出発・到着時刻が公開されている鉄道と長距離バスだけを比較します。",
    cities: "訪問する都市", addCity: "都市を追加", searchCity: "都市・国を検索", searchWorldCities: "世界の都市を検索", citySearchPlaceholder: "世界の都市名を入力", citySearchHint: "1文字から都市を検索して追加できます。", noCityResults: "都市が見つかりません。", citySearchError: "都市検索を一時的に利用できません。", geocodingCredit: "都市データ：GeoNames・Open‑Meteo", wikidataCredit: "多言語別名：Wikidata", departure: "出発日", startCity: "出発都市", endCity: "到着都市", findRoute: "最速ルートを検索",
    optimizedOrder: "確認済みの旅行順序", exactOptimization: "確認済み全区間の厳密最適化", fastApproximation: "確認済み時刻表による近似順序・最短保証なし", totalTravel: "総移動時間", legs: "区間",
    observed: "確認済み移動データ", scheduled: "公開時刻表", estimated: "未確認データ", mixedData: "混合データ", unavailable: "データなし", dataSource: "データ基準", expand: "内訳を見る", collapse: "内訳を閉じる",
    share: "リンク共有", pdf: "PDF保存", save: "旅行に保存", copied: "共有リンクをコピーしました。", pdfReady: "PDFを保存しました。", saved: "この端末の旅行に保存しました。", shareLedger: "家計簿リンクを共有", ledgerCopied: "家計簿の共有リンクをコピーしました。", ledgerPdf: "家計簿をPDF保存", ledgerSharePrivacy: "家計簿リンクを知っている人は、メンバー名と支出明細を閲覧できます。", sharedLedgerPreview: "共有家計簿のプレビュー", sharedLedgerPreviewHelp: "この家計簿は読み取り専用で、プロフィールと自分の指定情報は含まれません。", saveSharedLedger: "この端末に家計簿を保存", sharedLedgerSaved: "共有家計簿をこの端末に保存しました。", sharedLedgerConflict: "この端末に既存の家計簿があるため上書きしませんでした。先に共有またはPDF保存してから、自分で空にしてください。", ledgerShareError: "家計簿を共有できません。データ量とブラウザ設定を確認してください。",
    savedTrips: "保存した旅行", savedTripsDesc: "この端末の現在のブラウザに保存した旅行です。", noTrips: "保存した旅行はまだありません。", open: "開く", remove: "削除", private: "非公開", updated: "更新", recheckTimetable: "時刻表の再確認が必要",
    expenseTitle: "旅行費用を、すっきり精算。", expenseDescription: "自分でメンバーと支出を追加し、選んだ人の間で正確に分割します。", totalExpense: "総支出", myExpense: "自分の支出", receiveAfter: "受取予定", addExpense: "支出を追加", category: "カテゴリ", description: "説明", amount: "金額", paidBy: "支払った人", splitWith: "分ける人", splitMethod: "分割方法", equal: "均等", saveExpense: "支出を保存", settlement: "誰が誰に", settleDone: "精算済みにする", all: "すべて", accommodation: "宿泊", transport: "交通", food: "食費", activities: "観光", shopping: "買い物", other: "その他", expenseSaved: "家計簿をこの端末に保存しました。",
    people: "メンバー", personName: "名前を入力", addPerson: "追加", chooseYourself: "あなたはどの人ですか？", duplicatePerson: "同じ名前の人がすでにいます。", personInUse: "この人は支出に含まれているため削除できません。", addPeopleFirst: "先に1人以上追加してください。", membersCount: "{count}人", noExpenses: "支出はまだありません。実際に使った分だけ追加してください。", noSettlement: "精算する項目はまだありません。",
    profileTitle: "一緒に旅する自分を紹介。", profileDescription: "すべて任意項目で、この端末だけに保存されます。", name: "名前", ageBand: "年代", smoking: "喫煙", drinking: "飲酒", mbti: "MBTI", unspecified: "未選択", yes: "はい", no: "いいえ", profileSave: "プロフィール保存", profileSaved: "プロフィールをこの端末に保存しました。",
    privacyTitle: "端末への保存と公開範囲", privacyText: "旅行、家計簿、プロフィールは、この端末のブラウザだけに保存されます。共有には選択したルートまたは家計簿だけが含まれ、プロフィールは含まれません。",
    currency: "ユーロ", language: "言語", menu: "メニュー", close: "閉じる", retry: "再試行", loading: "読み込み中", guest: "名前未設定", cityLimit: "都市を2件以上選んでください。", duplicateCity: "同じ都市は一度だけ選べます。", providerRequired: "表示される全区間には公開された出発・到着時刻があります。", dataUpdated: "確認時刻",
    deviceOnly: "この端末だけに保存", deviceStorageHelp: "この端末の現在のブラウザだけに保存されます。ブラウザのデータを消去すると、このデータも削除されます。", deviceSaveError: "この端末に保存できませんでした。ブラウザのストレージ設定を確認してください。", storageLimit: "この端末の保存上限に達したため、これ以上追加できません。",
    brandHome: "Together ホーム", primaryNavigation: "メインナビゲーション", mobileNavigation: "モバイルナビゲーション", mobilePrimaryNavigation: "モバイルのメインナビゲーション", moveUp: "上へ移動", moveDown: "下へ移動", pdfError: "PDFを作成できませんでした。もう一度お試しください。",
    scheduleLoading: "公開時刻表を確認中", scheduleFound: "すべての候補区間の出発・到着時刻を確認しました。", schedulePartial: "確認に必要な全区間を検証できませんでした。", scheduleChecked: "公開時刻表の確認が完了しました。", scheduleUnavailable: "確認済みの時刻表はありません。", verifiedRouteUnavailable: "完全に確認できるルートがありません", verifiedRouteUnavailableHelp: "すべての候補区間で公開された出発・到着時刻を確認できた場合だけ結果を表示します。航空時刻表の提供元が接続されるまで航空区間は作成しません。", transitDataCredit: "公共交通データ：Transitous・OpenStreetMap", selectedPeople: "{count}人で均等に分割",
    routeMap: "旅行ルート地図", mapControls: "地図操作", zoomIn: "地図を拡大", zoomOut: "地図を縮小", fitMap: "ルート全体を表示", mapHelp: "ボタンまたはマウスホイールで拡大・縮小できます。ドラッグすると地図を移動できます。", mapAttribution: "地図データ：Natural Earth",
    metadataTitle: "Together | 公開時刻表で確認する複数都市旅行", metadataDescription: "公開された出発・到着時刻がある鉄道と長距離バスで複数都市旅行を作成・共有・保存し、旅費を精算できます。", ogAlt: "エッフェル塔を背景にしたTogetherの旅行計画", offlineTitle: "インターネット接続が必要です", offlineDescription: "接続を確認してから、Togetherをもう一度開いてください。",
  },
  zh: {
    route: "路线", trips: "我的旅行", expenses: "旅行账本", profile: "个人资料",
    routeTitle: "通过公开时刻表核验多城市路线。", routeDescription: "只比较所选日期有公开出发和抵达时间的铁路与长途巴士。",
    cities: "要去的城市", addCity: "添加城市", searchCity: "搜索城市或国家", searchWorldCities: "搜索全球城市", citySearchPlaceholder: "输入全球任一城市", citySearchHint: "输入一个或更多字符即可添加城市。", noCityResults: "未找到城市。", citySearchError: "城市搜索暂时不可用。", geocodingCredit: "城市数据：GeoNames · Open‑Meteo", wikidataCredit: "多语言别名：Wikidata", departure: "出发日期", startCity: "出发城市", endCity: "终点城市", findRoute: "查找最快路线",
    optimizedOrder: "已核验的旅行顺序", exactOptimization: "对全部已核验区段精确优化", fastApproximation: "基于已核验时刻表的近似顺序 · 不保证最短", totalTravel: "总移动时间", legs: "段",
    observed: "已核验交通数据", scheduled: "公开时刻表", estimated: "未核验数据", mixedData: "混合数据", unavailable: "暂无数据", dataSource: "数据依据", expand: "查看明细", collapse: "收起明细",
    share: "分享链接", pdf: "保存 PDF", save: "保存到我的旅行", copied: "分享链接已复制。", pdfReady: "PDF 已下载。", saved: "已保存到本设备的我的旅行。", shareLedger: "分享账本链接", ledgerCopied: "账本分享链接已复制。", ledgerPdf: "将账本保存为 PDF", ledgerSharePrivacy: "任何拥有账本链接的人都可以查看成员姓名和支出明细。", sharedLedgerPreview: "共享账本预览", sharedLedgerPreviewHelp: "此链接中的账本为只读，不包含个人资料和本人指定信息。", saveSharedLedger: "将账本保存到本设备", sharedLedgerSaved: "共享账本已保存到本设备。", sharedLedgerConflict: "本设备已有账本，因此未覆盖。请先分享或导出现有账本，再自行清空。", ledgerShareError: "无法分享账本，请检查数据大小和浏览器设置。",
    savedTrips: "已保存的旅行", savedTripsDesc: "旅行保存在本设备的当前浏览器中。", noTrips: "还没有保存的旅行。", open: "打开", remove: "删除", private: "私密", updated: "更新", recheckTimetable: "需要重新核验时刻表",
    expenseTitle: "共同旅行开支，清楚结算。", expenseDescription: "请自行添加成员和支出，再在选定成员之间准确分摊。", totalExpense: "总支出", myExpense: "我的支出", receiveAfter: "应收金额", addExpense: "添加支出", category: "类别", description: "说明", amount: "金额", paidBy: "付款人", splitWith: "分摊成员", splitMethod: "分摊方式", equal: "平均", saveExpense: "保存支出", settlement: "谁付给谁", settleDone: "标记已结算", all: "全部", accommodation: "住宿", transport: "交通", food: "餐饮", activities: "景点", shopping: "购物", other: "其他", expenseSaved: "旅行账本已保存到本设备。",
    people: "成员", personName: "输入姓名", addPerson: "添加成员", chooseYourself: "哪位成员是你？", duplicatePerson: "已存在同名成员。", personInUse: "该成员已包含在支出中，无法删除。", addPeopleFirst: "请先添加至少一名成员。", membersCount: "{count}名成员", noExpenses: "还没有支出。请仅添加实际发生的支出。", noSettlement: "目前没有需要结算的款项。",
    profileTitle: "介绍你的旅行方式。", profileDescription: "所有项目均为选填，并且仅保存在本设备上。", name: "姓名", ageBand: "年龄段", smoking: "吸烟", drinking: "饮酒", mbti: "MBTI", unspecified: "未选择", yes: "是", no: "否", profileSave: "保存资料", profileSaved: "个人资料已保存到本设备。",
    privacyTitle: "设备存储与可见范围", privacyText: "旅行、账本和个人资料仅保存在本设备的当前浏览器中。分享内容只包含所选路线或账本，不包含个人资料。",
    currency: "欧元", language: "语言", menu: "菜单", close: "关闭", retry: "重试", loading: "加载中", guest: "未填写姓名", cityLimit: "请至少选择2个城市。", duplicateCity: "同一城市只能选择一次。", providerRequired: "显示的每个区段都有公开出发和抵达时间。", dataUpdated: "核验时间",
    deviceOnly: "仅保存在本设备", deviceStorageHelp: "数据仅保存在本设备的当前浏览器中。清除浏览器数据时也会被删除。", deviceSaveError: "无法保存到本设备，请检查浏览器的存储设置。", storageLimit: "已达到本设备的存储上限，无法继续添加。",
    brandHome: "Together 首页", primaryNavigation: "主导航", mobileNavigation: "移动端导航", mobilePrimaryNavigation: "移动端主导航", moveUp: "上移", moveDown: "下移", pdfError: "无法生成 PDF，请重试。",
    scheduleLoading: "正在查询公开时刻表", scheduleFound: "已核验所有候选区段的出发与抵达时间。", schedulePartial: "未能核验所需的全部区段。", scheduleChecked: "公开时刻表核验完成。", scheduleUnavailable: "没有可用的已核验时刻表。", verifiedRouteUnavailable: "没有可完整核验的路线", verifiedRouteUnavailableHelp: "只有所有候选区段都有公开出发和抵达时间时才会显示结果。在接入航班时刻表提供方之前，不会生成航班区段。", transitDataCredit: "公共交通数据：Transitous · OpenStreetMap", selectedPeople: "由{count}人平均分摊",
    routeMap: "旅行路线地图", mapControls: "地图控制", zoomIn: "放大地图", zoomOut: "缩小地图", fitMap: "显示完整路线", mapHelp: "可使用按钮或鼠标滚轮缩放地图，拖动可移动地图。", mapAttribution: "地图数据：Natural Earth",
    metadataTitle: "Together | 公开时刻表核验的多城市旅行", metadataDescription: "使用有公开出发与抵达时间的铁路和长途巴士创建、分享、保存多城市旅行并分摊费用。", ogAlt: "以埃菲尔铁塔为背景的 Together 旅行规划", offlineTitle: "需要连接互联网", offlineDescription: "请检查网络连接，然后重新打开 Together。",
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
