import {
  buildLocalItemRows,
  mergeRemoteItems,
  mergeRemoteLearning,
  migrateLegacyState,
  nextTimestamp,
  normalizeMeta,
} from "./sync-core.mjs?v=7";

const STORAGE = {
  status: "vietnameseVocab2063.status.v1",
  wrong: "vietnameseVocab2063.wrong.v1",
  daily: "vietnameseVocab2063.daily.v1",
  lastWord: "vietnameseVocab2063.lastWord.v1",
  meta: "vietnameseVocab2063.syncMeta.v1",
  queue: "vietnameseVocab2063.syncQueue.v1",
  owner: "vietnameseVocab2063.syncOwner.v1",
  lastSync: "vietnameseVocab2063.lastSync.v1",
  sessionHint: "vietnameseVocab2063.syncSessionHint.v1",
};

const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
const config = window.VOCAB_SYNC_CONFIG || {};
const configured = /^https:\/\/.+\.supabase\.co\/?$/i.test(config.supabaseUrl || "")
  && /^(sb_publishable_|eyJ)/.test(config.supabasePublishableKey || "");

let client = null;
let currentUser = null;
let syncTimer = null;
let syncInFlight = false;
let syncRequested = false;
let syncState = configured ? "local" : "disabled";
let syncMessage = "이 기기에만 저장 중";
const ui = {};

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function saveSessionHint(user) {
  if (user) {
    writeJson(STORAGE.sessionHint, { id: user.id, email: user.email || "" });
  } else {
    localStorage.removeItem(STORAGE.sessionHint);
  }
}

function readQueue() {
  const saved = readJson(STORAGE.queue, {});
  return {
    itemKeys: [...new Set(Array.isArray(saved.itemKeys) ? saved.itemKeys.map(String) : [])],
    learning: Boolean(saved.learning),
  };
}

function writeQueue(queue) {
  writeJson(STORAGE.queue, queue);
  renderSyncUi();
}

function markItemsDirty(keys) {
  const queue = readQueue();
  queue.itemKeys = [...new Set([...queue.itemKeys, ...keys.map(String)])];
  writeQueue(queue);
}

function markLearningDirty() {
  const queue = readQueue();
  queue.learning = true;
  writeQueue(queue);
}

function migrateLocalData() {
  const result = migrateLegacyState({
    statuses: readJson(STORAGE.status, {}),
    wrongKeys: readJson(STORAGE.wrong, []),
    dailySession: readJson(STORAGE.daily, null),
    lastWordKey: localStorage.getItem(STORAGE.lastWord),
    meta: readJson(STORAGE.meta, null),
  });
  if (result.changed) writeJson(STORAGE.meta, result.meta);
  return result.meta;
}

function takeTimestamp() {
  const result = nextTimestamp(readJson(STORAGE.meta, null));
  writeJson(STORAGE.meta, result.meta);
  return result;
}

function recordStatus(wordKey) {
  const { meta, timestamp } = takeTimestamp();
  meta.statusTimestamps[String(wordKey)] = timestamp;
  writeJson(STORAGE.meta, meta);
  markItemsDirty([wordKey]);
  scheduleSync();
}

function recordWrongKeys(previousKeys, nextKeys) {
  const before = new Set((previousKeys || []).map(String));
  const after = new Set((nextKeys || []).map(String));
  const changedKeys = [...new Set([...before, ...after])].filter((key) => before.has(key) !== after.has(key));
  if (!changedKeys.length) return;
  let { meta, timestamp } = takeTimestamp();
  for (const key of changedKeys) {
    meta.wrongTimestamps[key] = timestamp;
    timestamp += 1;
  }
  meta.clock = Math.max(meta.clock, timestamp - 1);
  writeJson(STORAGE.meta, meta);
  markItemsDirty(changedKeys);
  scheduleSync();
}

function recordDaily() {
  const { meta, timestamp } = takeTimestamp();
  meta.dailyTimestamp = timestamp;
  writeJson(STORAGE.meta, meta);
  markLearningDirty();
  scheduleSync();
}

function recordLastWord() {
  const { meta, timestamp } = takeTimestamp();
  meta.lastWordTimestamp = timestamp;
  writeJson(STORAGE.meta, meta);
  markLearningDirty();
  scheduleSync();
}

window.VocabSync = { recordStatus, recordWrongKeys, recordDaily, recordLastWord, syncNow: () => performSync(true) };

