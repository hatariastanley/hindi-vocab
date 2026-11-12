(() => {
  'use strict';

  const WORDS_KEY = 'hindiFlashcards.words.v1';
  const ACTIVITY_KEY = 'hindiFlashcards.activity.v1';
  const MAX_DECK_SIZE = 12;
  const DEFAULTS_VERSION = 2;
  const DEFAULTS_VERSION_KEY = 'hindiFlashcards.defaultsVersion.v1';

  const DEFAULT_WORDS = window.HINDI_SEED_WORDS || [];
  const CONVERSATION_IDS = [
    'seed-hello',
    'seed-how-are-you',
    'seed-i-am-fine',
    'seed-whats-your-name',
    'seed-see-you-again',
    'seed-thank-you',
    'seed-please',
    'seed-sure',
    'seed-what',
    'seed-where',
    'seed-what-time',
    'seed-okay'
  ];

  const $ = (id) => document.getElementById(id);
  const cardStage = $('cardStage');
  const talkStage = $('talkStage');
  const wordList = $('wordList');
  const wordForm = $('wordForm');
  const wordFormWrap = $('wordFormWrap');
  const imagePreview = $('imagePreview');

  let words = loadWords();
  mergeMissingSeedWords();
  let activity = loadActivity();
  let deck = [];
  let deckIndex = 0;
  let revealed = false;
  let session = { correct: 0, practice: 0 };
  let pendingImageDataUrl = null;
  let conversationIndex = 0;
  let conversationLang = 'english';

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function safeImageUrl(url) {
    const value = String(url || '').trim();
    if (!value) return '';
    if (/^(javascript|data:text|vbscript):/i.test(value)) return '';
    return value;
  }

  function dateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function offsetDateKey(offset) {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return dateKey(date);
  }

  function normalizeWord(word, index = 0) {
    return {
      id: String(word.id || `word-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 7)}`),
      english: String(word.english || '').trim(),
      hindi: String(word.hindi || '').trim(),
      transliteration: String(word.transliteration || '').trim(),
      emoji: String(word.emoji || '✨').trim() || '✨',
      image: String(word.image || '').trim(),
      audio: String(word.audio || '').trim(),
      active: word.active !== false,
      box: Math.min(3, Math.max(1, Number(word.box) || 1)),
      correct: Math.max(0, Number(word.correct) || 0),
      incorrect: Math.max(0, Number(word.incorrect) || 0),
      lastSeen: word.lastSeen || null,
      createdAt: Number(word.createdAt) || Date.now()
    };
  }

  function loadWords() {
    const raw = localStorage.getItem(WORDS_KEY);
    if (raw === null) {
      const initial = DEFAULT_WORDS.map((word, index) => normalizeWord(word, index));
      localStorage.setItem(WORDS_KEY, JSON.stringify(initial));
      return initial;
    }

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((word, index) => normalizeWord(word, index)).filter((word) => word.english && word.hindi);
      }
    } catch (error) {
      // Fall through to defaults below.
    }

    const initial = DEFAULT_WORDS.map((word, index) => normalizeWord(word, index));
    localStorage.setItem(WORDS_KEY, JSON.stringify(initial));
    return initial;
  }

  function saveWords() {
    localStorage.setItem(WORDS_KEY, JSON.stringify(words));
  }

  function mergeMissingSeedWords() {
    const storedVersion = Number(localStorage.getItem(DEFAULTS_VERSION_KEY) || 0);
    if (storedVersion >= DEFAULTS_VERSION) return;

    const byId = new Map(words.map((word) => [word.id, word]));
    const byKey = new Map(words.map((word) => [wordKey(word), word]));
    let changed = false;

    DEFAULT_WORDS.forEach((seed, index) => {
      const normalized = normalizeWord(seed, words.length + index);
      const existing = byId.get(normalized.id) || byKey.get(wordKey(normalized));

      if (!existing) {
        words.push(normalized);
        byId.set(normalized.id, normalized);
        byKey.set(wordKey(normalized), normalized);
        changed = true;
        return;
      }

      ['transliteration', 'emoji', 'image', 'audio'].forEach((field) => {
        if (!existing[field] && normalized[field]) {
          existing[field] = normalized[field];
          changed = true;
        }
      });
    });

    if (changed) saveWords();
    localStorage.setItem(DEFAULTS_VERSION_KEY, String(DEFAULTS_VERSION));
  }

  function loadActivity() {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function saveActivity() {
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity));
  }

  function todayActivity(create = false) {
    const key = dateKey();
    if (!activity[key] && create) {
      activity[key] = { correct: 0, practice: 0, attempts: 0, points: 0 };
    }
    return activity[key] || { correct: 0, practice: 0, attempts: 0, points: 0 };
  }

  function hasActivityFor(key) {
    return Boolean(activity[key] && activity[key].attempts > 0);
  }

  function computeStreak() {
    const today = dateKey();
    let cursor = hasActivityFor(today) ? 0 : -1;
    let streak = 0;

    while (true) {
      const key = offsetDateKey(cursor);
      if (!hasActivityFor(key)) break;
      streak += 1;
      cursor -= 1;
    }

    return streak;
  }

  function renderStats() {
    const today = todayActivity(false);
    $('statPoints').textContent = String(today.points || 0);
    $('statCorrect').textContent = String(today.correct || 0);
    $('statPractice').textContent = String(today.practice || 0);
    $('statStreak').textContent = String(computeStreak());
  }

  function shuffle(array) {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function weightedSample(items, count) {
    const pool = [...items];
    const selected = [];

    while (selected.length < count && pool.length > 0) {
      const weights = pool.map((word) => Math.max(1, 5 - (word.box || 1)));
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      let random = Math.random() * total;
      let index = 0;

      for (let i = 0; i < weights.length; i += 1) {
        random -= weights[i];
        if (random <= 0) {
          index = i;
          break;
        }
      }

      selected.push(pool.splice(index, 1)[0]);
    }

    return selected;
  }

  function buildDeck() {
    const active = words.filter((word) => word.active);
    if (active.length <= MAX_DECK_SIZE) return shuffle(active).map((word) => word.id);
    return weightedSample(active, MAX_DECK_SIZE).map((word) => word.id);
  }

  function findWord(id) {
    return words.find((word) => word.id === id) || null;
  }

  function currentWord() {
    return findWord(deck[deckIndex]) || null;
  }

  function pictureHtml(word) {
    const image = safeImageUrl(word.image);
    if (image) {
      return `<img src="${escapeHtml(image)}" alt="${escapeHtml(word.english)}">`;
    }
    return `<div class="emoji-fallback" aria-hidden="true">${escapeHtml(word.emoji || '✨')}</div>`;
  }

  function renderCard() {
    if (deckIndex >= deck.length) {
      renderComplete();
      return;
    }

    const word = currentWord();
    if (!word) {
      deckIndex += 1;
      renderCard();
      return;
    }

    const answerPanel = revealed
      ? `
        <div class="answer-panel">
          <p class="hindi-word">${escapeHtml(word.hindi)}</p>
          ${word.transliteration ? `<div class="transliteration">${escapeHtml(word.transliteration)}</div>` : ''}
          <div class="actions" style="margin-top: 18px;">
            <button class="btn secondary" type="button" data-action="hear-hindi">🔊 Hear Hindi</button>
            <button class="btn good" type="button" data-action="correct">✅ I knew it</button>
            <button class="btn practice-btn" type="button" data-action="practice">🔁 Practice again</button>
          </div>
        </div>
      `
      : '';

    const frontActions = revealed
      ? ''
      : `
        <div class="actions">
          <button class="btn secondary" type="button" data-action="hear-english">🔊 Hear English</button>
          <button class="btn primary" type="button" data-action="show-answer">👀 Show answer</button>
          <button class="btn secondary" type="button" data-action="skip">⏭️ Skip</button>
        </div>
      `;

    cardStage.innerHTML = `
      <div class="flashcard">
        <div class="picture-wrap">${pictureHtml(word)}</div>
        <div class="prompt">What is this in Hindi?</div>
        ${frontActions}
        ${answerPanel}
      </div>
    `;
  }

  function renderEmpty() {
    cardStage.innerHTML = `
      <div class="empty-card">
        <h2>No words yet</h2>
        <p class="hint">Add a word in the Words tab to start practicing.</p>
        <div class="actions" style="margin-top: 18px;">
          <button class="btn primary" type="button" data-action="manage-words">Open Words</button>
        </div>
      </div>
    `;
  }

  function renderComplete() {
    const today = todayActivity(false);
    const totalCards = session.correct + session.practice;
    const completionMessage = session.correct === 0
      ? 'Great effort! Try the sound button and say each word out loud.'
      : totalCards > 0 && session.practice === 0
        ? 'Amazing! Every card was a win.'
        : 'Nice work! Keep going tomorrow.';

    cardStage.innerHTML = `
      <div class="complete-card">
        <h2>🎉 Great job!</h2>
        <p class="hint">${escapeHtml(completionMessage)}</p>
        <div class="summary-grid">
          <div class="summary-item"><strong>${today.points || 0}</strong><span>points today</span></div>
          <div class="summary-item"><strong>${today.correct || 0}</strong><span>got today</span></div>
          <div class="summary-item"><strong>${today.practice || 0}</strong><span>practice today</span></div>
          <div class="summary-item"><strong>${computeStreak()}</strong><span>day streak</span></div>
        </div>
        <div class="actions">
          <button class="btn primary" type="button" data-action="play-again">🔁 Play again</button>
          <button class="btn secondary" type="button" data-action="manage-words">📝 Manage words</button>
        </div>
      </div>
    `;

    if (session.correct + session.practice > 0) {
      celebrate();
    }
  }

  function startPlay() {
    deck = buildDeck();
    deckIndex = 0;
    revealed = false;
    session = { correct: 0, practice: 0 };
    if (deck.length === 0) {
      renderEmpty();
    } else {
      renderCard();
    }
    renderStats();
  }

  function nextCard() {
    deckIndex += 1;
    revealed = false;
    renderCard();
  }

  function recordResult(word, result, countSession = true) {
    const points = result === 'correct' ? 10 + (word.box || 1) * 2 : 2;
    const today = todayActivity(true);

    if (result === 'correct') {
      word.correct += 1;
      today.correct += 1;
      if (countSession) session.correct += 1;
      word.box = Math.min(3, (word.box || 1) + 1);
    } else {
      word.incorrect += 1;
      today.practice += 1;
      if (countSession) session.practice += 1;
      word.box = Math.max(1, (word.box || 1) - 1);
    }

    word.lastSeen = Date.now();
    today.attempts += 1;
    today.points += points;

    saveWords();
    saveActivity();
    renderStats();
  }

  function safeAudioUrl(url) {
    const value = String(url || '').trim();
    if (!value) return '';
    if (/^(javascript|data:text|vbscript):/i.test(value)) return '';
    if (value.startsWith('data:') && !value.startsWith('data:audio/')) return '';
    return value;
  }

  function speak(text, lang, rate = 0.9) {
    const value = String(text || '').trim();
    if (!value || !window.speechSynthesis) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(value);
    utterance.lang = lang;
    utterance.rate = rate;
    utterance.pitch = lang.startsWith('hi') ? 1.05 : 1;
    window.speechSynthesis.speak(utterance);
  }

  function speakHindi(word) {
    const audioUrl = safeAudioUrl(word && word.audio);
    if (audioUrl) {
      window.speechSynthesis.cancel();
      const audio = new Audio(audioUrl);
      audio.play().catch(() => speak(word.hindi, 'hi-IN', 0.82));
      return;
    }
    speak(word.hindi, 'hi-IN', 0.82);
  }

  function conversationWords() {
    return CONVERSATION_IDS
      .map((id) => findWord(id))
      .filter((word) => word && word.active);
  }

  function renderConversation() {
    const deck = conversationWords();
    if (deck.length === 0) {
      talkStage.innerHTML = `
        <div class="empty-card">
          <h2>No conversation phrases yet</h2>
          <p class="hint">The starter conversation words are missing. You can re-import them from the Words tab.</p>
        </div>
      `;
      return;
    }

    const index = ((conversationIndex % deck.length) + deck.length) % deck.length;
    const word = deck[index];
    const isHindi = conversationLang === 'hindi';
    const mainText = isHindi ? word.hindi : word.english;
    const subText = isHindi ? word.transliteration : '';

    talkStage.innerHTML = `
      <div class="flashcard conversation-card">
        <div class="conversation-topline">
          <span class="conversation-badge">💬 Phrase ${index + 1} of ${deck.length}</span>
          <div class="lang-toggle" role="group" aria-label="Choose language">
            <button class="lang-pill${conversationLang === 'english' ? ' active' : ''}" type="button" data-action="talk-lang-english">English</button>
            <button class="lang-pill${conversationLang === 'hindi' ? ' active' : ''}" type="button" data-action="talk-lang-hindi">हिंदी</button>
          </div>
        </div>
        <div class="conversation-bubble ${isHindi ? 'hindi' : 'english'}">
          <div class="conversation-speaker" aria-hidden="true">${isHindi ? '🧒' : '🧑'}</div>
          <div class="conversation-body">
            <p class="conversation-text">${escapeHtml(mainText)}</p>
            ${subText ? `<div class="transliteration">${escapeHtml(subText)}</div>` : ''}
          </div>
        </div>
        <p class="hint">Toggle the language, listen, then say it out loud.</p>
        <div class="actions">
          <button class="btn secondary" type="button" data-action="talk-hear-english">🔊 English</button>
          <button class="btn secondary" type="button" data-action="talk-hear-hindi">🔊 Hindi</button>
        </div>
        <div class="actions">
          <button class="btn good" type="button" data-action="talk-correct">✅ Got it</button>
          <button class="btn practice-btn" type="button" data-action="talk-practice">🔁 Practice</button>
          <button class="btn secondary" type="button" data-action="talk-prev">⬅️ Back</button>
          <button class="btn primary" type="button" data-action="talk-next">Next ➡️</button>
        </div>
        <div class="actions conversation-reset">
          <button class="btn secondary" type="button" data-action="talk-restart">↩️ Start over</button>
        </div>
      </div>
    `;
  }

  function handleTalkAction(action) {
    const deck = conversationWords();
    if (deck.length === 0) return;

    const index = ((conversationIndex % deck.length) + deck.length) % deck.length;
    const word = deck[index];

    switch (action) {
      case 'talk-lang-english':
        conversationLang = 'english';
        renderConversation();
        break;
      case 'talk-lang-hindi':
        conversationLang = 'hindi';
        renderConversation();
        break;
      case 'talk-hear-english':
        speak(word.english, 'en-US', 0.95);
        break;
      case 'talk-hear-hindi':
        speakHindi(word);
        break;
      case 'talk-correct':
        recordResult(word, 'correct', false);
        conversationIndex += 1;
        renderConversation();
        break;
      case 'talk-practice':
        recordResult(word, 'practice', false);
        conversationIndex += 1;
        renderConversation();
        break;
      case 'talk-next':
        conversationIndex += 1;
        renderConversation();
        break;
      case 'talk-prev':
        conversationIndex -= 1;
        renderConversation();
        break;
      case 'talk-restart':
        conversationIndex = 0;
        renderConversation();
        break;
      default:
        break;
    }
  }

  function handleCardAction(action) {
    const word = currentWord();

    switch (action) {
      case 'hear-english':
        if (word) speak(word.english, 'en-US', 0.95);
        break;
      case 'show-answer':
        if (!word) return;
        revealed = true;
        renderCard();
        speakHindi(word);
        break;
      case 'hear-hindi':
        if (word) speakHindi(word);
        break;
      case 'skip':
        nextCard();
        break;
      case 'correct':
        if (!word) return;
        recordResult(word, 'correct');
        nextCard();
        break;
      case 'practice':
        if (!word) return;
        recordResult(word, 'practice');
        nextCard();
        break;
      case 'play-again':
        startPlay();
        break;
      case 'manage-words':
        switchTab('words');
        break;
      default:
        break;
    }
  }

  function celebrate() {
    const container = $('celebration');
    const pieces = ['🎉', '✨', '⭐', '🌟', '🎈', '👏'];

    for (let i = 0; i < 42; i += 1) {
      const piece = document.createElement('span');
      piece.className = 'confetti-piece';
      piece.textContent = pieces[Math.floor(Math.random() * pieces.length)];
      piece.style.left = `${Math.random() * 100}vw`;
      piece.style.animationDuration = `${1.4 + Math.random() * 1.1}s`;
      piece.style.animationDelay = `${Math.random() * 0.45}s`;
      piece.style.fontSize = `${1.4 + Math.random() * 1.4}rem`;
      container.appendChild(piece);
      window.setTimeout(() => piece.remove(), 2600);
    }
  }

  function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    $('talkView').classList.toggle('active', tabName === 'talk');
    $('playView').classList.toggle('active', tabName === 'play');
    $('wordsView').classList.toggle('active', tabName === 'words');
    if (tabName === 'talk') renderConversation();
    renderStats();
  }

  function renderWordList() {
    if (words.length === 0) {
      wordList.innerHTML = '<div class="empty-card"><h2>No words yet</h2><p class="hint">Use the Add word button to create your first flashcard.</p></div>';
      return;
    }

    wordList.innerHTML = words.map((word) => {
      const image = safeImageUrl(word.image);
      const thumb = image
        ? `<img src="${escapeHtml(image)}" alt="">`
        : `<div class="emoji-fallback" aria-hidden="true">${escapeHtml(word.emoji || '✨')}</div>`;

      return `
        <article class="word-card">
          <div class="word-card-top">
            <div class="thumb">${thumb}</div>
            <div class="word-title">
              <strong>${escapeHtml(word.english)}</strong>
              <span>${escapeHtml(word.hindi)}${word.transliteration ? ` • ${escapeHtml(word.transliteration)}` : ''}</span>
            </div>
          </div>
          <div class="badge-row">
            <span class="badge">Level ${word.box}</span>
            <span class="badge">✅ ${word.correct}</span>
            <span class="badge">🔁 ${word.incorrect}</span>
            ${word.active ? '' : '<span class="badge inactive">Inactive</span>'}
          </div>
          <div class="word-actions">
            <button class="btn secondary" type="button" data-action="edit-word" data-id="${escapeHtml(word.id)}">Edit</button>
            <button class="btn secondary" type="button" data-action="delete-word" data-id="${escapeHtml(word.id)}">Delete</button>
          </div>
        </article>
      `;
    }).join('');
  }

  function resetWordForm() {
    wordForm.reset();
    $('wordId').value = '';
    pendingImageDataUrl = null;
    renderImagePreview('');
  }

  function renderImagePreview(url) {
    if (!imagePreview) return;
    const safeUrl = safeImageUrl(url);
    if (!safeUrl) {
      imagePreview.classList.add('hidden');
      imagePreview.innerHTML = '';
      return;
    }
    imagePreview.classList.remove('hidden');
    imagePreview.innerHTML = `<img src="${escapeHtml(safeUrl)}" alt="Preview">`;
  }

  function openWordForm(word = null) {
    resetWordForm();
    if (word) {
      $('wordId').value = word.id;
      $('fEnglish').value = word.english;
      $('fHindi').value = word.hindi;
      $('fTransliteration').value = word.transliteration || '';
      $('fEmoji').value = word.emoji || '';
      $('fActive').checked = word.active !== false;

      if (word.image.startsWith('data:image/') || word.image.startsWith('blob:')) {
        pendingImageDataUrl = word.image;
        $('fImageUrl').value = '';
        renderImagePreview(word.image);
      } else {
        pendingImageDataUrl = null;
        $('fImageUrl').value = word.image || '';
        renderImagePreview(word.image);
      }
    }
    wordFormWrap.classList.remove('hidden');
    $('fEnglish').focus();
  }

  function closeWordForm() {
    wordFormWrap.classList.add('hidden');
    resetWordForm();
  }

  function fileToCompressedDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) {
        reject(new Error('Please choose an image file.'));
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        reject(new Error('That image is too large. Please choose one under 8 MB.'));
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read that image.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Could not load that image.'));
        img.onload = () => {
          const maxSize = 640;
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          const width = Math.max(1, Math.round(img.width * scale));
          const height = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          context.drawImage(img, 0, 0, width, height);

          let dataUrl = canvas.toDataURL('image/webp', 0.82);
          if (!dataUrl.startsWith('data:image/webp')) {
            dataUrl = canvas.toDataURL('image/jpeg', 0.86);
          }
          resolve(dataUrl);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function wordKey(word) {
    return `${String(word.english || '').trim().toLowerCase()}|${String(word.hindi || '').trim()}`;
  }

  function exportWords() {
    const blob = new Blob([JSON.stringify(words, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'hindi-flashcards-words.json';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importWordsFile(file) {
    const reader = new FileReader();
    reader.onerror = () => window.alert('Could not read that file.');
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ''));
        if (!Array.isArray(parsed)) throw new Error('bad shape');

        const imported = parsed.map((word, index) => normalizeWord(word, index)).filter((word) => word.english && word.hindi);
        if (imported.length === 0) throw new Error('empty');

        const byId = new Map(words.map((word) => [word.id, word]));
        const byKey = new Map(words.map((word) => [wordKey(word), word]));

        words = imported.map((word) => {
          const existing = byId.get(word.id) || byKey.get(wordKey(word));
          if (!existing) return word;
          return {
            ...word,
            id: existing.id || word.id,
            box: existing.box,
            correct: existing.correct,
            incorrect: existing.incorrect,
            lastSeen: existing.lastSeen,
            createdAt: existing.createdAt || word.createdAt
          };
        });

        saveWords();
        renderWordList();
        window.alert(`Imported ${words.length} word${words.length === 1 ? '' : 's'}.`);
      } catch (error) {
        window.alert('That file does not look like a valid flashcard word list.');
      }
    };
    reader.readAsText(file);
  }

  cardStage.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    handleCardAction(button.dataset.action);
  });

  talkStage.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    handleTalkAction(button.dataset.action);
  });

  wordList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const id = button.dataset.id;
    const word = findWord(id);

    if (button.dataset.action === 'edit-word' && word) {
      openWordForm(word);
    } else if (button.dataset.action === 'delete-word' && word) {
      const ok = window.confirm(`Delete "${word.english}" (${word.hindi})?`);
      if (!ok) return;
      words = words.filter((item) => item.id !== id);
      saveWords();
      renderWordList();
      if ($('wordId').value === id) closeWordForm();
    }
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  $('addWordBtn').addEventListener('click', () => openWordForm());
  $('cancelWord').addEventListener('click', closeWordForm);
  $('exportWords').addEventListener('click', exportWords);
  $('importWords').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) importWordsFile(file);
    event.target.value = '';
  });

  $('fImageUrl').addEventListener('input', () => {
    pendingImageDataUrl = null;
    renderImagePreview($('fImageUrl').value);
  });

  $('fImageFile').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    try {
      pendingImageDataUrl = await fileToCompressedDataUrl(file);
      $('fImageUrl').value = '';
      renderImagePreview(pendingImageDataUrl);
    } catch (error) {
      window.alert(error.message || 'Could not use that image.');
      event.target.value = '';
    }
  });

  wordForm.addEventListener('submit', (event) => {
    event.preventDefault();

    const id = $('wordId').value;
    const english = $('fEnglish').value.trim();
    const hindi = $('fHindi').value.trim();
    if (!english || !hindi) return;

    const image = pendingImageDataUrl || $('fImageUrl').value.trim();
    const base = {
      english,
      hindi,
      transliteration: $('fTransliteration').value.trim(),
      emoji: $('fEmoji').value.trim() || '✨',
      image,
      active: $('fActive').checked
    };

    if (id) {
      const index = words.findIndex((word) => word.id === id);
      if (index >= 0) {
        words[index] = { ...words[index], ...base };
      }
    } else {
      words.push(normalizeWord({ ...base, id: `word-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` }, words.length));
    }

    saveWords();
    renderWordList();
    closeWordForm();
    window.alert('Word saved.');
  });

  renderStats();
  renderWordList();
  renderConversation();
  startPlay();
})();
