import { Capacitor, registerPlugin } from "@capacitor/core";
import type { NativeAutomationConfiguration, NativeEventAcknowledgement } from "./cardAutomation";
import { normalizeIosTransactionInput, parseIosTransactionInput } from "./iosTransactionInput";

export interface CardAutomationStatus {
  readonly supported: boolean;
  readonly accessGranted: boolean;
  readonly alertPermissionGranted: boolean;
  /** iOS receives only the data the user forwards using Shortcuts. */
  readonly captureMode?: "ios-shortcuts";
  readonly captureEnabled?: boolean;
  readonly lastShortcutReceivedAt?: number;
  readonly queuedInputs?: number;
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
  setCaptureEnabled(options: { readonly enabled: boolean }): Promise<void>;
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
  const ios = status.captureMode === "ios-shortcuts";
  return Object.freeze({ supported: status.supported === true, accessGranted: status.accessGranted === true, alertPermissionGranted: status.alertPermissionGranted === true, recentChecks: Object.freeze(recentChecks), ...timestamps, ...(ios ? { captureMode: "ios-shortcuts" as const, captureEnabled: status.captureEnabled === true,
    ...(typeof status.lastShortcutReceivedAt === "number" && Number.isSafeInteger(status.lastShortcutReceivedAt) && status.lastShortcutReceivedAt > 0 && status.lastShortcutReceivedAt < 8.64e15 ? { lastShortcutReceivedAt: status.lastShortcutReceivedAt } : {}),
    ...(typeof status.queuedInputs === "number" && Number.isSafeInteger(status.queuedInputs) && status.queuedInputs >= 0 && status.queuedInputs <= 5_000 ? { queuedInputs: status.queuedInputs } : {}) } : {}), ...(typeof status.listenerConnected === "boolean" && !ios ? { listenerConnected: status.listenerConnected } : {}), ...(lastRecoveryError === "rebind_failed" || lastRecoveryError === "scan_failed" || lastRecoveryError === "processing_failed" ? { lastRecoveryError } : {}) });
}
function isMobile(): boolean { return Capacitor.getPlatform() === "android" || Capacitor.getPlatform() === "ios"; }

export function cardAutomationConnectionState(status: CardAutomationStatus): "unsupported" | "access-required" | "disconnected" | "connected" | "unknown" | "shortcuts" {
  if (!status.supported) return "unsupported";
  if (!status.accessGranted) return "access-required";
  if (status.captureMode === "ios-shortcuts") return "shortcuts";
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
  isAvailable(): boolean { return isMobile(); },
  isIos(): boolean { return Capacitor.getPlatform() === "ios"; },
  async getStatus(): Promise<CardAutomationStatus> { return isMobile() ? normalizeCardAutomationStatus(await withNativeReadDeadline(NativeCardAutomation.getStatus(), 8_000)) : UNSUPPORTED_CARD_AUTOMATION_STATUS; },
  async openAccessSettings(): Promise<void> { if (isMobile()) await NativeCardAutomation.openAccessSettings(); },
  async requestAlertPermission(): Promise<void> { if (isMobile()) await NativeCardAutomation.requestAlertPermission(); },
  async setCaptureEnabled(enabled: boolean): Promise<void> { if (Capacitor.getPlatform() === "ios") await NativeCardAutomation.setCaptureEnabled({ enabled }); },
  async peekPendingEvents(): Promise<unknown> {
    if (!isMobile()) return Object.freeze({ events: Object.freeze([]) });
    const response = await withNativeReadDeadline(NativeCardAutomation.peekPendingEvents(), 8_000);
    return Capacitor.getPlatform() === "ios" ? normalizeIosInbox(response) : response;
  },
  async acknowledgeEvents(options: { readonly events: readonly NativeEventAcknowledgement[] }): Promise<void> { if (isMobile() && options.events.length) await NativeCardAutomation.acknowledgeEvents(options); },
  async configure(options: NativeAutomationConfiguration): Promise<void> { if (isMobile()) await NativeCardAutomation.configure(options); },
  async recheckActiveNotifications(): Promise<void> { if (isMobile()) await withNativeReadDeadline(NativeCardAutomation.recheckActiveNotifications(), 35_000); },
});

/** Keep rejected envelope identities in the normal save-before-ack pipeline.
 * Unexpected parser errors propagate, leaving the durable inbox untouched. */
export function normalizeIosInbox(value: unknown): { readonly events: readonly unknown[] } {
  if (typeof value !== "object" || value === null || !Array.isArray((value as { inputs?: unknown }).inputs)) throw new Error("ios-inbox-invalid");
  const inputs = (value as { inputs: unknown[] }).inputs;
  if (inputs.length > 5_000) throw new Error("ios-inbox-limit");
  return Object.freeze({ events: Object.freeze(inputs.map((raw) => {
    const normalized = normalizeIosTransactionInput(raw);
    if (normalized) return parseIosTransactionInput(normalized) ?? { id: normalized.id, queueToken: normalized.queueToken };
    // Let the common batch validator acknowledge only safely bounded tokens.
    if (typeof raw === "object" && raw !== null) {
      const item = raw as Record<string, unknown>;
      return { id: item.id, queueToken: item.queueToken };
    }
    return null;
  })) });
}
