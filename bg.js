const LIST_URL = "https://www.inet.se/fyndhornan";
const INTERVAL_MIN = 10;

/* === Lifecycle === */
chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create("checkInetFynd", { periodInMinutes: INTERVAL_MIN });
    checkNow();
});
chrome.alarms.onAlarm.addListener(a => { if (a.name === "checkInetFynd") checkNow(); });

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.cmd === "manualRefresh") { checkNow().then(() => sendResponse({ ok: true })); return true; }
    if (msg?.cmd === "debugSimulate") { simulateFind(msg.items || []); sendResponse({ ok: true }); return true; }
});

/* === Kategorisering (titel) === */
function categorizeTitle(title = "") {
    const t = title.toLowerCase();
    const has = (arr) => arr.some(k => t.includes(k));
    if (has(["ssd","nvme","m.2"])) return ["SSD"];
    if (has(["hdd","hårddisk","harddisk","seagate","wd ","western digital"])) return ["HDD"];
    if (has(["ddr5","ddr4","ram","so-dimm","sodimm"])) return ["RAM"];
    if (has(["grafikkort","rtx","rx ","geforce","radeon"])) return ["GPU"];
    if (has(["processor","cpu","core i","ryzen"])) return ["CPU"];
    if (has(["moderkort","motherboard","b650","z790","x670"])) return ["Motherboard"];
    if (has(["kabel","sladd","cable"])) return ["Cable"];
    if (has(["fodral","skal","case","rugged"])) return ["Case"];
    if (has(["telefon","iphone","samsung galaxy"])) return ["Phone"];
    return ["Other"];
}

/* Hjälpare */
function stripComments(html){ return html.replace(/<!--[\s\S]*?-->/g, ""); }
function textOnly(s){ return (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(); }
function parsePriceKr(s){
    // "1 419 kr" / "3 869 kr" -> 1419 / 3869
    if (!s) return null;
    const digits = s.replace(/[^\d]/g, "");
    if (!digits) return null;
    return Number(digits);
}

/* === Hämta & parsa === */
async function checkNow() {
    try {
        const res = await fetch(LIST_URL, { cache: "no-store" });
        const html = await res.text();

        const cards = [...html.matchAll(/<li[^>]*data-test-id="search_product_[^"]+"[^>]*>([\s\S]*?)<\/li>/g)]
            .map(m => m[1]);

        const items = cards.map(raw => {
            // 1) Gör en "cleaned" variant utan HTML-kommentarer
            const card = stripComments(raw);

            const href = (card.match(/<a[^>]+href="([^"]+)"/) || [])[1] || "";
            const url = href ? new URL(href, "https://www.inet.se").toString() : "";
            const id = (href.match(/\/produkt\/([^/]+)/) || [])[1] || url;

            const title = textOnly((card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1]);

            // 2) Försök läsa "-14%" (unicode minus eller vanligt bindestreck), nu utan kommentarer
            let percent = null;
            const pm = card.match(/[−-]\s*(\d{1,3})\s*%/);
            if (pm) percent = Number(pm[1]);

            // 3) Priser
            const oldPriceHtml = (card.match(/<s[^>]*>([\s\S]*?)<\/s>/) || [])[1] || null;
            const newPriceHtml = (card.match(/data-test-is-discounted-price="true"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || null;

            const oldPrice = oldPriceHtml ? textOnly(oldPriceHtml) : null;
            const newPrice = newPriceHtml ? textOnly(newPriceHtml) : null;

            // 4) Fallback: räkna ut procent om den inte fanns i texten
            if (percent == null && oldPrice && newPrice) {
                const oldN = parsePriceKr(oldPrice);
                const newN = parsePriceKr(newPrice);
                if (oldN && newN && newN < oldN) {
                    percent = Math.round(((oldN - newN) / oldN) * 100);
                }
            }

            const stock = textOnly((card.match(/>(\s*\d+&nbsp;st\s*)</) || [])[1]?.replace(/&nbsp;/g, " "));

            const img = (card.match(/<img[^>]+src="([^"]+)"/) || [])[1] || "";
            const tags = categorizeTitle(title);
            return { id, title, percent, url, oldPrice, newPrice, stock, img, tags, ts: Date.now() };
        }).filter(x => x.title && x.url);

        if (!items.length) return;
        await handleItems(items);
    } catch { /* noop */ }
}

/* === Push + lagring + MEMORY (50 st) === */
async function handleItems(items) {
    const st = await chrome.storage.local.get(["knownIds","minNotifyPercent","minUI","includeTags","dismissedIds","memoryItems"]);
    const knownIds = Array.isArray(st.knownIds) ? st.knownIds : [];
    const minNotifyPercent = Number(st.minNotifyPercent ?? 0);
    const minUI = Number(st.minUI ?? 0);
    const includeTags = Array.isArray(st.includeTags) ? st.includeTags : [];
    const dismissedIds = Array.isArray(st.dismissedIds) ? st.dismissedIds : [];
    const memoryItems = Array.isArray(st.memoryItems) ? st.memoryItems : [];

    const pushEnabled = minNotifyPercent > 0;
    const known = new Set(knownIds);
    const dismissed = new Set(dismissedIds);
    const inc = new Set(includeTags);
    const passInc = (tags=[]) => (inc.size === 0 ? true : tags.some(t => inc.has(t)));

    const newly = items.filter(it => !known.has(it.id));

    // Memory 50 senaste (nya)
    if (newly.length) {
        const map = new Map(memoryItems.map(m => [m.id, m]));
        newly.forEach(n => map.set(n.id, n));
        const merged = Array.from(map.values())
            .sort((a,b) => (b.ts ?? 0) - (a.ts ?? 0))
            .slice(0, 50);
        await chrome.storage.local.set({ memoryItems: merged });
    }

    // Push – följer samma filter och trösklar
    const hits = newly.filter(it =>
        pushEnabled &&
        (it.percent ?? 0) >= minNotifyPercent &&
        (it.percent ?? 0) >= minUI &&
        passInc(it.tags) &&
        !dismissed.has(it.id)
    );

    if (hits.length) {
        const msg = hits.length === 1 ? `${hits[0].percent ?? "?"}%: ${hits[0].title}`
            : `${hits.length} nya fynd (min ${minNotifyPercent}%+)`;
        chrome.notifications.create({
            type: "basic", iconUrl: "icon.png",
            title: "Nytt i Fyndhörnan", message: msg, priority: 2
        });
        chrome.notifications.onClicked.addListener(() => {
            chrome.tabs.create({ url: hits.length === 1 ? hits[0].url : LIST_URL });
        });
    }

    // lastItems + knownIds
    const cap = 5000;
    const uniqIds = Array.from(new Set([...items.map(i => i.id), ...knownIds])).slice(0, cap);
    await chrome.storage.local.set({ lastItems: items, knownIds: uniqIds });
}

/* === Debug === */
async function simulateFind(fakeItems) {
    await chrome.storage.local.set({ knownIds: [] });
    fakeItems = fakeItems.map(it => ({ ...it, ts: Date.now(), tags: it.tags || categorizeTitle(it.title || "") }));
    await handleItems(fakeItems);
}
