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
  return voted.includes(countryCode) || voted.includes(`${countryCode}_unknown`);
}

function addUserVotedCountry(countryCode) {
  const voted = getUserVotedCountries();
  if (!voted.includes(countryCode)) {
    voted.push(countryCode);
    localStorage.setItem(USER_VOTED_COUNTRIES_KEY, JSON.stringify(voted));
  }
}

function hasUserVotedUnknown(countryCode) {
  const voted = getUserVotedCountries();
  return voted.includes(`${countryCode}_unknown`);
}

function addUserVotedUnknown(countryCode) {
  const voted = getUserVotedCountries();
  const key = `${countryCode}_unknown`;
  if (!voted.includes(key)) {
    voted.push(key);
    localStorage.setItem(USER_VOTED_COUNTRIES_KEY, JSON.stringify(voted));
  }
}

function updateUIAfterReset() {
  // Сначала очищаем данные о голосовании пользователя
  localStorage.removeItem(USER_VOTED_COUNTRIES_KEY);
  
  // Обновляем таблицу - это перерисует все кнопки с правильным состоянием
  const votes = readVotes();
  renderTable(votes, currentIsAdmin);
  
  // Обновляем кнопку голосования в форме
  const voteBtn = document.getElementById("voteBtn");
  const select = document.getElementById("countrySelect");
  if (voteBtn && select) {
    if (currentIsAdmin) {
      // Для админа всегда доступно
      voteBtn.disabled = false;
      voteBtn.textContent = "Голосовать";
    } else {
      // Для обычных пользователей - после сброса все кнопки должны быть открыты
      // getUserVotedCountries() должен вернуть пустой массив после очистки
      const voted = getUserVotedCountries();
      const code = select.value;
      if (voted.length === 0 || !voted.includes(code)) {
        // Гарантируем, что кнопка открыта после сброса
        voteBtn.disabled = false;
        voteBtn.textContent = "Голосовать";
      } else {
        voteBtn.disabled = true;
        voteBtn.textContent = "Вы уже проголосовали за эту страну";
      }
    }
  }
  
  // Дополнительно обновляем все кнопки +1 в таблице для гарантии
  // (renderTable уже должен был это сделать, но на всякий случай)
  setTimeout(() => {
    const tableBtns = document.querySelectorAll('#countriesTableBody button.small');
    const voted = getUserVotedCountries(); // Должен вернуть пустой массив после очистки
    tableBtns.forEach(btn => {
      const tr = btn.closest('tr');
      if (tr) {
        const countryName = tr.querySelector('td:first-child')?.textContent;
        if (countryName) {
          const country = COUNTRIES.find(c => c.name === countryName);
          if (country) {
            // После сброса все кнопки должны быть открыты (кроме админа, для которого всегда открыты)
            if (voted.length === 0 || !voted.includes(country.code) || currentIsAdmin) {
              btn.disabled = false;
              btn.textContent = "+1";
            } else {
              btn.disabled = true;
              btn.textContent = "✓";
            }
          }
        }
      }
    });
  }, 100);
}

