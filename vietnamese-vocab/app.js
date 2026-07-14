let words = [];

const STORAGE = {
  status: "vietnameseVocab2063.status.v1",
  statusTimestamps: "vietnameseVocab2063.statusTimestamps.v1",
  wrong: "vietnameseVocab2063.wrong.v1",
  wrongStates: "vietnameseVocab2063.wrongStates.v1",
  range: "vietnameseVocab2063.examRange.v1",
  examSource: "vietnameseVocab2063.examSource.v1",
  daily: "vietnameseVocab2063.daily.v1",
  lastWord: "vietnameseVocab2063.lastWord.v1",
  lastWordTimestamp: "vietnameseVocab2063.lastWordTimestamp.v1",
  syncQueue: "vietnameseVocab2063.syncQueue.v1",
  lastSyncTime: "vietnameseVocab2063.lastSyncTime.v1"
};

const DAILY_SIZE = 30;
const TTS_RATES = {
  word: 0.78,
  sentence: 0.92,
};

const statusLabels = {
  new: "새 단어",
  unknown: "몰라요",
  review: "다시 보기",
  known: "알아요",
};

const examSourceLabels = {
  all: "전체 단어",
  new: "새 단어",
  unknown: "몰라요",
  review: "다시 보기",
  known: "알아요",
  wrong: "오답노트",
};

const state = {
  view: "home",
  query: "",
  filter: "all",
  filtered: [],
  index: 0,
  answersHidden: false,
  analysisOpen: false,
  studyMode: "all",
  statuses: readJson(STORAGE.status, {}),
  statusTimestamps: readJson(STORAGE.statusTimestamps, {}),
  wrongStates: readJson(STORAGE.wrongStates, {}),
  syncQueue: readJson(STORAGE.syncQueue, []),
  speakingWord: null,
  exam: {
    mode: "vi_ko",
    size: 10,
    rangeStart: 1,
    rangeEnd: words.length,
    source: "all",
    pool: [],
    candidates: [],
    questions: [],
    index: 0,
    score: 0,
    answered: false,
  },
};

const els = {};
let recognition = null;
let recognitionActive = false;

document.addEventListener("DOMContentLoaded", async () => {
  bindElements();
  try {
    words = await loadVocabularyData();
    state.filtered = [...words];
    state.speakingWord = words[0] || null;
    state.exam.rangeEnd = words.length;
    
    // 데이터 마이그레이션 실행
    migrateData();
    
    loadExamRange();
    bindEvents();
    
    // Supabase 및 동기화 초기화
    initSupabaseAuth();
    
    refreshStudyList();
    renderHome();
    showView("home");
  } catch (error) {
    console.error(error);
    els.homeSummary.textContent = "단어 데이터를 불러오지 못했습니다.";
  }
});

async function loadVocabularyData() {
  if (!("DecompressionStream" in window)) {
    throw new Error("This browser does not support compressed vocabulary data.");
  }
  let compressed;
  if (window.VOCAB_GZIP_BASE64) {
    const binary = atob(window.VOCAB_GZIP_BASE64);
    compressed = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } else {
    const response = await fetch("assets/vocab.json.gz", { cache: "force-cache" });
    if (!response.ok) throw new Error(`Vocabulary request failed: ${response.status}`);
    compressed = new Uint8Array(await response.arrayBuffer());
  }
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  const rows = await new Response(stream).json();
  return rows.map((row) => ({
    key: String(row.n),
    number: Number(row.n),
    word: row.w || "",
    meaning: row.m || "",
    note: row.d || "",
    example: row.e || "",
    exampleKo: row.k || "",
    analysis: row.a || "",
  }));
}

