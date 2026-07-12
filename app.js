const exampleById = new Map(
  (window.TOPIK_EXAMPLES && window.TOPIK_EXAMPLES.words ? window.TOPIK_EXAMPLES.words : [])
    .map((word) => [word.id, word]),
);

const words = (window.TOPIK_DATA && window.TOPIK_DATA.words ? window.TOPIK_DATA.words : []).map((word) => ({
  ...word,
  ...(exampleById.get(word.id) || {}),
  key: String(word.id),
}));

const state = {
  view: "home",
  filtered: [...words],
  index: 0,
  filter: "all",
  query: "",
  day: "all",
  hiddenMeaning: false,
  analysisWordKey: null,
  exam: {
    mode: "ko_vi",
    size: 10,
    questions: [],
    index: 0,
    score: 0,
    selected: false,
  },
};

const els = {};
const statusLabels = {
  new: "Chưa đánh dấu",
  unknown: "Chưa thuộc",
  review: "Ôn lại",
  known: "Đã thuộc",
};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  buildDayOptions();
  bindEvents();
  refreshStudyList();
  renderHome();
  showView("home");
});

function bindElements() {
  [
    "homeView", "studyView", "examView", "wrongView", "homeCount", "studyProgress",
    "searchInput", "daySelect", "toggleMeaningBtn", "randomBtn", "wordMeta",
    "wordStatus", "koreanWord", "vietnameseMeaning", "examplePanel", "koreanExample",
    "vietnameseExample", "speakExampleBtn", "analysisToggleBtn", "analysisPanel", "analysisText",
    "markUnknown", "markReview", "markKnown", "prevBtn", "nextBtn", "examStart",
    "examRun", "examResult", "examCounter", "examDay", "examQuestion",
    "examPrompt", "options", "examFeedback", "examNext",
    "scoreText", "retryExam", "wrongCount", "clearWrong", "wrongList",
    "speakKoBtn", "examSpeakBtn",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.nav));
  });

  els.searchInput.addEventListener("input", () => {
    state.query = els.searchInput.value.trim().toLowerCase();
    state.index = 0;
    state.analysisWordKey = null;
    refreshStudyList();
    renderStudy();
  });

  els.daySelect.addEventListener("change", () => {
    state.day = els.daySelect.value;
    state.index = 0;
    state.analysisWordKey = null;
    refreshStudyList();
    renderStudy();
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      state.index = 0;
      state.analysisWordKey = null;
      refreshStudyList();
      renderStudy();
    });
  });

  els.toggleMeaningBtn.addEventListener("click", () => {
    state.hiddenMeaning = !state.hiddenMeaning;
    renderStudy();
  });

  els.randomBtn.addEventListener("click", () => {
    if (!state.filtered.length) return;
    state.index = Math.floor(Math.random() * state.filtered.length);
    state.analysisWordKey = null;
    renderStudy();
  });

  els.prevBtn.addEventListener("click", () => moveStudy(-1));
  els.nextBtn.addEventListener("click", () => moveStudy(1));

  els.markUnknown.addEventListener("click", () => markCurrent("unknown"));
  els.markReview.addEventListener("click", () => markCurrent("review"));
  els.markKnown.addEventListener("click", () => markCurrent("known"));

  document.querySelectorAll("[data-exam]").forEach((button) => {
    button.addEventListener("click", () => startExam(button.dataset.exam, Number(button.dataset.size)));
  });

  els.examNext.addEventListener("click", nextExam);
  els.retryExam.addEventListener("click", () => startExam(state.exam.mode, state.exam.size));
  els.clearWrong.addEventListener("click", () => {
    localStorage.setItem("topik840Wrong", JSON.stringify([]));
    renderWrong();
  });

  els.speakKoBtn.addEventListener("click", () => {
    const word = currentWord();
    if (word) speakText(word.korean, "ko-KR");
  });

  els.speakExampleBtn.addEventListener("click", () => {
    const word = currentWord();
    if (word && word.koreanExample) speakText(word.koreanExample, "ko-KR");
  });

  els.analysisToggleBtn.addEventListener("click", () => {
    const word = currentWord();
    state.analysisWordKey = state.analysisWordKey === word.key ? null : word.key;
    renderExample(word);
  });

  els.examSpeakBtn.addEventListener("click", () => {
    const word = state.exam.questions[state.exam.index];
    if (word) speakText(word.korean, "ko-KR");
  });
}

function renderHome() {
  els.homeCount.textContent = `${words.length} từ · ${new Set(words.map((word) => word.day)).size} ngày`;
}

function showView(view) {
  state.view = view;
  els.homeView.classList.toggle("hidden", view !== "home");
  els.studyView.classList.toggle("hidden", view !== "study");
  els.examView.classList.toggle("hidden", view !== "exam");
  els.wrongView.classList.toggle("hidden", view !== "wrong");

  if (view === "study") {
    renderStudy();
  } else if (view === "exam") {
    renderExamStart();
  } else if (view === "wrong") {
    renderWrong();
  }
}

