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
      link.href = '/telegram';
    }
  } catch {
    // Keep the bot-first fallback when the session cannot be verified.
  }
}

void useDirectMiniAppLinksForReturningUser();
