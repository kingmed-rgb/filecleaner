# File Cleaner

Free browser-based image metadata cleanup, funded only by Google AdSense when configured. Files remain on the user's device.

- Guests: 3 images per UTC day. A batch counts each image separately.
- Signed-in users: unlimited daily images and free batch processing.
- Maximum batch size: 500 images to keep requests bounded; this is not a daily quota.
- No payments, subscriptions, or paid feature gates. Ads apply to both guests and accounts.

## Deployment

Deploy this repository on Vercel using its included build configuration. Serve the frontend and API from the same domain (session cookies use SameSite=Lax).

Set the variables in `.env.example`: `APP_URL`, `ALLOWED_ORIGINS`, a random `SESSION_SECRET` of at least 32 characters, Redis REST credentials, and Resend credentials plus a verified sender for email login. Missing deployment credentials fail closed. Only explicit local `NODE_ENV=development` or `test` permits temporary in-memory storage and development login codes; Vercel deployments never permit these fallbacks.

Optional Google login requires a Google OAuth web client with callback `https://YOUR_DOMAIN/api/auth/google/callback`. Only verified Google email addresses are accepted.

Guest quotas use a daily keyed hash of the trusted client network address. Clearing cookies does not reset the allowance. Shared networks share the guest allowance; signing in removes that restriction. Vercel's overwritten `x-vercel-forwarded-for` header is trusted only on Vercel; elsewhere the direct socket address is used. Another reverse proxy requires an explicit trusted-IP adapter. Client-side file processing inherently remains bypassable by someone modifying the browser code.

Quota reservations are atomic in Redis and expire within 48 hours. Login send/verify counters use 10-minute windows per email and network. Login challenges are hashed, expire in 10 minutes, and are consumed atomically. A processing attempt consumes its image allowance before local work begins; failed downloads are not refunded. Daily usage is not stored for signed-in accounts.

## Google AdSense

Publisher `pub-8412484885269791` is configured in `adsense.json`. Ads remain disabled by default.

1. Add your production domain to your AdSense account.
2. Deploy this branch. The build automatically adds the account verification meta tag (`ca-pub-8412484885269791`) and generates `/ads.txt` (`pub-8412484885269791`). `ADSENSE_PUBLISHER_ID` can override this public default; an empty override disables publisher configuration.
3. Complete site approval and configure Auto ads and the required consent messages in AdSense Privacy & messaging. Use Google's certified consent-management tooling for applicable regions.
4. Set `ADSENSE_ENABLED=true` and redeploy when ready. The build inserts Google's Auto ads script on all HTML pages. Leave it false to keep ad requests disabled.

References: [AdSense setup](https://support.google.com/adsense/answer/7584263), [Auto ads](https://support.google.com/adsense/answer/9261307), [ads.txt](https://support.google.com/adsense/answer/12171612).

## Verification and development

- `npm run check` checks API and inline frontend JavaScript syntax.
- `npm test` covers quotas, concurrency, authentication, deployment safeguards, origins, and ad builds.
- `npm run build` writes the deployable static pages to `public/`.
- `npm run dev` runs a local-only development server with test storage and explicit development login codes.

## Removing the old billing setup

The application no longer exposes billing endpoints or reads subscription fields. Existing accounts receive unlimited access regardless of their previous plan; logging in again drops legacy billing fields from their stored account record. Old session tokens require a fresh sign-in.

Deployment cleanup: remove former Stripe environment variables and webhook configuration. If any real subscriptions were created, cancel their future renewals in the Stripe account before considering billing retired. Removing code does not cancel external subscriptions. Historical customer mapping records can be removed according to your retention policy; do not delete account records.
