/* ============================================================
   Whisper — anonymous Q&A
   Two data modes, chosen by config.js:
     • Supabase  (supabaseUrl + supabaseKey set): questions are shared
       across every visitor; the owner signs in with email + password.
     • Local demo (config empty): questions stay in this browser's
       localStorage and the owner uses a passcode.
   Render functions read the in-memory cache (`questions`, `profile`,
   store.stats()); the `store` object keeps that cache and the backend
   in step and calls rerender() when something changes.
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

  const CFG = window.WHISPER_CONFIG || {};
  const remote = Boolean(CFG.supabaseUrl && CFG.supabaseKey);
  let sb = null;                       // Supabase client (remote mode)
  let loading = remote;                // true until the first fetch lands

  const DEFAULT_PROFILE = { name: "Yahya Al Mawali", handle: "@Yahya", bio: "اسألني أي شيء. أجيب عن الأسئلة الجميلة علنًا، والباقي يبقى بيننا.", pass: "1234" };
  let profile = remote ? { ...DEFAULT_PROFILE } : Object.assign({ ...DEFAULT_PROFILE }, safe.get(KEY_P, {}));

  let questions = [];
  if (!remote) {
    questions = safe.get(KEY_Q, null);
    if (!Array.isArray(questions)) { questions = SAMPLES.slice(); safe.set(KEY_Q, questions); }
  }
  let remoteStats = { received: 0, answered: 0 };

  const fromRow = (r) => ({
    id: r.id, text: r.text, status: r.status, answer: r.answer || "",
    createdAt: Date.parse(r.created_at), answeredAt: r.answered_at ? Date.parse(r.answered_at) : null,
  });
  const toRow = (patch) => {
    const row = {};
    if ("status" in patch) row.status = patch.status;
    if ("answer" in patch) row.answer = patch.answer;
    if ("answeredAt" in patch) row.answered_at = patch.answeredAt ? new Date(patch.answeredAt).toISOString() : null;
    return row;
  };
  const saveLocal = () => { if (!remote) safe.set(KEY_Q, questions); };
  const fail = (msg, error) => { console.error(msg, error); toast(msg); };

  const store = {
    list() { return questions.slice().sort((a, b) => b.createdAt - a.createdAt); },
    stats() {
      if (remote) return remoteStats;
      return { received: questions.length, answered: questions.filter(q => q.status === "answered").length };
    },
    async refresh() {
      if (!remote || !sb) return;
      const q = sb.from("questions").select("id,text,status,answer,created_at,answered_at").order("created_at", { ascending: false }).limit(500);
      const [rows, st, pr] = await Promise.all([
        unlocked ? q : q.eq("status", "answered"),
        sb.rpc("public_stats"),
        sb.from("profile").select("name,handle,bio").eq("id", 1).maybeSingle(),
      ]);
      if (rows.error) { loading = false; return fail("تعذّر تحميل الأسئلة. تحقق من اتصالك.", rows.error); }
      questions = rows.data.map(fromRow);
      if (!st.error && st.data) remoteStats = { received: Number(st.data.received) || 0, answered: Number(st.data.answered) || 0 };
      if (!pr.error && pr.data) profile = { ...profile, ...pr.data };
      loading = false;
    },
    async add(text) {
      if (remote) {
        if (!sb) throw new Error("Not connected");
        const { error } = await sb.from("questions").insert({ text });
        if (error) throw error;
        remoteStats.received += 1;
        return;
      }
      questions.unshift({ id: uid(), text, status: "open", createdAt: Date.now() }); saveLocal();
    },
    async update(id, patch) {
      const i = questions.findIndex(q => q.id === id); if (i < 0) return;
      const before = questions[i];
      questions[i] = { ...before, ...patch }; saveLocal(); rerender();
      if (!remote) return;
      const { error } = await sb.from("questions").update(toRow(patch)).eq("id", id);
      if (error) { const k = questions.findIndex(q => q.id === id); if (k > -1) questions[k] = before; rerender(); return fail("لم يتم الحفظ. حاول مرة أخرى.", error); }
      if (before.status !== "answered" && patch.status === "answered") remoteStats.answered += 1;
      if (before.status === "answered" && patch.status && patch.status !== "answered") remoteStats.answered = Math.max(0, remoteStats.answered - 1);
      rerender();
    },
    async remove(id) {
      const before = questions.slice();
      const gone = questions.find(q => q.id === id);
      questions = questions.filter(q => q.id !== id); saveLocal(); rerender();
      if (!remote) return;
      const { error } = await sb.from("questions").delete().eq("id", id);
      if (error) { questions = before; rerender(); return fail("لم يتم الحذف. حاول مرة أخرى.", error); }
      remoteStats.received = Math.max(0, remoteStats.received - 1);
      if (gone && gone.status === "answered") remoteStats.answered = Math.max(0, remoteStats.answered - 1);
      rerender();
    },
    removeSamples() { questions = questions.filter(q => !q.sample); saveLocal(); },
    async saveProfile(next) {
      if (remote) {
        const { error } = await sb.from("profile").update({ name: next.name, handle: next.handle, bio: next.bio }).eq("id", 1);
        if (error) throw error;
      }
      profile = { ...profile, ...next };
      if (!remote) safe.set(KEY_P, profile);
    },
  };

  /* Remember me: Supabase keeps its session in localStorage when ticked, sessionStorage otherwise. */
  const KEY_REMEMBER = "whisper.remember";
  const authStorage = {
    getItem(k) { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch { return null; } },
    setItem(k, v) { try { (localStorage.getItem(KEY_REMEMBER) === "1" ? localStorage : sessionStorage).setItem(k, v); } catch {} },
    removeItem(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch {} },
  };
  const loadSupabase = () => new Promise((resolve, reject) => {
    if (window.supabase) return resolve();
    const el = document.createElement("script");
    el.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";
    el.onload = resolve; el.onerror = () => reject(new Error("Could not load Supabase"));
    document.head.appendChild(el);
  });
  const checkOwner = async () => {
    const { data, error } = await sb.rpc("is_owner");
    return !error && data === true;
  };

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

  /* the link people share (NGL-style): a standalone page at /yahya/ that only asks */
  const shareLink = () => new URL("../yahya/", location.href).href;

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
    let target = name === "ask" ? "home" : views.some(v => v.dataset.view === name) ? name : "home";
    if (target === "signin" && unlocked) { history.replaceState(null, "", "#inbox"); target = "inbox"; }
    views.forEach(v => { v.hidden = v.dataset.view !== target; });
    document.body.classList.toggle("is-auth", target === "signin");
    $$(".nav-link").forEach(a => a.classList.toggle("is-active", a.dataset.route === target));
    current = target;
    if (target === "signin") showSignIn();
    else stopSlides();
    if (target === "home") resetComposer();
    rerender();
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  };
  let current = "home";
  /* redraw the visible page from the cache without moving the scroll position */
  const rerender = () => {
    renderAuth(); updateInboxCount();
    if (current === "answers") renderAnswers();
    if (current === "inbox") renderInbox();
    if (current === "profile") renderProfilePage();
    if (current === "home") renderProfile();
  };
  window.addEventListener("hashchange", route);

  /* ---------- profile ---------- */
  const renderProfile = () => {
    $("#profileName").textContent = profile.name;
    $("#profileHandle").textContent = profile.handle;
    $("#profileBio").textContent = profile.bio;
    $("#avatar").textContent = (profile.name.trim()[0] || "?").toUpperCase();
    const st = store.stats();
    $("#statAnswered").textContent = loading ? "–" : st.answered;
    $("#statReceived").textContent = loading ? "–" : st.received;
  };
  const updateInboxCount = () => {
    const n = store.list().filter(q => q.status === "open").length;
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
    const started = Date.now();
    store.add(text)
      .then(() => new Promise(r => setTimeout(r, Math.max(0, 450 - (Date.now() - started)))))
      .then(() => {
        lastSent = Date.now();
        ta.value = ""; updateCounter();
        form.hidden = true; $(".composer-head").hidden = true; $("#sentState").hidden = false;
        renderProfile(); updateInboxCount();
      })
      .catch((error) => {
        console.error(error);
        err.textContent = "لم يُرسل سؤالك. تحقق من اتصالك وحاول مرة أخرى."; err.hidden = false;
      })
      .finally(() => { sendBtn.disabled = false; sendBtn.classList.remove("is-busy"); });
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
      store.update(q.id, { answer: a, status: "answered", answeredAt: Date.now() });
      toast("تم نشر الإجابة");
    });

    if (q.status === "open") btn("Answer", "accent", openReply);
    if (q.status === "answered") btn("Edit", "accent", openReply);
    if (q.status !== "archived") btn("Archive", "", () => store.update(q.id, { status: "archived" }));
    else btn("Restore", "", () => store.update(q.id, { status: q.answer ? "answered" : "open" }));
    btn("Copy", "", () => copy(q.text, "تم نسخ السؤال"));
    const del = btn("Delete", "", () => {
      if (!del.classList.contains("is-confirm")) { del.classList.add("is-confirm"); del.textContent = "Delete?"; setTimeout(() => { del.classList.remove("is-confirm"); del.textContent = "Delete"; }, 2500); return; }
      store.remove(q.id); toast("تم الحذف");
    });
    return node;
  };

  /* ---------- answers page ---------- */
  const renderAnswers = () => {
    const feed = $("#answersFeed"); feed.replaceChildren();
    const list = store.list().filter(q => q.status === "answered").sort((a, b) => (b.answeredAt || 0) - (a.answeredAt || 0));
    list.forEach((q, i) => { const c = makeCard(q, { owner: false }); c.style.animationDelay = `${Math.min(i, 8) * 40}ms`; feed.appendChild(c); });
    $("#answersEmpty").hidden = loading || list.length > 0;
  };

  /* ---------- profile page ---------- */
  const renderProfilePage = () => {
    const answered = store.list().filter(q => q.status === "answered").sort((a, b) => (b.answeredAt || 0) - (a.answeredAt || 0));
    const st = store.stats();
    $("#pAvatar").textContent = (profile.name.trim()[0] || "?").toUpperCase();
    $("#pName").textContent = profile.name;
    $("#pHandle").textContent = profile.handle;
    $("#pBio").textContent = profile.bio;
    $("#pAnswered").textContent = loading ? "–" : st.answered;
    $("#pReceived").textContent = loading ? "–" : st.received;
    $("#pRate").textContent = loading ? "–" : st.received ? Math.round((st.answered / st.received) * 100) + "%" : "0%";
    $("#pSince").textContent = loading ? "جارٍ التحميل…" : answered.length ? `آخر إجابة ${timeAgo(answered[0].answeredAt || answered[0].createdAt)}` : "لا إجابات منشورة بعد";
    $("#pEdit").hidden = !unlocked;
    const feed = $("#profileFeed"); feed.replaceChildren();
    answered.slice(0, 3).forEach((q, i) => { const c = makeCard(q, { owner: false }); c.style.animationDelay = `${i * 40}ms`; feed.appendChild(c); });
    $("#profileEmpty").hidden = loading || answered.length > 0;
    $(".see-all").hidden = answered.length <= 3;
  };
  $("#heroCopy").addEventListener("click", () => {
    copy(shareLink(), "تم نسخ الرابط");
    const b = $("#heroCopy"); b.classList.add("is-done"); b.querySelector(".copy-label").textContent = "Copied";
    setTimeout(() => { b.classList.remove("is-done"); b.querySelector(".copy-label").textContent = "Copy link"; }, 2000);
  });
  $("#pCopy").addEventListener("click", () => copy(`${location.origin}${location.pathname}#profile`, "تم نسخ رابط الملف الشخصي"));

  /* ---------- inbox ---------- */
  const remembered = () => { try { return localStorage.getItem(KEY_UNLOCK) === "1"; } catch { return false; } };
  let unlocked = !remote && (sessionStorage.getItem(KEY_UNLOCK) === "1" || remembered());
  let filter = "all";
  const renderInbox = () => {
    $("#lockScreen").hidden = unlocked; $("#inboxPanel").hidden = !unlocked;
    if (!unlocked) return;
    const all = store.list();
    const open = all.filter(q => q.status === "open").length;
    $("#inboxLede").textContent = open === 0 ? "لا شيء بانتظارك، رائع." : open === 1 ? "سؤال واحد بانتظارك" : open === 2 ? "سؤالان بانتظارك" : open <= 10 ? `${open} أسئلة بانتظارك` : `${open} سؤالًا بانتظارك`;
    const list = all.filter(q => filter === "all" ? q.status !== "archived" : q.status === filter);
    const feed = $("#inboxFeed"); feed.replaceChildren();
    list.forEach((q, i) => { const c = makeCard(q, { owner: true }); c.style.animationDelay = `${Math.min(i, 8) * 40}ms`; feed.appendChild(c); });
    $("#inboxEmpty").hidden = loading || list.length > 0;
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
  const signedIn = () => {
    unlocked = true; sessionStorage.removeItem(KEY_GUEST);
    renderAuth(); toast(`Welcome back, ${profile.name.split(" ")[0]}`);
    location.hash = "#inbox";
  };
  const loginBtn = $(".auth-btn");
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (remote) {
      const email = $("#loginUser").value.trim(), password = $("#loginPass").value;
      if (!email || !password) { loginErr.textContent = "أدخل البريد الإلكتروني وكلمة المرور."; loginErr.hidden = false; return; }
      if (!sb) { loginErr.textContent = "تعذّر الاتصال بقاعدة البيانات."; loginErr.hidden = false; return; }
      try { localStorage.setItem(KEY_REMEMBER, $("#loginRemember").checked ? "1" : "0"); } catch {}
      loginBtn.disabled = true; loginErr.hidden = true;
      try {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) { loginErr.textContent = "البريد الإلكتروني أو كلمة المرور غير صحيحة."; loginErr.hidden = false; $("#loginPass").select(); return; }
        if (!(await checkOwner())) {
          await sb.auth.signOut();
          loginErr.textContent = "هذا الحساب ليس صاحب الصفحة."; loginErr.hidden = false; return;
        }
        loading = true;
        signedIn();
        await store.refresh(); rerender();
      } catch (error) {
        console.error(error); loginErr.textContent = "تعذّر الاتصال. حاول مرة أخرى."; loginErr.hidden = false;
      } finally { loginBtn.disabled = false; }
      return;
    }
    const u = normHandle($("#loginUser").value), p = $("#loginPass").value;
    const nameMatch = u === normHandle(profile.handle) || u === profile.name.trim().toLowerCase();
    if (!u || !p) { loginErr.textContent = "أدخل اسم المستخدم ورمز الدخول."; loginErr.hidden = false; return; }
    if (!nameMatch || p !== profile.pass) { loginErr.textContent = "اسم المستخدم أو رمز الدخول غير صحيح."; loginErr.hidden = false; $("#loginPass").select(); return; }
    sessionStorage.setItem(KEY_UNLOCK, "1");
    if ($("#loginRemember").checked) { try { localStorage.setItem(KEY_UNLOCK, "1"); } catch {} }
    signedIn();
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
  $("#footTheme").addEventListener("click", () => $("#themeToggle").click());
  $("#navSignIn").addEventListener("click", goSignIn);
  $("#lockSignIn").addEventListener("click", goSignIn);
  $("#navUser").addEventListener("click", () => { location.hash = "#profile"; });

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

  $("#lockBtn").addEventListener("click", async () => {
    unlocked = false; sessionStorage.removeItem(KEY_UNLOCK); sessionStorage.setItem(KEY_GUEST, "1");
    try { localStorage.removeItem(KEY_UNLOCK); } catch {}
    if (remote) {
      questions = questions.filter(q => q.status === "answered");   // drop private rows from memory
      if (sb) await sb.auth.signOut().catch(() => {});
    }
    toast("تم تسجيل الخروج"); location.hash = "#home"; rerender();
  });
  $$(".filter").forEach(b => b.addEventListener("click", () => {
    filter = b.dataset.filter; $$(".filter").forEach(x => x.classList.toggle("is-active", x === b)); renderInbox();
  }));
  $("#copyLink").addEventListener("click", () => copy(shareLink(), "تم نسخ رابطك، أرسله لأي شخص ليسألك مباشرة"));

  /* ---------- settings ---------- */
  const sheet = $("#settingsSheet");
  const openSettings = () => {
    $("#setName").value = profile.name; $("#setHandle").value = profile.handle; $("#setBio").value = profile.bio; $("#setPass").value = "";
    $("#clearSamples").hidden = !store.list().some(q => q.sample);
    sheet.hidden = false; $("#setName").focus();
  };
  const closeSettings = () => { sheet.hidden = true; };
  $("#openSettings").addEventListener("click", openSettings);
  $("#pEdit").addEventListener("click", openSettings);
  $("#closeSettings").addEventListener("click", closeSettings);
  sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSettings(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!sheet.hidden) closeSettings();
  });
  $("#settingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pass = $("#setPass").value.trim();
    let handle = $("#setHandle").value.trim();
    if (handle && !handle.startsWith("@")) handle = "@" + handle;
    const next = { name: $("#setName").value.trim() || profile.name, handle: handle || profile.handle, bio: $("#setBio").value.trim() };
    try {
      if (remote && pass) {
        if (pass.length < 6) { toast("كلمة المرور يجب أن تكون 6 أحرف على الأقل."); return; }
        const { error } = await sb.auth.updateUser({ password: pass });
        if (error) throw error;
      } else if (pass) next.pass = pass;
      await store.saveProfile(next);
      toast("تم حفظ الإعدادات"); closeSettings(); rerender();
    } catch (error) { fail("لم تُحفظ الإعدادات. حاول مرة أخرى.", error); }
  });
  $("#clearSamples").addEventListener("click", () => { store.removeSamples(); toast("تم حذف الأسئلة التجريبية"); closeSettings(); rerender(); });

  $("#shareUrl").textContent = shareLink().replace(/^https?:\/\//, "").replace(/\/$/, "");

  /* ---------- remote-mode labels ---------- */
  if (remote) {
    const userField = $("#loginUser"), passField = $("#loginPass");
    userField.closest(".field").querySelector(".field-label").textContent = "Email";
    userField.type = "email"; userField.autocomplete = "email"; userField.placeholder = "you@example.com";
    passField.closest(".field").querySelector(".field-label").textContent = "Password";
    passField.removeAttribute("inputmode"); passField.placeholder = "••••••••";
    const setPass = $("#setPass"); setPass.removeAttribute("inputmode"); setPass.minLength = 6;
    setPass.closest("label").firstChild.textContent = "New password";
  }

  /* ---------- live refresh ---------- */
  let pollTimer = null;
  const syncNow = async () => { if (remote && sb && !document.hidden) { await store.refresh(); rerender(); } };
  const startPolling = () => { clearInterval(pollTimer); if (remote) pollTimer = setInterval(syncNow, 30000); };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncNow(); });

  /* ---------- boot ---------- */
  const boot = async () => {
    updateCounter();
    if (remote) {
      try {
        await loadSupabase();
        sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
          auth: { storage: authStorage, persistSession: true, autoRefreshToken: true, storageKey: "whisper.auth" },
        });
        const { data: { session } } = await sb.auth.getSession();
        if (session) unlocked = await checkOwner();
        sb.auth.onAuthStateChange((event) => {
          if (event === "SIGNED_OUT" && unlocked) { unlocked = false; rerender(); }
        });
      } catch (error) {
        console.error(error);
        loading = false;
        toast("تعذّر الاتصال بقاعدة البيانات.");
      }
    }
    const entry = location.hash.replace("#", "");
    const sharedLink = entry !== "" && entry !== "home" && entry !== "signin";
    if (sharedLink) sessionStorage.setItem(KEY_GUEST, "1");
    if (!unlocked && !sharedLink && sessionStorage.getItem(KEY_GUEST) !== "1" && entry !== "signin") {
      afterSignIn = "home";
      history.replaceState(null, "", "#signin");
    }
    route();
    if (remote && sb) { await store.refresh(); rerender(); startPolling(); }
  };
  boot();
})();