function bindElements() {
  [
    "homeView", "studyView", "examView", "speakingView", "wrongView", "homeSummary",
    "startToday", "todaySummary", "studyTitle", "studyTools", "studyUtilityRow",
    "studyProgress", "studySearch", "toggleAnswer", "randomStudy", "wordNumber",
    "wordStatus", "wordText", "wordMeaning", "meaningNoteBlock", "meaningNote",
    "exampleBlock", "exampleVi", "exampleKo", "speakExample", "analysisToggle",
    "analysisPanel", "analysisText", "speakWord", "markUnknown", "markReview",
    "markKnown", "previousWord", "nextWord", "examStart", "rangeStart", "rangeEnd", "examSource",
    "fullRange", "examRun", "examResult", "examCounter", "examWordNumber",
    "examQuestion", "examSpeak", "examPrompt", "examOptions", "typedAnswerWrap",
    "typedAnswer", "checkTypedAnswer", "examFeedback", "examNext", "examScore",
    "examResultRange", "retryExam", "speakingSearch", "findSpeakingWord",
    "speakingNumber", "speakingWord", "speakingMeaning", "listenSpeakingWord",
    "randomSpeakingWord", "startRecognition", "recognitionPanel", "recognitionState",
    "recognizedText", "recognitionScore", "wrongCount", "clearWrong", "wrongList",
    
    // 구름 동기화 관련 요소
    "openSyncModalBtn", "syncBadgeText", "syncModal", "closeSyncModalBtn",
    "syncLoggedOutSection", "syncEmailInput", "sendMagicLinkBtn", "authMessage",
    "syncLoggedInSection", "loggedInUserEmail", "syncConnectionStatus",
    "lastSyncTimeText", "manualSyncBtn", "logoutBtn", "magicLinkForm"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.nav === "study") {
        openStudy("all");
      } else {
        showView(button.dataset.nav);
      }
    });
  });

  els.startToday.addEventListener("click", () => openStudy("daily"));

  els.studySearch.addEventListener("input", () => {
    state.query = els.studySearch.value.trim().toLocaleLowerCase("vi-VN");
    state.index = 0;
    state.analysisOpen = false;
    refreshStudyList();
    renderStudy();
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      state.index = 0;
      state.analysisOpen = false;
      refreshStudyList();
      renderStudy();
    });
  });

  els.toggleAnswer.addEventListener("click", () => {
    state.answersHidden = !state.answersHidden;
    if (state.answersHidden) state.analysisOpen = false;
    renderStudy();
  });

  els.randomStudy.addEventListener("click", () => {
    if (!state.filtered.length) return;
    state.index = Math.floor(Math.random() * state.filtered.length);
    state.analysisOpen = false;
    renderStudy();
  });

  els.previousWord.addEventListener("click", () => moveStudy(-1));
  els.nextWord.addEventListener("click", () => moveStudy(1));
  els.markUnknown.addEventListener("click", () => markCurrent("unknown"));
  els.markReview.addEventListener("click", () => markCurrent("review"));
  els.markKnown.addEventListener("click", () => markCurrent("known"));

  els.analysisToggle.addEventListener("click", () => {
    state.analysisOpen = !state.analysisOpen;
    renderStudyDetails(currentWord());
  });

  els.speakWord.addEventListener("click", () => {
    const word = currentWord();
    if (word) speakVietnamese(word.word);
  });

  els.speakExample.addEventListener("click", () => {
    const word = currentWord();
    if (word) speakVietnamese(word.example, "sentence");
  });

  els.fullRange.addEventListener("click", () => {
    els.rangeStart.value = "1";
    els.rangeEnd.value = String(words.length);
  });

  document.querySelectorAll("[data-exam]").forEach((button) => {
    button.addEventListener("click", () => startExam(button.dataset.exam, Number(button.dataset.size)));
  });

  els.examSpeak.addEventListener("click", () => {
    const word = currentExamWord();
    if (word) speakVietnamese(word.word);
  });

  els.checkTypedAnswer.addEventListener("click", submitTypedAnswer);
  els.typedAnswer.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitTypedAnswer();
  });
  els.examNext.addEventListener("click", nextExamQuestion);
  els.retryExam.addEventListener("click", () => startExam(state.exam.mode, state.exam.size, true));

  els.findSpeakingWord.addEventListener("click", findSpeakingWord);
  els.speakingSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") findSpeakingWord();
  });
  els.randomSpeakingWord.addEventListener("click", () => {
    stopRecognition();
    state.speakingWord = words[Math.floor(Math.random() * words.length)] || null;
    els.speakingSearch.value = "";
    renderSpeaking();
  });
  els.listenSpeakingWord.addEventListener("click", () => {
    if (state.speakingWord) speakVietnamese(state.speakingWord.word);
  });
  els.startRecognition.addEventListener("click", toggleRecognition);

  els.clearWrong.addEventListener("click", () => {
    setWrongKeys([]);
    renderWrong();
  });

  // 구름 동기화 관련 이벤트 바인딩
  if (els.openSyncModalBtn) {
    els.openSyncModalBtn.addEventListener("click", openSyncModal);
    els.closeSyncModalBtn.addEventListener("click", closeSyncModal);
    els.syncModal.addEventListener("click", (e) => {
      if (e.target === els.syncModal) closeSyncModal();
    });
    els.magicLinkForm.addEventListener("submit", handleMagicLinkSubmit);
    els.manualSyncBtn.addEventListener("click", () => triggerSync(true));
    els.logoutBtn.addEventListener("click", handleLogout);
    
    window.addEventListener("online", () => {
      updateSyncBadgeUI("online");
      triggerSync();
    });
    window.addEventListener("offline", () => {
      updateSyncBadgeUI("offline");
      updateSyncModalUI();
    });
  }
}

