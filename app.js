/* アラビア語単語練習アプリ */
"use strict";

/* ---------- ユーティリティ ---------- */

// ハラカット(母音記号)・タトウィールを除去して「文字だけ」にする
// U+064B〜U+065F: タンウィーン、ファトハ、カスラ、ダンマ、スクーン、シャッダ など
// U+0670: 上付きアリフ(هٰذَا の ٰ )  U+0640: タトウィール(ـ)
const HARAKAT_RE = /[\u064B-\u065F\u0670\u0640]/g;

function normalizeAr(s) {
  return s.replace(HARAKAT_RE, "").replace(/\s+/g, " ").trim();
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sample(arr, n) {
  return shuffle(arr).slice(0, n);
}

const $ = (sel) => document.querySelector(sel);

/* ---------- 苦手リスト (localStorage) ---------- */

const WEAK_KEY = "arabic-weak-v1";

function loadWeak() {
  try { return JSON.parse(localStorage.getItem(WEAK_KEY)) || {}; }
  catch { return {}; }
}
function saveWeak(w) { localStorage.setItem(WEAK_KEY, JSON.stringify(w)); }
function markWeak(word) {
  const w = loadWeak();
  w[word.ar] = (w[word.ar] || 0) + 1;
  saveWeak(w);
  updateWeakCount();
}
function unmarkWeak(word) {
  const w = loadWeak();
  if (word.ar in w) { delete w[word.ar]; saveWeak(w); updateWeakCount(); }
}
function isWeak(word) { return word.ar in loadWeak(); }
function updateWeakCount() {
  const n = Object.keys(loadWeak()).length;
  $("#weak-count").textContent = n ? `(${n}語)` : "(まだなし)";
}

/* ---------- 画面切り替え ---------- */

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
  window.scrollTo(0, 0);
}

/* ---------- ホーム画面のセットアップ ---------- */

function buildLessonFilter() {
  const box = $("#lesson-filter");
  box.innerHTML = "";
  for (const [num, title] of Object.entries(LESSONS)) {
    const label = document.createElement("label");
    label.innerHTML =
      `<input type="checkbox" value="${num}" checked> 第${num}課 ${title}`;
    box.appendChild(label);
  }
}

function selectedLessons() {
  return [...document.querySelectorAll("#lesson-filter input:checked")]
    .map((el) => Number(el.value));
}

function currentPool() {
  const lessons = new Set(selectedLessons());
  let pool = WORDS.filter((w) => lessons.has(w.lesson));
  if ($("#opt-weak-only").checked) pool = pool.filter(isWeak);
  return pool;
}

/* ---------- セッション管理 ---------- */

const session = {
  mode: null,        // "card" | "choice" | "spell"
  queue: [],
  idx: 0,
  correct: 0,
  wrong: [],         // 間違えた word の配列(重複なし)
};

function startSession(mode, queue) {
  if (queue.length === 0) {
    alert("出題できる単語がありません。課の選択や「苦手だけ」設定を確認してね。");
    return;
  }
  session.mode = mode;
  session.queue = shuffle(queue);
  session.idx = 0;
  session.correct = 0;
  session.wrong = [];
  if (mode === "card") { showScreen("#screen-card"); renderCard(); }
  if (mode === "choice") { showScreen("#screen-choice"); renderChoice(); }
  if (mode === "spell") { showScreen("#screen-spell"); renderSpell(); }
}

function currentWord() { return session.queue[session.idx]; }

function recordAnswer(word, ok) {
  if (ok) {
    session.correct++;
  } else if (!session.wrong.includes(word)) {
    session.wrong.push(word);
  }
  if (ok) unmarkWeak(word); else markWeak(word);
}

function nextOrFinish() {
  session.idx++;
  if (session.idx >= session.queue.length) { showResult(); return; }
  if (session.mode === "card") renderCard();
  if (session.mode === "choice") renderChoice();
  if (session.mode === "spell") renderSpell();
}

function progressText() {
  return `${session.idx + 1} / ${session.queue.length}`;
}

function kanaEnabled() { return $("#opt-kana").checked; }
function direction() { return $("#opt-direction").value; }

