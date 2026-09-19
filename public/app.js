(function () {
  "use strict";

  const DEFAULT_LANGS = ["English", "Hindi", "Tamil", "Bengali"];
  let ALL_LANGUAGES = ["English", "Hindi", "Tamil", "Telugu", "Bengali", "Marathi"];
  let selectedLangs = new Set(["English", "Hindi"]);
  let lastBrief = "";
  let lastLangs = [];
  let generationController = null;
  let generationRequestId = 0;

  const el = (id) => document.getElementById(id);

  // ---------- standalone shared-card preview ----------
  function tryRenderSharedPreview() {
    const hash = window.location.hash;
    if (!hash.startsWith("#card=")) return false;
    try {
      const json = decodeURIComponent(escape(atob(hash.slice(6))));
      const direction = JSON.parse(json);
      const shell = el("previewShell");
      shell.hidden = false;
      document.querySelector("main").style.display = "none";
      document.querySelector(".topbar").style.display = "none";
      const card = buildCard(direction, { standalone: true });
      const wrap = document.createElement("div");
      wrap.className = "preview-card";
      wrap.appendChild(card);
      const back = document.createElement("a");
      back.href = window.location.pathname;
      back.className = "preview-back";
      back.textContent = "← Open the studio";
      wrap.appendChild(back);
      shell.appendChild(wrap);
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------- language chips ----------
  async function loadLanguages() {
    try {
      const res = await fetch("/api/languages");
      const data = await res.json();
      if (Array.isArray(data.languages) && data.languages.length) {
        ALL_LANGUAGES = data.languages;
      }
    } catch (e) {
      /* fall back to default list already set */
    }
    const wrap = el("langChips");
    wrap.innerHTML = "";
    ALL_LANGUAGES.forEach((lang) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = lang;
      chip.setAttribute("aria-pressed", selectedLangs.has(lang) ? "true" : "false");
      chip.addEventListener("click", () => {
        if (selectedLangs.has(lang)) {
          if (selectedLangs.size === 1) return; // keep at least one language
          selectedLangs.delete(lang);
        } else {
          selectedLangs.add(lang);
        }
        chip.setAttribute("aria-pressed", selectedLangs.has(lang) ? "true" : "false");
      });
      wrap.appendChild(chip);
    });
  }

  // ---------- generation ----------
  async function generate() {
    const brief = el("briefInput").value.trim();
    const errorMsg = el("errorMsg");
    const setupHint = el("setupHint");
    errorMsg.hidden = true;
    setupHint.hidden = true;

    if (brief.length < 6) {
      errorMsg.textContent = "Give the studio a real brief — a sentence or two is enough.";
      errorMsg.hidden = false;
      return;
    }

    if (generationController) generationController.abort();
    generationController = new AbortController();
    const requestId = ++generationRequestId;
    setLoading(true);
    try {
      const languages = Array.from(selectedLangs);
      const count = parseInt(el("countSlider").value, 10);
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: generationController.signal,
        body: JSON.stringify({ brief, languages, count }),
      });
      const data = await res.json();
      if (!res.ok) throw Object.assign(new Error(data.error || "Generation failed"), { noKey: res.status === 500 });

      if (requestId !== generationRequestId) return;
      lastBrief = brief;
      lastLangs = languages;
      renderDirections(data.directions || []);
    } catch (err) {
      if (err.name === "AbortError") return;
      errorMsg.textContent = err.message || "Something went wrong talking to the model.";
      errorMsg.hidden = false;
      if (err.noKey) setupHint.hidden = false;
    } finally {
      if (requestId === generationRequestId) {
        generationController = null;
        setLoading(false);
      }
    }
  }

  function setLoading(isLoading) {
    const btn = el("generateBtn");
    btn.disabled = isLoading;
    btn.querySelector(".btn-spinner").hidden = !isLoading;
    btn.querySelector(".btn-label").textContent = isLoading ? "Generating..." : "Open the signal";
  }

  // ---------- rendering ----------
  function renderDirections(directions) {
    const grid = el("nodeGrid");
    const empty = el("canvasEmpty");
    const tag = el("directionCountTag");
    grid.innerHTML = "";
    if (!directions.length) {
      empty.hidden = false;
      grid.hidden = true;
      return;
    }
    empty.hidden = true;
    grid.hidden = false;
    tag.textContent = `${directions.length} direction node${directions.length > 1 ? "s" : ""}`;

    directions.forEach((direction, i) => {
      const card = buildCard(direction, { standalone: false, index: i });
      grid.appendChild(card);
    });
  }

  function textFor(direction, lang) {
    const t = (direction.translations && direction.translations[lang]) || {};
    return {
      headline: t.headline || direction.headline,
      subhead: t.subhead || direction.subhead,
      cta: t.cta || direction.cta,
    };
  }

  function buildCard(direction, opts) {
    opts = opts || {};
    const card = document.createElement("div");
    card.className = "card";
    if (!opts.standalone) card.style.animationDelay = `${(opts.index || 0) * 70}ms`;

    const palette = Array.isArray(direction.palette) && direction.palette.length
      ? direction.palette
      : ["#3a3a44", "#242429", "#151519"];

    const art = document.createElement("div");
    art.className = "card-art";
    art.style.background = `linear-gradient(135deg, ${palette[0]}, ${palette[1] || palette[0]} 55%, ${palette[2] || palette[0]})`;

    const angle = document.createElement("p");
    angle.className = "card-angle";
    angle.textContent = direction.angle || direction.mood || "Direction";
    art.appendChild(angle);

    const headline = document.createElement("h3");
    headline.className = "card-headline";
    const sub = document.createElement("p");
    sub.className = "card-sub";

    const availableLangs = direction.translations ? Object.keys(direction.translations) : ["English"];
    let currentLang = availableLangs.includes("English") ? "English" : availableLangs[0];

    function applyText(lang) {
      const t0 = performance.now();
      const t = textFor(direction, lang);
      headline.textContent = t.headline;
      sub.textContent = t.subhead;
      cta.textContent = t.cta;
      const elapsed = (performance.now() - t0).toFixed(2);
      el("switchMetric").textContent = `${elapsed} ms`;
    }

    art.appendChild(headline);
    art.appendChild(sub);
    card.appendChild(art);

    const body = document.createElement("div");
    body.className = "card-body";

    const cta = document.createElement("span");
    cta.className = "card-cta";
    body.appendChild(cta);

    if (availableLangs.length > 1) {
      const tabs = document.createElement("div");
      tabs.className = "lang-tabs";
      availableLangs.forEach((lang) => {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "lang-tab";
        tab.textContent = lang;
        tab.setAttribute("aria-pressed", lang === currentLang ? "true" : "false");
        tab.addEventListener("click", () => {
          currentLang = lang;
          tabs.querySelectorAll(".lang-tab").forEach((b) =>
            b.setAttribute("aria-pressed", b === tab ? "true" : "false")
          );
          applyText(lang);
        });
        tabs.appendChild(tab);
      });
      body.appendChild(tabs);
    }

    applyText(currentLang);

    if (!opts.standalone) {
      const actions = document.createElement("div");
      actions.className = "card-actions";

      const remixBtn = document.createElement("button");
      remixBtn.className = "ghost-btn";
      remixBtn.textContent = "Regenerate";
      remixBtn.addEventListener("click", () => regenerateCard(direction, card, remixBtn));
      actions.appendChild(remixBtn);

      const shareBtn = document.createElement("button");
      shareBtn.className = "ghost-btn";
      shareBtn.textContent = "Distribute";
      shareBtn.addEventListener("click", () => openDistributeModal(direction));
      actions.appendChild(shareBtn);

      body.appendChild(actions);

      const meta = document.createElement("div");
      meta.className = "card-meta";
      meta.innerHTML = `<span>${direction.mood || ""}</span><span>${availableLangs.length} language${availableLangs.length > 1 ? "s" : ""}</span>`;
      body.appendChild(meta);
    }

    card.appendChild(body);
    return card;
  }

  async function regenerateCard(direction, cardEl, btn) {
    btn.disabled = true;
    btn.textContent = "Remixing...";
    try {
      const res = await fetch("/api/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: lastBrief, angle: direction.angle, languages: lastLangs }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Regeneration failed");
      const fresh = buildCard(data.direction, { standalone: false });
      fresh.style.animationDelay = "0ms";
      cardEl.replaceWith(fresh);
    } catch (err) {
      btn.textContent = "Retry remix";
      btn.disabled = false;
      btn.title = err.message || "Remix failed. Try again.";
      return;
    }
  }

  // ---------- distribution modal ----------
  function openDistributeModal(direction) {
    const backdrop = el("modalBackdrop");
    backdrop.hidden = false;

    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(direction))));
    const link = `${window.location.origin}${window.location.pathname}#card=${encoded}`;
    el("shareLink").value = link;
    el("embedSnippet").value = `<iframe src="${link}" style="width:320px;height:420px;border:0;border-radius:14px;overflow:hidden" title="${(direction.headline || "Campaign").replace(/"/g, "")}"></iframe>`;

    const qrHolder = el("qrHolder");
    qrHolder.innerHTML = "";
    const qrImage = document.createElement("img");
    qrImage.alt = "Scannable share code for this direction";
    qrImage.width = 196;
    qrImage.height = 196;
    qrImage.src = `/api/qr?text=${encodeURIComponent(link)}`;
    qrImage.onerror = () => {
      qrHolder.textContent = "Share code unavailable. Copy the link above.";
      qrHolder.classList.add("qr-error");
    };
    qrHolder.appendChild(qrImage);
  }

  function closeModal() {
    el("modalBackdrop").hidden = true;
  }

  function wireCopyButton(btnId, sourceId) {
    el(btnId).addEventListener("click", () => {
      const source = el(sourceId);
      source.select();
      navigator.clipboard?.writeText(source.value).catch(() => {});
      const btn = el(btnId);
      const original = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = original), 1200);
    });
  }

  // ---------- init ----------
  document.addEventListener("DOMContentLoaded", () => {
    if (tryRenderSharedPreview()) return;

    loadLanguages();

    el("countSlider").addEventListener("input", (e) => {
      el("countLabel").textContent = e.target.value;
    });

    el("generateBtn").addEventListener("click", generate);
    document.querySelectorAll(".seed-btn").forEach((button) => {
      button.addEventListener("click", () => {
        el("briefInput").value = button.dataset.seed;
        el("briefInput").focus();
      });
    });
    el("briefInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
    });

    el("modalClose").addEventListener("click", closeModal);
    el("modalBackdrop").addEventListener("click", (e) => {
      if (e.target === el("modalBackdrop")) closeModal();
    });
    wireCopyButton("copyLink", "shareLink");
    wireCopyButton("copyEmbed", "embedSnippet");

    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => {
        if (!d.hasKey) el("setupHint").hidden = false;
      })
      .catch(() => {});
  });
})();
