import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';

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

export const subscribeUsageLogs = (onLogs, onError) => {
  const logsQuery = query(
    collection(db, 'usage_logs'),
    orderBy('timestamp', 'desc'),
    limit(50)
  );

  return onSnapshot(
    logsQuery,
    (snapshot) => {
      const logs = snapshot.docs.map((docSnapshot) => ({
        id: docSnapshot.id,
        ...docSnapshot.data()
      }));
      onLogs(logs);
    },
    onError
  );
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
