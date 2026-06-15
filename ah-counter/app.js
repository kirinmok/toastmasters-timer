// ===== Filler 顯示欄位 =====
const FILLER_COLUMNS = [
  {label: "嗯/啊", alts: ["嗯", "啊", "欸"]},
  {label: "那個",  alts: ["那個", "這個"]},
  {label: "就是",  alts: ["就是"]},
  {label: "然後",  alts: ["然後"]},
  {label: "對/所以", alts: ["所以", "對"]},
  {label: "uh/um", alts: ["uh", "um", "ah"]},
  {label: "like",  alts: ["like"]},
  {label: "so/well", alts: ["so", "well"]},
  {label: "you know", alts: ["you know"]},
  {label: "actually", alts: ["actually", "basically"]},
];

let timers = {};

// ===== Tabs =====
document.querySelectorAll(".tab").forEach(t => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    document.getElementById("tab-" + t.dataset.tab).classList.add("active");
  });
});

// ===== Load Agenda =====
async function loadAgenda() {
  try {
    const res = await fetch("/api/agenda");
    const data = await res.json();
    document.getElementById("meeting-info").textContent =
      `${data.club || "Toastmasters"} #${data.meeting || "-"} · ${data.date || ""}`;
    document.getElementById("opening-text").textContent = data.opening_speech || "(no opening script)";
    renderSpeakers(data.speakers);
  } catch (err) {
    // 線上版無 backend：回退到 localStorage（OCR 上傳後存的議程）
    const stored = localStorage.getItem('bni_agenda');
    if (stored) {
      try {
        const data = JSON.parse(stored);
        const dateStr = (data.saved_at || '').slice(0, 10);
        document.getElementById("meeting-info").textContent = `Local agenda · ${dateStr}`;
        renderSpeakers(data.speakers || []);
      } catch (e) {
        renderSpeakers([]);
      }
    } else {
      document.getElementById("meeting-info").textContent = "拍照載入講者 →";
      renderSpeakers([]);
    }
  }
}

function renderSpeakers(speakers) {
  const list = document.getElementById("speaker-list");
  list.innerHTML = "";
  if (!speakers || speakers.length === 0) {
    list.innerHTML = `
      <div class="hint" style="text-align:center; padding:24px; border:1px dashed #333; border-radius:8px;">
        📷 還沒有講者<br>
        請到 <b>Script tab → 拍照載入今晚講者</b>
      </div>`;
    return;
  }
  speakers.forEach(sp => list.appendChild(speakerRow(sp)));
}

function speakerRow(sp) {
  const div = document.createElement("div");
  div.className = "speaker";
  div.id = `sp-${sp.idx}`;
  if (sp.is_recording) div.classList.add("active");
  if (sp.ended) div.classList.add("done");

  div.innerHTML = `
    <div class="speaker-row">
      <div class="speaker-name">
        <span class="name">${sp.name}</span>
        <span class="role">${sp.role}</span>
      </div>
      <div class="timer-display" id="tm-${sp.idx}">00:00</div>
      <button class="btn-rec" id="btn-${sp.idx}" data-idx="${sp.idx}">
        ${recBtnLabel(sp)}
      </button>
    </div>
    <div class="filler-grid" id="fg-${sp.idx}"></div>
    <div class="transcript-mini" id="tr-${sp.idx}" style="display:none"></div>
  `;
  renderFiller(sp);
  const btn = div.querySelector(".btn-rec");
  if (sp.is_recording) btn.classList.add("recording");
  if (sp.ended) btn.classList.add("done");
  btn.addEventListener("click", () => toggleRecording(sp.idx));
  return div;
}

function recBtnLabel(sp) {
  if (sp.is_recording) return "⏹ 停止";
  if (sp.ended) return "✅ 已完成";
  return "● 開始錄音";
}

function renderFiller(sp) {
  const wrap = document.getElementById(`fg-${sp.idx}`);
  if (!wrap) return;
  const fillers = sp.fillers || {};
  wrap.innerHTML = FILLER_COLUMNS.map(col => {
    const n = col.alts.reduce((a, w) => a + (fillers[w] || 0), 0);
    let cls = "zero";
    if (n >= 5) cls = "hot";
    else if (n >= 3) cls = "warn";
    else if (n > 0) cls = "";
    return `<div class="filler-cell ${cls}">
      <div class="word">${col.label}</div>
      <div class="count">${n}</div>
    </div>`;
  }).join("");
  if (sp.transcript && sp.transcript !== "(no audio)") {
    const t = document.getElementById(`tr-${sp.idx}`);
    t.textContent = "📝 " + sp.transcript;
    t.style.display = "block";
  }
}

