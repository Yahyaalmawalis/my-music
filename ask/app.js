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
  const KEY_GUEST = "whisper.guest";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* ---------- persistence ---------- */
  const safe = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: keep in memory */ } },
  };

  const SAMPLES = [
    { id: "s1", text: "ما العادة الوحيدة التي غيّرت حياتك أكثر مما توقعت؟", status: "answered",
      answer: "المشي بلا سماعات. تبيّن أن عشرين دقيقة من اللاشيء هي المكان الذي كانت تختبئ فيه كل أفكاري.",
      createdAt: Date.now() - 1000 * 60 * 60 * 30, answeredAt: Date.now() - 1000 * 60 * 60 * 26, sample: true },
    { id: "s2", text: "بصراحة: هل تقرأ فعلًا كل سؤال يصلك؟", status: "answered",
      answer: "كل واحد منها. لا أجيب عنها كلها، لكنني أقرؤها جميعًا، غالبًا في الليل مع كوب شاي.",
      createdAt: Date.now() - 1000 * 60 * 60 * 9, answeredAt: Date.now() - 1000 * 60 * 60 * 7, sample: true },
    { id: "s3", text: "أي أغنية تكررها هذه الأيام؟", status: "open",
      createdAt: Date.now() - 1000 * 60 * 42, sample: true },
    { id: "s4", text: "لو أعدت مشروعًا واحدًا من الصفر، أيّها تختار ولماذا؟", status: "open",
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
    { name: "Yahya Al Mawali", handle: "@Yahya", bio: "اسألني أي شيء. أجيب عن الأسئلة الجميلة علنًا، والباقي يبقى بيننا.", pass: "1234" },
    safe.get(KEY_P, {})
  );

  /* ---------- helpers ---------- */
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "q" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const timeAgo = (ts) => {
    const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return "الآن";
    const m = Math.round(s / 60); if (m < 60) return `قبل ${m} د`;
    const h = Math.round(m / 60); if (h < 24) return `قبل ${h} س`;
    const d = Math.round(h / 24); if (d < 7) return `قبل ${d} ي`;
    return new Date(ts).toLocaleDateString("ar", { month: "short", day: "numeric" });
  };
  let toastTimer;
  const toast = (msg) => {
    const el = $("#toast"); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
  };
  const copy = async (text, okMsg) => {
    try { await navigator.clipboard.writeText(text); toast(okMsg); }
    catch { window.prompt("انسخ هذا النص:", text); }
  };

  /* ---------- theme ---------- */
  const root = document.documentElement;
  const applyTheme = (t) => { root.setAttribute("data-theme", t === "dark" ? "dark" : "light"); document.querySelector('meta[name="theme-color"]').content = t === "dark" ? "#0b0b0d" : "#ffffff"; };
  applyTheme(safe.get(KEY_T, matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  $("#themeToggle").addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next); safe.set(KEY_T, next);
  });

  /* ---------- routing ---------- */
  const views = $$(".view");
  let afterSignIn = "home";            // where a guest lands after leaving the sign-in page
  const route = () => {
    const name = (location.hash.replace("#", "") || "home").split("?")[0];
    let target = views.some(v => v.dataset.view === name) ? name : "home";
    if (target === "signin" && unlocked) { history.replaceState(null, "", "#inbox"); target = "inbox"; }
    views.forEach(v => { v.hidden = v.dataset.view !== target; });
    document.body.classList.toggle("is-auth", target === "signin");
    $$(".nav-link").forEach(a => a.classList.toggle("is-active", a.dataset.route === target));
    if (target === "signin") showSignIn();
    else stopSlides();
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
    if (text.length < 3) { err.textContent = "اكتب بضعة أحرف على الأقل أولًا."; err.hidden = false; ta.focus(); return; }
    if (Date.now() - lastSent < 4000) { err.textContent = "على مهلك، انتظر بضع ثوانٍ بين سؤال وآخر."; err.hidden = false; return; }
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
    else if (owner) { badge.textContent = { open: "New", answered: "Answered", archived: "Archived" }[q.status]; badge.classList.add(`is-${q.status}`); }
    else badge.remove();

    if (q.answer) { $(".q-answer", node).hidden = false; $(".a-text", node).textContent = q.answer; }

    const actions = $(".q-foot .q-actions", node);
    const btn = (label, cls, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = `btn-ghost sm ${cls || ""}`.trim(); b.textContent = label; b.addEventListener("click", fn); actions.appendChild(b); return b; };

    if (!owner) {
      node.classList.add("answers-card");
      btn("Share", "accent", () => copy(`س: ${q.text}\nج: ${q.answer}\n${location.origin}${location.pathname}#answers`, "تم النسخ"));
      return node;
    }

    const reply = $(".q-reply", node), replyInput = $(".reply-input", node);
    const openReply = () => { reply.hidden = false; replyInput.value = q.answer || ""; replyInput.focus(); };
    $(".act-cancel", node).addEventListener("click", () => { reply.hidden = true; });
    $(".act-publish", node).addEventListener("click", () => {
      const a = replyInput.value.trim();
      if (!a) { replyInput.focus(); return; }
      storage.update(q.id, { answer: a, status: "answered", answeredAt: Date.now() });
      toast("تم نشر الإجابة"); renderInbox();
    });

    if (q.status === "open") btn("Answer", "accent", openReply);
    if (q.status === "answered") btn("Edit", "accent", openReply);
    if (q.status !== "archived") btn("Archive", "", () => { storage.update(q.id, { status: "archived" }); renderInbox(); });
    else btn("Restore", "", () => { storage.update(q.id, { status: q.answer ? "answered" : "open" }); renderInbox(); });
    btn("Copy", "", () => copy(q.text, "تم نسخ السؤال"));
    const del = btn("Delete", "", () => {
      if (!del.classList.contains("is-confirm")) { del.classList.add("is-confirm"); del.textContent = "Delete?"; setTimeout(() => { del.classList.remove("is-confirm"); del.textContent = "Delete"; }, 2500); return; }
      storage.remove(q.id); toast("تم الحذف"); renderInbox();
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
  const remembered = () => { try { return localStorage.getItem(KEY_UNLOCK) === "1"; } catch { return false; } };
  let unlocked = sessionStorage.getItem(KEY_UNLOCK) === "1" || remembered();
  let filter = "all";
  const renderInbox = () => {
    $("#lockScreen").hidden = unlocked; $("#inboxPanel").hidden = !unlocked;
    if (!unlocked) return;
    const all = storage.list();
    const open = all.filter(q => q.status === "open").length;
    $("#inboxLede").textContent = open === 0 ? "لا شيء بانتظارك، رائع." : open === 1 ? "سؤال واحد بانتظارك" : open === 2 ? "سؤالان بانتظارك" : open <= 10 ? `${open} أسئلة بانتظارك` : `${open} سؤالًا بانتظارك`;
    const list = all.filter(q => filter === "all" ? q.status !== "archived" : q.status === filter);
    const feed = $("#inboxFeed"); feed.replaceChildren();
    list.forEach((q, i) => { const c = makeCard(q, { owner: true }); c.style.animationDelay = `${Math.min(i, 8) * 40}ms`; feed.appendChild(c); });
    $("#inboxEmpty").hidden = list.length > 0;
    updateInboxCount();
  };
  /* ---------- sign-in page ---------- */
  const normHandle = (h) => h.trim().replace(/^@/, "").toLowerCase();
  const loginErr = $("#loginError");
  const renderAuth = () => {
    $("#navSignIn").hidden = unlocked; $("#navUser").hidden = !unlocked;
    $("#navAvatar").textContent = (profile.name.trim()[0] || "?").toUpperCase();
    $("#navName").textContent = profile.handle.replace(/^@/, "");
  };
  const showSignIn = () => {
    loginErr.hidden = true; $("#loginPass").value = "";
    $("#loginUser").placeholder = profile.handle;
    startSlides();
    setTimeout(() => $("#loginUser").focus({ preventScroll: true }), 60);
  };
  const goSignIn = () => {
    const cur = (location.hash.replace("#", "") || "home");
    if (cur !== "signin") afterSignIn = cur;
    location.hash = "#signin";
  };
  const continueAsGuest = (dest) => {
    sessionStorage.setItem(KEY_GUEST, "1");
    location.hash = "#" + (dest || (afterSignIn === "inbox" ? "home" : afterSignIn));
  };
  $("#loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const u = normHandle($("#loginUser").value), p = $("#loginPass").value;
    const nameMatch = u === normHandle(profile.handle) || u === profile.name.trim().toLowerCase();
    if (!u || !p) { loginErr.textContent = "أدخل اسم المستخدم ورمز الدخول."; loginErr.hidden = false; return; }
    if (!nameMatch || p !== profile.pass) { loginErr.textContent = "اسم المستخدم أو رمز الدخول غير صحيح."; loginErr.hidden = false; $("#loginPass").select(); return; }
    unlocked = true; sessionStorage.setItem(KEY_UNLOCK, "1"); sessionStorage.removeItem(KEY_GUEST);
    if ($("#loginRemember").checked) { try { localStorage.setItem(KEY_UNLOCK, "1"); } catch {} }
    renderAuth(); toast(`Welcome back, ${profile.name.split(" ")[0]}`);
    location.hash = "#inbox";
  });
  $("#passToggle").addEventListener("click", (e) => {
    const b = e.currentTarget, inp = $("#loginPass"), show = inp.type === "password";
    inp.type = show ? "text" : "password";
    b.setAttribute("aria-pressed", String(show)); b.setAttribute("aria-label", show ? "Hide passcode" : "Show passcode");
    inp.focus();
  });
  $("#loginGuest").addEventListener("click", () => continueAsGuest());
  $("#authClose").addEventListener("click", (e) => { e.preventDefault(); continueAsGuest(); });
  $$(".auth-links [data-guest]").forEach(a => a.addEventListener("click", (e) => { e.preventDefault(); continueAsGuest(a.getAttribute("href").slice(1)); }));
  $("#authTheme").addEventListener("click", () => $("#themeToggle").click());
  $("#navSignIn").addEventListener("click", goSignIn);
  $("#lockSignIn").addEventListener("click", goSignIn);
  $("#navUser").addEventListener("click", () => { location.hash = "#inbox"; });

  /* ---------- sign-in slides ---------- */
  const slides = $$(".slide"), dots = $$("#slideDots .dot");
  let slideIdx = 0, slideTimer = null;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const showSlide = (i) => {
    slideIdx = (i + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle("is-active", k === slideIdx));
    dots.forEach((d, k) => { d.classList.toggle("is-active", k === slideIdx); d.setAttribute("aria-selected", String(k === slideIdx)); });
  };
  const stopSlides = () => { clearInterval(slideTimer); slideTimer = null; };
  const startSlides = () => { stopSlides(); if (!reduceMotion) slideTimer = setInterval(() => showSlide(slideIdx + 1), 5000); };
  $("#slideNext").addEventListener("click", () => { showSlide(slideIdx + 1); startSlides(); });
  $("#slidePrev").addEventListener("click", () => { showSlide(slideIdx - 1); startSlides(); });
  dots.forEach((d, k) => d.addEventListener("click", () => { showSlide(k); startSlides(); }));

  $("#lockBtn").addEventListener("click", () => {
    unlocked = false; sessionStorage.removeItem(KEY_UNLOCK); sessionStorage.setItem(KEY_GUEST, "1");
    try { localStorage.removeItem(KEY_UNLOCK); } catch {}
    renderAuth(); toast("تم تسجيل الخروج"); location.hash = "#home"; renderInbox();
  });
  $$(".filter").forEach(b => b.addEventListener("click", () => {
    filter = b.dataset.filter; $$(".filter").forEach(x => x.classList.toggle("is-active", x === b)); renderInbox();
  }));
  $("#copyLink").addEventListener("click", () => copy(`${location.origin}${location.pathname}#home`, "تم نسخ رابطك"));

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
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!sheet.hidden) closeSettings();
  });
  $("#settingsForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const pass = $("#setPass").value.trim();
    let handle = $("#setHandle").value.trim();
    if (handle && !handle.startsWith("@")) handle = "@" + handle;
    profile = { ...profile, name: $("#setName").value.trim() || profile.name, handle: handle || profile.handle, bio: $("#setBio").value.trim(), ...(pass ? { pass } : {}) };
    safe.set(KEY_P, profile);
    toast("تم حفظ الإعدادات"); closeSettings(); renderProfile(); renderAuth(); renderInbox();
  });
  $("#clearSamples").addEventListener("click", () => { storage.removeSamples(); toast("تم حذف الأسئلة التجريبية"); closeSettings(); renderInbox(); renderProfile(); });

  /* ---------- boot ---------- */
  updateCounter();
  renderProfile();
  renderAuth();
  const entry = (location.hash.replace("#", "") || "home");
  if (!unlocked && sessionStorage.getItem(KEY_GUEST) !== "1" && entry !== "signin") {
    afterSignIn = entry;
    history.replaceState(null, "", "#signin");
  }
  route();
})();
