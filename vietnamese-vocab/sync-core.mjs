export const SYNC_META_VERSION = 1;
export const LEGACY_TIMESTAMP = 1;
export const VALID_STATUSES = new Set(["new", "unknown", "review", "known"]);

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
const numberOrZero = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0);

function timestampMap(value) {
  if (!isObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, timestamp]) => [String(key), numberOrZero(timestamp)])
      .filter(([, timestamp]) => timestamp > 0),
  );
}

export function normalizeMeta(value) {
  const source = isObject(value) ? value : {};
  return {
    version: SYNC_META_VERSION,
    clock: numberOrZero(source.clock),
    statusTimestamps: timestampMap(source.statusTimestamps),
    wrongTimestamps: timestampMap(source.wrongTimestamps),
    dailyTimestamp: numberOrZero(source.dailyTimestamp),
    lastWordTimestamp: numberOrZero(source.lastWordTimestamp),
  };
}

export function nextTimestamp(meta, now = Date.now()) {
  const normalized = normalizeMeta(meta);
  const timestamp = Math.max(numberOrZero(now), normalized.clock + 1, 2);
  normalized.clock = timestamp;
  return { meta: normalized, timestamp };
}

export function migrateLegacyState({ statuses = {}, wrongKeys = [], dailySession = null, lastWordKey = null, meta = null }) {
  const normalized = normalizeMeta(meta);
  let changed = !isObject(meta) || Number(meta.version) !== SYNC_META_VERSION;

  for (const [key, status] of Object.entries(isObject(statuses) ? statuses : {})) {
    if (!VALID_STATUSES.has(status) || status === "new" || normalized.statusTimestamps[key]) continue;
    normalized.statusTimestamps[key] = LEGACY_TIMESTAMP;
    changed = true;
  }

  for (const key of Array.isArray(wrongKeys) ? wrongKeys : []) {
    const normalizedKey = String(key);
    if (normalized.wrongTimestamps[normalizedKey]) continue;
    normalized.wrongTimestamps[normalizedKey] = LEGACY_TIMESTAMP;
    changed = true;
  }

  if (dailySession && !normalized.dailyTimestamp) {
    normalized.dailyTimestamp = LEGACY_TIMESTAMP;
    changed = true;
  }
  if (lastWordKey && !normalized.lastWordTimestamp) {
    normalized.lastWordTimestamp = LEGACY_TIMESTAMP;
    changed = true;
  }

  normalized.clock = Math.max(
    normalized.clock,
    normalized.dailyTimestamp,
    normalized.lastWordTimestamp,
    ...Object.values(normalized.statusTimestamps),
    ...Object.values(normalized.wrongTimestamps),
  );
  return { meta: normalized, changed };
}

export function buildLocalItemRows({ statuses = {}, wrongKeys = [], meta }) {
  const normalized = normalizeMeta(meta);
  const wrongSet = new Set((Array.isArray(wrongKeys) ? wrongKeys : []).map(String));
  const keys = new Set([
    ...Object.keys(normalized.statusTimestamps),
    ...Object.keys(normalized.wrongTimestamps),
  ]);
  return [...keys].map((wordKey) => ({
    word_key: wordKey,
    status: VALID_STATUSES.has(statuses[wordKey]) ? statuses[wordKey] : "new",
    status_changed_at: normalized.statusTimestamps[wordKey] || 0,
    is_wrong: wrongSet.has(wordKey),
    wrong_changed_at: normalized.wrongTimestamps[wordKey] || 0,
  }));
}

export function mergeRemoteItems({ statuses = {}, wrongKeys = [], meta }, remoteRows = []) {
  const mergedStatuses = { ...(isObject(statuses) ? statuses : {}) };
  const mergedWrong = new Set((Array.isArray(wrongKeys) ? wrongKeys : []).map(String));
  const mergedMeta = normalizeMeta(meta);
  let changed = false;

  for (const remote of Array.isArray(remoteRows) ? remoteRows : []) {
    const key = String(remote.word_key ?? "");
    if (!key) continue;

    const remoteStatusTime = numberOrZero(remote.status_changed_at);
    const localStatusTime = mergedMeta.statusTimestamps[key] || 0;
    const localStatus = VALID_STATUSES.has(mergedStatuses[key]) ? mergedStatuses[key] : "new";
    const remoteStatusWinsTie = remoteStatusTime > 0
      && remoteStatusTime === localStatusTime
      && VALID_STATUSES.has(remote.status)
      && remote.status !== localStatus;
    if (remoteStatusTime > localStatusTime || remoteStatusWinsTie) {
      if (remote.status === "new") delete mergedStatuses[key];
      else if (VALID_STATUSES.has(remote.status)) mergedStatuses[key] = remote.status;
      mergedMeta.statusTimestamps[key] = remoteStatusTime;
      changed = true;
    }

    const remoteWrongTime = numberOrZero(remote.wrong_changed_at);
    const localWrongTime = mergedMeta.wrongTimestamps[key] || 0;
    const remoteWrongWinsTie = remoteWrongTime > 0
      && remoteWrongTime === localWrongTime
      && Boolean(remote.is_wrong) !== mergedWrong.has(key);
    if (remoteWrongTime > localWrongTime || remoteWrongWinsTie) {
      if (remote.is_wrong) mergedWrong.add(key);
      else mergedWrong.delete(key);
      mergedMeta.wrongTimestamps[key] = remoteWrongTime;
      changed = true;
    }
  }

  mergedMeta.clock = Math.max(
    mergedMeta.clock,
    ...Object.values(mergedMeta.statusTimestamps),
    ...Object.values(mergedMeta.wrongTimestamps),
  );
  return { statuses: mergedStatuses, wrongKeys: [...mergedWrong], meta: mergedMeta, changed };
}

export function mergeRemoteLearning({ dailySession = null, lastWordKey = null, meta }, remote = null) {
  const mergedMeta = normalizeMeta(meta);
  let mergedDaily = dailySession;
  let mergedLastWord = lastWordKey;
  let changed = false;
  if (!remote) return { dailySession: mergedDaily, lastWordKey: mergedLastWord, meta: mergedMeta, changed };

  const remoteDailyTime = numberOrZero(remote.daily_changed_at);
  const remoteDaily = isObject(remote.daily_session) && Object.keys(remote.daily_session).length ? remote.daily_session : null;
  const remoteDailyWinsTie = remoteDailyTime > 0
    && remoteDailyTime === mergedMeta.dailyTimestamp
    && JSON.stringify(remoteDaily) !== JSON.stringify(mergedDaily);
  if (remoteDailyTime > mergedMeta.dailyTimestamp || remoteDailyWinsTie) {
    mergedDaily = remoteDaily;
    mergedMeta.dailyTimestamp = remoteDailyTime;
    changed = true;
  }

  const remoteLastWordTime = numberOrZero(remote.last_word_changed_at);
  const remoteLastWord = remote.last_word_key ? String(remote.last_word_key) : null;
  const remoteLastWordWinsTie = remoteLastWordTime > 0
    && remoteLastWordTime === mergedMeta.lastWordTimestamp
    && remoteLastWord !== mergedLastWord;
  if (remoteLastWordTime > mergedMeta.lastWordTimestamp || remoteLastWordWinsTie) {
    mergedLastWord = remoteLastWord;
    mergedMeta.lastWordTimestamp = remoteLastWordTime;
    changed = true;
  }

  mergedMeta.clock = Math.max(mergedMeta.clock, mergedMeta.dailyTimestamp, mergedMeta.lastWordTimestamp);
  return { dailySession: mergedDaily, lastWordKey: mergedLastWord, meta: mergedMeta, changed };
}