/* ---------- 単語カード ---------- */

let cardFlipped = false;

function renderCard() {
  const w = currentWord();
  cardFlipped = false;
  $("#card-progress").textContent = progressText();

  const front = $("#card-front");
  const back = $("#card-back");
  const arHtml = `<div class="ar">${w.ar}</div>` +
    (kanaEnabled() ? `<div class="kana">${w.kana}</div>` : "");
  const jaHtml = `<div class="ja">${w.ja}</div><div class="pos">[${w.pos}] 第${w.lesson}課</div>`;

  if (direction() === "ja2ar") {
    front.innerHTML = jaHtml;
    back.innerHTML = arHtml;
  } else {
    front.innerHTML = arHtml;
    back.innerHTML = jaHtml;
  }
  front.classList.remove("hidden");
  back.classList.add("hidden");
  $("#card-hint").textContent = "タップしてめくる";
}

function flipCard() {
  cardFlipped = !cardFlipped;
  $("#card-front").classList.toggle("hidden", cardFlipped);
  $("#card-back").classList.toggle("hidden", !cardFlipped);
  $("#card-hint").textContent = cardFlipped ? "タップで表にもどる" : "タップしてめくる";
}

/* ---------- 4択クイズ ---------- */

function renderChoice() {
  const w = currentWord();
  const dir = direction();
  $("#choice-progress").textContent = progressText();
  $("#choice-feedback").classList.add("hidden");
  $("#btn-choice-next").classList.add("hidden");

  const promptEl = $("#choice-prompt");
  const kanaEl = $("#choice-kana");
  if (dir === "ja2ar") {
    $("#choice-label").textContent = "アラビア語はどれ?";
    promptEl.className = "prompt-main";
    promptEl.textContent = w.ja;
    kanaEl.textContent = `[${w.pos}] 第${w.lesson}課`;
  } else {
    $("#choice-label").textContent = "意味はどれ?";
    promptEl.className = "prompt-main arabic";
    promptEl.textContent = w.ar;
    kanaEl.textContent = kanaEnabled() ? w.kana : "";
  }

  // 同じ課からダミーを優先して選ぶ
  const sameLesson = WORDS.filter((x) => x !== w && x.lesson === w.lesson);
  const others = WORDS.filter((x) => x !== w && x.lesson !== w.lesson);
  const distractors = sample(sameLesson, 3);
  if (distractors.length < 3) distractors.push(...sample(others, 3 - distractors.length));

  const options = shuffle([w, ...distractors]);
  const box = $("#choice-options");
  box.innerHTML = "";
  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "choice-btn" + (dir === "ja2ar" ? " arabic" : "");
    btn.textContent = dir === "ja2ar" ? opt.ar : opt.ja;
    btn.addEventListener("click", () => answerChoice(btn, opt, w));
    box.appendChild(btn);
  });
}

function answerChoice(btn, chosen, correct) {
  const ok = chosen === correct;
  recordAnswer(correct, ok);

  document.querySelectorAll(".choice-btn").forEach((b) => {
    b.disabled = true;
    if (b.textContent === (direction() === "ja2ar" ? correct.ar : correct.ja)) {
      b.classList.add("correct");
    }
  });
  if (!ok) btn.classList.add("wrong");

  const fb = $("#choice-feedback");
  fb.className = "feedback " + (ok ? "good" : "bad");
  fb.innerHTML = (ok ? "⭕ 正解! " : "❌ ざんねん… ") +
    `<span class="ar-answer">${correct.ar}</span>` +
    `<span class="kana-answer">${correct.kana} — ${correct.ja}</span>`;
  fb.classList.remove("hidden");
  $("#btn-choice-next").classList.remove("hidden");
}

/* ---------- 綴り練習 ---------- */

const KEY_ROWS = [
  ["ا", "ب", "ت", "ث", "ج", "ح", "خ"],
  ["د", "ذ", "ر", "ز", "س", "ش", "ص"],
  ["ض", "ط", "ظ", "ع", "غ", "ف", "ق"],
  ["ك", "ل", "م", "ن", "ه", "و", "ي"],
  ["ة", "ء", "أ", "إ", "آ", "ؤ", "ئ", "ى"],
];

