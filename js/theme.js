/* ===========================================================
   IST Trust Zone — Theme system (Dark / Blue) — Instant switch
=========================================================== */
const THEME_KEY = "ist_theme";
const THEMES = ["dark", "blue"];

export function getStoredTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return THEMES.includes(t) ? t : "dark";
  } catch (_) {
    return "dark";
  }
}

export function applyTheme(theme) {
  const t = THEMES.includes(theme) ? theme : "dark";
  document.documentElement.setAttribute("data-theme", t);
}

export function setTheme(theme) {
  const t = THEMES.includes(theme) ? theme : "dark";
  applyTheme(t);
  try { localStorage.setItem(THEME_KEY, t); } catch (_) {}
}

function syncAllThemeButtons() {
  const current = getStoredTheme();
  document.querySelectorAll(".theme-switch .theme-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.themeValue === current);
  });
}

export function initThemeSwitch(containerId = "theme-switch") {
  applyTheme(getStoredTheme());
  const containers = containerId
    ? [document.getElementById(containerId)].filter(Boolean)
    : [];
  if (!containers.length) return;

  containers.forEach((container) => {
    container.querySelectorAll(".theme-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.themeValue;
        if (target === getStoredTheme()) return;
        setTheme(target);
        syncAllThemeButtons();
      });
    });
  });

  syncAllThemeButtons();
}
