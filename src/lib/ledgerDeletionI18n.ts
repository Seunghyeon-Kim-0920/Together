import type { Locale } from "./types";

const copy = {
  ko: {
    scope: "삭제 범위", device: "이 기기에서만 삭제", leave: "여행에서 나가고 이 기기에서 삭제", everyone: "공동 여행과 이 기기 가계부 삭제",
    deviceWarning: "이 기기의 가계부와 지출을 삭제합니다. 서버의 여행과 참여 권한, 다른 사람의 가계부는 그대로 유지됩니다. 다시 보려면 사본이나 초대가 필요할 수 있습니다.",
    leaveWarning: "공동 여행 참여를 종료하고 이 기기의 가계부를 삭제합니다. 다른 사람의 여행과 이미 공유된 지출은 유지됩니다.",
    everyoneWarning: "서버의 공동 여행과 이 기기의 가계부를 삭제합니다. 모든 참가자의 동기화가 종료됩니다. 다른 사람이 이미 내려받은 사본은 지울 수 없습니다.",
    pendingWarning: "아직 전송되지 않은 지출도 이 기기에서 삭제됩니다. 필요하면 먼저 PDF 또는 가계부 파일로 보관하세요.",
    busy: "처리 중…", failed: "삭제가 완료되지 않았습니다. 가계부는 기기에 남아 있습니다. 연결을 확인하고 재시도하거나 이 기기에서만 삭제를 선택하세요.",
    sharedRename: "공동 여행의 이름은 이 메뉴에서 변경할 수 없습니다.",
  },
  en: {
    scope: "Deletion scope", device: "Delete only from this device", leave: "Leave trip and delete from this device", everyone: "Delete shared trip and this ledger",
    deviceWarning: "Delete this device’s ledger and expenses. The server trip, membership and other people’s ledgers remain unchanged. A backup or invitation may be needed to return.",
    leaveWarning: "Leave the shared trip and delete this device’s ledger. Other members’ trip and expenses already shared remain available.",
    everyoneWarning: "Delete the shared trip from the server and this device’s ledger. Synchronization ends for everyone. Copies already downloaded by others cannot be erased.",
    pendingWarning: "Unsent expenses will also be deleted from this device. Export a PDF or ledger file first if you need a backup.",
    busy: "Processing…", failed: "Deletion did not complete. The ledger remains on this device. Check the connection and retry, or choose device-only deletion.",
    sharedRename: "The shared trip name cannot be changed from this menu.",
  },
  fr: {
    scope: "Portée de la suppression", device: "Supprimer uniquement sur cet appareil", leave: "Quitter le voyage et supprimer ce carnet", everyone: "Supprimer le voyage partagé et ce carnet",
    deviceWarning: "Supprime le carnet et les dépenses de cet appareil. Le voyage sur le serveur, votre accès et les carnets des autres restent inchangés. Une sauvegarde ou une invitation peut être nécessaire pour revenir.",
    leaveWarning: "Quitte le voyage partagé et supprime le carnet de cet appareil. Le voyage des autres membres et les dépenses déjà partagées sont conservés.",
    everyoneWarning: "Supprime le voyage du serveur et le carnet de cet appareil. La synchronisation s’arrête pour tous. Les copies déjà téléchargées par les autres ne peuvent pas être effacées.",
    pendingWarning: "Les dépenses non envoyées seront aussi supprimées de cet appareil. Exportez d’abord un PDF ou un fichier de carnet si vous souhaitez une sauvegarde.",
    busy: "Traitement…", failed: "La suppression n’est pas terminée. Le carnet reste sur cet appareil. Vérifiez la connexion et réessayez, ou choisissez la suppression locale uniquement.",
    sharedRename: "Le nom du voyage partagé ne peut pas être modifié depuis ce menu.",
  },
} as const;
export function ledgerDeletionText(locale: Locale, key: keyof typeof copy.en): string { return copy[locale][key]; }
