// memory.js – enkel “Historik” UI för de 50 senaste

(() => {
    const $ = (s) => document.querySelector(s);

    // --- UI: lägg till en knapp & panel under verktygsraden ---
    const toolbar = document.querySelector(".toolbar");
    const historyBtn = document.createElement("button");
    historyBtn.id = "historyToggle";
    historyBtn.className = "btn small";
    historyBtn.textContent = "Historik ▸";
    toolbar.insertBefore(historyBtn, toolbar.firstChild); // lägg först

    const panel = document.createElement("section");
    panel.id = "historyPanel";
    panel.className = "panel";
    panel.hidden = true;
    panel.innerHTML = `
    <div class="list">
      <div class="list-title">Historik (50 senaste)</div>

      <div class="history-controls" style="display:flex;gap:8px;margin-bottom:6px;align-items:center">
        <input id="histSearch" placeholder="Sök titel/price/tagg…" style="flex:1;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:#2a2a2a;color:#fff"/>
        <button id="histClear" class="btn small">Rensa alla</button>
      </div>

      <div id="histTagList" class="list-body" style="max-height:112px"></div>
      <ul id="histList" class="cards" style="max-height:320px"></ul>
    </div>
  `;
    toolbar.parentElement.after(panel);

    const ALL_TAGS = ["SSD","RAM","HDD","GPU","CPU","Motherboard","Phone","Case","Cable","Other"];

    const histTagList = panel.querySelector("#histTagList");
    const histList = panel.querySelector("#histList");
    const histSearch = panel.querySelector("#histSearch");
    const histClear = panel.querySelector("#histClear");

    // rendera tagg-checkboxar (fristående från huvudfiltret)
    function renderTagChecks(active = []) {
        histTagList.innerHTML = ALL_TAGS.map(t => {
            const ck = active.includes(t) ? "checked" : "";
            return `<label class="list-item"><input type="checkbox" data-tag="${t}" ${ck}/><span>${t}</span></label>`;
        }).join("");

        histTagList.querySelectorAll("input[type=checkbox]").forEach(cb => {
            cb.addEventListener("change", async () => {
                const st = await chrome.storage.local.get("historyTagFilter");
                const cur = new Set(st.historyTagFilter ?? []);
                const tag = cb.getAttribute("data-tag");
                if (cb.checked) cur.add(tag); else cur.delete(tag);
                await chrome.storage.local.set({ historyTagFilter: [...cur] });
                paint();
            });
        });
    }

    // öppna/stäng
    historyBtn.addEventListener("click", async () => {
        const open = panel.hidden;
        panel.hidden = !open;
        historyBtn.textContent = open ? "Historik ▾" : "Historik ▸";
        await chrome.storage.local.set({ historyOpen: open });
        if (open) paint();
    });

    // återställ öppet/stängt från storage
    (async () => {
        const st = await chrome.storage.local.get(["historyOpen","historyTagFilter","historySearch"]);
        const open = !!st.historyOpen;
        panel.hidden = !open;
        historyBtn.textContent = open ? "Historik ▾" : "Historik ▸";
        histSearch.value = st.historySearch ?? "";
        renderTagChecks(st.historyTagFilter ?? []);
        if (open) paint();
    })();

    // sök + rensa
    histSearch.addEventListener("input", async (e) => {
        await chrome.storage.local.set({ historySearch: e.target.value });
        paint();
    });

    histClear.addEventListener("click", async () => {
        if (!confirm("Rensa alla sparade annonser?")) return;
        await chrome.storage.local.set({ memoryItems: [] });
        paint();
    });

    // radera enstaka
    histList.addEventListener("click", async (e) => {
        const btn = e.target.closest("button[data-del]");
        if (!btn) return;
        const id = btn.getAttribute("data-del");
        const st = await chrome.storage.local.get("memoryItems");
        const arr = (st.memoryItems ?? []).filter(x => x.id !== id);
        await chrome.storage.local.set({ memoryItems: arr });
        paint();
    });

    function normalizeImg(u){
        if (!u) return "";
        if (/^https?:\/\//i.test(u)) return u;
        return chrome.runtime.getURL(u.replace(/^\/+/, ""));
    }
    const esc = (s) => (s||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

    async function paint(){
        const st = await chrome.storage.local.get(["memoryItems","historyTagFilter","historySearch"]);
        const q = (st.historySearch ?? "").toLowerCase().trim();
        const tagFilter = new Set(st.historyTagFilter ?? []);
        let rows = (st.memoryItems ?? []);

        if (q) {
            rows = rows.filter(r =>
                (r.title||"").toLowerCase().includes(q) ||
                (r.newPrice||"").toLowerCase().includes(q) ||
                (r.oldPrice||"").toLowerCase().includes(q) ||
                (r.tags||[]).some(t => t.toLowerCase().includes(q))
            );
        }
        if (tagFilter.size) {
            rows = rows.filter(r => (r.tags||[]).some(t => tagFilter.has(t)));
        }

        if (!rows.length) {
            histList.innerHTML = `<li style="opacity:.7;padding:6px 2px">Inget sparat ännu.</li>`;
            return;
        }

        histList.innerHTML = rows.map(r => {
            const img = normalizeImg(r.img);
            const pct = r.percent != null ? `−${r.percent}%` : "−?%";
            const ts = r.ts ? new Date(r.ts).toLocaleString() : "";
            return `
<li class="card">
  <div class="img">${img ? `<img src="${img}" alt="" onerror="this.onerror=null;this.replaceWith(document.createTextNode('🛒'));">` : "🛒"}</div>
  <div>
    <div class="title"><a href="${r.url}" target="_blank" rel="noopener">${esc(r.title)}</a></div>
    <div class="meta"><span class="dot"></span><span>${esc(r.stock || "1 st")}</span> <span style="opacity:.7">• ${esc(ts)}</span></div>
    <div class="price">${r.oldPrice ? `<span class="old"><s>${esc(r.oldPrice)}</s></span>` : ""} ${r.newPrice ? `<span class="new">${esc(r.newPrice)}</span>` : ""}</div>
  </div>
  <div class="badge">${pct}</div>
  <button class="dismiss" title="Ta bort" data-del="${esc(r.id)}">×</button>
</li>`;
        }).join("");
    }
})();
