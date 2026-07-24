// Voice-tracking core: turn a script into word tokens and advance a "read
// pointer" as spoken words come in. Pure functions only (no React, no native
// deps) so the matching behavior can be reasoned about and unit-tested.

// Normalize a word for comparison: lowercase, strip surrounding punctuation,
// collapse curly quotes. Digits are kept as-is.
export function normalizeWord(w) {
  if (!w) return '';
  return String(w)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9']/g, '')
    .replace(/^'+|'+$/g, '');
}

// Split a script into renderable tokens. Each token keeps its raw text (with
// trailing spaces / punctuation) plus a normalized form and the paragraph it
// belongs to, so the UI can render it verbatim while matching on `norm`.
export function tokenize(text) {
  const tokens = [];
  if (!text) return tokens;
  const paragraphs = String(text).replace(/\r\n/g, '\n').split('\n');
  paragraphs.forEach((para, pIdx) => {
    // Match runs of non-space (words+punctuation). Whitespace is folded into
    // the preceding word's trailing space for rendering.
    const matches = para.match(/\S+/g) || [];
    matches.forEach((raw) => {
      const norm = normalizeWord(raw);
      tokens.push({
        raw,
        norm,
        paragraph: pIdx,
        index: tokens.length,
        // Only tokens with a normalized form are matchable (skip pure punctuation).
        matchable: norm.length > 0,
      });
    });
    // Paragraph break marker (not matchable, used by the renderer for newlines).
    if (pIdx < paragraphs.length - 1) {
      tokens.push({
        raw: '\n',
        norm: '',
        paragraph: pIdx,
        index: tokens.length,
        matchable: false,
        isBreak: true,
      });
    }
  });
  return tokens;
}

// Small Levenshtein distance, capped early for speed. Used to tolerate
// recognizer mis-hears on longer words ("appointment" vs "apointment").
export function editDistance(a, b, max = 2) {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  let prev = new Array(bl + 1);
  let cur = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1; // whole row exceeded budget — bail
    [prev, cur] = [cur, prev];
  }
  return prev[bl];
}

// Does a spoken word match a script word? Exact after normalization, or a
// close fuzzy match for words long enough that a 1-char slip is still clearly
// the same word.
export function wordsMatch(spoken, scriptNorm) {
  if (!spoken || !scriptNorm) return false;
  if (spoken === scriptNorm) return true;
  const minLen = Math.min(spoken.length, scriptNorm.length);
  if (minLen < 4) return false; // short words must match exactly
  const budget = minLen >= 7 ? 2 : 1;
  return editDistance(spoken, scriptNorm, budget) <= budget;
}

// Advance the read pointer given newly recognized spoken words.
//
//   tokens        - output of tokenize()
//   pointer       - index of the next script token expected to be spoken
//   spokenWords   - array of raw recognized words (newest utterance chunk)
//   lookahead     - how far ahead to search for a match (skips a stumble/repeat)
//
// Returns the new pointer (never moves backward). The lookahead lets a single
// missed or mumbled word be skipped without losing the place, and matching the
// first spoken word to a token a few positions ahead keeps sync if the reader
// jumps slightly.
export function advancePointer(tokens, pointer, spokenWords, lookahead = 6) {
  let p = pointer;
  const spoken = (spokenWords || []).map(normalizeWord).filter(Boolean);
  for (const sw of spoken) {
    // Search from the current pointer forward within the lookahead window for
    // the next matchable token that matches this spoken word.
    let matchedAt = -1;
    let scanned = 0;
    for (let i = p; i < tokens.length && scanned <= lookahead; i++) {
      const t = tokens[i];
      if (!t.matchable) continue; // skip breaks / pure punctuation without spending budget
      scanned++;
      if (wordsMatch(sw, t.norm)) {
        matchedAt = i;
        break;
      }
    }
    if (matchedAt >= 0) {
      p = matchedAt + 1;
    }
    // If no match within the window, ignore this spoken word (filler, "um",
    // an aside) and keep the pointer where it is.
  }
  return p;
}

// Given a full transcript string for the current utterance and how many words
// of it we've already consumed, return only the newly-added words plus the new
// consumed count. Handles the recognizer resetting to a fresh utterance
// (transcript gets shorter) by starting over from the beginning.
export function newWordsFromTranscript(transcript, alreadyConsumed) {
  const words = (transcript || '').trim().split(/\s+/).filter(Boolean);
  if (words.length < alreadyConsumed) {
    // New utterance / recognizer reset — consume from the top again.
    return { newWords: words, consumed: words.length };
  }
  return { newWords: words.slice(alreadyConsumed), consumed: words.length };
}
