import { initializeApp, type FirebaseOptions } from "firebase/app";
import { connectAuthEmulator, getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, runTransaction } from "firebase/firestore";
import { initialRoster, readDay, readParticipants, type Roster, type SavedDay } from "./ledger.js";
import type { LedgerStore } from "./store.js";

export type CloudConfig = {
  firebase: FirebaseOptions;
  emulator?: { authPort: number; firestorePort: number };
};

export function connectFirestore(config: CloudConfig) {
  const app = initializeApp(config.firebase);
  const auth = getAuth(app);
  const database = getFirestore(app);
  const provider = new GoogleAuthProvider();
  if (config.emulator) {
    const host = window.location.hostname;
    if (!["localhost", "127.0.0.1"].includes(host) || !config.firebase.projectId?.startsWith("demo-")) {
      throw new Error("Firebase emulators require a local demo project.");
    }
    connectAuthEmulator(auth, "http://" + host + ":" + config.emulator.authPort, { disableWarnings: true });
    connectFirestoreEmulator(database, host, config.emulator.firestorePort);
  }

  function storeFor(uid: string): LedgerStore {
    const owner = doc(database, "ledgers", uid);
    const profile = doc(owner, "profile", "participants");
    const days = collection(owner, "days");

    return {
      async load() {
        const daySnapshots = await getDocs(days);
        const profileSnapshot = await getDoc(profile);
        let roster = initialRoster();
        if (profileSnapshot.exists()) {
          const { participants, revision } = profileSnapshot.data();
          const validated = readParticipants(participants);
          if (!validated || typeof revision !== "string") throw new Error("The saved participant list is invalid.");
          roster = { participants: validated, revision };
        }
        const saved = daySnapshots.docs.map((snapshot): SavedDay => {
          const { day, revision } = snapshot.data();
          const validated = readDay(day, snapshot.id, roster.participants);
          if (!validated || typeof revision !== "string") throw new Error("A saved lunch entry is invalid. Reload its latest version.");
          return { day: validated, revision };
        });
        return { roster, days: saved };
      },
      async saveDay(day, revision) {
        const reference = doc(days, day.date);
        const saved = { day, revision: crypto.randomUUID() };
        await runTransaction(database, async (transaction) => {
          const current = await transaction.get(reference);
          if ((current.data()?.revision ?? null) !== revision) {
            throw new Error("This lunch day changed elsewhere. Reload the app before editing it.");
          }
          transaction.set(reference, saved);
        });
        return saved;
      },
      async saveRoster(participants, revision) {
        const saved: Roster = { participants, revision: crypto.randomUUID() };
        await runTransaction(database, async (transaction) => {
          const current = await transaction.get(profile);
          if ((current.data()?.revision ?? null) !== revision) {
            throw new Error("Participants changed elsewhere. Reload the app before editing them.");
          }
          transaction.set(profile, saved);
        });
        return saved;
      },
    };
  }

  return {
    signIn: () => signInWithPopup(auth, provider),
    signOut: () => signOut(auth),
    watch(callback: (session: { store: LedgerStore; email: string | null } | null) => void) {
      return onAuthStateChanged(auth, (user) =>
        callback(user ? { store: storeFor(user.uid), email: user.email } : null));
    },
  };
}