let spellBuffer = "";
let spellDone = false;

function buildKeyboard() {
  const kb = $("#spell-keyboard");
  kb.innerHTML = "";
  KEY_ROWS.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "kb-row";
    row.forEach((ch) => {
      const key = document.createElement("button");
      key.className = "kb-key";
      key.textContent = ch;
      key.addEventListener("click", () => typeChar(ch));
      rowEl.appendChild(key);
    });
    kb.appendChild(rowEl);
  });
  // 最下段: スペースと削除
  const lastRow = document.createElement("div");
  lastRow.className = "kb-row";
  const spaceKey = document.createElement("button");
  spaceKey.className = "kb-key wide";
  spaceKey.textContent = "スペース";
  spaceKey.addEventListener("click", () => typeChar(" "));
  const delKey = document.createElement("button");
  delKey.className = "kb-key wide";
  delKey.textContent = "⌫ 削除";
  delKey.addEventListener("click", deleteChar);
  lastRow.appendChild(spaceKey);
  lastRow.appendChild(delKey);
  kb.appendChild(lastRow);
}

function typeChar(ch) {
  if (spellDone) return;
  spellBuffer += ch;
  renderSpellInput();
}
function deleteChar() {
  if (spellDone) return;
  spellBuffer = [...spellBuffer].slice(0, -1).join("");
  renderSpellInput();
}
function renderSpellInput() {
  const el = $("#spell-input");
  if (spellBuffer) {
    el.textContent = spellBuffer;
  } else {
    el.innerHTML = '<span class="placeholder">下のキーボードで入力</span>';
  }
}

function renderSpell() {
  const w = currentWord();
  spellBuffer = "";
  spellDone = false;
  $("#spell-progress").textContent = progressText();
  const wordCount = normalizeAr(w.ar).split(" ").length;
  $("#spell-prompt").textContent =
    `「${w.ja}」` + (wordCount > 1 ? ` (${wordCount}語)` : "");
  $("#spell-kana").textContent = w.kana;
  $("#spell-kana").classList.add("hidden");
  $("#spell-feedback").classList.add("hidden");
  $("#btn-spell-next").classList.add("hidden");
  $("#btn-spell-check").classList.remove("hidden");
  $("#btn-spell-giveup").classList.remove("hidden");
  renderSpellInput();
}

// 文字タイルの比較表示を作る(RTLは flex-direction: row-reverse で表現)
function buildDiffTiles(chars, judge) {
  const wrap = document.createElement("div");
  wrap.className = "letter-tiles";
  chars.forEach((ch, i) => {
    const tile = document.createElement("span");
    tile.className = "tile " + judge(ch, i);
    if (ch === " ") { tile.classList.add("space"); tile.textContent = "␣"; }
    else tile.textContent = ch;
    wrap.appendChild(tile);
  });
  return wrap;
}

function checkSpell(giveUp = false) {
  if (spellDone) return;
  const w = currentWord();
  const user = normalizeAr(spellBuffer);
  const answer = normalizeAr(w.ar);
  const ok = !giveUp && user === answer;
  spellDone = true;
  recordAnswer(w, ok);

  const fb = $("#spell-feedback");
  fb.className = "feedback " + (ok ? "good" : "bad");
  fb.innerHTML = "";

  const head = document.createElement("div");
  head.textContent = ok ? "⭕ 正解! すごい!" : (giveUp ? "答えはこちら👇" : "❌ おしい! 比べてみよう");
  fb.appendChild(head);

  const arEl = document.createElement("span");
  arEl.className = "ar-answer";
  arEl.textContent = w.ar;
  fb.appendChild(arEl);

  const kanaEl = document.createElement("span");
  kanaEl.className = "kana-answer";
  kanaEl.textContent = `${w.kana} — ${w.ja}`;
  fb.appendChild(kanaEl);

  if (!ok && !giveUp) {
    const userChars = [...user];
    const ansChars = [...answer];
    const row1 = document.createElement("div");
    row1.className = "diff-row";
    row1.innerHTML = '<span class="diff-title">あなたの答え</span>';
    row1.appendChild(buildDiffTiles(userChars, (ch, i) => (ansChars[i] === ch ? "good" : "bad")));
    fb.appendChild(row1);

    const row2 = document.createElement("div");
    row2.className = "diff-row";
    row2.innerHTML = '<span class="diff-title">正しい綴り(文字のみ)</span>';
    row2.appendChild(buildDiffTiles(ansChars, (ch, i) => (userChars[i] === ch ? "good" : "bad")));
    fb.appendChild(row2);
  }

  fb.classList.remove("hidden");
  $("#btn-spell-check").classList.add("hidden");
  $("#btn-spell-giveup").classList.add("hidden");
  $("#btn-spell-next").classList.remove("hidden");
}

