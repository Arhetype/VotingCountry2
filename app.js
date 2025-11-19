const COUNTRIES = [
  { code: "RUS", name: "Россия" },
  { code: "BLR", name: "Беларусь" },
  { code: "KAZ", name: "Казахстан" },
  { code: "UZB", name: "Узбекистан" },
  { code: "KGZ", name: "Кыргызстан" },
  { code: "UKR", name: "Украина" },
  { code: "GBR", name: "Великобритания" },
  { code: "SWE", name: "Швеция" },
  { code: "AUT", name: "Австрия" },
  { code: "DEU", name: "Германия" },
  { code: "ITA", name: "Италия" },
  { code: "FRA", name: "Франция" },
  { code: "CHN", name: "Китай" },
  { code: "HKG", name: "Гонконг" },
  { code: "SGP", name: "Сингапур" },
  { code: "MYS", name: "Малайзия" },
  { code: "KOR", name: "Корея" },
  { code: "JPN", name: "Япония" },
  { code: "EGY", name: "Египет" },
  { code: "ARE", name: "ОАЭ" }
];

const STORAGE_KEY = "country_votes_v3";
const ADMIN_KEY = "admin_active";
const USER_VOTED_COUNTRIES_KEY = "user_voted_countries"; // Массив кодов стран, за которые пользователь уже проголосовал
const LAST_RESET_TIMESTAMP_KEY = "last_reset_timestamp"; // Timestamp последнего сброса
let firebaseApi = null;
let tableSortOrder = { column: null, ascending: true }; // Состояние сортировки таблицы
let currentIsAdmin = false; // Текущий статус админа для доступа из функций Firebase

// ISO A3 -> ISO A2 fallback map
const ISO_A3_TO_A2 = {
  RUS: "RU", BLR: "BY", KAZ: "KZ", UZB: "UZ", KGZ: "KG", UKR: "UA",
  GBR: "GB", SWE: "SE", AUT: "AT", DEU: "DE", ITA: "IT", FRA: "FR",
  CHN: "CN", HKG: "HK", SGP: "SG", MYS: "MY", KOR: "KR", JPN: "JP",
  EGY: "EG", ARE: "AE"
};

function readVotes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function writeVotes(votes) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(votes));
}

function isAdminActive() {
  return localStorage.getItem(ADMIN_KEY) === "true";
}

function setAdminActive(active) {
  if (active) {
    localStorage.setItem(ADMIN_KEY, "true");
  } else {
    localStorage.removeItem(ADMIN_KEY);
  }
}

