import { unzipSync, zipSync } from "fflate";

const FLAGS = [
  { bit: 0, mask: 0x01, label: "Beat Time Trial", sub: "Normal" },
  { bit: 1, mask: 0x02, label: "Beat Time Trial", sub: "Reversed" },
  { bit: 2, mask: 0x04, label: "Beat Time Trial", sub: "Mirrored" },
  { bit: 3, mask: 0x08, label: "Practice Star", sub: "Collected" },
  { bit: 4, mask: 0x10, label: "Single Race", sub: "Won 1st place" },
  { bit: 5, mask: 0x20, label: "Championship", sub: "Cup completed" },
];

const levels = new Map();
const stunts = new Map();
let activeType = null;
let activeName = null;

function crc32_rvgl(data) {
  const n = data.length >>> 2;
  if (n === 0) return 0;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let crc = -1;
  for (let w = 0; w < n; w++) {
    let word = v.getUint32(w * 4, true);
    for (let b = 0; b < 32; b++) {
      const msb = crc < 0;
      crc = (crc << 1) | (word & 1);
      word >>>= 1;
      if (msb) crc ^= 0x04c11db7;
    }
  }
  return ~crc >>> 0;
}

function writeStr(buf, off, str, len) {
  const b = new TextEncoder().encode(str);
  for (let i = 0; i < len; i++) buf[off + i] = i < b.length ? b[i] : 0;
}
function writeU32(buf, off, val) {
  buf[off] = val & 0xff;
  buf[off + 1] = (val >>> 8) & 0xff;
  buf[off + 2] = (val >>> 16) & 0xff;
  buf[off + 3] = (val >>> 24) & 0xff;
}
function readU32(buf, off) {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}
function readStr(buf, off, len) {
  let end = off;
  while (end < off + len && buf[end] !== 0) end++;
  return new TextDecoder().decode(buf.subarray(off, end));
}

function buildLevelFile(name) {
  const buf = new Uint8Array(72);
  writeStr(buf, 0x00, "RVGL Save File 1.00", 32);
  writeStr(buf, 0x20, document.getElementById("profileName").value, 16);
  const entry = levels.get(name);
  writeStr(buf, 0x30, entry ? entry.innerName : name, 16);
  let secrets = 0x80000000;
  if (entry)
    entry.flags.forEach((on, i) => {
      if (on) secrets |= FLAGS[i].mask;
    });
  writeU32(buf, 0x40, secrets);
  writeU32(buf, 0x44, crc32_rvgl(buf.subarray(0, 0x44)));
  return buf;
}

function buildStuntFile(name) {
  const buf = new Uint8Array(140);
  writeStr(buf, 0x00, "RVGL Save File 1.00", 32);
  writeStr(buf, 0x20, document.getElementById("profileName").value, 16);
  const s = stunts.get(name);
  writeStr(buf, 0x30, s ? s.innerName : name, 16);
  const total = s ? s.total : 0;
  const indices = [];
  if (s)
    for (let i = 0; i < total; i++) {
      if (s.stars[i]) indices.push(i);
    }
  writeU32(buf, 0x40, indices.length);
  writeU32(buf, 0x44, total);
  for (let i = 0; i < indices.length && i < 64; i++) buf[0x48 + i] = indices[i];
  writeU32(buf, 0x88, crc32_rvgl(buf.subarray(0, 0x88)));
  return buf;
}

function parseLevelFile(data) {
  if (data.length < 72) return null;
  const hdr = readStr(data, 0, 19);
  if (hdr !== "RVGL Save File 1.00") return null;
  const profile = readStr(data, 0x20, 16);
  const track = readStr(data, 0x30, 16);
  const secrets = readU32(data, 0x40);
  const flags = FLAGS.map((f) => Boolean(secrets & f.mask));
  return { profile, track, flags };
}

function parseStuntFile(data) {
  if (data.length < 140) return null;
  const hdr = readStr(data, 0, 19);
  if (hdr !== "RVGL Save File 1.00") return null;
  const profile = readStr(data, 0x20, 16);
  const level = readStr(data, 0x30, 16);
  const found = readU32(data, 0x40);
  const total = readU32(data, 0x44);
  const stars = new Array(64).fill(false);
  for (let i = 0; i < found && i < 64; i++) {
    const idx = data[0x48 + i];
    if (idx < 64) stars[idx] = true;
  }
  return { profile, level, total, stars };
}

