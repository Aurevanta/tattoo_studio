# TASK-0131 — legal texts checked against the code (2026-10-16)

Technical review by the studio's developer tooling, **not legal advice**. It checks that what the
terms and the privacy policy (`apps/web/src/content/legal.ts`) say is what the code does. A lawyer
must still review the texts before `LEGAL_DRAFT` is set to `false`.

## Statements checked

| Statement in the text | Code | Status |
|---|---|---|
| Body photos and what is composed on them are deleted after 24 h | `EncryptedFileStore(..., retention=timedelta(hours=24))`, `app/studio.py` | OBSERVED, consistent |
| Usage log kept up to 365 days | `telemetry_retention_days = 365`, `app/settings.py` (configurable) | OBSERVED, consistent (default) |
| A tattooer link stops after 30 days | `SHARE_DAYS = 30`, `app/shares.py` | OBSERVED, consistent |
| Body photos never go to the image generator | ADR-0007, GEN-INV-002; own photo declined by `_StudioBlend` | OBSERVED, consistent |
| Processors: Supabase, OpenAI, Anthropic, Black Forest Labs, Brave | settings and consultation agents | OBSERVED, consistent |
| «Brave Search … solo recibe el texto de la búsqueda» | `ReferencesStep.tsx` shows `<img src={reference.source}>`; a Brave result's source is a thumbnail on `imgs.search.brave.com` | **Inaccurate**: the client's browser loads it, so Brave receives the client's IP. Fixed |
| (not stated) Wikimedia Commons and Openverse | `image-scout.ts` sends the search text to their APIs; thumbnails from `upload.wikimedia.org` and Openverse load in the browser | **Missing**. Added |
| (not stated) Google Fonts | `globals.css` `@import` from `fonts.googleapis.com` | **Missing**: Google receives the visitor's IP. Added; see open item 4 |
| (not stated) how long the consultation in progress lives | `CONSULTATION_TTL_S = 86400`, deleted 24 h after its last change | **Missing**. Added |
| (not stated) cookies | `inkcraft_at` 1 h, `inkcraft_rt` 30 days (`lib/auth.ts`), `inkcraft_ok` 30 days (`lib/consent.ts`); all httpOnly, technical; no analytics or advertising | **Missing** (LSSI art. 22.2 exempts technical cookies from consent, not from information). Added section 7 |
| (not stated) whether data are required; automated decisions | GDPR art. 13.2(e), (f) | **Missing**. Added to section 3 |
| CSP violation reports (TASK-0127) | `client_error`/`csp` events, no account, page path without tokens | Covered by «registro del uso … errores» |
| Holder identity | `LEGAL_ENTITY`: name and email only | **Incomplete** (LSSI art. 10): open item 1 |

`IMAGES_VERSION` moves to `2026-10-16`, so every account accepts the privacy and image text again
at its next sign-in (the mechanism of TASK-0068). `TERMS_VERSION` is unchanged: the terms' text did
not change.

## Open items (owner)

1. **Holder data.** Is the holder a company (S.L.) or a self-employed person? Give the exact name
   (company name, or full name), NIF, postal address and, for a company, its Registro Mercantil
   entry. Fill `LEGAL_ENTITY`; `legal.test.ts` refuses to leave draft while NIF or address is empty.
2. **Which providers run in production.** The worker can also use fal.ai (`FAL_KEY`,
   `generation/fal_provider.py`). If the deployed studio has it configured, it must be listed as a
   processor. UNKNOWN from the repository: check the Coolify environment.
3. **International transfers.** The text says transfers outside the EEA have GDPR safeguards; confirm
   each provider's mechanism (Data Privacy Framework or standard contractual clauses) and signed DPA.
4. **Google Fonts.** Loading fonts from Google sends the visitor's IP to Google before any consent.
   Self-hosting the three families would remove that transfer and two CSP hosts. Recommended; not
   done here.
5. **Records of processing and a DPIA.** Processing photographs of bodies with AI providers may
   require a data protection impact assessment (GDPR art. 35). Not a text change; for the lawyer.

## Open items (lawyer)

- Review both texts as a whole and decide when `LEGAL_DRAFT` can be `false`.
- Confirm the consumer and liability wording of terms section 6 under Spanish consumer law.
