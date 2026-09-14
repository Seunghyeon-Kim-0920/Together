import type { Locale } from "./types";

const ko = {
  title: "PDF 저장 기간", saveHelp: "원하는 기간의 내역을 PDF로 저장합니다. 휴대폰 저장 위치를 선택하세요.",
  period: "선택한 기간", all: "전체 기간", custom: "기간 선택", from: "시작 날짜", to: "마지막 날짜",
  inclusive: "시작 날짜와 마지막 날짜의 지출을 모두 포함합니다. 선택한 기간 밖의 내역은 PDF와 첨부 원본 데이터에 포함하지 않습니다.",
  invalid: "올바른 시작 날짜와 마지막 날짜를 선택해주세요. 마지막 날짜는 시작 날짜보다 빠를 수 없습니다.",
  count: "포함할 내역", empty: "이 기간에 지출 내역이 없습니다. 빈 내역과 선택한 기간을 PDF로 저장할 수 있습니다.",
};
type Key = keyof typeof ko;
const en: Record<Key, string> = {
  title: "PDF date range", saveHelp: "Save expenses from your chosen dates as a PDF. Choose a location on your phone.",
  period: "Selected date range", all: "All dates", custom: "Choose dates", from: "Start date", to: "End date",
  inclusive: "Includes expenses on both the start and end dates. Expenses outside this range are excluded from the PDF and its original-data attachment.",
  invalid: "Choose valid start and end dates. The end date cannot be before the start date.",
  count: "Included expenses", empty: "There are no expenses in this range. You can save an empty report showing the selected dates.",
};
const fr: Record<Key, string> = {
  title: "Période du PDF", saveHelp: "Enregistrez les dépenses de la période choisie dans un PDF. Choisissez un emplacement sur le téléphone.",
  period: "Période sélectionnée", all: "Toutes les dates", custom: "Choisir une période", from: "Date de début", to: "Date de fin",
  inclusive: "Les dépenses des dates de début et de fin sont incluses. Les dépenses hors période sont exclues du PDF et des données originales jointes.",
  invalid: "Choisissez des dates valides. La date de fin ne peut pas précéder la date de début.",
  count: "Dépenses incluses", empty: "Aucune dépense pour cette période. Vous pouvez enregistrer un rapport vide indiquant les dates sélectionnées.",
};

export function pdfExportText(locale: Locale, key: Key): string { return ({ ko, en, fr })[locale][key]; }
