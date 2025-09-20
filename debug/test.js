document.getElementById("btnTest")?.addEventListener("click", async () => {
    const items = [
        {
            id:"debug-14700KF",
            title:"Intel Core i7 14700KF 3.4 GHz 61MB",
            percent:14,
            url:"https://www.inet.se/fyndhornan",
            newPrice:"3 276 kr",
            oldPrice:"3 829 kr",
            stock:"1 st",
            img:"debug/1-cpu.png",
            tags:["CPU"]
        },
        {
            id:"debug-gskill-48gb-9000",
            title:"G.Skill 48GB (2x24GB) DDR5 9000MHz CL42 Trident Z5 CK CUDIMM",
            percent:18,
            url:"https://www.inet.se/fyndhornan",
            newPrice:"3 869 kr",
            oldPrice:"4 699 kr",
            stock:"1 st",
            img:"debug/2-ram.png",
            tags:["RAM"]
        },
        {
            id:"debug-s25-ultra-case",
            title:"Samsung Galaxy S25 Ultra Rugged Case Svart",
            percent:62,
            url:"https://www.inet.se/fyndhornan",
            newPrice:"269 kr",
            oldPrice:"699 kr",
            stock:"1 st",
            img:"debug/3-tele.png",
            tags:["Case","Phone"]
        }
    ];
    await new Promise(res => chrome.runtime.sendMessage({ cmd:"debugSimulate", items }, () => res()));
    await chrome.storage.local.set({ lastItems: items, dismissedIds: [] });
    setTimeout(() => location.reload(), 120);
});
