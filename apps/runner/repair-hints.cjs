"use strict";

// Evidence-led suggestions only. Never replay or change a browser action here.
// Suggestions are accepted only for click_role locator mismatches; assertions
// and expected business behavior are never relaxed or rewritten.
const safeName = value => typeof value === "string" &&
  value.trim().length > 0 && value.length <= 120 &&
  !/[\r\n\x00-\x1f]/.test(value) &&
  !/password|token|secret|api.?key|private.?key/i.test(value);

function words(value) {
  return new Set(String(value).toLowerCase().match(/[a-z0-9]+/g) || []);
}
function editSimilarity(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const dp = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let left = i, diagonal = i - 1;
    for (let j = 1; j <= b.length; j++) {
      const up = dp[j];
      const value = Math.min(up + 1, left + 1, diagonal + (a[i-1] === b[j-1] ? 0 : 1));
      dp[j] = value; diagonal = up; left = value;
    }
    dp[0] = i;
  }
  return 1 - dp[b.length] / Math.max(a.length, b.length, 1);
}
function similarity(a, b) {
  const x = words(a), y = words(b);
  const overlap = [...x].filter(w => y.has(w) && w.length >= 4).length;
  const jaccard = overlap / Math.max(new Set([...x, ...y]).size, 1);
  return 0.7 * editSimilarity(a, b) + 0.3 * jaccard;
}

// Array values are visible accessible names only; never capture HTML, field
// values, page snapshots, credentials, or raw model-generated scripts.
function suggestFromCandidates(action, candidateNames, stepIndex) {
  if (!action || action.op !== "click_role" || !["button","link"].includes(action.role) ||
      !safeName(action.name) || !Array.isArray(candidateNames) ||
      candidateNames.length > 30 || !Number.isInteger(stepIndex) || stepIndex < 0) return null;
  const distinct = [...new Set(candidateNames.filter(safeName))].filter(name => name !== action.name);
  const scored = distinct.map(name => ({name, score: similarity(action.name, name)}))
    .sort((a,b) => b.score - a.score);
  if (!scored.length || scored[0].score < 0.4) return null;
  if (scored.length > 1 && scored[0].score - scored[1].score < 0.12) return null;
  return {
    step_index: stepIndex,
    op: action.op,
    role: action.role,
    original_name: action.name,
    proposed_name: scored[0].name,
    confidence: Math.round(scored[0].score * 100) / 100,
    basis: "visible_accessible_name",
    note: "Unverified locator suggestion from visible browser controls. Original assertions are unchanged."
  };
}

async function collectRepairSuggestion(page, action, index) {
  if (!action || action.op !== "click_role") return null;
  try {
    const locators = await page.getByRole(action.role).all();
    if (locators.length > 24) return null;
    const names = [];
    for (const locator of locators) {
      if (!(await locator.isVisible())) continue;
      const label = (await locator.getAttribute("aria-label")) || await locator.innerText();
      if (safeName(label)) names.push(label.trim());
    }
    return suggestFromCandidates(action, names, index);
  } catch {
    return null;
  }
}

module.exports = { safeName, similarity, suggestFromCandidates, collectRepairSuggestion };
