/** Public Firebase web configuration, not an administrator credential.
 * Wallet Diary Spark project; optional shared trips only. No Analytics SDK.
 * Never place service-account keys, billing credentials or payment data here. */
export type SharedTravelFirebaseConfig = {
  apiKey: string; projectId: string; appId: string; authDomain: string;
};
export const SHARED_TRAVEL_FIREBASE_CONFIG: SharedTravelFirebaseConfig | null = {
  apiKey: "AIzaSyDYFvtbhGp3zZVEjJUp4CvEf0PCPeQy5uY",
  projectId: "wallet-diary-c2a1a",
  appId: "1:609381247951:web:6355e8d3ed31588a1540ba",
  authDomain: "wallet-diary-c2a1a.firebaseapp.com",
};
