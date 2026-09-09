import { Capacitor, registerPlugin } from "@capacitor/core";
import type { NativeAutomationConfiguration, NativeEventAcknowledgement } from "./cardAutomation";

export interface CardAutomationStatus {
  readonly supported: boolean;
  readonly accessGranted: boolean;
  readonly alertPermissionGranted: boolean;
  readonly listenerConnected?: boolean;
  readonly lastListenerConnectedAt?: number;
  readonly lastListenerDisconnectedAt?: number;
  readonly lastRecoveryRequestedAt?: number;
  readonly lastProcessingFailureAt?: number;
  readonly lastRecoveryError?: "rebind_failed" | "scan_failed" | "processing_failed";
  readonly recentChecks?: readonly { readonly packageName: string; readonly sourceName: string; readonly checkedAt: number; readonly recognized: boolean }[];
}

interface CardAutomationNativePlugin {
  getStatus(): Promise<unknown>;
  openAccessSettings(): Promise<void>;
  requestAlertPermission(): Promise<void>;
  peekPendingEvents(): Promise<unknown>;
  acknowledgeEvents(options: { readonly events: readonly NativeEventAcknowledgement[] }): Promise<void>;
  configure(options: NativeAutomationConfiguration): Promise<void>;
  recheckActiveNotifications(): Promise<unknown>;
}

const NativeCardAutomation = registerPlugin<CardAutomationNativePlugin>("CardAutomation");
export const UNSUPPORTED_CARD_AUTOMATION_STATUS: CardAutomationStatus = Object.freeze({ supported: false, accessGranted: false, alertPermissionGranted: false });

export function normalizeCardAutomationStatus(value: unknown): CardAutomationStatus {
  if (typeof value !== "object" || value === null) return UNSUPPORTED_CARD_AUTOMATION_STATUS;
  const status = value as Record<string, unknown>;
  const recentChecks = Array.isArray(status.recentChecks) ? status.recentChecks.slice(0, 20).flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) return [];
    const check = item as Record<string, unknown>;
    return typeof check.packageName === "string" && typeof check.sourceName === "string" && typeof check.checkedAt === "number" && Number.isSafeInteger(check.checkedAt) && check.checkedAt > 0 && check.checkedAt < 8.64e15 && typeof check.recognized === "boolean"
      ? [Object.freeze({ packageName: check.packageName.slice(0, 200), sourceName: check.sourceName.slice(0, 80), checkedAt: check.checkedAt, recognized: check.recognized })] : [];
  }) : [];
  const timestamps: Partial<Record<"lastListenerConnectedAt" | "lastListenerDisconnectedAt" | "lastRecoveryRequestedAt" | "lastProcessingFailureAt", number>> = {};
  for (const key of ["lastListenerConnectedAt", "lastListenerDisconnectedAt", "lastRecoveryRequestedAt", "lastProcessingFailureAt"] as const) {
    const timestamp = status[key];
    if (typeof timestamp === "number" && Number.isSafeInteger(timestamp) && timestamp > 0 && timestamp < 8.64e15) timestamps[key] = timestamp;
  }
  const lastRecoveryError = status.lastRecoveryError;
  return Object.freeze({ supported: status.supported === true, accessGranted: status.accessGranted === true, alertPermissionGranted: status.alertPermissionGranted === true, recentChecks: Object.freeze(recentChecks), ...timestamps, ...(typeof status.listenerConnected === "boolean" ? { listenerConnected: status.listenerConnected } : {}), ...(lastRecoveryError === "rebind_failed" || lastRecoveryError === "scan_failed" || lastRecoveryError === "processing_failed" ? { lastRecoveryError } : {}) });
}
function isAndroid(): boolean { return Capacitor.getPlatform() === "android"; }

export function cardAutomationConnectionState(status: CardAutomationStatus): "unsupported" | "access-required" | "disconnected" | "connected" | "unknown" {
  if (!status.supported) return "unsupported";
  if (!status.accessGranted) return "access-required";
  if (status.listenerConnected === false) return "disconnected";
  return status.listenerConnected === true ? "connected" : "unknown";
}

/** Only read/recovery calls may time out. Configuration and acknowledgement
 * must retain their native completion semantics before durable work advances. */
export function withNativeReadDeadline<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error("notification-native-read-timeout")), milliseconds);
    operation.then((value) => { globalThis.clearTimeout(timer); resolve(value); }, (error: unknown) => { globalThis.clearTimeout(timer); reject(error); });
  });
}

export const cardAutomationPlugin = Object.freeze({
  isAvailable(): boolean { return isAndroid(); },
  async getStatus(): Promise<CardAutomationStatus> { return isAndroid() ? normalizeCardAutomationStatus(await withNativeReadDeadline(NativeCardAutomation.getStatus(), 8_000)) : UNSUPPORTED_CARD_AUTOMATION_STATUS; },
  async openAccessSettings(): Promise<void> { if (isAndroid()) await NativeCardAutomation.openAccessSettings(); },
  async requestAlertPermission(): Promise<void> { if (isAndroid()) await NativeCardAutomation.requestAlertPermission(); },
  async peekPendingEvents(): Promise<unknown> { return isAndroid() ? withNativeReadDeadline(NativeCardAutomation.peekPendingEvents(), 8_000) : Object.freeze({ events: Object.freeze([]) }); },
  async acknowledgeEvents(options: { readonly events: readonly NativeEventAcknowledgement[] }): Promise<void> { if (isAndroid() && options.events.length) await NativeCardAutomation.acknowledgeEvents(options); },
  async configure(options: NativeAutomationConfiguration): Promise<void> { if (isAndroid()) await NativeCardAutomation.configure(options); },
  async recheckActiveNotifications(): Promise<void> { if (isAndroid()) await withNativeReadDeadline(NativeCardAutomation.recheckActiveNotifications(), 35_000); },
});