function buildDayOptions() {
  const days = [...new Set(words.map((word) => word.day))].sort((a, b) => a - b);
  days.forEach((day) => {
    const option = document.createElement("option");
    option.value = String(day);
    option.textContent = `Ngày ${day}`;
    els.daySelect.appendChild(option);
  });
}

function refreshStudyList() {
  state.filtered = words.filter((word) => {
    if (state.day !== "all" && String(word.day) !== state.day) return false;
    if (state.filter !== "all" && getStatus(word) !== state.filter) return false;
    if (!state.query) return true;
    const joined = `${word.id} ${word.day} ${word.number} ${word.korean} ${word.vietnamese} ${word.koreanExample || ""} ${word.vietnameseExample || ""}`.toLowerCase();
    return joined.includes(state.query);
  });
  if (state.index >= state.filtered.length) {
    state.index = Math.max(0, state.filtered.length - 1);
  }
  updateFilterButtons();
}

function renderStudy() {
  if (!state.filtered.length) {
    els.studyProgress.textContent = "0 / 0";
    els.wordMeta.textContent = "Không có kết quả";
    els.wordStatus.textContent = "";
    els.koreanWord.textContent = "-";
    els.vietnameseMeaning.textContent = "Không tìm thấy từ phù hợp";
    els.vietnameseMeaning.classList.remove("masked");
    els.examplePanel.classList.add("hidden");
    return;
  }

  const word = currentWord();
  els.studyProgress.textContent = `${state.index + 1} / ${state.filtered.length}`;
  els.wordMeta.textContent = `Ngày ${word.day} · No. ${word.number}`;
  els.wordStatus.textContent = statusLabels[getStatus(word)];
  els.koreanWord.textContent = word.korean;
  els.vietnameseMeaning.textContent = state.hiddenMeaning ? "••••••" : word.vietnamese;
  els.vietnameseMeaning.classList.toggle("masked", state.hiddenMeaning);
  els.toggleMeaningBtn.textContent = state.hiddenMeaning ? "Hiện nghĩa" : "Ẩn nghĩa";
  renderExample(word);
}

function renderExample(word) {
  const hasExample = Boolean(word.koreanExample && word.vietnameseExample);
  els.examplePanel.classList.toggle("hidden", !hasExample);
  if (!hasExample) return;

  const analysisVisible = !state.hiddenMeaning && state.analysisWordKey === word.key;
  els.koreanExample.textContent = word.koreanExample;
  els.vietnameseExample.textContent = state.hiddenMeaning ? "••••••" : word.vietnameseExample;
  els.vietnameseExample.classList.toggle("masked", state.hiddenMeaning);
  els.analysisToggleBtn.classList.toggle("hidden", state.hiddenMeaning || !word.analysisVi);
  els.analysisPanel.classList.toggle("hidden", !analysisVisible);
  els.analysisToggleBtn.textContent = analysisVisible ? "Ẩn phân tích" : "Xem phân tích";
  els.analysisText.textContent = word.analysisVi || "";
}

function currentWord() {
  return state.filtered[state.index] || words[0];
}

function moveStudy(delta) {
  if (!state.filtered.length) return;
  state.index = (state.index + delta + state.filtered.length) % state.filtered.length;
  state.analysisWordKey = null;
  renderStudy();
}

function markCurrent(status) {
  const word = currentWord();
  const statuses = getStatuses();
  statuses[word.key] = status;
  localStorage.setItem("topik840Statuses", JSON.stringify(statuses));
  if (status === "unknown") saveWrong(word);
  refreshStudyList();
  renderStudy();
}

function getStatuses() {
  return readJson("topik840Statuses", {});
}

function getStatus(word) {
  return getStatuses()[word.key] || "new";
}

function updateFilterButtons() {
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === state.filter);
  });
}

function renderExamStart() {
  els.examStart.classList.remove("hidden");
  els.examRun.classList.add("hidden");
  els.examResult.classList.add("hidden");
}

function startExam(mode, size) {
  state.exam.mode = mode;
  state.exam.size = size;
  state.exam.questions = shuffle([...words]).slice(0, Math.min(size, words.length));
  state.exam.index = 0;
  state.exam.score = 0;
  state.exam.selected = false;
  els.examStart.classList.add("hidden");
  els.examResult.classList.add("hidden");
  els.examRun.classList.remove("hidden");
  renderExamQuestion();
}

