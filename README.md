# File Cleaner

A browser-based image metadata cleaner with Vercel-backed usage limits, email-code sign-in, and Stripe Pro subscriptions.

## Plans

- Guest: 3 image uses per day
- Signed-in Free: 10 image uses per day
- Pro: $10/month or $89/year with unlimited images, batch processing, no ads, priority support, and cancel anytime

Files are still processed locally in the browser. The Vercel backend only stores account, quota, and billing state.

## Deploy on Vercel

1. Import this repository into Vercel.
2. Add Vercel KV or Upstash Redis and copy `KV_REST_API_URL` and `KV_REST_API_TOKEN` into the project environment variables.
3. Create a Stripe product with two recurring prices: monthly `$10` and yearly `$89`.
4. Add the environment variables from `.env.example`.
5. Optional Google OAuth: create a Google OAuth web client and add this authorized redirect URI:

   `https://your-filecleaner-app.vercel.app/api/auth/google/callback`

6. Add a Stripe webhook pointing to:

   `https://your-filecleaner-app.vercel.app/api/stripe/webhook`

   Subscribe to these events:

   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

7. Deploy.

## GitHub Pages front end

If you keep the static front end on GitHub Pages while the API is on Vercel, set the API base before the main script in `index.html`:

```html
<script>window.FILECLEANER_API_BASE = "https://your-filecleaner-app.vercel.app";</script>
```

Also include `https://kingmed-rgb.github.io` in `ALLOWED_ORIGINS`.

## Local notes

Without KV credentials, the API falls back to in-memory storage for development. That is not durable and should not be used for production quotas.