const dropZone = document.getElementById("dropZone");
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

function handleFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function () {
    try {
      const buf = reader.result;
      const zipEntries = unzipSync(new Uint8Array(buf));
      const zipFiles = Object.entries(zipEntries).map(([name, data]) => ({ name, data }));
      levels.clear();
      stunts.clear();
      let profile = "";
      for (const zf of zipFiles) {
        const base = zf.name.replace(/^.*[/\\]/, "");
        if (base.endsWith(".level")) {
          const p = parseLevelFile(zf.data);
          const lName = base.replace(/\.level$/, "");
          if (p) {
            levels.set(lName, { innerName: p.track, flags: p.flags });
            if (!profile) profile = p.profile;
          }
        } else if (base.endsWith(".stunt")) {
          const p = parseStuntFile(zf.data);
          const sName = base.replace(/\.stunt$/, "");
          if (p) {
            stunts.set(sName, {
              innerName: p.level,
              total: p.total,
              stars: p.stars,
            });
            if (!profile) profile = p.profile;
          }
        }
      }
      if (profile) document.getElementById("profileName").value = profile;
      if (levels.size > 0) {
        activeType = "level";
        activeName = levels.keys().next().value;
      } else if (stunts.size > 0) {
        activeType = "stunt";
        activeName = stunts.keys().next().value;
      } else {
        activeType = null;
        activeName = null;
      }
      rebuildUI();
    } catch (err) {
      alert("Failed to parse ZIP: " + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function loadStockPreset() {
  levels.clear();
  stunts.clear();
  const stockLevels = [
    "garden1",
    "market1",
    "market2",
    "muse1",
    "muse2",
    "nhood1",
    "nhood2",
    "roof",
    "ship1",
    "ship2",
    "toy2",
    "toylite",
    "wild_west1",
    "wild_west2",
  ];
  for (const name of stockLevels) {
    levels.set(name, { innerName: name, flags: [false, false, false, false, false, false] });
  }
  stunts.set("stunts", { innerName: "stunts", total: 20, stars: new Array(64).fill(false) });
  activeType = "level";
  activeName = stockLevels[0];
  rebuildUI();
}

function addEntry(type) {
  const inp = document.getElementById("newName");
  const name = inp.value.trim();
  if (!name) return;
  if (type === "level") {
    if (!levels.has(name))
      levels.set(name, {
        innerName: name,
        flags: [false, false, false, false, false, false],
      });
  } else {
    if (!stunts.has(name))
      stunts.set(name, {
        innerName: name,
        total: 0,
        stars: new Array(64).fill(false),
      });
  }
  inp.value = "";
  activeType = type;
  activeName = name;
  rebuildUI();
}

function removeEntry(type, name) {
  if (type === "level") levels.delete(name);
  else stunts.delete(name);
  if (activeType === type && activeName === name) {
    const first = levels.keys().next().value || null;
    const firstStunt = stunts.keys().next().value || null;
    if (first) {
      activeType = "level";
      activeName = first;
    } else if (firstStunt) {
      activeType = "stunt";
      activeName = firstStunt;
    } else {
      activeType = null;
      activeName = null;
    }
  }
  rebuildUI();
}

function rebuildUI() {
  buildTabBar();
  refreshPanels();
  refreshVisibility();
  if (hexVisible) updateHex();
  update();
}

function hasEntries() {
  return levels.size > 0 || stunts.size > 0;
}

function refreshVisibility() {
  document.getElementById("emptyState").style.display = hasEntries() ? "none" : "";
  document.getElementById("globalActions").style.display = hasEntries() ? "" : "none";
  document.getElementById("delBtn").style.display = activeType && activeName ? "" : "none";
}

function removeActive() {
  if (activeType && activeName) removeEntry(activeType, activeName);
}

function buildTabBar() {
  const bar = document.getElementById("tabBar");
  bar.innerHTML = "";
  for (const name of levels.keys()) {
    const btn = document.createElement("button");
    btn.dataset.type = "level";
    btn.dataset.name = name;
    btn.textContent = name;
    btn.onclick = () => switchTab("level", name);
    bar.appendChild(btn);
  }
  for (const name of stunts.keys()) {
    const btn = document.createElement("button");
    btn.className = "stunt-tab";
    btn.dataset.type = "stunt";
    btn.dataset.name = name;
    btn.textContent = name;
    btn.onclick = () => switchTab("stunt", name);
    bar.appendChild(btn);
  }
  refreshTabClasses();
}

function refreshTabClasses() {
  document.querySelectorAll(".track-tabs button").forEach((btn) => {
    const t = btn.dataset.type,
      n = btn.dataset.name;
    btn.classList.toggle("active", t === activeType && n === activeName);
    if (t === "level") {
      const e = levels.get(n);
      const cnt = e ? e.flags.filter(Boolean).length : 0;
      btn.classList.toggle("complete", cnt === 6);
      btn.classList.toggle("partial", cnt > 0 && cnt < 6);
    }
  });
}

function switchTab(type, name) {
  activeType = type;
  activeName = name;
  refreshPanels();
  refreshTabClasses();
  update();
}

function onInnerNameChange(type) {
  const val = document.getElementById(type === "level" ? "levelInnerName" : "stuntInnerName").value;
  const entry = (type === "level" ? levels : stunts).get(activeName);
  if (entry) entry.innerName = val;
  updateInnerCount(type);
  update();
}

function updateInnerCount(type) {
  const val = document.getElementById(type === "level" ? "levelInnerName" : "stuntInnerName").value;
  const len = new TextEncoder().encode(val).length;
  const el = document.getElementById(type === "level" ? "levelInnerCount" : "stuntInnerCount");
  el.textContent = `${len} / 15`;
  el.classList.toggle("warn", len > 15);
}

function refreshPanels() {
  const lp = document.getElementById("levelPanel");
  const sp = document.getElementById("stuntPanel");
  lp.classList.remove("visible");
  sp.classList.remove("visible");
  if (activeType === "level" && levels.has(activeName)) {
    lp.classList.add("visible");
    document.getElementById("trackLabel").textContent = activeName + ".level";
    const le = levels.get(activeName);
    document.getElementById("levelInnerName").value = le.innerName;
    updateInnerCount("level");
    renderFlags();
  } else if (activeType === "stunt" && stunts.has(activeName)) {
    sp.classList.add("visible");
    document.getElementById("stuntLabel").textContent = activeName + ".stunt";
    const s = stunts.get(activeName);
    document.getElementById("stuntInnerName").value = s.innerName;
    updateInnerCount("stunt");
    document.getElementById("totalStars").value = s.total;
    updateStarGrid();
  }
}

function renderFlags() {
  const grid = document.getElementById("flagsGrid");
  grid.innerHTML = "";
  const entry = levels.get(activeName);
  if (!entry) return;
  const flags = entry.flags;
  FLAGS.forEach((f, i) => {
    const item = document.createElement("div");
    item.className = "flag-item" + (flags[i] ? " checked" : "");
    item.innerHTML = `
      <div class="flag-check"></div>
      <div>
        <div class="flag-label">${f.label} <span style="color:#ccc">(${f.sub})</span></div>
      </div>`;
    item.onclick = () => {
      flags[i] = !flags[i];
      item.classList.toggle("checked", flags[i]);
      refreshTabClasses();
      update();
    };
    grid.appendChild(item);
  });
}

function setCurrentFlags(val) {
  const entry = levels.get(activeName);
  if (!entry) return;
  entry.flags.fill(val);
  renderFlags();
  refreshTabClasses();
  update();
}

function setAllEverything(val) {
  for (const e of levels.values()) e.flags.fill(val);
  for (const s of stunts.values()) {
    for (let i = 0; i < 64; i++) s.stars[i] = val && i < s.total;
  }
  refreshPanels();
  refreshTabClasses();
  update();
}

function updateStarGrid() {
  const s = stunts.get(activeName);
  if (!s) return;
  s.total = Math.min(64, Math.max(0, parseInt(document.getElementById("totalStars").value) || 0));
  const grid = document.getElementById("starGrid");
  grid.innerHTML = "";
  for (let i = 0; i < s.total; i++) {
    const cell = document.createElement("div");
    cell.className = "star-cell" + (s.stars[i] ? " active" : "");
    cell.textContent = i;
    cell.onclick = () => {
      s.stars[i] = !s.stars[i];
      updateStarGrid();
      update();
    };
    grid.appendChild(cell);
  }
  update();
}

function setAllStars(val) {
  const s = stunts.get(activeName);
  if (!s) return;
  for (let i = 0; i < 64; i++) s.stars[i] = val && i < s.total;
  updateStarGrid();
}

let hexVisible = false;

function toggleHex() {
  hexVisible = !hexVisible;
  document.getElementById("hexCard").style.display = hexVisible ? "" : "none";
  if (hexVisible) updateHex();
}

function regionClass(off, fn) {
  if (off < 0x20) return "header-bytes";
  if (off < 0x30) return "profile-bytes";
  if (fn.endsWith(".level")) {
    if (off < 0x40) return "level-bytes";
    if (off < 0x44) return "secrets-bytes";
    return "crc-bytes";
  } else {
    if (off < 0x88) return "secrets-bytes";
    return "crc-bytes";
  }
}

function renderHex(data, fn) {
  const lines = [];
  for (let row = 0; row < data.length; row += 16) {
    const hex = [],
      asc = [];
    for (let col = 0; col < 16; col++) {
      const o = row + col;
      if (o < data.length) {
        const b = data[o],
          cls = regionClass(o, fn);
        hex.push(`<span class="${cls}">${b.toString(16).padStart(2, "0")}</span>`);
        const ch = b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".";
        asc.push(`<span class="${cls}">${ch.replace(/</g, "&lt;")}</span>`);
      } else {
        hex.push("  ");
        asc.push(" ");
      }
      if (col === 7) hex.push(" ");
    }
    lines.push(`<span class="offset">${row.toString(16).padStart(4, "0")}</span>  ${hex.join(" ")}  ${asc.join("")}`);
  }
  return lines.join("\n");
}

function updateHex() {
  if (!activeType || !activeName) {
    document.getElementById("hexViewer").innerHTML = "";
    return;
  }
  const fn = activeType === "level" ? activeName + ".level" : activeName + ".stunt";
  const data = activeType === "level" ? buildLevelFile(activeName) : buildStuntFile(activeName);
  document.getElementById("hexViewer").innerHTML = renderHex(data, fn);
}

function downloadZip() {
  const filesObj = {};
  for (const name of levels.keys()) filesObj[name + ".level"] = [buildLevelFile(name), { level: 0 }];
  for (const name of stunts.keys()) filesObj[name + ".stunt"] = [buildStuntFile(name), { level: 0 }];
  if (Object.keys(filesObj).length === 0) return;
  const zip = zipSync(filesObj, { level: 0 });

  const blob = new Blob([zip], { type: "application/zip" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (document.getElementById("profileName").value || "saves") + ".zip";
  a.click();
  URL.revokeObjectURL(a.href);
}

function resetAll() {
  levels.clear();
  stunts.clear();
  activeType = null;
  activeName = null;
  document.getElementById("profileName").value = "";
  document.getElementById("newName").value = "";
  document.getElementById("fileInput").value = "";
  hexVisible = false;
  document.getElementById("hexCard").style.display = "none";
  rebuildUI();
}

function update() {
  const pLen = new TextEncoder().encode(document.getElementById("profileName").value).length;
  const pc = document.getElementById("profileCount");
  pc.textContent = `${pLen} / 15`;
  pc.classList.toggle("warn", pLen > 15);
  if (hexVisible) updateHex();
}

refreshVisibility();

// Expose functions to global scope for inline onclick handlers
window.handleFile = handleFile;
window.downloadZip = downloadZip;
window.toggleHex = toggleHex;
window.loadStockPreset = loadStockPreset;
window.resetAll = resetAll;
window.addEntry = addEntry;
window.removeActive = removeActive;
window.setCurrentFlags = setCurrentFlags;
window.setAllEverything = setAllEverything;
window.setAllStars = setAllStars;
window.updateStarGrid = updateStarGrid;
window.onInnerNameChange = onInnerNameChange;
window.update = update;
