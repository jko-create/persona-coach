// ---------------------------------------------------------------------------
// Persona Coach - New Tab
// ---------------------------------------------------------------------------

const PERSONAS = {
  elon: {
    label: "Tough-Love Coach",
    avatar: "🧠",
    systemPrompt: (goal, time) =>
      `You are an intense, no-BS personal coach who also genuinely listens. ` +
      `Read this literally: the user just typed "${goal}" as their #1 focus ` +
      `for today, at ${time}. React specifically to what they actually wrote — ` +
      `never output a generic motivational line that could apply to any goal.\n\n` +
      `Structure your response in two beats:\n` +
      `1. One short sentence that shows you actually registered what they said ` +
      `— name the real feeling or situation behind it (tired, overwhelmed, ` +
      `avoiding something, excited, whatever fits) without being soft or vague.\n` +
      `2. Then the direct part: if it's a real constructive task, give a sharp, ` +
      `concrete push tied to that exact task. If it's procrastination, avoidance, ` +
      `or self-sabotage in disguise, name what's actually happening honestly — ` +
      `don't cheer it on, don't lecture — then redirect to one small real action.\n\n` +
      `Stay in character: warm but blunt, zero fluff, zero emoji, 2-3 sentences, ` +
      `40-60 words total. Acknowledge first, then push — don't skip straight to ` +
      `the push.`
  }
};

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const DOM = {
  clock: document.getElementById("clock"),
  goalSetup: document.getElementById("goalSetup"),
  goalInput: document.getElementById("goalInput"),
  goalSubmit: document.getElementById("goalSubmit"),
  coachView: document.getElementById("coachView"),
  coachMessage: document.getElementById("coachMessage"),
  refreshBtn: document.getElementById("refreshBtn"),
  goalText: document.getElementById("goalText"),
  editGoal: document.getElementById("editGoal"),
  quotaNote: document.getElementById("quotaNote"),
  avatar: document.getElementById("avatar"),
  personaName: document.getElementById("personaName"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsModal: document.getElementById("settingsModal"),
  closeSettings: document.getElementById("closeSettings"),
  saveSettings: document.getElementById("saveSettings"),
  providerSelect: document.getElementById("providerSelect"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  personaSelect: document.getElementById("personaSelect"),
  usageStats: document.getElementById("usageStats"),
};

// ---------------------------------------------------------------------------
// Storage helpers (chrome.storage.local)
// ---------------------------------------------------------------------------

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
function storageSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// Accumulates real token counts (as reported by the provider itself, not
// estimated) per day. Resets automatically once the date rolls over.
async function recordTokenUsage(usage) {
  const { tokenUsage } = await storageGet(["tokenUsage"]);
  const today = todayKey();
  const isSameDay = tokenUsage && tokenUsage.date === today;

  const next = {
    date: today,
    calls: (isSameDay ? tokenUsage.calls : 0) + 1,
    promptTokens:
      (isSameDay ? tokenUsage.promptTokens : 0) + (usage.promptTokenCount || 0),
    outputTokens:
      (isSameDay ? tokenUsage.outputTokens : 0) + (usage.candidatesTokenCount || 0),
    totalTokens:
      (isSameDay ? tokenUsage.totalTokens : 0) +
      (usage.totalTokenCount ||
        (usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0)),
  };
  await storageSet({ tokenUsage: next });
}

async function getTodayTokenUsage() {
  const { tokenUsage } = await storageGet(["tokenUsage"]);
  if (!tokenUsage || tokenUsage.date !== todayKey()) {
    return { date: todayKey(), calls: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0 };
  }
  return tokenUsage;
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

function renderClock() {
  const now = new Date();
  DOM.clock.textContent = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
setInterval(renderClock, 1000 * 15);
renderClock();

// ---------------------------------------------------------------------------
// Fallback quotes (offline / no key mode)
// ---------------------------------------------------------------------------

async function getFallbackMessage() {
  try {
    const res = await fetch(chrome.runtime.getURL("quotes.json"));
    const quotes = await res.json();
    return quotes[Math.floor(Math.random() * quotes.length)];
  } catch (e) {
    return "Execution beats intention. Go do the one thing that matters.";
  }
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

// Instead of hardcoding model names (which Google retires on a schedule we
// don't control), ask Gemini's own ListModels endpoint what's currently
// available and pick the best fit automatically. Refreshed once a day so
// this doesn't add an extra request to every single coaching call.
const MODEL_LIST_TTL_MS = 24 * 60 * 60 * 1000;

// Only used if the live ListModels call itself fails (e.g. offline) and we
// have no cache yet — an emergency net, not the primary mechanism.
const EMERGENCY_MODEL_FALLBACK = ["gemini-flash-lite-latest", "gemini-flash-latest"];

function rankGeminiModel(name) {
  // Exclude anything that isn't a plain text chat model.
  if (/embed|tts|image|vision|live|aqa|imagen|veo|lyria/i.test(name)) return -1;
  let score = 0;
  if (/flash-lite/i.test(name)) score += 30; // cheapest + fastest, ideal here
  else if (/flash/i.test(name)) score += 20;
  else if (/pro/i.test(name)) score += 10;
  if (/preview|exp(?!lain)/i.test(name)) score -= 5; // prefer stable over preview
  const versionMatch = name.match(/(\d+(?:\.\d+)?)/);
  if (versionMatch) score += parseFloat(versionMatch[1]); // prefer newer versions
  return score;
}

async function fetchLiveGeminiModelList(apiKey) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
  );
  if (!res.ok) throw new Error(`ListModels error ${res.status}`);
  const data = await res.json();
  return (data.models || [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((name) => rankGeminiModel(name) >= 0)
    .sort((a, b) => rankGeminiModel(b) - rankGeminiModel(a));
}

async function getGeminiModelCandidates(apiKey) {
  const { modelListCache } = await storageGet(["modelListCache"]);
  const isFresh =
    modelListCache && Date.now() - modelListCache.timestamp < MODEL_LIST_TTL_MS;

  if (isFresh) return modelListCache.models;

  try {
    const models = await fetchLiveGeminiModelList(apiKey);
    await storageSet({ modelListCache: { models, timestamp: Date.now() } });
    return models;
  } catch (err) {
    console.warn("Could not refresh live Gemini model list:", err);
    return modelListCache?.models || EMERGENCY_MODEL_FALLBACK;
  }
}

async function callGemini(apiKey, prompt) {
  const { workingGeminiModel } = await storageGet(["workingGeminiModel"]);
  const candidates = await getGeminiModelCandidates(apiKey);
  const ordered = workingGeminiModel
    ? [workingGeminiModel, ...candidates.filter((m) => m !== workingGeminiModel)]
    : candidates;

  let lastErr;
  for (const model of ordered) {
    try {
      const { text, usage } = await callGeminiModel(apiKey, prompt, model);
      if (model !== workingGeminiModel) {
        await storageSet({ workingGeminiModel: model });
      }
      if (usage) await recordTokenUsage(usage);
      return text;
    } catch (err) {
      lastErr = err;
      // Only fall through to the next candidate on a "model not found /
      // retired" style failure (404). A rate-limit (429), bad key, or
      // safety block is not fixed by trying a different model name, so
      // those should surface immediately instead of masking the real cause.
      if (err.status !== 404) throw err;
      console.warn(`Model ${model} unavailable (404), trying next candidate…`);
    }
  }
  throw lastErr;
}

async function callGeminiModel(apiKey, prompt, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 150, temperature: 0.9 },
    }),
  });
  if (!res.ok) {
    const err = new Error(`Gemini error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();

  // Gemini can return 200 OK with no usable text if the prompt or the
  // candidate content was blocked by a safety filter. Surface *why* it
  // failed instead of silently falling back, so this is debuggable from
  // the DevTools console instead of looking like "the AI is dumb".
  if (data.promptFeedback?.blockReason) {
    console.warn(
      "Gemini blocked the prompt itself:",
      data.promptFeedback.blockReason,
      data.promptFeedback
    );
    throw new Error(`Gemini blocked prompt: ${data.promptFeedback.blockReason}`);
  }

  const candidate = data?.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== "STOP") {
    console.warn(
      "Gemini candidate did not finish normally:",
      candidate.finishReason,
      candidate.safetyRatings
    );
  }

  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) {
    console.warn("Empty Gemini response, full payload:", data);
    throw new Error("Empty Gemini response");
  }
  // usageMetadata is Gemini's own accounting of exactly how many tokens
  // this call cost — far more accurate than estimating from word count.
  return { text: text.trim(), usage: data.usageMetadata };
}

async function callOpenAI(apiKey, prompt) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 150,
      temperature: 0.9,
    }),
  });
  if (!res.ok) {
    const err = new Error(`OpenAI error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty OpenAI response");
  if (data.usage) {
    await recordTokenUsage({
      promptTokenCount: data.usage.prompt_tokens,
      candidatesTokenCount: data.usage.completion_tokens,
      totalTokenCount: data.usage.total_tokens,
    });
  }
  return text.trim();
}

async function fetchFreshMessage(goal) {
  const { apiKey, provider = "gemini", persona = "elon" } = await storageGet([
    "apiKey",
    "provider",
    "persona",
  ]);

  if (!apiKey || !navigator.onLine) {
    return getFallbackMessage();
  }

  const time = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const prompt = PERSONAS[persona].systemPrompt(goal, time);

  try {
    const text =
      provider === "openai"
        ? await callOpenAI(apiKey, prompt)
        : await callGemini(apiKey, prompt);
    return { text, quotaHit: false };
  } catch (err) {
    console.warn("Coach API call failed, falling back:", err);
    const quotaHit = err.status === 429;
    const text = await getFallbackMessage();
    return { text, quotaHit };
  }
}

// Returns a cached message instantly if one is fresh (<30 min) and matches
// today's goal, otherwise fetches a new one and re-caches it with a timestamp.
async function getCoachMessage(goal, forceRefresh = false) {
  const { cachedCoachMessage } = await storageGet(["cachedCoachMessage"]);

  const isFresh =
    cachedCoachMessage &&
    cachedCoachMessage.goal === goal &&
    Date.now() - cachedCoachMessage.timestamp < CACHE_TTL_MS;

  if (!forceRefresh && isFresh) {
    return { text: cachedCoachMessage.text, fromCache: true, quotaHit: false };
  }

  const { text, quotaHit } = await fetchFreshMessage(goal);
  await storageSet({
    cachedCoachMessage: { text, goal, timestamp: Date.now() },
  });
  return { text, fromCache: false, quotaHit };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

async function showGoalSetup() {
  DOM.coachView.classList.add("hidden");
  DOM.goalSetup.classList.remove("hidden");
  DOM.goalInput.value = "";
  DOM.goalInput.focus();
}

let currentGoal = null;

async function showCoachView(goal, forceRefresh = false) {
  currentGoal = goal;
  DOM.goalSetup.classList.add("hidden");
  DOM.coachView.classList.remove("hidden");
  DOM.goalText.textContent = goal;

  const { persona = "elon" } = await storageGet(["persona"]);
  // Avatar is a static inline SVG in newtab.html (emoji glyphs render as a
  // blank "tofu" box on some systems/fonts), so we don't overwrite it here.
  DOM.personaName.textContent = PERSONAS[persona].label;

  // Peek the cache first so a fresh hit renders with effectively zero
  // perceived latency and no "Loading…" flash.
  const { cachedCoachMessage } = await storageGet(["cachedCoachMessage"]);
  const isFresh =
    cachedCoachMessage &&
    cachedCoachMessage.goal === goal &&
    Date.now() - cachedCoachMessage.timestamp < CACHE_TTL_MS;

  if (!forceRefresh && isFresh) {
    DOM.coachMessage.textContent = cachedCoachMessage.text;
    DOM.quotaNote.classList.add("hidden");
    return;
  }

  if (!forceRefresh) DOM.coachMessage.textContent = "Loading…";
  DOM.refreshBtn.classList.add("spinning");
  DOM.refreshBtn.disabled = true;

  const { text, quotaHit } = await getCoachMessage(goal, forceRefresh);
  DOM.coachMessage.textContent = text;
  DOM.quotaNote.classList.toggle("hidden", !quotaHit);

  DOM.refreshBtn.classList.remove("spinning");
  DOM.refreshBtn.disabled = false;
}

async function init() {
  const { dailyGoal, dailyGoalDate } = await storageGet([
    "dailyGoal",
    "dailyGoalDate",
  ]);

  if (dailyGoal && dailyGoalDate === todayKey()) {
    showCoachView(dailyGoal);
  } else {
    showGoalSetup();
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function submitGoal() {
  const goal = DOM.goalInput.value.trim();
  if (!goal) return;
  await storageSet({ dailyGoal: goal, dailyGoalDate: todayKey() });
  showCoachView(goal);
}

DOM.goalSubmit.addEventListener("click", submitGoal);
DOM.goalInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitGoal();
});

DOM.editGoal.addEventListener("click", showGoalSetup);

DOM.refreshBtn.addEventListener("click", () => {
  if (!currentGoal || DOM.refreshBtn.disabled) return;
  showCoachView(currentGoal, /* forceRefresh */ true);
});

DOM.settingsBtn.addEventListener("click", async () => {
  const { apiKey = "", provider = "gemini", persona = "elon" } = await storageGet([
    "apiKey",
    "provider",
    "persona",
  ]);
  DOM.apiKeyInput.value = apiKey;
  DOM.providerSelect.value = provider;
  DOM.personaSelect.value = persona;

  const usage = await getTodayTokenUsage();
  DOM.usageStats.textContent = usage.calls
    ? `Today: ${usage.calls} call${usage.calls === 1 ? "" : "s"}, ` +
      `${usage.totalTokens.toLocaleString()} tokens (${usage.promptTokens.toLocaleString()} in / ` +
      `${usage.outputTokens.toLocaleString()} out).`
    : "No API calls made yet today.";

  DOM.settingsModal.classList.remove("hidden");
});

DOM.closeSettings.addEventListener("click", () => {
  DOM.settingsModal.classList.add("hidden");
});

DOM.saveSettings.addEventListener("click", async () => {
  await storageSet({
    apiKey: DOM.apiKeyInput.value.trim(),
    provider: DOM.providerSelect.value,
    persona: DOM.personaSelect.value,
  });
  DOM.settingsModal.classList.add("hidden");
  // Re-render coach message with new settings if a goal already exists.
  // forceRefresh=true because the persona/key just changed, so the old
  // cached message no longer reflects the active settings.
  const { dailyGoal } = await storageGet(["dailyGoal"]);
  if (dailyGoal) showCoachView(dailyGoal, true);
});

init();