function getUserVotedCountries() {
  try {
    const raw = localStorage.getItem(USER_VOTED_COUNTRIES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function hasUserVotedForCountry(countryCode) {
  const voted = getUserVotedCountries();
  return voted.includes(countryCode);
}

function addUserVotedCountry(countryCode) {
  const voted = getUserVotedCountries();
  if (!voted.includes(countryCode)) {
    voted.push(countryCode);
    localStorage.setItem(USER_VOTED_COUNTRIES_KEY, JSON.stringify(voted));
  }
}

function updateUIAfterReset() {
  // Сначала очищаем данные о голосовании пользователя
  localStorage.removeItem(USER_VOTED_COUNTRIES_KEY);
  
  // Обновляем таблицу
  const votes = readVotes();
  renderTable(votes, currentIsAdmin);
  
  // Обновляем кнопки голосования
  const voteBtn = document.getElementById("voteBtn");
  const select = document.getElementById("countrySelect");
  if (voteBtn && select) {
    if (currentIsAdmin) {
      // Для админа всегда доступно
      voteBtn.disabled = false;
      voteBtn.textContent = "Голосовать";
    } else {
      // Для обычных пользователей проверяем после очистки
      const code = select.value;
      const voted = getUserVotedCountries(); // Должен вернуть пустой массив после очистки
      if (voted.includes(code)) {
        voteBtn.disabled = true;
        voteBtn.textContent = "Вы уже проголосовали за эту страну";
      } else {
        voteBtn.disabled = false;
        voteBtn.textContent = "Голосовать";
      }
    }
  }
  
  // Обновляем все кнопки +1 в таблице
  const tableBtns = document.querySelectorAll('#countriesTableBody button.small');
  const voted = getUserVotedCountries(); // Должен вернуть пустой массив после очистки
  tableBtns.forEach(btn => {
    const tr = btn.closest('tr');
    if (tr) {
      const countryName = tr.querySelector('td:first-child')?.textContent;
      if (countryName) {
        const country = COUNTRIES.find(c => c.name === countryName);
        if (country) {
          if (voted.includes(country.code) && !currentIsAdmin) {
            btn.disabled = true;
            btn.textContent = "✓";
          } else {
            btn.disabled = false;
            btn.textContent = "+1";
          }
        }
      }
    }
  });
}

function computeStats(votes) {
  const counts = COUNTRIES.map(c => votes[c.code] || 0);
  const total = counts.reduce((a, b) => a + b, 0);
  const positives = counts.filter(v => v > 0);
  const allZero = positives.length === 0;
  const max = allZero ? null : Math.max(...counts);
  const minPositive = allZero ? null : Math.min(...positives);
  return { total, max, minPositive };
}

function percent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function renderSelect() {
  const select = document.getElementById("countrySelect");
  select.innerHTML = "";
  COUNTRIES.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.code;
    opt.textContent = c.name;
    select.appendChild(opt);
  });
}

function setupTableSorting() {
  const thead = document.querySelector('table thead');
  if (!thead) return;
  
  // Проверяем, не настроена ли уже сортировка
  if (thead.dataset.sortingSetup === 'true') {
    updateSortIndicators();
    return;
  }
  
  const headers = thead.querySelectorAll('th');
  headers.forEach((th, index) => {
    let text = th.textContent.trim().replace(/[↑↓]/g, '').trim();
    if (text === '%' || text === 'Голоса' || text === 'Страна') {
      th.style.cursor = 'pointer';
      th.style.userSelect = 'none';
      th.title = 'Нажмите для сортировки';
      
      // Добавляем индикатор сортировки
      const indicator = document.createElement('span');
      indicator.className = 'sort-indicator';
      indicator.style.marginLeft = '5px';
      indicator.style.opacity = '0.5';
      th.appendChild(indicator);
      
      th.addEventListener('click', () => {
        let column = null;
        if (text === '%') column = 'percent';
        else if (text === 'Голоса') column = 'votes';
        else if (text === 'Страна') column = 'name';
        
        if (column) {
          // Переключаем порядок сортировки, если кликнули по той же колонке
          if (tableSortOrder.column === column) {
            tableSortOrder.ascending = !tableSortOrder.ascending;
          } else {
            tableSortOrder.column = column;
            tableSortOrder.ascending = true;
          }
          
          updateSortIndicators();
          
          // Перерисовываем таблицу
          const votes = readVotes();
          const isAdmin = isAdminActive();
          renderTable(votes, isAdmin);
        }
      });
    }
  });
  
  thead.dataset.sortingSetup = 'true';
  updateSortIndicators();
}

function updateSortIndicators() {
  const headers = document.querySelectorAll('table thead th');
  headers.forEach((th, index) => {
    const indicator = th.querySelector('.sort-indicator');
    if (indicator) {
      const text = th.textContent.trim().replace(/[↑↓]/g, '').trim();
      let column = null;
      if (text === '%') column = 'percent';
      else if (text === 'Голоса') column = 'votes';
      else if (text === 'Страна') column = 'name';
      
      if (column && tableSortOrder.column === column) {
        indicator.textContent = tableSortOrder.ascending ? '↑' : '↓';
        indicator.style.opacity = '1';
      } else {
        indicator.textContent = '';
        indicator.style.opacity = '0.5';
      }
    }
  });
}

function renderTable(votes, isAdmin = false) {
  const tbody = document.getElementById("countriesTableBody");
  tbody.innerHTML = "";
  const { total, max, minPositive } = computeStats(votes);
  document.getElementById("totalVotes").textContent = `Всего голосов: ${total}`;

  // Подготавливаем данные для сортировки
  const countriesData = COUNTRIES.map(c => {
    const v = votes[c.code] || 0;
    const pct = percent(v, total);
    return { ...c, votes: v, percent: pct };
  });

  // Сортировка
  if (tableSortOrder.column === 'percent') {
    countriesData.sort((a, b) => {
      const diff = a.percent - b.percent;
      return tableSortOrder.ascending ? diff : -diff;
    });
  } else if (tableSortOrder.column === 'votes') {
    countriesData.sort((a, b) => {
      const diff = a.votes - b.votes;
      return tableSortOrder.ascending ? diff : -diff;
    });
  } else if (tableSortOrder.column === 'name') {
    countriesData.sort((a, b) => {
      const diff = a.name.localeCompare(b.name);
      return tableSortOrder.ascending ? diff : -diff;
    });
  }

  countriesData.forEach(c => {
    const tr = document.createElement("tr");
    const v = c.votes;
    const pct = c.percent;

    const tdName = document.createElement("td");
    tdName.textContent = c.name;

    const tdVotes = document.createElement("td");
    tdVotes.className = "num";
    tdVotes.textContent = v.toString();

    const tdPct = document.createElement("td");
    tdPct.className = "num";
    tdPct.textContent = `${pct}%`;

    const tdBtn = document.createElement("td");
    const btn = document.createElement("button");
    btn.className = "small";
    btn.textContent = "+1";
    
    // Блокируем кнопку если пользователь уже голосовал за эту страну
    if (hasUserVotedForCountry(c.code) && !isAdmin) {
      btn.disabled = true;
      btn.textContent = "✓";
    }
    
    btn.addEventListener("click", async () => {
      if (hasUserVotedForCountry(c.code) && !isAdmin) return;
      
      const newValue = (votes[c.code] || 0) + 1;
      votes[c.code] = newValue;
      
      // Синхронизация с Firebase
      if (firebaseApi) {
        try {
          if (firebaseApi.runTransaction && firebaseApi.ref) {
            await firebaseApi.runTransaction(firebaseApi.ref(firebaseApi.db, `votes/${c.code}`), current => (Number(current) || 0) + 1);
          }
        } catch (_) {
          // Fallback на localStorage
          writeVotes(votes);
        }
      } else {
        writeVotes(votes);
      }
      
      // Помечаем что пользователь проголосовал за эту страну (только для обычных пользователей)
      if (!isAdmin) {
        addUserVotedCountry(c.code);
      }
      
      renderTable(votes, isAdmin);
      colorMap(votes);
    });
    
    tdBtn.appendChild(btn);
    tr.appendChild(tdName);
    tr.appendChild(tdVotes);
    tr.appendChild(tdPct);
    tr.appendChild(tdBtn);
    tbody.appendChild(tr);
  });
  
  // Обновляем индикаторы сортировки после рендеринга
  updateSortIndicators();
}

function colorMap(votes) {
  const svgRoot = document.getElementById("worldMapSvg");
  if (!svgRoot) return;
  const { max, minPositive } = computeStats(votes);
  
  COUNTRIES.forEach(c => {
    let el = svgRoot.querySelector(`#${CSS.escape(c.code)}`);
    if (!el) {
      const a2 = ISO_A3_TO_A2[c.code];
      if (a2) {
        el = svgRoot.querySelector(`#${CSS.escape(a2)}`) || svgRoot.querySelector(`#${CSS.escape(a2.toLowerCase())}`);
      }
    }
    if (!el) return;
    
    const v = votes[c.code] || 0;
    let fill = "#374151";
    if (v > 0) {
      if (max !== null && v === max) {
        fill = "#22c55e";
      } else if (minPositive !== null && v === minPositive) {
        fill = "#f43f5e";
      } else {
        fill = "#f59e0b";
      }
    }
    el.style.fill = fill;
  });
}

function checkAuth() {
  const urlParams = new URLSearchParams(window.location.search);
  const role = urlParams.get('role');
  
  if (!role) {
      // Если нет параметра role, перенаправляем на страницу авторизации
      window.location.href = 'auth.html';
      return;
  }
  
  const isAdmin = role === 'admin';
  
  // Добавляем класс authenticated, чтобы показать контент
  document.body.classList.add('authenticated');
  
  if (isAdmin) {
      document.body.classList.add('admin');
  }
  
  return isAdmin;
}

async function checkResetTimestamp() {
  // Проверяем resetTimestamp из Firebase при инициализации
  if (!window.FIREBASE_CONFIG) return;
  
  try {
    const cfg = window.FIREBASE_CONFIG || {};
    const base = cfg.databaseURL ? cfg.databaseURL.replace(/\/$/, '') : '';
    if (!base) return;
    
    const lastReset = localStorage.getItem(LAST_RESET_TIMESTAMP_KEY);
    const res = await fetch(`${base}/resetTimestamp.json`);
    if (res.ok) {
      const resetTs = await res.json();
      if (resetTs !== null && resetTs !== undefined && String(resetTs) !== String(lastReset)) {
        // Обнаружен новый сброс - очищаем данные пользователя
        localStorage.removeItem(USER_VOTED_COUNTRIES_KEY);
        localStorage.setItem(LAST_RESET_TIMESTAMP_KEY, String(resetTs));
        updateUIAfterReset();
      }
    }
  } catch (_) {
    // Игнорируем ошибки при проверке
  }
}

async function init() {
  try {
    const isAdmin = checkAuth();
    if (isAdmin === undefined) return; // Перенаправление произошло
    
    currentIsAdmin = isAdmin; // Сохраняем статус админа для доступа из функций Firebase
    
    // Проверяем resetTimestamp перед отображением контента
    await checkResetTimestamp();
    
    let votes = readVotes();
    
    // Убеждаемся, что DOM элементы существуют
    if (!document.getElementById("countrySelect")) {
      console.error("DOM elements not ready");
      return;
    }
    
    // Сначала отображаем весь контент
    renderSelect();
    setupTableSorting(); // Настраиваем сортировку таблицы
    renderTable(votes, isAdmin);
    setupControls(votes, isAdmin);
    
    // Нормализуем размер SVG и отображаем карту сразу (не ждем Firebase)
    setTimeout(() => {
      normalizeSvgSizing();
      colorMap(votes);
    }, 50);
    
    // Пытаемся загрузить внешний SVG, если нужно (не блокируем основной контент)
    loadExternalWorldSvg().then(() => {
      setTimeout(() => {
        normalizeSvgSizing();
        colorMap(votes);
      }, 50);
    }).catch(() => {
      // Если не удалось загрузить, используем встроенную карту
      setTimeout(() => {
        normalizeSvgSizing();
        colorMap(votes);
      }, 50);
    });
    
    // Инициализация Firebase асинхронно, без блокировки отображения
    if (window.FIREBASE_CONFIG) {
      initFirebase(votes, isAdmin).catch(err => {
        console.warn('Firebase init failed, using local storage:', err);
      });
    }
  } catch (error) {
    console.error("Init error:", error);
    // Даже при ошибке пытаемся показать контент
    try {
      const isAdmin = checkAuth();
      if (isAdmin !== undefined) {
        const votes = readVotes();
        renderSelect();
        renderTable(votes, isAdmin);
        setupControls(votes, isAdmin);
        setTimeout(() => {
          normalizeSvgSizing();
          colorMap(votes);
        }, 100);
      }
    } catch (e) {
      console.error("Fallback init also failed:", e);
    }
  }
}

document.addEventListener("DOMContentLoaded", init);

function initApp(isAdmin) {
  const votes = readVotes();
  renderSelect();
  renderTable(votes, isAdmin);
  setupControls(votes, isAdmin);
  
  loadExternalWorldSvg().finally(() => {
    normalizeSvgSizing();
    colorMap(votes);
  });
}

function setupControls(votes, isAdmin) {
  const voteBtn = document.getElementById("voteBtn");
  const select = document.getElementById("countrySelect");
  const resetBtn = document.getElementById("resetBtn");

  // Скрываем кнопку сброса для пользователей
  if (!isAdmin && resetBtn) {
    resetBtn.style.display = "none";
  }

  // Обновляем состояние кнопки при изменении выбора
  function updateVoteButton() {
    const code = select.value;
    if (hasUserVotedForCountry(code) && !isAdmin) {
      voteBtn.disabled = true;
      voteBtn.textContent = "Вы уже проголосовали за эту страну";
    } else {
      voteBtn.disabled = false;
      voteBtn.textContent = "Голосовать";
    }
  }
  
  select.addEventListener("change", updateVoteButton);
  updateVoteButton();

  voteBtn.addEventListener("click", async () => {
    const code = select.value;
    if (hasUserVotedForCountry(code) && !isAdmin) return;
    
    const newValue = (votes[code] || 0) + 1;
    votes[code] = newValue;
    
    // Синхронизация с Firebase
    if (firebaseApi) {
      try {
        if (firebaseApi.runTransaction && firebaseApi.ref) {
          await firebaseApi.runTransaction(firebaseApi.ref(firebaseApi.db, `votes/${code}`), current => (Number(current) || 0) + 1);
        }
      } catch (_) {
        // Fallback на localStorage
        writeVotes(votes);
      }
    } else {
      writeVotes(votes);
    }
    
    if (!isAdmin) {
      addUserVotedCountry(code);
      updateVoteButton();
    }
    
    renderTable(votes, isAdmin);
    colorMap(votes);
  });

  if (resetBtn && isAdmin) {
    resetBtn.addEventListener("click", async () => {
      if (!confirm("Сбросить все голоса? Это действие нельзя отменить.")) return;
      
      const resetData = {};
      COUNTRIES.forEach(c => { resetData[c.code] = 0; });
      
      // Синхронизация с Firebase
      if (firebaseApi && firebaseApi.update && firebaseApi.ref) {
        try {
          const payload = {};
          COUNTRIES.forEach(c => { payload[`votes/${c.code}`] = 0; });
          await firebaseApi.update(firebaseApi.ref(firebaseApi.db), payload);
          
          // Отдельно записываем resetTimestamp в корень
          const resetTs = Date.now();
          if (firebaseApi.set) {
            await firebaseApi.set(firebaseApi.ref(firebaseApi.db, 'resetTimestamp'), resetTs);
          } else {
            // REST режим fallback
            const cfg = window.FIREBASE_CONFIG || {};
            const base = cfg.databaseURL ? cfg.databaseURL.replace(/\/$/, '') : '';
            if (base) {
              await fetch(`${base}/resetTimestamp.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(resetTs)
              });
            }
          }
          localStorage.setItem(LAST_RESET_TIMESTAMP_KEY, resetTs);
          // Обновляем локальные votes после успешного обновления Firebase
          Object.assign(votes, resetData);
          writeVotes(votes);
        } catch (_) {
          // Fallback
          Object.assign(votes, resetData);
          writeVotes(votes);
          const resetTs = Date.now();
          localStorage.setItem(LAST_RESET_TIMESTAMP_KEY, resetTs);
        }
      } else {
        Object.assign(votes, resetData);
        writeVotes(votes);
        const resetTs = Date.now();
        localStorage.setItem(LAST_RESET_TIMESTAMP_KEY, resetTs);
      }
      
      // updateUIAfterReset() обновит таблицу и все кнопки, включая очистку USER_VOTED_COUNTRIES_KEY
      updateUIAfterReset();
      colorMap(votes);
      alert("Голоса сброшены! Все пользователи могут голосовать заново.");
    });
  }

  if (isAdmin) {
    const logoutBtn = document.createElement("button");
    logoutBtn.className = "ghost";
    logoutBtn.textContent = "Выйти";
    logoutBtn.title = "Выйти из режима администратора";
    logoutBtn.style.marginLeft = "auto"; // Прижимаем к правому краю
    logoutBtn.style.flexShrink = "0"; // Не даем сжиматься
    
    logoutBtn.addEventListener("click", function() {
      if (confirm("Выйти из режима администратора?")) {
        setAdminActive(false);
        window.location.href = "auth.html";
      }
    });
    
    // Добавляем кнопку в controls
    const controls = document.querySelector(".controls");
    if (controls) {
      controls.appendChild(logoutBtn);
    }
  }
}

// Остальные функции остаются без изменений
async function loadExternalWorldSvg() {
  try {
    const res = await fetch('./assets/world_full.svg', { cache: 'no-store' });
    if (!res.ok) {
      // Если файл не найден, используем встроенную карту
      return;
    }
    const text = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'image/svg+xml');
    const externalSvg = doc.querySelector('svg');
    if (!externalSvg) return;
    
    const container = document.querySelector('.map-wrap');
    const current = document.getElementById('worldMapSvg');
    if (container && current) {
      externalSvg.id = 'worldMapSvg';
      externalSvg.querySelectorAll('*').forEach(n => {
        if (n.tagName.toLowerCase() === 'path' || n.tagName.toLowerCase() === 'polygon') {
          if (!n.getAttribute('fill')) n.setAttribute('fill', '#374151');
        }
      });
      container.replaceChild(externalSvg, current);
    }
  } catch (e) {
    // Если ошибка, используем встроенную карту
    console.warn('Could not load external SVG, using embedded map:', e);
  }
}

async function initFirebase(initialVotes, isAdmin) {
  try {
    if (!window.FIREBASE_CONFIG) return;
    
    // Если только databaseURL, используем REST API
    const cfg = window.FIREBASE_CONFIG || {};
    const onlyDbUrl = cfg && Object.keys(cfg).length === 1 && typeof cfg.databaseURL === 'string';
    
    if (onlyDbUrl) {
      // REST режим
      const base = cfg.databaseURL.replace(/\/$/, '');
      firebaseApi = {
        db: {},
        ref: (db, path) => ({ path }),
        runTransaction: async (ref, updater) => {
          const code = ref.path.split('/').pop();
          const current = await fetch(`${base}/votes/${code}.json`).then(r => r.json()).catch(() => 0) || 0;
          const next = updater(current);
          await fetch(`${base}/votes/${code}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(next)
          });
        },
        update: async (ref, payload) => {
          await fetch(`${base}/votes.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.fromEntries(
              Object.keys(payload).map(k => {
                const m = k.match(/^votes\/(.+)$/);
                return m ? [m[1], payload[k]] : null;
              }).filter(Boolean)
            ))
          });
        },
        set: async (ref, value) => {
          const path = ref.path;
          await fetch(`${base}${path}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(value)
          });
        }
      };
      
      // Проверяем resetTimestamp при первой загрузке
      const lastReset = localStorage.getItem(LAST_RESET_TIMESTAMP_KEY);
      try {
        const res = await fetch(`${base}/resetTimestamp.json`);
        if (res.ok) {
          const resetTs = await res.json();
          if (resetTs !== null && resetTs !== undefined && String(resetTs) !== String(lastReset)) {
            localStorage.removeItem(USER_VOTED_COUNTRIES_KEY);
            localStorage.setItem(LAST_RESET_TIMESTAMP_KEY, String(resetTs));
            updateUIAfterReset();
          }
        }
      } catch (_) {}
      
      // Подписка через polling
      setInterval(async () => {
        try {
          const res = await fetch(`${base}/votes.json`);
          const data = await res.json() || {};
          const newVotes = {};
          COUNTRIES.forEach(c => { newVotes[c.code] = Number(data[c.code] || 0); });
          
          // Проверяем resetTimestamp
          const resetRes = await fetch(`${base}/resetTimestamp.json`);
          if (resetRes.ok) {
            const resetTs = await resetRes.json();
            const lastReset = localStorage.getItem(LAST_RESET_TIMESTAMP_KEY);
            if (resetTs !== null && resetTs !== undefined && String(resetTs) !== String(lastReset)) {
              localStorage.removeItem(USER_VOTED_COUNTRIES_KEY);
              localStorage.setItem(LAST_RESET_TIMESTAMP_KEY, String(resetTs));
              updateUIAfterReset();
            }
          }
          
          renderTable(newVotes, isAdmin);
          colorMap(newVotes);
          writeVotes(newVotes);
        } catch (_) {}
      }, 2000);
      
      // Первоначальная загрузка (только если в Firebase есть данные)
      try {
        const res = await fetch(`${base}/votes.json`);
        const data = await res.json();
        if (data && Object.keys(data).length > 0) {
          const newVotes = {};
          COUNTRIES.forEach(c => { newVotes[c.code] = Number(data[c.code] || 0); });
          renderTable(newVotes, isAdmin);
          colorMap(newVotes);
          writeVotes(newVotes);
        }
      } catch (_) {}
      
      return;
    }
    
    // Полный SDK режим
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.1/firebase-app.js');
    const { getDatabase, ref, onValue, runTransaction, update, set } = await import('https://www.gstatic.com/firebasejs/10.12.1/firebase-database.js');
    const app = initializeApp(window.FIREBASE_CONFIG);
    const db = getDatabase(app);
    firebaseApi = { db, ref, onValue, runTransaction, update, set };
    
    // Подписка на resetTimestamp для сброса флагов голосования
    const resetRef = ref(db, 'resetTimestamp');
    onValue(resetRef, (snap) => {
      const resetTs = snap.val();
      if (resetTs !== null && resetTs !== undefined) {
        const lastReset = localStorage.getItem(LAST_RESET_TIMESTAMP_KEY);
        if (String(resetTs) !== String(lastReset)) {
          localStorage.removeItem(USER_VOTED_COUNTRIES_KEY);
          localStorage.setItem(LAST_RESET_TIMESTAMP_KEY, String(resetTs));
          updateUIAfterReset();
        }
      }
    });
    
    // Подписка на изменения в реальном времени
    const root = ref(db, 'votes');
    onValue(root, (snap) => {
      const data = snap.val() || {};
      const newVotes = {};
      COUNTRIES.forEach(c => { newVotes[c.code] = Number(data[c.code] || 0); });
      renderTable(newVotes, isAdmin);
      colorMap(newVotes);
      writeVotes(newVotes);
    });
    
    // Первоначальная загрузка
    const snap = await new Promise((resolve) => {
      onValue(root, resolve, { onlyOnce: true });
    });
    const data = snap.val() || {};
    const newVotes = {};
    COUNTRIES.forEach(c => { newVotes[c.code] = Number(data[c.code] || 0); });
    renderTable(newVotes, isAdmin);
    colorMap(newVotes);
    writeVotes(newVotes);
    
    // Проверяем resetTimestamp при первой загрузке
    const resetSnap = await new Promise((resolve) => {
      onValue(resetRef, resolve, { onlyOnce: true });
    });
    const resetTs = resetSnap.val();
    if (resetTs !== null && resetTs !== undefined) {
      const lastReset = localStorage.getItem(LAST_RESET_TIMESTAMP_KEY);
      if (String(resetTs) !== String(lastReset)) {
        localStorage.removeItem(USER_VOTED_COUNTRIES_KEY);
        localStorage.setItem(LAST_RESET_TIMESTAMP_KEY, String(resetTs));
        updateUIAfterReset();
      }
    }
    
  } catch (err) {
    console.error('Firebase init error:', err);
  }
}

function normalizeSvgSizing() {
  const svg = document.getElementById('worldMapSvg');
  if (!svg) {
    console.warn('SVG map not found');
    return;
  }
  try {
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    // Если viewBox уже есть, используем его, иначе пытаемся получить из getBBox
    if (!svg.getAttribute('viewBox')) {
      try {
        const bbox = svg.getBBox();
        if (bbox.width > 0 && bbox.height > 0) {
          svg.setAttribute('viewBox', `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`);
        }
      } catch (e) {
        // Если getBBox не работает, используем дефолтный viewBox
        if (!svg.getAttribute('viewBox')) {
          svg.setAttribute('viewBox', '0 0 1000 520');
        }
      }
    }
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.display = 'block';
  } catch (e) {
    console.error('Error normalizing SVG:', e);
  }
}