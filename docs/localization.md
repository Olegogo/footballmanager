# Russian and English

The app and bot use `packages/i18n/locales/{ru,en}.json`. The server-rendered landing uses `packages/i18n/landing.json` and a shared HTML template. English landing assets are exact Figma exports from node `3311:155`; the expanded language-menu reference was unavailable due to the Figma MCP limit, so the menu uses the existing navigation colors and accessible native disclosure behavior.

- `/ru` and `/en` always render their explicit language. `/about` redirects using the saved language cookie or the browser language. Both versions have localized metadata, canonical URLs and hreflang links.
- A manual account preference wins over Telegram language. Unsupported languages default to English. Migration retains Russian for existing records without a language field.
- Landing links carry the language into `/start landing_en` or `startapp=lang_en`. The app also remembers manual selection locally. Group announcements use the group's language; personal notifications and callback responses use the player's language.
- `/language` changes personal language in private chats; only group admins can change a group's language.
- `/timezone Europe/London` sets the zone for new announcements. Existing matches keep their schedule. Manual games and team challenges expose a venue time-zone field. UTC instants and venue calendar dates are stored separately. Invalid or ambiguous local times around DST transitions are rejected.
- Announcement parsing accepts Russian dates, English day-first/month-first dates and ISO dates, with 24-hour times. Existing roster and historical import requirements remain in place. User-written venue names, prices, payment instructions and comments remain in their original language and currency.
- Domain errors expose stable `errorKey` and `errorParams`; API and bot responses translate them. Unknown failures show a generic localized message.
- Product analytics includes `locale` without collecting user-entered text.
- Bot startup configures command descriptions, full descriptions and short descriptions for RU, EN and the English fallback. These external settings take effect when the deployed bot restarts; the local preview disables Telegram calls.

Validation: `npm test`, plus browser checks of the landing/menu at desktop and mobile widths and a local API journey with an English organizer, Russian player, invitation acceptance, language persistence and a London venue.