/* ---------- 結果画面 ---------- */

function showResult() {
  const total = session.queue.length;
  const rate = Math.round((session.correct / total) * 100);
  $("#result-score").textContent =
    session.mode === "card"
      ? `覚えた: ${session.correct} / ${total}`
      : `正解率 ${rate}% (${session.correct}/${total})`;
  $("#result-message").textContent =
    rate === 100 ? "パーフェクト! 本番もこの調子 💪"
    : rate >= 70 ? "いい感じ! 間違えたところだけ復習しよう ✨"
    : "苦手をつぶせば必ず伸びる! もう一周しよう 🔥";

  const list = $("#result-wrong-list");
  list.innerHTML = "";
  if (session.wrong.length === 0) {
    $("#result-wrong-panel").classList.add("hidden");
    $("#btn-retry-wrong").classList.add("hidden");
  } else {
    $("#result-wrong-panel").classList.remove("hidden");
    $("#btn-retry-wrong").classList.remove("hidden");
    session.wrong.forEach((w) => {
      const li = document.createElement("li");
      li.innerHTML =
        `<span class="meta">${w.ja}<span class="kana">${w.kana}</span></span>` +
        `<span class="ar">${w.ar}</span>`;
      list.appendChild(li);
    });
  }
  showScreen("#screen-result");
}

/* ---------- イベント登録 ---------- */

function init() {
  buildLessonFilter();
  buildKeyboard();
  updateWeakCount();

  // モード開始
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => startSession(btn.dataset.mode, currentPool()));
  });

  // 課フィルタの一括操作
  $("#btn-all-lessons").addEventListener("click", () => {
    document.querySelectorAll("#lesson-filter input").forEach((el) => (el.checked = true));
  });
  $("#btn-no-lessons").addEventListener("click", () => {
    document.querySelectorAll("#lesson-filter input").forEach((el) => (el.checked = false));
  });

  // 苦手リセット
  $("#btn-reset-weak").addEventListener("click", () => {
    if (confirm("苦手リストをリセットしますか?")) {
      localStorage.removeItem(WEAK_KEY);
      updateWeakCount();
    }
  });

  // やめるボタン(全画面共通)
  document.querySelectorAll('[data-action="quit"]').forEach((btn) => {
    btn.addEventListener("click", () => showScreen("#screen-home"));
  });

  // 単語カード
  $("#flashcard").addEventListener("click", flipCard);
  $("#btn-card-ok").addEventListener("click", () => {
    recordAnswer(currentWord(), true);
    nextOrFinish();
  });
  $("#btn-card-ng").addEventListener("click", () => {
    recordAnswer(currentWord(), false);
    nextOrFinish();
  });

  // 4択
  $("#btn-choice-next").addEventListener("click", nextOrFinish);

  // 綴り
  $("#btn-spell-check").addEventListener("click", () => checkSpell(false));
  $("#btn-spell-giveup").addEventListener("click", () => checkSpell(true));
  $("#btn-spell-next").addEventListener("click", nextOrFinish);
  $("#btn-spell-hint").addEventListener("click", () => {
    $("#spell-kana").classList.toggle("hidden");
  });

  // 結果画面
  $("#btn-go-home").addEventListener("click", () => showScreen("#screen-home"));
  $("#btn-retry-wrong").addEventListener("click", () => {
    startSession(session.mode, session.wrong.slice());
  });
}

document.addEventListener("DOMContentLoaded", init);