function computeStats(votes) {
  const counts = COUNTRIES.map(c => votes[c.code] || 0);
  // Для процентов считаем только голоса за страну (без "не знаю")
  const totalForPercent = counts.reduce((a, b) => a + b, 0);
  // Общее количество голосов включая "не знаю" для счетчика
  const unknownCounts = COUNTRIES.map(c => votes[`${c.code}_unknown`] || 0);
  const total = totalForPercent + unknownCounts.reduce((a, b) => a + b, 0);
  const positives = counts.filter(v => v > 0);
  const allZero = positives.length === 0;
  const max = allZero ? null : Math.max(...counts);
  const minPositive = allZero ? null : Math.min(...positives);
  return { total, totalForPercent, max, minPositive };
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
    if (text === '%' || text === 'Голоса' || text === 'Страна' || text === 'Не знаю') {
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
        else if (text === 'Не знаю') column = 'unknown';
        
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
      else if (text === 'Не знаю') column = 'unknown';
      
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
  const { total, totalForPercent, max, minPositive } = computeStats(votes);
  document.getElementById("totalVotes").textContent = `Всего голосов: ${total}`;

  // Подготавливаем данные для сортировки
  const countriesData = COUNTRIES.map(c => {
    const v = votes[c.code] || 0;
    const unknownVotes = votes[`${c.code}_unknown`] || 0;
    // Процент считаем только от голосов за страну (без "не знаю")
    const pct = percent(v, totalForPercent);
    return { ...c, votes: v, unknownVotes, percent: pct };
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
  } else if (tableSortOrder.column === 'unknown') {
    countriesData.sort((a, b) => {
      const diff = a.unknownVotes - b.unknownVotes;
      return tableSortOrder.ascending ? diff : -diff;
    });
  }

  countriesData.forEach(c => {
    const tr = document.createElement("tr");
    const v = c.votes;
    const pct = c.percent;

    const tdName = document.createElement("td");
    tdName.className = "country-name";
    tdName.textContent = c.name;

    const tdVotes = document.createElement("td");
    tdVotes.className = "num";
    tdVotes.textContent = v.toString();

    const tdPct = document.createElement("td");
    tdPct.className = "num";
    tdPct.textContent = `${c.percent}%`;

    const tdUnknown = document.createElement("td");
    tdUnknown.className = "num";
    tdUnknown.textContent = c.unknownVotes.toString();

    const tdBtn = document.createElement("td");
    tdBtn.className = "buttons-cell"; // Добавляем класс для стилизации
    
    // Контейнер для кнопок
    const buttonsContainer = document.createElement("div");
    buttonsContainer.className = "buttons-container";
    
    // Кнопка "+1"
    const btn = document.createElement("button");
    btn.className = "small";
    btn.textContent = "+1";
    
    const hasVoted = hasUserVotedForCountry(c.code);
    const hasVotedUnknown = hasUserVotedUnknown(c.code);
    
    // Блокируем кнопку если пользователь уже голосовал за эту страну или выбрал "не знаю"
    if ((hasVoted || hasVotedUnknown) && !isAdmin) {
      btn.disabled = true;
      if (hasVoted) {
        btn.textContent = "✓";
      } else {
        btn.textContent = "+1";
      }
    }
    
    btn.addEventListener("click", async () => {
      if ((hasVoted || hasVotedUnknown) && !isAdmin) return;
      
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
    
    // Кнопка "не знаю"
    const btnUnknown = document.createElement("button");
    btnUnknown.className = "small unknown-btn";
    btnUnknown.textContent = "?";
    
    // Блокируем кнопку если пользователь уже голосовал за эту страну или выбрал "не знаю"
    if ((hasVoted || hasVotedUnknown) && !isAdmin) {
      btnUnknown.disabled = true;
      if (hasVotedUnknown) {
        btnUnknown.textContent = "✓";
      } else {
        btnUnknown.textContent = "?";
      }
    }
    
    btnUnknown.addEventListener("click", async () => {
      if ((hasVoted || hasVotedUnknown) && !isAdmin) return;
      
      const unknownKey = `${c.code}_unknown`;
      const newValue = (votes[unknownKey] || 0) + 1;
      votes[unknownKey] = newValue;
      
      // Синхронизация с Firebase
      if (firebaseApi) {
        try {
          if (firebaseApi.runTransaction && firebaseApi.ref) {
            await firebaseApi.runTransaction(firebaseApi.ref(firebaseApi.db, `votes/${unknownKey}`), current => (Number(current) || 0) + 1);
          }
        } catch (_) {
          // Fallback на localStorage
          writeVotes(votes);
        }
      } else {
        writeVotes(votes);
      }
      
      // Помечаем что пользователь выбрал "не знаю" (только для обычных пользователей)
      if (!isAdmin) {
        addUserVotedUnknown(c.code);
      }
      
      renderTable(votes, isAdmin);
      colorMap(votes);
    });
    
    buttonsContainer.appendChild(btn);
    buttonsContainer.appendChild(btnUnknown);
    tdBtn.appendChild(buttonsContainer);
    tr.appendChild(tdName);
    tr.appendChild(tdVotes);
    tr.appendChild(tdPct);
    tr.appendChild(tdUnknown);
    tr.appendChild(tdBtn);
    tbody.appendChild(tr);
  });
  
  // Обновляем индикаторы сортировки после рендеринга
  updateSortIndicators();
}

// Функция для интерполяции между двумя цветами в RGB
function interpolateColor(color1, color2, factor) {
  // Преобразуем hex в RGB
  const hex1 = color1.replace('#', '');
  const hex2 = color2.replace('#', '');
  const r1 = parseInt(hex1.substr(0, 2), 16);
  const g1 = parseInt(hex1.substr(2, 2), 16);
  const b1 = parseInt(hex1.substr(4, 2), 16);
  const r2 = parseInt(hex2.substr(0, 2), 16);
  const g2 = parseInt(hex2.substr(2, 2), 16);
  const b2 = parseInt(hex2.substr(4, 2), 16);
  
  const r = Math.round(r1 + (r2 - r1) * factor);
  const g = Math.round(g1 + (g2 - g1) * factor);
  const b = Math.round(b1 + (b2 - b1) * factor);
  
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Функция для получения цвета на основе количества голосов (градиент как пробки в картах)
function getGradientColor(votes, minPositive, max) {
  if (votes === 0) {
    return "#374151"; // Серый для стран без голосов
  }
  
  if (max === null || minPositive === null || max === minPositive) {
    // Если все значения одинаковые или нет данных
    return "#f59e0b"; // Желтый по умолчанию
  }
  
  // Нормализуем значение от 0 до 1 (где 0 = minPositive, 1 = max)
  const normalized = (votes - minPositive) / (max - minPositive);
  
  // Градиент цветов как в пробках карт (инвертированный):
  // Бордовый -> Темно-красный -> Красный -> Оранжевый -> Желтый
  const colors = [
    "#991b1b",  // Бордовый (начало - минимум)
    "#dc2626",  // Темно-красный
    "#ef4444",  // Красный
    "#f97316",  // Оранжевый
    "#f59e0b",  // Желто-оранжевый
    "#fbbf24"   // Желтый (конец - максимум)
  ];
  
  // Определяем, между какими цветами интерполировать
  const segmentSize = 1 / (colors.length - 1);
  const segmentIndex = Math.min(Math.floor(normalized / segmentSize), colors.length - 2);
  const localFactor = (normalized - segmentIndex * segmentSize) / segmentSize;
  
  return interpolateColor(colors[segmentIndex], colors[segmentIndex + 1], localFactor);
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
    let fill = "#374151"; // Базовый серый цвет
    
    if (v > 0) {
      // Топовая страна (максимум) всегда зеленая
      if (max !== null && v === max) {
        fill = "#22c55e"; // Зеленый для топовой страны
      } else {
        // Остальные страны получают градиентный цвет
        fill = getGradientColor(v, minPositive, max);
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
    // Загружаем resetTimestamp и votes одновременно
    const [resetRes, votesRes] = await Promise.all([
      fetch(`${base}/resetTimestamp.json`),
      fetch(`${base}/votes.json`)
    ]);
    
    if (resetRes.ok) {
      const resetTs = await resetRes.json();
      if (resetTs !== null && resetTs !== undefined && String(resetTs) !== String(lastReset)) {
        // Обнаружен новый сброс - очищаем данные пользователя
        localStorage.removeItem(USER_VOTED_COUNTRIES_KEY);
        localStorage.setItem(LAST_RESET_TIMESTAMP_KEY, String(resetTs));
        
        // Обновляем votes если они были загружены
        if (votesRes.ok) {
          const votesData = await votesRes.json() || {};
          const newVotes = {};
          COUNTRIES.forEach(c => { 
            newVotes[c.code] = Number(votesData[c.code] || 0);
            newVotes[`${c.code}_unknown`] = Number(votesData[`${c.code}_unknown`] || 0);
          });
          writeVotes(newVotes);
        }
        
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
    const hasVoted = hasUserVotedForCountry(code);
    const hasVotedUnknown = hasUserVotedUnknown(code);
    if ((hasVoted || hasVotedUnknown) && !isAdmin) {
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
    const hasVoted = hasUserVotedForCountry(code);
    const hasVotedUnknown = hasUserVotedUnknown(code);
    if ((hasVoted || hasVotedUnknown) && !isAdmin) return;
    
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
      COUNTRIES.forEach(c => { 
        resetData[c.code] = 0;
        resetData[`${c.code}_unknown`] = 0;
      });
      
      // Полная очистка Firebase и синхронизация
      if (firebaseApi && firebaseApi.ref) {
        try {
          const cfg = window.FIREBASE_CONFIG || {};
          const base = cfg.databaseURL ? cfg.databaseURL.replace(/\/$/, '') : '';
          
          if (base) {
            // Полностью удаляем все данные из votes в Firebase
            await fetch(`${base}/votes.json`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' }
            });
            
            // Создаем новый пустой объект votes с нулевыми значениями
            const votesPayload = {};
            COUNTRIES.forEach(c => { 
              votesPayload[c.code] = 0;
              votesPayload[`${c.code}_unknown`] = 0;
            });
            await fetch(`${base}/votes.json`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(votesPayload)
            });
          } else if (firebaseApi.update && firebaseApi.set) {
            // Используем SDK методы
            const payload = {};
            COUNTRIES.forEach(c => { 
              payload[`votes/${c.code}`] = 0;
              payload[`votes/${c.code}_unknown`] = 0;
            });
            await firebaseApi.update(firebaseApi.ref(firebaseApi.db), payload);
          }
          
          // Устанавливаем resetTimestamp
          const resetTs = Date.now();
          if (firebaseApi.set && base) {
            // REST режим
            await fetch(`${base}/resetTimestamp.json`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(resetTs)
            });
          } else if (firebaseApi.set) {
            // SDK режим
            await firebaseApi.set(firebaseApi.ref(firebaseApi.db, 'resetTimestamp'), resetTs);
          }
          
          localStorage.setItem(LAST_RESET_TIMESTAMP_KEY, resetTs);
          // Обновляем локальные votes после успешного обновления Firebase
          Object.assign(votes, resetData);
          writeVotes(votes);
        } catch (err) {
          console.error('Reset error:', err);
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
      
      // Очищаем данные о голосовании пользователя (для админа тоже)
      localStorage.removeItem(USER_VOTED_COUNTRIES_KEY);
      
      // updateUIAfterReset() обновит таблицу и все кнопки
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
    logoutBtn.style.flexShrink = "0"; // Не даем сжиматься
    logoutBtn.style.whiteSpace = "nowrap"; // Не переносим текст
    
    logoutBtn.addEventListener("click", function() {
      if (confirm("Выйти из режима администратора?")) {
        setAdminActive(false);
        window.location.href = "auth.html";
      }
    });
    
    // Добавляем кнопку в controls
    const controls = document.querySelector(".controls");
    if (controls) {
      // Добавляем спейсер перед кнопкой выхода, чтобы прижать её к правому краю
      const spacer = document.createElement("div");
      spacer.style.flex = "1";
      spacer.style.minWidth = "8px"; // Минимальная ширина для gap
      controls.appendChild(spacer);
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
        // Загружаем resetTimestamp и votes одновременно
        const [resetRes, votesRes] = await Promise.all([
          fetch(`${base}/resetTimestamp.json`),
          fetch(`${base}/votes.json`)
        ]);
        
        if (resetRes.ok) {
          const resetTs = await resetRes.json();
          if (resetTs !== null && resetTs !== undefined && String(resetTs) !== String(lastReset)) {
            // Обнаружен новый сброс - очищаем данные пользователя
            localStorage.removeItem(USER_VOTED_COUNTRIES_KEY);
            localStorage.setItem(LAST_RESET_TIMESTAMP_KEY, String(resetTs));
            
            // Обновляем votes если они были загружены
            if (votesRes.ok) {
              const votesData = await votesRes.json() || {};
              const newVotes = {};
              COUNTRIES.forEach(c => { 
                newVotes[c.code] = Number(votesData[c.code] || 0);
                newVotes[`${c.code}_unknown`] = Number(votesData[`${c.code}_unknown`] || 0);
              });
              writeVotes(newVotes);
            }
            
            updateUIAfterReset();
          }
        }
      } catch (_) {}
      
      // Подписка через polling
      setInterval(async () => {
        try {
          // Сначала проверяем resetTimestamp
          let resetDetected = false;
          const resetRes = await fetch(`${base}/resetTimestamp.json`);
          if (resetRes.ok) {
            const resetTs = await resetRes.json();
            const lastReset = localStorage.getItem(LAST_RESET_TIMESTAMP_KEY);
            if (resetTs !== null && resetTs !== undefined && String(resetTs) !== String(lastReset)) {
              // Обнаружен новый сброс - очищаем данные пользователя
              localStorage.removeItem(USER_VOTED_COUNTRIES_KEY);
              localStorage.setItem(LAST_RESET_TIMESTAMP_KEY, String(resetTs));
              resetDetected = true;
            }
          }
          
          // Загружаем актуальные votes
          const res = await fetch(`${base}/votes.json`);
          const data = await res.json() || {};
          const newVotes = {};
          COUNTRIES.forEach(c => { 
            newVotes[c.code] = Number(data[c.code] || 0);
            newVotes[`${c.code}_unknown`] = Number(data[`${c.code}_unknown`] || 0);
          });
          
          // Если был обнаружен сброс, обновляем UI после загрузки votes
          if (resetDetected) {
            writeVotes(newVotes);
            updateUIAfterReset();
          } else {
            renderTable(newVotes, isAdmin);
            colorMap(newVotes);
            writeVotes(newVotes);
          }
        } catch (_) {}
      }, 2000);
      
      // Первоначальная загрузка (только если в Firebase есть данные)
      try {
        const res = await fetch(`${base}/votes.json`);
        const data = await res.json();
        if (data && Object.keys(data).length > 0) {
          const newVotes = {};
          COUNTRIES.forEach(c => { 
            newVotes[c.code] = Number(data[c.code] || 0);
            newVotes[`${c.code}_unknown`] = Number(data[`${c.code}_unknown`] || 0);
          });
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
    let resetTimestampValue = null;
    onValue(resetRef, (snap) => {
      const resetTs = snap.val();
      resetTimestampValue = resetTs;
      if (resetTs !== null && resetTs !== undefined) {
        const lastReset = localStorage.getItem(LAST_RESET_TIMESTAMP_KEY);
        if (String(resetTs) !== String(lastReset)) {
          // Обнаружен новый сброс - очищаем данные пользователя
          localStorage.removeItem(USER_VOTED_COUNTRIES_KEY);
          localStorage.setItem(LAST_RESET_TIMESTAMP_KEY, String(resetTs));
          // Обновим UI после того, как votes обновятся
        }
      }
    });
    
    // Подписка на изменения в реальном времени
    const root = ref(db, 'votes');
    onValue(root, (snap) => {
      const data = snap.val() || {};
      const newVotes = {};
      COUNTRIES.forEach(c => { 
        newVotes[c.code] = Number(data[c.code] || 0);
        newVotes[`${c.code}_unknown`] = Number(data[`${c.code}_unknown`] || 0);
      });
      
      // Проверяем, был ли обнаружен новый сброс
      const lastReset = localStorage.getItem(LAST_RESET_TIMESTAMP_KEY);
      const resetDetected = resetTimestampValue !== null && 
                           resetTimestampValue !== undefined && 
                           String(resetTimestampValue) !== String(lastReset);
      
      if (resetDetected) {
        // Если был сброс, обновляем timestamp и очищаем данные пользователя
        localStorage.removeItem(USER_VOTED_COUNTRIES_KEY);
        localStorage.setItem(LAST_RESET_TIMESTAMP_KEY, String(resetTimestampValue));
        writeVotes(newVotes);
        updateUIAfterReset();
      } else {
        renderTable(newVotes, isAdmin);
        colorMap(newVotes);
        writeVotes(newVotes);
      }
    });
    
    // Первоначальная загрузка - загружаем votes и resetTimestamp одновременно
    const [snap, resetSnap] = await Promise.all([
      new Promise((resolve) => {
        onValue(root, resolve, { onlyOnce: true });
      }),
      new Promise((resolve) => {
        onValue(resetRef, resolve, { onlyOnce: true });
      })
    ]);
    
    const data = snap.val() || {};
    const newVotes = {};
    COUNTRIES.forEach(c => { 
      newVotes[c.code] = Number(data[c.code] || 0);
      newVotes[`${c.code}_unknown`] = Number(data[`${c.code}_unknown`] || 0);
    });
    
    const resetTs = resetSnap.val();
    const lastReset = localStorage.getItem(LAST_RESET_TIMESTAMP_KEY);
    const resetDetected = resetTs !== null && 
                         resetTs !== undefined && 
                         String(resetTs) !== String(lastReset);
    
    if (resetDetected) {
      // Обнаружен новый сброс - очищаем данные пользователя
      localStorage.removeItem(USER_VOTED_COUNTRIES_KEY);
      localStorage.setItem(LAST_RESET_TIMESTAMP_KEY, String(resetTs));
      resetTimestampValue = resetTs;
      writeVotes(newVotes);
      updateUIAfterReset();
    } else {
      renderTable(newVotes, isAdmin);
      colorMap(newVotes);
      writeVotes(newVotes);
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