function showView(view) {
  if (state.view === "speaking" && view !== "speaking") stopRecognition();
  state.view = view;
  els.homeView.classList.toggle("hidden", view !== "home");
  els.studyView.classList.toggle("hidden", view !== "study");
  els.examView.classList.toggle("hidden", view !== "exam");
  els.speakingView.classList.toggle("hidden", view !== "speaking");
  els.wrongView.classList.toggle("hidden", view !== "wrong");

  if (view === "study") renderStudy();
  if (view === "exam") renderExamStart();
  if (view === "speaking") renderSpeaking();
  if (view === "wrong") renderWrong();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function openStudy(mode) {
  state.studyMode = mode;
  state.query = "";
  state.filter = "all";
  state.index = 0;
  state.analysisOpen = false;
  els.studySearch.value = "";
  refreshStudyList();
  if (mode === "all") {
    const lastKey = localStorage.getItem(STORAGE.lastWord);
    const lastIndex = state.filtered.findIndex((word) => word.key === lastKey);
    state.index = lastIndex >= 0 ? lastIndex : 0;
  }
  showView("study");
}

function renderHome() {
  const statuses = getStatuses();
  const known = words.reduce((count, word) => count + (statuses[word.key] === "known" ? 1 : 0), 0);
  els.homeSummary.textContent = `${words.length}개 단어 · 알아요 ${known}개`;
  const daily = getDailySession();
  const completed = new Set(daily.completed);
  const remaining = daily.keys.filter((key) => !completed.has(key)).length;
  els.todaySummary.textContent = remaining
    ? `${daily.keys.length}개 중 ${remaining}개 남음`
    : "오늘 학습 완료";
}

function getStatuses() {
  return state.statuses;
}

function getStatus(word) {
  return getStatuses()[word.key] || "new";
}

function setStatus(word, status) {
  state.statuses[word.key] = status;
  state.statusTimestamps[word.key] = Date.now();
  localStorage.setItem(STORAGE.status, JSON.stringify(state.statuses));
  localStorage.setItem(STORAGE.statusTimestamps, JSON.stringify(state.statusTimestamps));
  queueSyncAction("statuses");
}

function localDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDailySession() {
  const date = localDateKey();
  const saved = readJson(STORAGE.daily, null);
  if (saved && saved.date === date && Array.isArray(saved.keys) && Array.isArray(saved.completed)) {
    const validKeys = saved.keys.filter((key) => words.some((word) => word.key === key));
    const validKeySet = new Set(validKeys);
    const completed = [...new Set(saved.completed.filter((key) => validKeySet.has(key)))];
    if (validKeys.length) return { date, keys: validKeys, completed };
  }

  const groups = {
    unknown: shuffle(words.filter((word) => getStatus(word) === "unknown")),
    review: shuffle(words.filter((word) => getStatus(word) === "review")),
    new: shuffle(words.filter((word) => getStatus(word) === "new")),
    known: shuffle(words.filter((word) => getStatus(word) === "known")),
  };
  const selected = [];
  const selectedKeys = new Set();
  const take = (group, count) => {
    while (group.length && count > 0 && selected.length < DAILY_SIZE) {
      const word = group.shift();
      if (!selectedKeys.has(word.key)) {
        selected.push(word);
        selectedKeys.add(word.key);
        count -= 1;
      }
    }
  };

  take(groups.unknown, 10);
  take(groups.review, 10);
  take(groups.new, 10);
  [groups.unknown, groups.review, groups.new, groups.known].forEach((group) => {
    take(group, DAILY_SIZE - selected.length);
  });

  const session = { date, keys: selected.map((word) => word.key), completed: [] };
  saveDailySession(session);
  return session;
}

function completeDailyWord(word) {
  const session = getDailySession();
  if (!session.keys.includes(word.key) || session.completed.includes(word.key)) return;
  session.completed.push(word.key);
  saveDailySession(session);
}

function refreshStudyList() {
  if (state.studyMode === "daily") {
    const daily = getDailySession();
    const completed = new Set(daily.completed);
    state.filtered = daily.keys
      .filter((key) => !completed.has(key))
      .map((key) => words.find((word) => word.key === key))
      .filter(Boolean);
    if (state.index >= state.filtered.length) state.index = Math.max(0, state.filtered.length - 1);
    return;
  }

  const query = state.query;
  state.filtered = words.filter((word) => {
    if (state.filter !== "all" && getStatus(word) !== state.filter) return false;
    if (!query) return true;
    const joined = `${word.number} ${word.word} ${word.meaning} ${word.note} ${word.example} ${word.exampleKo} ${word.analysis}`
      .toLocaleLowerCase("vi-VN");
    return joined.includes(query);
  });
  if (state.index >= state.filtered.length) state.index = Math.max(0, state.filtered.length - 1);
  updateFilterButtons();
}

function updateFilterButtons() {
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === state.filter);
  });
}

function currentWord() {
  return state.filtered[state.index] || null;
}

function renderStudy() {
  refreshStudyList();
  const isDaily = state.studyMode === "daily";
  els.studyTitle.textContent = isDaily ? "오늘의 학습" : "단어장";
  els.studyTools.classList.toggle("hidden", isDaily);
  els.randomStudy.classList.toggle("hidden", isDaily);
  els.studyUtilityRow.classList.toggle("single-column", isDaily);
  const word = currentWord();
  if (!word) {
    if (isDaily) {
      const daily = getDailySession();
      els.studyProgress.textContent = `오늘 ${daily.completed.length} / ${daily.keys.length}`;
    } else {
      els.studyProgress.textContent = "0 / 0";
    }
    els.wordNumber.textContent = isDaily ? "오늘 학습 완료" : "검색 결과 없음";
    els.wordStatus.textContent = "";
    els.wordText.textContent = "-";
    els.wordMeaning.textContent = isDaily ? "오늘의 단어를 모두 학습했습니다." : "조건에 맞는 단어가 없습니다.";
    els.meaningNoteBlock.classList.add("hidden");
    els.exampleBlock.classList.add("hidden");
    els.analysisToggle.classList.add("hidden");
    els.analysisPanel.classList.add("hidden");
    [els.speakWord, els.markUnknown, els.markReview, els.markKnown, els.previousWord, els.nextWord]
      .forEach((button) => { button.disabled = true; });
    return;
  }

  [els.speakWord, els.markUnknown, els.markReview, els.markKnown, els.previousWord, els.nextWord]
    .forEach((button) => { button.disabled = false; });
  if (!isDaily) setLastWord(word.key);
  if (isDaily) {
    const daily = getDailySession();
    els.studyProgress.textContent = `오늘 ${daily.completed.length + 1} / ${daily.keys.length}`;
  } else {
    els.studyProgress.textContent = `${state.index + 1} / ${state.filtered.length}`;
  }
  els.wordNumber.textContent = `No. ${word.number}`;
  els.wordStatus.textContent = statusLabels[getStatus(word)];
  els.wordText.textContent = word.word;
  els.wordMeaning.textContent = state.answersHidden ? "••••••" : word.meaning;
  els.wordMeaning.classList.toggle("masked", state.answersHidden);
  els.toggleAnswer.textContent = state.answersHidden ? "뜻 보기" : "뜻 가리기";
  renderStudyDetails(word);
}

function renderStudyDetails(word) {
  if (!word) return;
  const showAnswer = !state.answersHidden;
  els.meaningNoteBlock.classList.toggle("hidden", !showAnswer || !word.note);
  els.meaningNote.textContent = word.note;
  els.exampleBlock.classList.toggle("hidden", !word.example);
  els.exampleVi.textContent = word.example;
  els.exampleKo.textContent = showAnswer ? word.exampleKo : "••••••";
  els.exampleKo.classList.toggle("masked", !showAnswer);

  const hasAnalysis = showAnswer && Boolean(word.analysis);
  els.analysisToggle.classList.toggle("hidden", !hasAnalysis);
  els.analysisPanel.classList.toggle("hidden", !hasAnalysis || !state.analysisOpen);
  els.analysisToggle.textContent = state.analysisOpen ? "예문 분석 접기" : "예문 분석 펼쳐보기";
  els.analysisText.textContent = word.analysis;
  els.speakExample.disabled = !word.example;
}