// ===== Recording control =====
async function toggleRecording(idx) {
  const btn = document.getElementById(`btn-${idx}`);
  const card = document.getElementById(`sp-${idx}`);
  const isRec = btn.textContent.includes("停止");

  if (!isRec) {
    setStatus(`啟動 ${idx} 錄音…`);
    const res = await fetch(`/api/speaker/${idx}/start`, {method: "POST"});
    const data = await res.json();
    if (data.error) {
      setStatus(`❌ ${data.error}`);
      alert(data.error);
      return;
    }
    btn.textContent = "⏹ 停止";
    btn.classList.add("recording");
    card.classList.add("active");
    card.classList.remove("done");
    timers[`start-${idx}`] = Date.now();
    timers[idx] = setInterval(() => updateTimer(idx), 500);
    setStatus(`🔴 錄音中: ${data.name}`);
  } else {
    setStatus(`⏳ 轉錄分析中…`);
    btn.disabled = true;
    btn.textContent = "⏳ 分析…";
    clearInterval(timers[idx]);
    const res = await fetch(`/api/speaker/${idx}/stop`, {method: "POST"});
    const data = await res.json();
    btn.disabled = false;
    btn.textContent = "✅ 已完成";
    btn.classList.remove("recording");
    btn.classList.add("done");
    card.classList.remove("active");
    card.classList.add("done");
    renderFiller(data);
    setStatus(`✅ ${data.name}: ${data.total_fillers} fillers`);
    await maybeAutoReport();
  }
}

function updateTimer(idx) {
  const start = timers[`start-${idx}`];
  if (!start) return;
  const sec = Math.floor((Date.now() - start) / 1000);
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  const el = document.getElementById(`tm-${idx}`);
  if (el) el.textContent = `${m}:${s}`;
}

async function maybeAutoReport() {
  const res = await fetch("/api/agenda");
  const data = await res.json();
  if (data.speakers.every(s => s.ended)) {
    setStatus("🎉 全部完成,自動生成報告…");
    await generateReport();
    // 切到 Report tab
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(x => x.classList.remove("active"));
    document.querySelector('[data-tab="report"]').classList.add("active");
    document.getElementById("tab-report").classList.add("active");
  }
}

async function generateReport() {
  const res = await fetch("/api/report");
  const data = await res.json();
  document.getElementById("report-text").textContent = data.script || "(no data)";
  setStatus("📣 報告已生成");
}

function setStatus(msg) {
  document.getElementById("status-bar").textContent = msg;
}

// ===== Copy buttons =====
document.getElementById("copy-report").addEventListener("click", () => {
  const t = document.getElementById("report-text").textContent;
  navigator.clipboard.writeText(t).then(() => setStatus("📋 報告已複製"));
});
document.getElementById("generate-report").addEventListener("click", generateReport);

// ===== OCR 上傳 (Tesseract.js 純前端 + localStorage 共用) =====
document.getElementById("btn-pick-photo").addEventListener("click", () => {
  document.getElementById("agenda-photo").click();
});

document.getElementById("agenda-photo").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (typeof Tesseract === 'undefined') {
    setStatus("❌ Tesseract.js 未載入，請檢查網路");
    return;
  }
  setStatus("📷 OCR 辨識中（首次載入模型約 5MB，請等一下）…");
  try {
    const { data } = await Tesseract.recognize(file, 'chi_tra+eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          setStatus(`📷 OCR ${Math.round(m.progress * 100)}%`);
        }
      }
    });
    const rawText = data.text || '';
    const speakers = parseSpeakers(rawText);
    showOcrResult({ raw_text: rawText, speakers });
    setStatus(`📷 辨識到 ${speakers.length} 行候選 — 勾選哪些是要計入的講者`);
  } catch (err) {
    setStatus("❌ OCR 失敗: " + err.message);
    alert("OCR 失敗: " + err.message);
  }
});