function bindUi() {
  [
    "homeSyncRow", "syncOpen", "syncButtonLabel", "syncDot", "syncDialog", "syncClose", "syncStatus",
    "syncLastTime", "syncSignedOut", "syncSignedIn", "syncEmail", "syncSendLink",
    "syncAccount", "syncNow", "syncLogout",
  ].forEach((id) => { ui[id] = document.getElementById(id); });

  if (!configured || !ui.syncOpen) return;
  ui.homeSyncRow.hidden = false;
  ui.syncOpen.hidden = false;
  ui.syncOpen.addEventListener("click", () => {
    renderSyncUi();
    ui.syncDialog.showModal();
  });
  ui.syncClose.addEventListener("click", () => ui.syncDialog.close());
  ui.syncDialog.addEventListener("click", (event) => {
    if (event.target === ui.syncDialog) ui.syncDialog.close();
  });
  ui.syncSendLink.addEventListener("click", sendMagicLink);
  ui.syncEmail.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendMagicLink();
  });
  ui.syncNow.addEventListener("click", () => performSync(true));
  ui.syncLogout.addEventListener("click", logout);
}

function renderSyncUi() {
  if (!ui.syncOpen || !configured) return;
  const queue = readQueue();
  const hasPending = queue.itemKeys.length > 0 || queue.learning;
  const offline = !navigator.onLine;
  const lastSync = Number(localStorage.getItem(STORAGE.lastSync) || 0);
  const sessionHint = readJson(STORAGE.sessionHint, null);
  const knownSession = currentUser || sessionHint;

  let buttonLabel = knownSession ? "동기화됨" : "동기화";
  let status = knownSession ? `${knownSession.email || "로그인됨"}` : "이 기기에만 저장 중";
  let tone = knownSession ? "good" : "local";
  if (offline && knownSession) {
    buttonLabel = hasPending ? "동기화 대기" : "오프라인";
    status = hasPending ? "인터넷 연결 시 자동 동기화" : "오프라인 사용 중";
    tone = "pending";
  } else if (syncState === "syncing") {
    buttonLabel = "동기화 중";
    status = "학습 기록을 맞추는 중";
    tone = "syncing";
  } else if (syncState === "error") {
    buttonLabel = "동기화 확인";
    status = syncMessage;
    tone = "error";
  } else if (hasPending && knownSession) {
    buttonLabel = "동기화 대기";
    status = "변경사항 저장 대기 중";
    tone = "pending";
  } else if (syncState === "local" && syncMessage) {
    status = syncMessage;
  }

  ui.syncButtonLabel.textContent = buttonLabel;
  ui.syncDot.className = `sync-dot ${tone}`;
  ui.syncStatus.textContent = status;
  ui.syncStatus.className = `sync-status ${tone}`;
  ui.syncLastTime.textContent = lastSync
    ? `마지막 동기화 ${new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(lastSync)}`
    : "아직 동기화하지 않음";
  ui.syncSignedOut.classList.toggle("hidden", Boolean(knownSession));
  ui.syncSignedIn.classList.toggle("hidden", !knownSession);
  ui.syncAccount.textContent = knownSession?.email || "";
}

function setSyncState(state, message = "") {
  syncState = state;
  syncMessage = message;
  renderSyncUi();
}

function loadSupabaseLibrary() {
  if (window.supabase?.createClient) return Promise.resolve(window.supabase);
  if (!navigator.onLine) return Promise.reject(new Error("인터넷 연결이 필요합니다."));
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SUPABASE_CDN}"]`);
    const script = existing || document.createElement("script");
    const timeout = window.setTimeout(() => reject(new Error("동기화 모듈을 불러오지 못했습니다.")), 12000);
    script.addEventListener("load", () => {
      window.clearTimeout(timeout);
      if (window.supabase?.createClient) resolve(window.supabase);
      else reject(new Error("동기화 모듈을 초기화하지 못했습니다."));
    }, { once: true });
    script.addEventListener("error", () => {
      window.clearTimeout(timeout);
      reject(new Error("동기화 모듈을 불러오지 못했습니다."));
    }, { once: true });
    if (!existing) {
      script.src = SUPABASE_CDN;
      script.async = true;
      script.crossOrigin = "anonymous";
      document.head.appendChild(script);
    }
  });
}

async function ensureClient() {
  if (client) return client;
  const library = await loadSupabaseLibrary();
  client = library.createClient(config.supabaseUrl.replace(/\/$/, ""), config.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
  });
  client.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user || null;
    saveSessionHint(currentUser);
    if (currentUser && event === "SIGNED_IN") clearAuthUrl();
    renderSyncUi();
    if (currentUser) window.setTimeout(() => scheduleSync(0), 0);
  });
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  currentUser = data.session?.user || null;
  saveSessionHint(currentUser);
  return client;
}

function loginRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

function clearAuthUrl() {
  const url = new URL(window.location.href);
  const hasAuthData = url.hash.includes("access_token") || url.searchParams.has("code");
  if (!hasAuthData) return;
  ["code", "error", "error_code", "error_description"].forEach((key) => url.searchParams.delete(key));
  url.hash = "";
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
}

async function sendMagicLink() {
  const email = ui.syncEmail.value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    setSyncState("error", "이메일 주소를 확인해 주세요.");
    return;
  }
  try {
    setSyncState("syncing");
    const supabaseClient = await ensureClient();
    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: loginRedirectUrl() },
    });
    if (error) throw error;
    setSyncState("local", "이메일에서 Sign in 링크를 눌러주세요.");
  } catch (error) {
    setSyncState("error", readableError(error));
  }
}

async function prepareOwner() {
  if (!currentUser) return false;
  const owner = localStorage.getItem(STORAGE.owner);
  if (owner && owner !== currentUser.id) {
    const replace = window.confirm("이 기기에는 다른 계정의 학습 기록이 있습니다. 이 기기 기록을 지우고 현재 계정 기록을 불러올까요?");
    if (!replace) {
      await client.auth.signOut({ scope: "local" });
      currentUser = null;
      saveSessionHint(null);
      setSyncState("local", "기존 기기 기록을 유지했습니다.");
      return false;
    }
    [STORAGE.status, STORAGE.wrong, STORAGE.daily, STORAGE.lastWord, STORAGE.meta, STORAGE.queue, STORAGE.lastSync]
      .forEach((key) => localStorage.removeItem(key));
    migrateLocalData();
    window.dispatchEvent(new CustomEvent("vocab-sync-applied"));
  }
  localStorage.setItem(STORAGE.owner, currentUser.id);
  return true;
}

function localSnapshot() {
  return {
    statuses: readJson(STORAGE.status, {}),
    wrongKeys: readJson(STORAGE.wrong, []),
    dailySession: readJson(STORAGE.daily, null),
    lastWordKey: localStorage.getItem(STORAGE.lastWord),
    meta: normalizeMeta(readJson(STORAGE.meta, null)),
  };
}

function persistSnapshot(snapshot) {
  writeJson(STORAGE.status, snapshot.statuses);
  writeJson(STORAGE.wrong, snapshot.wrongKeys);
  if (snapshot.dailySession) writeJson(STORAGE.daily, snapshot.dailySession);
  else localStorage.removeItem(STORAGE.daily);
  if (snapshot.lastWordKey) localStorage.setItem(STORAGE.lastWord, snapshot.lastWordKey);
  else localStorage.removeItem(STORAGE.lastWord);
  writeJson(STORAGE.meta, snapshot.meta);
}