function moveStudy(delta) {
  if (!state.filtered.length) return;
  state.index = (state.index + delta + state.filtered.length) % state.filtered.length;
  state.analysisOpen = false;
  renderStudy();
}

function markCurrent(status) {
  const word = currentWord();
  if (!word) return;
  setStatus(word, status);
  if (state.studyMode === "daily") completeDailyWord(word);
  const previousIndex = state.index;
  refreshStudyList();
  if (state.studyMode === "daily") {
    state.index = Math.min(previousIndex, Math.max(0, state.filtered.length - 1));
  } else if (state.filter === "all" && state.filtered.length) {
    state.index = (previousIndex + 1) % state.filtered.length;
  } else {
    state.index = Math.min(previousIndex, Math.max(0, state.filtered.length - 1));
  }
  state.analysisOpen = false;
  renderHome();
  renderStudy();
}

function loadExamRange() {
  const saved = readJson(STORAGE.range, { start: 1, end: words.length });
  state.exam.rangeStart = clampNumber(saved.start, 1, words.length, 1);
  state.exam.rangeEnd = clampNumber(saved.end, 1, words.length, words.length);
  if (state.exam.rangeStart > state.exam.rangeEnd) {
    state.exam.rangeStart = 1;
    state.exam.rangeEnd = words.length;
  }
  const savedSource = localStorage.getItem(STORAGE.examSource);
  state.exam.source = Object.hasOwn(examSourceLabels, savedSource) ? savedSource : "all";
}

function renderExamStart() {
  els.examStart.classList.remove("hidden");
  els.examRun.classList.add("hidden");
  els.examResult.classList.add("hidden");
  els.rangeStart.value = String(state.exam.rangeStart);
  els.rangeEnd.value = String(state.exam.rangeEnd);
  els.examSource.value = state.exam.source;
}

function readExamRange() {
  const start = Number(els.rangeStart.value);
  const end = Number(els.rangeEnd.value);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > words.length || start > end) {
    window.alert(`시험 범위를 1~${words.length} 안에서 올바르게 입력해 주세요.`);
    return null;
  }
  state.exam.rangeStart = start;
  state.exam.rangeEnd = end;
  localStorage.setItem(STORAGE.range, JSON.stringify({ start, end }));
  return { start, end };
}

function startExam(mode, requestedSize, reuseRange = false) {
  const range = reuseRange
    ? { start: state.exam.rangeStart, end: state.exam.rangeEnd }
    : readExamRange();
  if (!range) return;

  if (!reuseRange) {
    state.exam.source = Object.hasOwn(examSourceLabels, els.examSource.value) ? els.examSource.value : "all";
    localStorage.setItem(STORAGE.examSource, state.exam.source);
  }

  const candidates = words.filter((word) => word.number >= range.start && word.number <= range.end && word.word && word.meaning);
  const wrongKeys = new Set(getWrongKeys());
  const pool = candidates.filter((word) => {
    if (state.exam.source === "all") return true;
    if (state.exam.source === "wrong") return wrongKeys.has(word.key);
    return getStatus(word) === state.exam.source;
  });
  if (!pool.length) {
    window.alert(`선택한 범위의 '${examSourceLabels[state.exam.source]}' 항목에 출제할 단어가 없습니다.`);
    return;
  }

  state.exam.mode = mode;
  state.exam.size = requestedSize;
  state.exam.pool = pool;
  state.exam.candidates = candidates;
  state.exam.questions = shuffle([...pool]).slice(0, Math.min(requestedSize, pool.length));
  state.exam.index = 0;
  state.exam.score = 0;
  state.exam.answered = false;
  els.examStart.classList.add("hidden");
  els.examResult.classList.add("hidden");
  els.examRun.classList.remove("hidden");
  renderExamQuestion();
}

function currentExamWord() {
  return state.exam.questions[state.exam.index] || null;
}

function renderExamQuestion() {
  const word = currentExamWord();
  if (!word) return;
  state.exam.answered = false;
  els.examCounter.textContent = `${state.exam.index + 1} / ${state.exam.questions.length}`;
  els.examWordNumber.textContent = `No. ${word.number}`;
  els.examFeedback.textContent = "";
  els.examFeedback.className = "exam-feedback";
  els.examNext.disabled = true;
  els.examNext.textContent = state.exam.index + 1 === state.exam.questions.length ? "결과 보기" : "다음 문제";
  els.examOptions.innerHTML = "";
  els.typedAnswer.value = "";
  els.typedAnswer.disabled = false;
  els.checkTypedAnswer.disabled = false;

  const isViToKo = state.exam.mode === "vi_ko";
  const isTyped = state.exam.mode === "ko_vi_input";
  els.examQuestion.textContent = isViToKo ? word.word : word.meaning;
  els.examSpeak.classList.toggle("hidden", !isViToKo);
  els.examPrompt.textContent = isViToKo
    ? "맞는 한국어 뜻을 고르세요."
    : (isTyped ? "베트남어 단어를 직접 입력하세요." : "맞는 베트남어 단어를 고르세요.");
  els.typedAnswerWrap.classList.toggle("hidden", !isTyped);

  if (!isTyped) {
    const correct = isViToKo ? word.meaning : word.word;
    const values = state.exam.candidates.map((item) => (isViToKo ? item.meaning : item.word));
    const options = createOptions(correct, values);
    options.forEach((value) => {
      const button = document.createElement("button");
      button.className = "option";
      button.textContent = value;
      button.addEventListener("click", () => selectOption(button, value, correct));
      els.examOptions.appendChild(button);
    });
  } else {
    requestAnimationFrame(() => els.typedAnswer.focus());
  }
}

function createOptions(correct, candidates) {
  const unique = [...new Set(candidates.filter((value) => value && value !== correct))];
  return shuffle([correct, ...shuffle(unique).slice(0, 3)]);
}

