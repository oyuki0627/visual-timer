// 作業・休憩の記録を IndexedDB に保存する
const NAME = 'visual-timer';
const VERSION = 1;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('sessions')) {
          const store = db.createObjectStore('sessions', { keyPath: 'id' });
          store.createIndex('start', 'start');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', mode);
    const req = fn(tx.objectStore('sessions'));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

export const putSession = (s) => run('readwrite', (st) => st.put(s));
export const deleteSession = (id) => run('readwrite', (st) => st.delete(id));
export const getSession = (id) => run('readonly', (st) => st.get(id));
export const allSessions = () => run('readonly', (st) => st.getAll());

// 開始時刻が from 以上 to 未満の記録
export const getSessions = (from, to) =>
  run('readonly', (st) => st.index('start').getAll(IDBKeyRange.bound(from, to, false, true)));
