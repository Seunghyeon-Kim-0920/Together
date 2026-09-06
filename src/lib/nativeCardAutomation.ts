import { Capacitor, registerPlugin } from "@capacitor/core";
import type { NativeAutomationConfiguration, NativeEventAcknowledgement } from "./cardAutomation";

export interface CardAutomationStatus {
  readonly supported: boolean;
  readonly accessGranted: boolean;
  readonly alertPermissionGranted: boolean;
  readonly listenerConnected?: boolean;
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

function normalizeStatus(value: unknown): CardAutomationStatus {
  if (typeof value !== "object" || value === null) return UNSUPPORTED_CARD_AUTOMATION_STATUS;
  const status = value as Record<string, unknown>;
  return Object.freeze({ supported: status.supported === true, accessGranted: status.accessGranted === true, alertPermissionGranted: status.alertPermissionGranted === true, ...(typeof status.listenerConnected === "boolean" ? { listenerConnected: status.listenerConnected } : {}) });
}
function isAndroid(): boolean { return Capacitor.getPlatform() === "android"; }

export const cardAutomationPlugin = Object.freeze({
  isAvailable(): boolean { return isAndroid(); },
  async getStatus(): Promise<CardAutomationStatus> { return isAndroid() ? normalizeStatus(await NativeCardAutomation.getStatus()) : UNSUPPORTED_CARD_AUTOMATION_STATUS; },
  async openAccessSettings(): Promise<void> { if (isAndroid()) await NativeCardAutomation.openAccessSettings(); },
  async requestAlertPermission(): Promise<void> { if (isAndroid()) await NativeCardAutomation.requestAlertPermission(); },
  async peekPendingEvents(): Promise<unknown> { return isAndroid() ? NativeCardAutomation.peekPendingEvents() : Object.freeze({ events: Object.freeze([]) }); },
  async acknowledgeEvents(options: { readonly events: readonly NativeEventAcknowledgement[] }): Promise<void> { if (isAndroid() && options.events.length) await NativeCardAutomation.acknowledgeEvents(options); },
  async configure(options: NativeAutomationConfiguration): Promise<void> { if (isAndroid()) await NativeCardAutomation.configure(options); },
  async recheckActiveNotifications(): Promise<void> { if (isAndroid()) await NativeCardAutomation.recheckActiveNotifications(); },
});