function selectOption(button, selected, correct) {
  if (state.exam.answered) return;
  const isCorrect = selected === correct;
  finishExamAnswer(isCorrect, correct);
  els.examOptions.querySelectorAll("button").forEach((option) => {
    option.disabled = true;
    if (option.textContent === correct) option.classList.add("correct");
    else if (option === button) option.classList.add("wrong");
  });
}

function submitTypedAnswer() {
  if (state.exam.answered) return;
  const typed = els.typedAnswer.value.trim();
  if (!typed) {
    els.examFeedback.textContent = "베트남어 단어를 입력해 주세요.";
    els.examFeedback.className = "exam-feedback feedback-bad";
    return;
  }
  const word = currentExamWord();
  const isCorrect = normalizeText(typed) === normalizeText(word.word);
  els.typedAnswer.disabled = true;
  els.checkTypedAnswer.disabled = true;
  finishExamAnswer(isCorrect, word.word);
}

function finishExamAnswer(isCorrect, correct) {
  state.exam.answered = true;
  if (isCorrect) {
    state.exam.score += 1;
    els.examFeedback.textContent = "정답입니다.";
    els.examFeedback.className = "exam-feedback feedback-good";
  } else {
    addWrong(currentExamWord());
    els.examFeedback.textContent = `오답입니다. 정답: ${correct}`;
    els.examFeedback.className = "exam-feedback feedback-bad";
  }
  els.examNext.disabled = false;
}

function nextExamQuestion() {
  if (!state.exam.answered) return;
  if (state.exam.index + 1 >= state.exam.questions.length) {
    showExamResult();
  } else {
    state.exam.index += 1;
    renderExamQuestion();
    window.scrollTo({ top: 0, behavior: "auto" });
  }
}

function showExamResult() {
  els.examRun.classList.add("hidden");
  els.examResult.classList.remove("hidden");
  els.examScore.textContent = `${state.exam.score} / ${state.exam.questions.length}`;
  els.examResultRange.textContent = `시험 범위 ${state.exam.rangeStart}~${state.exam.rangeEnd} · ${examSourceLabels[state.exam.source]}`;
}

function renderSpeaking() {
  const word = state.speakingWord;
  if (!word) return;
  els.speakingNumber.textContent = `No. ${word.number}`;
  els.speakingWord.textContent = word.word;
  els.speakingMeaning.textContent = word.meaning;
  resetRecognitionPanel();
}

function findSpeakingWord() {
  const query = els.speakingSearch.value.trim().toLocaleLowerCase("vi-VN");
  if (!query) return;
  const exact = words.find((word) => String(word.number) === query || word.word.toLocaleLowerCase("vi-VN") === query);
  const found = exact || words.find((word) => `${word.number} ${word.word} ${word.meaning}`.toLocaleLowerCase("vi-VN").includes(query));
  if (!found) {
    els.recognitionState.textContent = "상태: 검색 결과 없음";
    return;
  }
  stopRecognition();
  state.speakingWord = found;
  renderSpeaking();
}

function toggleRecognition() {
  if (recognitionActive) {
    recognition.stop();
    return;
  }

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    setRecognitionResult("상태: 음성인식 미지원", "Chrome 또는 Edge에서 열어 주세요.", "일치도: -", "bad");
    return;
  }

  recognition = new Recognition();
  recognition.lang = "vi-VN";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 5;

  recognition.onstart = () => {
    recognitionActive = true;
    els.startRecognition.textContent = "듣는 중 · 누르면 완료";
    els.startRecognition.classList.add("listening");
    els.recognitionPanel.classList.add("listening");
    els.recognitionState.textContent = "상태: 마이크 준비됨";
    els.recognizedText.textContent = "말해 주세요.";
    els.recognitionScore.textContent = "현재 일치도: -";
  };

  recognition.onspeechstart = () => {
    els.recognitionState.textContent = "상태: 말소리 감지됨";
  };

  recognition.onresult = (event) => {
    const target = state.speakingWord.word;
    let best = "";
    let bestScore = -1;
    let final = false;
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      final = final || result.isFinal;
      for (let j = 0; j < result.length; j += 1) {
        const candidate = result[j].transcript.trim();
        const score = similarity(normalizeText(target), normalizeText(candidate));
        if (score > bestScore) {
          best = candidate;
          bestScore = score;
        }
      }
    }
    renderRecognitionResult(best, final);
  };

  recognition.onerror = (event) => {
    const message = recognitionErrorMessage(event.error);
    setRecognitionResult("상태: 인식 실패", message, "일치도: -", "bad");
  };

  recognition.onend = () => {
    recognitionActive = false;
    els.startRecognition.textContent = "말하기 시작";
    els.startRecognition.classList.remove("listening");
    els.recognitionPanel.classList.remove("listening");
  };

  try {
    recognition.start();
  } catch (error) {
    setRecognitionResult("상태: 시작 실패", "마이크 권한을 확인해 주세요.", "일치도: -", "bad");
  }
}

function renderRecognitionResult(heard, final) {
  const target = state.speakingWord.word;
  const score = Math.round(similarity(normalizeText(target), normalizeText(heard)) * 100);
  const tone = score >= 85 ? "good" : (score >= 55 ? "review" : "bad");
  const stateText = final
    ? (score >= 85 ? "상태: 잘 인식되었습니다" : "상태: 다시 발음해 보세요")
    : "상태: 듣는 중";
  setRecognitionResult(
    stateText,
    `${final ? "최종 인식" : "실시간"}: ${heard || "인식되지 않음"}`,
    `${final ? "최종" : "현재"} 일치도: ${score}점`,
    tone,
  );
}

function setRecognitionResult(stateText, heardText, scoreText, tone) {
  els.recognitionState.textContent = stateText;
  els.recognizedText.textContent = heardText;
  els.recognitionScore.textContent = scoreText;
  const color = tone === "good" ? "var(--green)" : (tone === "review" ? "var(--amber)" : "var(--red)");
  els.recognizedText.style.color = color;
  els.recognitionScore.style.color = color;
}

