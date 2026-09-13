const SESSION_STORAGE_KEY = 'fifa-miniapp-token:global';
const telegramEntryLinks = document.querySelectorAll('[data-telegram-entry]');

async function useDirectMiniAppLinksForReturningUser() {
  let token = '';

  try {
    token = localStorage.getItem(SESSION_STORAGE_KEY) || '';
  } catch {
    return;
  }

  if (!token) {
    return;
  }

  try {
    const response = await fetch('/api/bootstrap', {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      return;
    }

    for (const link of telegramEntryLinks) {
      link.href = `/telegram${document.documentElement?.lang ? `?locale=${document.documentElement.lang}` : ''}`;
    }
  } catch {
    // Keep the bot-first fallback when the session cannot be verified.
  }
}

void useDirectMiniAppLinksForReturningUser();

const languageMenu = document.querySelector?.('.language-menu');
if (languageMenu) {
  document.addEventListener('click', (event) => {
    if (!languageMenu.contains(event.target)) languageMenu.open = false;
    const link = event.target.closest('[data-language]');
    if (link) {
      try { localStorage.setItem('matchup-locale', link.dataset.language); } catch {}
      document.cookie = `matchup_locale=${link.dataset.language}; Path=/; Max-Age=31536000; SameSite=Lax`;
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && languageMenu.open) {
      languageMenu.open = false;
      languageMenu.querySelector('summary').focus();
    }
  });
}