function renderExamQuestion() {
  const word = state.exam.questions[state.exam.index];
  state.exam.selected = false;
  els.examCounter.textContent = `${state.exam.index + 1} / ${state.exam.questions.length}`;
  els.examDay.textContent = `Ngày ${word.day}`;
  els.examQuestion.textContent = state.exam.mode === "ko_vi" ? word.korean : word.vietnamese;
  els.examPrompt.textContent = state.exam.mode === "ko_vi" ? "Chọn nghĩa tiếng Việt đúng." : "Chọn từ tiếng Hàn đúng.";
  els.examFeedback.textContent = "";
  els.examNext.disabled = true;
  els.examNext.textContent = state.exam.index + 1 === state.exam.questions.length ? "Xem kết quả" : "Câu tiếp theo";

  if (state.exam.mode === "ko_vi") {
    els.examSpeakBtn.classList.remove("hidden");
  } else {
    els.examSpeakBtn.classList.add("hidden");
  }

  els.options.innerHTML = "";
  buildOptions(word).forEach((optionText) => {
    const button = document.createElement("button");
    button.className = "option";
    button.textContent = optionText;
    button.addEventListener("click", () => selectAnswer(button, optionText));
    els.options.appendChild(button);
  });
}

function buildOptions(correctWord) {
  const correct = state.exam.mode === "ko_vi" ? correctWord.vietnamese : correctWord.korean;
  const pool = words
    .map((word) => state.exam.mode === "ko_vi" ? word.vietnamese : word.korean)
    .filter((value) => value && value !== correct);
  return shuffle([correct, ...shuffle([...new Set(pool)]).slice(0, 3)]);
}

function selectAnswer(button, selected) {
  if (state.exam.selected) return;
  state.exam.selected = true;
  const word = state.exam.questions[state.exam.index];
  const correct = state.exam.mode === "ko_vi" ? word.vietnamese : word.korean;
  const isCorrect = selected === correct;
  if (isCorrect) {
    state.exam.score += 1;
    els.examFeedback.textContent = "Đúng";
    els.examFeedback.style.color = "var(--green)";
  } else {
    saveWrong(word);
    els.examFeedback.textContent = `Sai · Đáp án: ${correct}`;
    els.examFeedback.style.color = "var(--red)";
  }

  [...els.options.children].forEach((optionButton) => {
    optionButton.disabled = true;
    if (optionButton.textContent === correct) {
      optionButton.classList.add("correct");
    } else if (optionButton === button && !isCorrect) {
      optionButton.classList.add("wrong");
    }
  });
  els.examNext.disabled = false;

  if (state.exam.mode === "vi_ko") {
    els.examSpeakBtn.classList.remove("hidden");
  }
}

function nextExam() {
  if (state.exam.index + 1 >= state.exam.questions.length) {
    renderExamResult();
  } else {
    state.exam.index += 1;
    renderExamQuestion();
  }
}

function renderExamResult() {
  els.examRun.classList.add("hidden");
  els.examResult.classList.remove("hidden");
  els.scoreText.textContent = `${state.exam.score} / ${state.exam.questions.length}`;
}

function renderWrong() {
  const wrongKeys = getWrongKeys();
  const wrongWords = words.filter((word) => wrongKeys.includes(word.key));
  els.wrongCount.textContent = `${wrongWords.length} từ`;
  els.clearWrong.disabled = wrongWords.length === 0;
  els.wrongList.innerHTML = "";

  if (!wrongWords.length) {
    const empty = document.createElement("p");
    empty.className = "prompt";
    empty.textContent = "Chưa có từ sai.";
    els.wrongList.appendChild(empty);
    return;
  }

  wrongWords.forEach((word) => {
    const row = document.createElement("article");
    row.className = "wrong-row";
    row.innerHTML = `
      <div class="wrong-title">No. ${word.id} · ${escapeHtml(word.korean)}</div>
      <div class="wrong-meaning">${escapeHtml(word.vietnamese)}</div>
    `;
    const actions = document.createElement("div");
    actions.className = "wrong-item-actions";
    const deleteButton = document.createElement("button");
    deleteButton.className = "danger solid";
    deleteButton.textContent = "Xóa";
    deleteButton.addEventListener("click", () => {
      removeWrong(word);
      renderWrong();
    });
    actions.append(deleteButton);
    row.appendChild(actions);
    els.wrongList.appendChild(row);
  });
}

function saveWrong(word) {
  const wrongKeys = getWrongKeys();
  if (!wrongKeys.includes(word.key)) {
    wrongKeys.push(word.key);
    localStorage.setItem("topik840Wrong", JSON.stringify(wrongKeys));
  }
}

function removeWrong(word) {
  const wrongKeys = getWrongKeys().filter((key) => key !== word.key);
  localStorage.setItem("topik840Wrong", JSON.stringify(wrongKeys));
}

function getWrongKeys() {
  return readJson("topik840Wrong", []);
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function shuffle(list) {
  for (let index = list.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [list[index], list[target]] = [list[target], list[index]];
  }
  return list;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function speakText(text, lang) {
  if (!('speechSynthesis' in window)) {
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  
  // Try to find a voice matching the language exactly
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find(v => v.lang.startsWith(lang));
  if (voice) {
    utterance.voice = voice;
  }
  
  window.speechSynthesis.speak(utterance);
}
