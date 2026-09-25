import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  query,
  orderBy,
  limit,
  startAfter,
  onSnapshot,
  getCountFromServer
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCcO5oXonWAMTCcdRRa1Q-bczWCyhZdwog',
  authDomain: 'test-2eb64.firebaseapp.com',
  projectId: 'test-2eb64',
  storageBucket: 'test-2eb64.firebasestorage.app',
  messagingSenderId: '49121312615',
  appId: '1:49121312615:web:973e681cd224fb0530b9c2'
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// One query per page: never returns more than `pageSize` rows (10/20/50).
// `cursor` is the last doc of the previous page (null = first page).
export const subscribeUsageLogsPage = (cursor, pageSize, onDocs, onError) => {
  const constraints = [orderBy('timestamp', 'desc'), limit(pageSize)];

  if (cursor) {
    constraints.push(startAfter(cursor));
  }

  return onSnapshot(query(collection(db, 'usage_logs'), ...constraints), (snapshot) => {
    onDocs(snapshot.docs);
  }, onError);
};

// Total number of documents in usage_logs (cheap aggregation, not a scan).
export const countUsageLogs = async () => {
  const snapshot = await getCountFromServer(collection(db, 'usage_logs'));
  return snapshot.data().count;
};

export const subscribeEntriesCache = (onEntries, onError) => {
  const entriesQuery = query(collection(db, 'entries_cache'), limit(1));

  return onSnapshot(
    entriesQuery,
    (snapshot) => {
      if (snapshot.empty) {
        onEntries([]);
        return;
      }
      const docSnapshot = snapshot.docs[0];
      onEntries(docSnapshot.data().entries ?? []);
    },
    onError
  );
};

export { db };