function resetRecognitionPanel() {
  els.recognitionState.textContent = "상태: 대기";
  els.recognizedText.textContent = "인식된 단어: -";
  els.recognitionScore.textContent = "일치도: -";
  els.recognizedText.style.color = "var(--text)";
  els.recognitionScore.style.color = "var(--muted)";
}

function stopRecognition() {
  if (recognition && recognitionActive) {
    try {
      recognition.abort();
    } catch (error) {
      // The browser may already have closed the recognition session.
    }
  }
  recognitionActive = false;
  recognition = null;
  if (els.startRecognition) {
    els.startRecognition.textContent = "말하기 시작";
    els.startRecognition.classList.remove("listening");
  }
  if (els.recognitionPanel) els.recognitionPanel.classList.remove("listening");
}

function recognitionErrorMessage(error) {
  if (error === "not-allowed" || error === "service-not-allowed") return "마이크 권한을 허용해 주세요.";
  if (error === "no-speech") return "말소리를 듣지 못했습니다. 버튼을 누른 뒤 바로 말해 주세요.";
  if (error === "audio-capture") return "마이크를 사용할 수 없습니다.";
  if (error === "network") return "인터넷 연결과 브라우저 음성인식 서비스를 확인해 주세요.";
  return "음성인식에 실패했습니다. 다시 시도해 주세요.";
}

function addWrong(word) {
  const now = Date.now();
  state.wrongStates[word.key] = { w: true, t: now };
  localStorage.setItem(STORAGE.wrongStates, JSON.stringify(state.wrongStates));
  queueSyncAction("wrongStates");
}

function getWrongKeys() {
  return Object.keys(state.wrongStates)
    .filter((key) => state.wrongStates[key] && state.wrongStates[key].w);
}

function setWrongKeys(keys) {
  const now = Date.now();
  const currentKeys = getWrongKeys();
  for (const key of currentKeys) {
    if (!keys.includes(key)) {
      state.wrongStates[key] = { w: false, t: now };
    }
  }
  for (const key of keys) {
    if (!state.wrongStates[key] || !state.wrongStates[key].w) {
      state.wrongStates[key] = { w: true, t: now };
    }
  }
  localStorage.setItem(STORAGE.wrongStates, JSON.stringify(state.wrongStates));
  queueSyncAction("wrongStates");
}

function renderWrong() {
  const keys = getWrongKeys();
  const wrongWords = keys.map((key) => words.find((word) => word.key === key)).filter(Boolean);
  els.wrongCount.textContent = `${wrongWords.length}개`;
  els.wrongList.innerHTML = "";

  if (!wrongWords.length) {
    const empty = document.createElement("div");
    empty.className = "wrong-row";
    empty.textContent = "저장된 오답이 없습니다.";
    els.wrongList.appendChild(empty);
    return;
  }

  wrongWords.forEach((word) => {
    const row = document.createElement("article");
    row.className = "wrong-row";
    const title = document.createElement("div");
    title.className = "wrong-word";
    title.textContent = `${word.number}. ${word.word}`;
    const meaning = document.createElement("div");
    meaning.className = "wrong-meaning";
    meaning.textContent = word.meaning;
    const actions = document.createElement("div");
    actions.className = "wrong-actions";
    const study = document.createElement("button");
    study.className = "primary";
    study.textContent = "학습";
    study.addEventListener("click", () => focusStudyWord(word));
    const remove = document.createElement("button");
    remove.className = "plain";
    remove.textContent = "삭제";
    remove.addEventListener("click", () => {
      setWrongKeys(getWrongKeys().filter((key) => key !== word.key));
      renderWrong();
    });
    actions.append(study, remove);
    row.append(title, meaning, actions);
    els.wrongList.appendChild(row);
  });
}

function focusStudyWord(word) {
  state.studyMode = "all";
  state.filter = "all";
  state.query = "";
  els.studySearch.value = "";
  refreshStudyList();
  state.index = Math.max(0, state.filtered.findIndex((item) => item.key === word.key));
  state.analysisOpen = false;
  showView("study");
}

function speakVietnamese(text, kind = "word") {
  if (!text || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "vi-VN";
  utterance.rate = TTS_RATES[kind] || TTS_RATES.word;
  const voices = window.speechSynthesis.getVoices();
  const vietnameseVoice = voices.find((voice) => voice.lang.toLocaleLowerCase().startsWith("vi"));
  if (vietnameseVoice) utterance.voice = vietnameseVoice;
  window.speechSynthesis.speak(utterance);
}

function normalizeText(text) {
  return String(text || "")
    .normalize("NFC")
    .toLocaleLowerCase("vi-VN")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function similarity(first, second) {
  if (!first && !second) return 1;
  const max = Math.max(first.length, second.length);
  if (!max) return 0;
  return Math.max(0, 1 - levenshtein(first, second) / max);
}

function levenshtein(first, second) {
  let previous = Array.from({ length: second.length + 1 }, (_, index) => index);
  let current = new Array(second.length + 1).fill(0);
  for (let i = 1; i <= first.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= second.length; j += 1) {
      const cost = first[i - 1] === second[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[second.length];
}

function shuffle(values) {
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value == null ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => console.error("Service worker registration failed", error));
  });
}

// ==========================================
//            구름 동기화 및 Supabase 관련 로직
// ==========================================

let supabase = null;
let isSyncing = false;

function initSupabaseAuth() {
  if (typeof supabasejs !== "undefined" && window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url !== "https://your-project-ref.supabase.co") {
    supabase = supabasejs.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
    
    // Auth 상태 변경 리스너
    supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("Supabase Auth Event:", event);
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        updateSyncBadgeUI("online");
        updateSyncModalUI();
        await triggerSync();
      } else if (event === "SIGNED_OUT") {
        updateSyncBadgeUI("logged-out");
        updateSyncModalUI();
        state.syncQueue = [];
        localStorage.setItem(STORAGE.syncQueue, "[]");
      }
    });

    // 현재 세션 상태 확인
    getSupabaseSession().then((session) => {
      if (session) {
        triggerSync();
      } else {
        updateSyncBadgeUI("logged-out");
      }
    });
  } else {
    console.warn("Supabase가 설정되지 않았거나 클라이언트 라이브러리를 불러오지 못했습니다.");
    updateSyncBadgeUI("not-configured");
  }
}

