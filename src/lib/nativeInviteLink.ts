import { Capacitor, registerPlugin } from "@capacitor/core";
import { inviteFromDeepLink, inviteFromInstallReferrer } from "./inviteLink";

interface InviteLinkNativePlugin {
  consumeInstallReferrer(): Promise<{ readonly referrer?: unknown }>;
  addListener(eventName: "inviteLink", listener: (event: { readonly url?: unknown }) => void): Promise<{ remove: () => Promise<void> }>;
}

const NativeInviteLink = registerPlugin<InviteLinkNativePlugin>("InviteLink");
const subscribers = new Set<(code: string) => void>();
let started = false;
let buffered: string | null = null;
let referrerInvite: Promise<string | null> | null = null;

function available(): boolean {
  return Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("InviteLink");
}

function deliver(code: string): void {
  if (!subscribers.size) { buffered = code; return; }
  for (const subscriber of [...subscribers]) subscriber(code);
}

/** One native listener for the whole session. A link that arrives while no
 * screen is subscribed (cold start, remount) waits for the next subscriber. */
export function listenForInviteLinks(onInvite: (code: string) => void): () => void {
  if (!available()) return () => undefined;
  subscribers.add(onInvite);
  if (!started) {
    started = true;
    void NativeInviteLink.addListener("inviteLink", (event) => {
      const code = inviteFromDeepLink(event?.url);
      if (code) deliver(code);
    }).catch(() => { started = false; });
  }
  if (buffered) {
    const code = buffered; buffered = null;
    queueMicrotask(() => { if (subscribers.has(onInvite)) onInvite(code); else buffered = code; });
  }
  return () => { subscribers.delete(onInvite); };
}

/** Keep the native result intact. The native bridge owns the bounded timeout
 * and only marks a definitive result consumed; an independent JS race would
 * discard a late result after native code has already consumed it. */
export async function readInstallReferrerInvite(read: () => Promise<{ readonly referrer?: unknown }>): Promise<string | null> {
  try { return inviteFromInstallReferrer((await read())?.referrer); }
  catch { return null; }
}

/** An invitation that survived a Play Store installation. Native code hands the
 * referrer over once; repeated calls in the same session share that answer. */
export function consumeInstallReferrerInvite(): Promise<string | null> {
  if (!available()) return Promise.resolve(null);
  referrerInvite ??= readInstallReferrerInvite(() => NativeInviteLink.consumeInstallReferrer());
  return referrerInvite;
}
