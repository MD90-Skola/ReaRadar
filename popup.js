const $ = (s) => document.querySelector(s);

/* DOM */
const listEl = $("#list");
const minEl = $("#min");
const minValEl = $("#minVal");
const notifyEl = $("#notify");
const notifyValEl = $("#notifyVal");
const refreshBtn = $("#refresh");

const filterToggle = $("#filterToggle");
const filterPanel  = $("#filterPanel");

const filterListEl = $("#filterList");
const activePillsEl = $("#activePills");

/* Data */
const ALL_TAGS = ["SSD","RAM","HDD","GPU","CPU","Motherboard","Phone","Case","Cable","Other"];
const DEFAULT_INCLUDE = ["SSD","RAM","HDD"];

init();

/* ---------- Init ---------- */
async function init(){
    const st = (await chrome.storage.local.get(["minUI","minNotifyPercent","includeTags","dismissedIds","filterOpen"])) || {};
    const minUI = Number(st.minUI ?? 0);
    const minNotifyPercent = Number(st.minNotifyPercent ?? 0);
    const includeTags = Array.isArray(st.includeTags) ? st.includeTags : DEFAULT_INCLUDE;
    const filterOpen = Boolean(st.filterOpen); // default: false (stängd)

    // sliders
    minEl.value = String(minUI); minValEl.textContent = String(minUI);
    notifyEl.value = String(minNotifyPercent); notifyValEl.textContent = String(minNotifyPercent);
    minEl.addEventListener("input", onMinChange);
    notifyEl.addEventListener("input", onNotifyChange);

    // refresh
    refreshBtn.addEventListener("click", () => chrome.runtime.sendMessage({ cmd:"manualRefresh" }));

    // filter toggle (kollapsbar panel)
    setFilterOpen(filterOpen);
    filterToggle.addEventListener("click", async () => {
        const next = filterPanel.hidden;  // om hidden -> öppna
        setFilterOpen(next);
        await chrome.storage.local.set({ filterOpen: next });
    });

    renderFilterList(includeTags);
    renderPills(includeTags);
    render();
}

/* ---------- UI helpers ---------- */
function setFilterOpen(open){
    filterPanel.hidden = !open;
    filterToggle.setAttribute("aria-expanded", String(open));
    filterToggle.textContent = open ? "Sökfilter ▾" : "Sökfilter ▸";
}

/* ---------- Sliders ---------- */
async function onMinChange(e){
    const v = Number(e.target.value);
    minValEl.textContent = v;
    await chrome.storage.local.set({ minUI: v });
    render();
}
async function onNotifyChange(e){
    const v = Number(e.target.value);
    notifyValEl.textContent = v;
    await chrome.storage.local.set({ minNotifyPercent: v });
}

/* ---------- Filter UI ---------- */
function renderFilterList(active){
    filterListEl.innerHTML = ALL_TAGS.map(tag => {
        const checked = active.includes(tag) ? "checked" : "";
        return `<label class="list-item">
      <input type="checkbox" data-tag="${tag}" ${checked} />
      <span>${tag}</span>
    </label>`;
    }).join("");

    filterListEl.querySelectorAll("input[type=checkbox]").forEach(cb => {
        cb.addEventListener("change", async () => {
            const tag = cb.getAttribute("data-tag");
            const st = await chrome.storage.local.get("includeTags");
            const cur = new Set(st.includeTags ?? DEFAULT_INCLUDE);
            if (cb.checked) cur.add(tag); else cur.delete(tag);
            const arr = [...cur];
            await chrome.storage.local.set({ includeTags: arr });
            renderPills(arr);
            render();
        });
    });
}

function renderPills(active){
    activePillsEl.innerHTML = active.map(tag => `<span class="pill" data-tag="${tag}">${tag} ×</span>`).join("");
    activePillsEl.querySelectorAll(".pill").forEach(p => {
        p.addEventListener("click", async () => {
            const tag = p.getAttribute("data-tag");
            const st = await chrome.storage.local.get("includeTags");
            const arr = (st.includeTags ?? DEFAULT_INCLUDE).filter(t => t !== tag);
            await chrome.storage.local.set({ includeTags: arr });
            const cb = filterListEl.querySelector(`input[data-tag="${CSS.escape(tag)}"]`);
            if (cb) cb.checked = false;
            renderPills(arr);
            render();
        });
    });
}

/* ---------- Cards ---------- */
async function render(){
    const st = await chrome.storage.local.get(["lastItems","minUI","includeTags","dismissedIds"]);
    const lastItems = st.lastItems ?? [];
    const minUI = Number(st.minUI ?? 0);
    const includeTags = new Set(st.includeTags ?? DEFAULT_INCLUDE);
    const dismissed = new Set(st.dismissedIds ?? []);

    const passInc = (tags=[]) => (includeTags.size === 0 ? true : tags.some(t => includeTags.has(t)));

    const rows = lastItems
        .filter(it => (it.percent ?? -1) >= minUI)
        .filter(it => !dismissed.has(it.id))
        .filter(it => passInc(it.tags))
        .sort((a,b) => (b.percent ?? -1) - (a.percent ?? -1));

    listEl.innerHTML = rows.map(it => cardHTML(it)).join("")
        || `<li style="opacity:.7;padding:6px 2px">Inget matchar – öppna <b>Sökfilter</b> eller klicka <b>Simulera fynd</b>.</li>`;

    listEl.querySelectorAll(".dismiss").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.getAttribute("data-id");
            const cur = new Set((await chrome.storage.local.get("dismissedIds")).dismissedIds ?? []);
            cur.add(id);
            await chrome.storage.local.set({ dismissedIds: [...cur] });
            btn.closest("li.card")?.remove();
        });
    });
}

/* ---------- Helpers ---------- */
function cardHTML(it){
    const pct = it.percent != null ? `−${it.percent}%` : "−?%";
    const imgSrc = normalizeImg(it.img);
    const priceHTML = priceBlock(it.newPrice, it.oldPrice);
    return `
<li class="card">
  <button class="dismiss" title="Dölj" data-id="${escapeAttr(it.id)}">×</button>
  <div class="img">
    ${imgSrc ? `<img src="${imgSrc}" alt="" onerror="this.onerror=null;this.replaceWith(document.createTextNode('🛒'));">` : "🛒"}
  </div>
  <div>
    <div class="title"><a href="${it.url}" target="_blank" rel="noopener">${escapeHtml(it.title)}</a></div>
    <div class="meta"><span class="dot"></span><span>${escapeHtml(it.stock || "1 st")}</span></div>
    <div class="price">${priceHTML}</div>
  </div>
  <div class="badge">${pct}</div>
</li>`;
}

function priceBlock(newP, oldP){
    const o = oldP ? `<span class="old"><s>${escapeHtml(oldP)}</s></span>` : "";
    const n = newP ? `<span class="new">${escapeHtml(newP)}</span>` : "";
    return `${o} ${n}`;
}

function normalizeImg(u){
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;                // CDN
    return chrome.runtime.getURL(u.replace(/^\/+/, ""));  // debug/…png
}
function escapeHtml(s){ return (s || "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function escapeAttr(s){ return (s || "").replace(/"/g, "&quot;"); }