async function getSupabaseSession() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session;
  } catch (err) {
    return null;
  }
}

function openSyncModal() {
  if (els.syncModal) {
    els.syncModal.classList.remove("hidden");
    updateSyncModalUI();
  }
}

function closeSyncModal() {
  if (els.syncModal) {
    els.syncModal.classList.add("hidden");
  }
}

function updateSyncBadgeUI(status) {
  if (!els.openSyncModalBtn) return;
  
  els.openSyncModalBtn.className = "sync-badge";
  
  if (!supabase) {
    els.openSyncModalBtn.classList.add("offline");
    els.syncBadgeText.textContent = "동기화 미설정";
    return;
  }

  if (!navigator.onLine) {
    els.openSyncModalBtn.classList.add("offline");
    els.syncBadgeText.textContent = "동기화 오프라인";
    return;
  }

  if (status === "syncing") {
    els.openSyncModalBtn.classList.add("syncing");
    els.syncBadgeText.textContent = "동기화 중...";
  } else if (status === "online") {
    els.openSyncModalBtn.classList.add("online");
    els.syncBadgeText.textContent = "동기화 완료";
  } else if (status === "logged-out") {
    els.openSyncModalBtn.classList.add("offline");
    els.syncBadgeText.textContent = "로그인 필요";
  } else {
    els.openSyncModalBtn.classList.add("offline");
    els.syncBadgeText.textContent = "동기화 오프라인";
  }
}

async function updateSyncModalUI() {
  if (!els.syncModal) return;
  
  const session = await getSupabaseSession();
  const isOnline = navigator.onLine;

  if (session) {
    els.syncLoggedOutSection.classList.add("hidden");
    els.syncLoggedInSection.classList.remove("hidden");
    els.loggedInUserEmail.textContent = session.user.email;
    
    if (isOnline) {
      els.syncConnectionStatus.textContent = "연결됨";
      els.syncConnectionStatus.className = "connection-status online";
    } else {
      els.syncConnectionStatus.textContent = "오프라인";
      els.syncConnectionStatus.className = "connection-status offline";
    }

    const lastSync = localStorage.getItem(STORAGE.lastSyncTime) || "기록 없음";
    els.lastSyncTimeText.textContent = lastSync;
  } else {
    els.syncLoggedOutSection.classList.remove("hidden");
    els.syncLoggedInSection.classList.add("hidden");
    els.authMessage.classList.add("hidden");
    els.syncEmailInput.value = "";
  }
}

async function handleMagicLinkSubmit(e) {
  e.preventDefault();
  if (!supabase) {
    showAuthMessage("Supabase 설정이 완료되지 않았습니다. config.js 파일을 확인해 주세요.", "error");
    return;
  }

  const email = els.syncEmailInput.value.trim();
  if (!email) return;

  els.sendMagicLinkBtn.disabled = true;
  els.sendMagicLinkBtn.textContent = "전송 중...";
  showAuthMessage("인증 메일을 전송 중입니다...", "success");

  try {
    const redirectUrl = window.location.href.split("?")[0];
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectUrl
      }
    });

    if (error) throw error;
    showAuthMessage("이메일로 인증 링크를 발송했습니다! 메일함을 확인해 주세요.", "success");
  } catch (error) {
    console.error("Magic link request failed:", error);
    showAuthMessage("인증 이메일 발송 실패: " + (error.message || "오류 발생"), "error");
  } finally {
    els.sendMagicLinkBtn.disabled = false;
    els.sendMagicLinkBtn.textContent = "인증 이메일 발송";
  }
}

function showAuthMessage(message, type) {
  if (!els.authMessage) return;
  els.authMessage.textContent = message;
  els.authMessage.className = `auth-message ${type}`;
  els.authMessage.classList.remove("hidden");
}

async function handleLogout() {
  if (!supabase) return;
  
  if (confirm("로그아웃 하시겠습니까? 로컬 데이터는 기기에 보존되며 서버 동기화만 해제됩니다.")) {
    try {
      await supabase.auth.signOut();
      alert("로그아웃 되었습니다.");
      closeSyncModal();
    } catch (error) {
      console.error("Logout failed:", error);
    }
  }
}

function queueSyncAction(type) {
  if (!state.syncQueue.includes(type)) {
    state.syncQueue.push(type);
    localStorage.setItem(STORAGE.syncQueue, JSON.stringify(state.syncQueue));
  }
  triggerSync();
}

