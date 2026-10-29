/* ============================================================
   Whisper — anonymous Q&A
   Static site: questions live in this browser's localStorage.
   To go multi-device, replace the `storage` object below with
   calls to a backend (Supabase, Firebase, your own API) — the
   rest of the app only talks to storage.list/add/update/remove.
   ============================================================ */
(() => {
  "use strict";

  const KEY_Q = "whisper.questions.v1";
  const KEY_P = "whisper.profile.v1";
  const KEY_T = "whisper.theme";
  const KEY_UNLOCK = "whisper.unlocked";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* ---------- persistence ---------- */
  const safe = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: keep in memory */ } },
  };

  const SAMPLES = [
    { id: "s1", text: "What's one habit that changed your life more than you expected?", status: "answered",
      answer: "Walking without headphones. Twenty minutes of nothing turned out to be where all my ideas were hiding.",
      createdAt: Date.now() - 1000 * 60 * 60 * 30, answeredAt: Date.now() - 1000 * 60 * 60 * 26, sample: true },
    { id: "s2", text: "Be honest: do you actually read every question you get?", status: "answered",
      answer: "Every single one. I don't answer every one, but I read them all, usually at night with tea.",
      createdAt: Date.now() - 1000 * 60 * 60 * 9, answeredAt: Date.now() - 1000 * 60 * 60 * 7, sample: true },
    { id: "s3", text: "Which song do you have on repeat right now?", status: "open",
      createdAt: Date.now() - 1000 * 60 * 42, sample: true },
    { id: "s4", text: "If you could restart one project from scratch, which one and why?", status: "open",
      createdAt: Date.now() - 1000 * 60 * 6, sample: true },
  ];

  let questions = safe.get(KEY_Q, null);
  if (!Array.isArray(questions)) { questions = SAMPLES.slice(); safe.set(KEY_Q, questions); }

  const storage = {
    list() { return questions.slice().sort((a, b) => b.createdAt - a.createdAt); },
    add(q) { questions.unshift(q); safe.set(KEY_Q, questions); },
    update(id, patch) { const i = questions.findIndex(q => q.id === id); if (i > -1) { questions[i] = { ...questions[i], ...patch }; safe.set(KEY_Q, questions); } },
    remove(id) { questions = questions.filter(q => q.id !== id); safe.set(KEY_Q, questions); },
    removeSamples() { questions = questions.filter(q => !q.sample); safe.set(KEY_Q, questions); },
  };

  let profile = Object.assign(
    { name: "Alex", handle: "@alex", bio: "Ask me anything. I answer the good ones in public, the rest stay between us.", pass: "1234" },
    safe.get(KEY_P, {})
  );

  /* ---------- helpers ---------- */
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "q" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const timeAgo = (ts) => {
    const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return "just now";
    const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24); if (d < 7) return `${d}d ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  let toastTimer;
  const toast = (msg) => {
    const el = $("#toast"); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
  };
  const copy = async (text, okMsg) => {
    try { await navigator.clipboard.writeText(text); toast(okMsg); }
    catch { window.prompt("Copy this:", text); }
  };

  /* ---------- theme ---------- */
  const root = document.documentElement;
  const applyTheme = (t) => { if (t === "light") root.setAttribute("data-theme", "light"); else root.removeAttribute("data-theme"); };
  applyTheme(safe.get(KEY_T, matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
  $("#themeToggle").addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    applyTheme(next); safe.set(KEY_T, next);
  });

  /* ---------- routing ---------- */
  const views = $$(".view");
  const route = () => {
    const name = (location.hash.replace("#", "") || "home").split("?")[0];
    const target = views.some(v => v.dataset.view === name) ? name : "home";
    views.forEach(v => { v.hidden = v.dataset.view !== target; });
    $$(".nav-link").forEach(a => a.classList.toggle("is-active", a.dataset.route === target));
    if (target === "answers") renderAnswers();
    if (target === "inbox") renderInbox();
    if (target === "home") { renderProfile(); resetComposer(); }
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  };
  window.addEventListener("hashchange", route);

  /* ---------- profile ---------- */
  const renderProfile = () => {
    $("#profileName").textContent = profile.name;
    $("#profileHandle").textContent = profile.handle;
    $("#profileBio").textContent = profile.bio;
    $("#avatar").textContent = (profile.name.trim()[0] || "?").toUpperCase();
    const all = storage.list();
    $("#statAnswered").textContent = all.filter(q => q.status === "answered").length;
    $("#statReceived").textContent = all.length;
    updateInboxCount();
  };
  const updateInboxCount = () => {
    const n = storage.list().filter(q => q.status === "open").length;
    const el = $("#inboxCount"); el.textContent = n; el.hidden = n === 0;
  };

  /* ---------- ask form ---------- */
  const form = $("#askForm"), ta = $("#question"), counter = $("#counter"), err = $("#formError"), sendBtn = $("#sendBtn");
  const updateCounter = () => {
    counter.textContent = `${ta.value.length} / 300`;
    counter.classList.toggle("is-near", ta.value.length > 260);
  };
  ta.addEventListener("input", () => { updateCounter(); err.hidden = true; });
  $("#prompts").addEventListener("click", (e) => {
    const b = e.target.closest(".prompt"); if (!b) return;
    ta.value = b.textContent; updateCounter(); ta.focus();
  });
  let lastSent = 0;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = ta.value.trim().replace(/\s+\n/g, "\n");
    if (text.length < 3) { err.textContent = "Write at least a few characters first."; err.hidden = false; ta.focus(); return; }
    if (Date.now() - lastSent < 4000) { err.textContent = "Easy there — wait a few seconds between questions."; err.hidden = false; return; }
    sendBtn.disabled = true; sendBtn.classList.add("is-busy");
    setTimeout(() => {
      storage.add({ id: uid(), text, status: "open", createdAt: Date.now() });
      lastSent = Date.now();
      ta.value = ""; updateCounter();
      sendBtn.disabled = false; sendBtn.classList.remove("is-busy");
      form.hidden = true; $(".composer-head").hidden = true; $("#sentState").hidden = false;
      renderProfile();
    }, 450);
  });
  const resetComposer = () => { $("#sentState").hidden = true; form.hidden = false; $(".composer-head").hidden = false; };
  $("#sendAnother").addEventListener("click", () => { resetComposer(); ta.focus(); });

  /* ---------- card factory ---------- */
  const tpl = $("#tplQuestion");
  const makeCard = (q, { owner }) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    $(".q-time", node).textContent = timeAgo(q.createdAt);
    $(".q-time", node).dateTime = new Date(q.createdAt).toISOString();
    $(".q-text", node).textContent = q.text;
    const badge = $(".badge", node);
    if (q.sample && owner) { badge.textContent = "Sample"; badge.classList.add("is-sample"); }
    else if (owner) { badge.textContent = q.status === "open" ? "New" : q.status; badge.classList.add(`is-${q.status}`); }
    else badge.remove();

    if (q.answer) { $(".q-answer", node).hidden = false; $(".a-text", node).textContent = q.answer; }

    const actions = $(".q-foot .q-actions", node);
    const btn = (label, cls, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = `btn-ghost sm ${cls || ""}`.trim(); b.textContent = label; b.addEventListener("click", fn); actions.appendChild(b); return b; };

    if (!owner) {
      node.classList.add("answers-card");
      btn("Share", "", () => copy(`Q: ${q.text}\nA: ${q.answer}\n${location.origin}${location.pathname}#answers`, "Copied to clipboard"));
      return node;
    }

    const reply = $(".q-reply", node), replyInput = $(".reply-input", node);
    const openReply = () => { reply.hidden = false; replyInput.value = q.answer || ""; replyInput.focus(); };
    $(".act-cancel", node).addEventListener("click", () => { reply.hidden = true; });
    $(".act-publish", node).addEventListener("click", () => {
      const a = replyInput.value.trim();
      if (!a) { replyInput.focus(); return; }
      storage.update(q.id, { answer: a, status: "answered", answeredAt: Date.now() });
      toast("Answer published"); renderInbox();
    });

    if (q.status === "open") btn("Answer", "", openReply);
    if (q.status === "answered") btn("Edit answer", "", openReply);
    if (q.status !== "archived") btn("Archive", "", () => { storage.update(q.id, { status: "archived" }); renderInbox(); });
    else btn("Restore", "", () => { storage.update(q.id, { status: q.answer ? "answered" : "open" }); renderInbox(); });
    btn("Copy", "", () => copy(q.text, "Question copied"));
    const del = btn("Delete", "", () => {
      if (!del.classList.contains("is-confirm")) { del.classList.add("is-confirm"); del.textContent = "Really delete?"; setTimeout(() => { del.classList.remove("is-confirm"); del.textContent = "Delete"; }, 2500); return; }
      storage.remove(q.id); toast("Deleted"); renderInbox();
    });
    return node;
  };

  /* ---------- answers page ---------- */
  const renderAnswers = () => {
    const feed = $("#answersFeed"); feed.replaceChildren();
    const list = storage.list().filter(q => q.status === "answered").sort((a, b) => (b.answeredAt || 0) - (a.answeredAt || 0));
    list.forEach((q, i) => { const c = makeCard(q, { owner: false }); c.style.animationDelay = `${Math.min(i, 8) * 40}ms`; feed.appendChild(c); });
    $("#answersEmpty").hidden = list.length > 0;
  };

  /* ---------- inbox ---------- */
  let unlocked = sessionStorage.getItem(KEY_UNLOCK) === "1";
  let filter = "all";
  const renderInbox = () => {
    $("#lockScreen").hidden = unlocked; $("#inboxPanel").hidden = !unlocked;
    if (!unlocked) { setTimeout(() => $("#passcode").focus(), 50); return; }
    const all = storage.list();
    const open = all.filter(q => q.status === "open").length;
    $("#inboxLede").textContent = open === 0 ? "Nothing waiting — nice." : `${open} question${open === 1 ? "" : "s"} waiting`;
    const list = all.filter(q => filter === "all" ? q.status !== "archived" : q.status === filter);
    const feed = $("#inboxFeed"); feed.replaceChildren();
    list.forEach((q, i) => { const c = makeCard(q, { owner: true }); c.style.animationDelay = `${Math.min(i, 8) * 40}ms`; feed.appendChild(c); });
    $("#inboxEmpty").hidden = list.length > 0;
    updateInboxCount();
  };
  $("#unlockForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#passcode").value;
    if (v === profile.pass) { unlocked = true; sessionStorage.setItem(KEY_UNLOCK, "1"); $("#passcode").value = ""; $("#unlockError").hidden = true; renderInbox(); }
    else { $("#unlockError").textContent = "That passcode doesn't match."; $("#unlockError").hidden = false; $("#passcode").select(); }
  });
  $("#lockBtn").addEventListener("click", () => { unlocked = false; sessionStorage.removeItem(KEY_UNLOCK); renderInbox(); });
  $$(".filter").forEach(b => b.addEventListener("click", () => {
    filter = b.dataset.filter; $$(".filter").forEach(x => x.classList.toggle("is-active", x === b)); renderInbox();
  }));
  $("#copyLink").addEventListener("click", () => copy(`${location.origin}${location.pathname}#home`, "Your ask link is copied"));

  /* ---------- settings ---------- */
  const sheet = $("#settingsSheet");
  const openSettings = () => {
    $("#setName").value = profile.name; $("#setHandle").value = profile.handle; $("#setBio").value = profile.bio; $("#setPass").value = "";
    $("#clearSamples").hidden = !storage.list().some(q => q.sample);
    sheet.hidden = false; $("#setName").focus();
  };
  const closeSettings = () => { sheet.hidden = true; };
  $("#openSettings").addEventListener("click", openSettings);
  $("#closeSettings").addEventListener("click", closeSettings);
  sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSettings(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) closeSettings(); });
  $("#settingsForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const pass = $("#setPass").value.trim();
    let handle = $("#setHandle").value.trim();
    if (handle && !handle.startsWith("@")) handle = "@" + handle;
    profile = { ...profile, name: $("#setName").value.trim() || profile.name, handle: handle || profile.handle, bio: $("#setBio").value.trim(), ...(pass ? { pass } : {}) };
    safe.set(KEY_P, profile);
    toast("Settings saved"); closeSettings(); renderProfile(); renderInbox();
  });
  $("#clearSamples").addEventListener("click", () => { storage.removeSamples(); toast("Sample questions removed"); closeSettings(); renderInbox(); renderProfile(); });

  /* ---------- boot ---------- */
  updateCounter();
  renderProfile();
  route();
})();