// Toastmasters 議程解析（同 Timer 一套）：從每行抽名字 + 推斷角色 + 預設計時 flag
function parseSpeakers(rawText) {
  const TM_ROLE_MAP = [
    { kw: /toastmaster\s*of|tm\s*of\s*evening|tm\s*of\s*the/i, role: 'TM of Evening',      timed: true  },
    { kw: /general\s*evaluator|gen\.?\s*evaluator|g\.?\s*e\.?/i, role: 'General Evaluator', timed: true  },
    { kw: /grammarian/i,                                        role: 'Grammarian',         timed: true  },
    { kw: /ah[\s\-]*counter/i,                                  role: 'Ah Counter',         timed: true  },
    { kw: /(^|\s)timer(\s|:|$)/i,                               role: 'Timer',              timed: true  },
    { kw: /table\s*topic.{0,5}master|topicsmaster/i,            role: 'Table Topic Master', timed: false },
    { kw: /manual\s*speech|prepared\s*speech|speaker\s*\d|speech\s*project/i, role: 'Manual Speech', timed: true },
    { kw: /table\s*topic(?!.{0,5}master)/i,                     role: 'Table Topic',        timed: true  },
    { kw: /evaluat/i,                                           role: 'Evaluator',          timed: true  },
    { kw: /president|chair\s*adjourn/i,                         role: 'President',          timed: false },
    { kw: /(^|\s)vp(\s|\.|:|$)|vice\s*president/i,              role: 'VP',                 timed: false },
    { kw: /invocation/i,                                        role: 'Invocation',         timed: false },
    { kw: /sergeant|saa|door/i,                                 role: 'SAA',                timed: false },
  ];
  const TM_NOISE = [
    'club', 'meeting', 'theme', 'regular', 'venue', 'address', 'agenda',
    'schedule', 'minutes', 'session', 'opening', 'closing',
    'group photo', 'intermission', 'social time', 'zoom',
    'bni', 'tainan', 'taiwan', 'district', 'division', 'since',
    'http', 'www', '.com', '榮耀', '分會', '保持',
  ];

  function extractNames(text) {
    const patterns = [
      /[A-Z][a-z]{1,15}\s+[A-Z][a-z]{1,15}/g,
      /[A-Z][a-z]{1,15}\s+[A-Z]\.\s*[A-Z][a-z]{1,15}/g,
      /[一-龥]{2,4}/g,
    ];
    let found = [];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) found.push(...m);
    }
    return found.filter(n => {
      const lower = n.toLowerCase();
      if (TM_NOISE.some(k => lower.includes(k))) return false;
      if (TM_ROLE_MAP.some(r => r.kw.test(n))) return false;
      return true;
    });
  }

  function detectRole(text) {
    for (const r of TM_ROLE_MAP) {
      if (r.kw.test(text)) return r;
    }
    return null;
  }

  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  const seen = {};
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 2 || line.length > 80) continue;
    const lineRole = detectRole(line);
    const names = extractNames(line);
    for (const name of names) {
      if (seen[name]) continue;
      seen[name] = true;
      const ctx = (i > 0 ? lines[i-1] : '') + ' ' + line + ' ' + (i < lines.length-1 ? lines[i+1] : '');
      const role = lineRole || detectRole(ctx);
      out.push({
        speaker: name,
        role: role ? role.role : 'Speaker',
        counted: role ? role.timed : true,
        start: '',
      });
    }
  }
  return out;
}

function showOcrResult(data) {
  const wrap = document.getElementById("ocr-result");
  wrap.style.display = "block";
  document.getElementById("ocr-count").textContent = data.speakers.length;
  document.getElementById("ocr-raw").textContent = data.raw_text;

  const list = document.getElementById("ocr-speaker-list");
  const esc = s => String(s || '').replace(/"/g, '&quot;');
  list.innerHTML = data.speakers.map((sp, i) => `
    <div class="ocr-row">
      <input type="checkbox" id="ocr-${i}" ${sp.counted ? "checked" : ""}>
      <input type="text" id="ocr-name-${i}" value="${esc(sp.speaker)}" placeholder="姓名">
      <input type="text" id="ocr-role-${i}" value="${esc(sp.role)}" placeholder="角色">
      <span class="ocr-time">${esc(sp.start)}</span>
    </div>
  `).join("");
}

document.getElementById("btn-show-raw").addEventListener("click", () => {
  const el = document.getElementById("ocr-raw");
  el.style.display = el.style.display === "none" ? "block" : "none";
});

document.getElementById("btn-commit").addEventListener("click", () => {
  const rows = document.querySelectorAll("#ocr-speaker-list .ocr-row");
  const speakers = Array.from(rows).map((row, i) => ({
    speaker: document.getElementById(`ocr-name-${i}`).value.trim(),
    role: document.getElementById(`ocr-role-${i}`).value.trim() || "Speaker",
    counted: document.getElementById(`ocr-${i}`).checked,
    language: "mixed",
  })).filter(s => s.speaker && s.counted);
  if (speakers.length === 0) {
    alert("沒勾選任何要計入的講者");
    return;
  }
  // 共用議程：Timer + Ah Counter 讀同一個 localStorage key
  const agenda = { speakers, saved_at: new Date().toISOString() };
  localStorage.setItem('bni_agenda', JSON.stringify(agenda));
  setStatus(`✅ ${speakers.length} 位講者已存（Timer 切過去自動填）`);
  renderSpeakers(speakers);
  // 切到 Counter tab
  document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(x => x.classList.remove("active"));
  document.querySelector('[data-tab="counter"]').classList.add("active");
  document.getElementById("tab-counter").classList.add("active");
});

// ===== Name input sync (像 Timer 一樣，input 變動 → header + Opening Script 名字同步) =====
function updateAhCounterName() {
  const name = document.getElementById('ahCounterName').value.trim();
  const scriptEl = document.getElementById('ahCounterScriptName');
  const headerEl = document.getElementById('headerAhCounterName');
  if (scriptEl) scriptEl.textContent = name || '______';
  if (headerEl) headerEl.textContent = name ? 'Ah Counter: ' + name : 'Ah Counter:';
}

// ===== Init =====
loadAgenda();
setStatus("Ready");