async function triggerSync(forceManualAlert = false) {
  if (!supabase) return;
  
  const session = await getSupabaseSession();
  if (!session) {
    updateSyncBadgeUI("logged-out");
    return;
  }

  if (!navigator.onLine) {
    updateSyncBadgeUI("offline");
    if (forceManualAlert) {
      alert("현재 오프라인 상태입니다. 네트워크 연결을 확인해 주세요.");
    }
    return;
  }

  if (isSyncing) return;
  isSyncing = true;
  updateSyncBadgeUI("syncing");

  try {
    const userId = session.user.id;
    
    // 1. 서버에서 최신 상태 로드
    const { data: serverState, error } = await supabase
      .from("user_vocab_state")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;

    let mergedStatuses = { ...state.statuses };
    let mergedTimestamps = { ...state.statusTimestamps };
    let mergedWrongStates = { ...state.wrongStates };
    let mergedDaily = readJson(STORAGE.daily, {});
    let mergedLastWord = localStorage.getItem(STORAGE.lastWord) || "";
    let mergedLastWordTimestamp = Number(localStorage.getItem(STORAGE.lastWordTimestamp) || 0);

    if (serverState) {
      // --- 단어 암기 상태 병합 (타임스탬프 비교) ---
      const serverStatuses = serverState.statuses || {};
      const serverStatusTimestamps = serverState.status_timestamps || {};
      const allStatusKeys = new Set([...Object.keys(state.statuses), ...Object.keys(serverStatuses)]);
      
      for (const key of allStatusKeys) {
        const localT = state.statusTimestamps[key] || 0;
        const serverT = serverStatusTimestamps[key] || 0;
        if (serverT > localT) {
          mergedStatuses[key] = serverStatuses[key];
          mergedTimestamps[key] = serverT;
        }
      }

      // --- 오답노트 상태 병합 ---
      const serverWrongStates = serverState.wrong_states || {};
      const allWrongKeys = new Set([...Object.keys(state.wrongStates), ...Object.keys(serverWrongStates)]);
      
      for (const key of allWrongKeys) {
        const localT = (state.wrongStates[key] && state.wrongStates[key].t) || 0;
        const serverT = (serverWrongStates[key] && serverWrongStates[key].t) || 0;
        if (serverT > localT) {
          mergedWrongStates[key] = serverWrongStates[key];
        }
      }

      // --- 오늘의 학습 세션 병합 ---
      const serverDaily = serverState.daily_session || {};
      if (serverDaily.date && serverDaily.date === mergedDaily.date) {
        const mergedCompleted = [...new Set([...(mergedDaily.completed || []), ...(serverDaily.completed || [])])];
        mergedDaily.completed = mergedCompleted;
      } else if (serverDaily.date && (!mergedDaily.date || serverDaily.date > mergedDaily.date)) {
        mergedDaily = serverDaily;
      }

      // --- 마지막 학습 단어 병합 ---
      const serverLastWordTimestamp = Number(serverState.last_word_timestamp || 0);
      if (serverLastWordTimestamp > mergedLastWordTimestamp) {
        mergedLastWord = serverState.last_word_key || "";
        mergedLastWordTimestamp = serverLastWordTimestamp;
      }
    }

    // 2. 병합된 결과 로컬에 반영
    state.statuses = mergedStatuses;
    state.statusTimestamps = mergedTimestamps;
    state.wrongStates = mergedWrongStates;
    localStorage.setItem(STORAGE.status, JSON.stringify(state.statuses));
    localStorage.setItem(STORAGE.statusTimestamps, JSON.stringify(state.statusTimestamps));
    localStorage.setItem(STORAGE.wrongStates, JSON.stringify(state.wrongStates));
    localStorage.setItem(STORAGE.daily, JSON.stringify(mergedDaily));
    localStorage.setItem(STORAGE.lastWord, mergedLastWord);
    localStorage.setItem(STORAGE.lastWordTimestamp, String(mergedLastWordTimestamp));

    // 3. 병합된 최신 결과를 서버에 저장 (업로드)
    const { error: upsertError } = await supabase
      .from("user_vocab_state")
      .upsert({
        user_id: userId,
        statuses: state.statuses,
        status_timestamps: state.statusTimestamps,
        wrong_states: state.wrongStates,
        daily_session: mergedDaily,
        last_word_key: mergedLastWord,
        last_word_timestamp: mergedLastWordTimestamp,
        updated_at: new Date().toISOString()
      });

    if (upsertError) throw upsertError;

    // 대기 중이던 동기화 큐 비우기
    state.syncQueue = [];
    localStorage.setItem(STORAGE.syncQueue, "[]");
    
    // 최종 동기화 시간 기록
    const nowStr = new Date().toLocaleString("ko-KR");
    localStorage.setItem(STORAGE.lastSyncTime, nowStr);

    updateSyncBadgeUI("online");
    updateSyncModalUI();
    renderHome();
    
    if (state.view === "study") renderStudy();
    if (state.view === "wrong") renderWrong();

    if (forceManualAlert) {
      alert("동기화가 완료되었습니다.");
    }
  } catch (error) {
    console.error("Sync failed:", error);
    updateSyncBadgeUI("offline");
    if (forceManualAlert) {
      alert("동기화에 실패했습니다: " + (error.message || "서버 통신 실패"));
    }
  } finally {
    isSyncing = false;
  }
}

function saveDailySession(session) {
  localStorage.setItem(STORAGE.daily, JSON.stringify(session));
  queueSyncAction("daily");
}

function setLastWord(key) {
  localStorage.setItem(STORAGE.lastWord, key);
  const now = Date.now();
  localStorage.setItem(STORAGE.lastWordTimestamp, String(now));
  queueSyncAction("lastWord");
}

function migrateData() {
  // 1. 단어 마스터 암기 상태 타임스탬프 부여
  let statusMigrated = false;
  for (const key of Object.keys(state.statuses)) {
    if (!state.statusTimestamps[key]) {
      state.statusTimestamps[key] = Date.now();
      statusMigrated = true;
    }
  }
  if (statusMigrated) {
    localStorage.setItem(STORAGE.statusTimestamps, JSON.stringify(state.statusTimestamps));
  }

  // 2. 오답노트 (단순 배열 -> 타임스탬프 맵 객체 구조로 변환)
  const oldWrong = readJson(STORAGE.wrong, null);
  let wrongMigrated = false;
  if (oldWrong && Array.isArray(oldWrong)) {
    for (const key of oldWrong) {
      if (!state.wrongStates[key]) {
        state.wrongStates[key] = { w: true, t: Date.now() };
        wrongMigrated = true;
      }
    }
    if (wrongMigrated) {
      localStorage.setItem(STORAGE.wrongStates, JSON.stringify(state.wrongStates));
    }
  }
}