async function fetchRemoteItems() {
  const rows = [];
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await client
      .from("user_vocab_items")
      .select("word_key,status,status_changed_at,is_wrong,wrong_changed_at")
      .eq("user_id", currentUser.id)
      .order("word_key", { ascending: true })
      .range(start, start + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function fetchRemoteLearning() {
  const { data, error } = await client
    .from("user_learning_state")
    .select("daily_session,daily_changed_at,last_word_key,last_word_changed_at")
    .eq("user_id", currentUser.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function mergeSnapshot(snapshot, remoteItems, remoteLearning) {
  const itemMerge = mergeRemoteItems(snapshot, remoteItems);
  const learningMerge = mergeRemoteLearning({
    dailySession: snapshot.dailySession,
    lastWordKey: snapshot.lastWordKey,
    meta: itemMerge.meta,
  }, remoteLearning);
  return {
    statuses: itemMerge.statuses,
    wrongKeys: itemMerge.wrongKeys,
    dailySession: learningMerge.dailySession,
    lastWordKey: learningMerge.lastWordKey,
    meta: learningMerge.meta,
    changed: itemMerge.changed || learningMerge.changed,
  };
}

async function upsertItems(rows) {
  for (let index = 0; index < rows.length; index += 300) {
    const chunk = rows.slice(index, index + 300).map((row) => ({ ...row, user_id: currentUser.id }));
    const { error } = await client.from("user_vocab_items").upsert(chunk, { onConflict: "user_id,word_key" });
    if (error) throw error;
  }
}

async function performSync(manual = false) {
  if (!configured) return;
  if (syncInFlight) {
    syncRequested = true;
    return;
  }
  if (!navigator.onLine) {
    setSyncState("offline", "인터넷 연결 시 자동 동기화됩니다.");
    return;
  }

  syncInFlight = true;
  try {
    setSyncState("syncing");
    await ensureClient();
    if (!currentUser) {
      setSyncState("local", manual ? "로그인하면 기기 간 기록이 연결됩니다." : "이 기기에만 저장 중");
      return;
    }
    if (!(await prepareOwner())) return;

    migrateLocalData();
    const [remoteItems, remoteLearning] = await Promise.all([fetchRemoteItems(), fetchRemoteLearning()]);
    let snapshot = mergeSnapshot(localSnapshot(), remoteItems, remoteLearning);
    if (snapshot.changed) {
      persistSnapshot(snapshot);
      window.dispatchEvent(new CustomEvent("vocab-sync-applied"));
    }

    const remoteMap = new Map(remoteItems.map((row) => [String(row.word_key), row]));
    const queue = readQueue();
    const dirtyKeys = new Set(queue.itemKeys);
    const itemRows = buildLocalItemRows(snapshot).filter((row) => {
      const remote = remoteMap.get(row.word_key);
      return dirtyKeys.has(row.word_key)
        || row.status_changed_at > Number(remote?.status_changed_at || 0)
        || row.wrong_changed_at > Number(remote?.wrong_changed_at || 0);
    });
    if (itemRows.length) await upsertItems(itemRows);

    const remoteDailyTime = Number(remoteLearning?.daily_changed_at || 0);
    const remoteLastTime = Number(remoteLearning?.last_word_changed_at || 0);
    if (queue.learning || snapshot.meta.dailyTimestamp > remoteDailyTime || snapshot.meta.lastWordTimestamp > remoteLastTime) {
      const { error } = await client.from("user_learning_state").upsert({
        user_id: currentUser.id,
        daily_session: snapshot.dailySession || {},
        daily_changed_at: snapshot.meta.dailyTimestamp,
        last_word_key: snapshot.lastWordKey || null,
        last_word_changed_at: snapshot.meta.lastWordTimestamp,
      }, { onConflict: "user_id" });
      if (error) throw error;
    }

    const [finalItems, finalLearning] = await Promise.all([fetchRemoteItems(), fetchRemoteLearning()]);
    snapshot = mergeSnapshot(localSnapshot(), finalItems, finalLearning);
    persistSnapshot(snapshot);
    writeQueue({ itemKeys: [], learning: false });
    localStorage.setItem(STORAGE.lastSync, String(Date.now()));
    window.dispatchEvent(new CustomEvent("vocab-sync-applied"));
    setSyncState("ready", "동기화 완료");
  } catch (error) {
    console.error("Vocabulary sync failed", error);
    setSyncState("error", readableError(error));
  } finally {
    syncInFlight = false;
    if (syncRequested) {
      syncRequested = false;
      scheduleSync(250);
    }
  }
}

function scheduleSync(delay = 1200) {
  if (!configured) return;
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => performSync(false), delay);
}

async function logout() {
  try {
    if (client) await client.auth.signOut({ scope: "local" });
    currentUser = null;
    saveSessionHint(null);
    setSyncState("local", "로그아웃했습니다. 기록은 이 기기에 남아 있습니다.");
  } catch (error) {
    setSyncState("error", readableError(error));
  }
}

function readableError(error) {
  const message = String(error?.message || error || "동기화 오류");
  if (/invalid login|token/i.test(message)) return "로그인 링크가 올바르지 않거나 만료됐습니다.";
  if (/fetch|network|internet/i.test(message)) return "인터넷 연결을 확인해 주세요.";
  if (/relation .* does not exist/i.test(message)) return "Supabase 테이블 설정이 필요합니다.";
  return message.length > 80 ? "동기화 중 오류가 발생했습니다." : message;
}

document.addEventListener("DOMContentLoaded", async () => {
  migrateLocalData();
  bindUi();
  renderSyncUi();
  if (!configured || !navigator.onLine) return;
  try {
    await ensureClient();
    renderSyncUi();
    if (currentUser) scheduleSync(0);
  } catch (error) {
    setSyncState("error", readableError(error));
  }
});

window.addEventListener("online", () => scheduleSync(0));
window.addEventListener("offline", renderSyncUi);
window.addEventListener("focus", () => {
  if (currentUser) scheduleSync(200);
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && currentUser) scheduleSync(200);
});
window.setInterval(() => {
  if (currentUser && navigator.onLine) scheduleSync(0);
}, 60000);
