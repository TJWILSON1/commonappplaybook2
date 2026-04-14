# 🎓 Common App Playbook — Setup Guide
## Complete step-by-step from zero to live

This guide assumes you are a total beginner. Follow each step in order.
Estimated time: **2–3 hours** the first time.

---

## PART 1 — Supabase (your database + user accounts)

### Step 1.1 — Create a Supabase account
1. Go to **https://supabase.com** and click "Start your project"
2. Sign up with GitHub or email
3. Click **"New Project"**
4. Choose a name (e.g. "commonapp-course"), a strong password, and a region close to you
5. Wait ~2 minutes for it to provision

### Step 1.2 — Create the database table
1. In your Supabase project, click **"SQL Editor"** in the left sidebar
2. Click **"New query"**
3. Open the file `supabase-setup.sql` from this project
4. Paste the entire contents into the SQL editor
5. Click **"Run"**
6. You should see "Success. No rows returned"

### Step 1.3 — Get your API keys
1. In Supabase, go to **Settings → API**
2. Copy these three values — you'll need them later:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **anon public** key (long string starting with `eyJ`)
   - **service_role** key (another long string — keep this secret!)

### Step 1.4 — Configure Auth settings
1. Go to **Authentication → Providers**
2. Make sure **Email** is enabled (it should be by default)
3. Go to **Authentication → URL Configuration**
4. Add your future Vercel URL to "Site URL" (you'll come back to fill this in after Step 3)

---

## PART 2 — Stripe (payment processing)

### Step 2.1 — Create a Stripe account
1. Go to **https://stripe.com** and sign up
2. Complete the identity verification (required to accept real payments)
3. You'll start in "Test Mode" — that's fine for now

### Step 2.2 — Create your product
1. In Stripe dashboard, go to **Product catalog**
2. Click **"+ Add product"**
3. Name: "The Common App Playbook"
4. Pricing: **One-time**, $35.00 USD
5. Click **"Save product"**
6. On the product page, copy the **Price ID** (looks like `price_1Abc...`)

### Step 2.3 — Get your API keys
1. Go to **Developers → API keys**
2. Copy your **Publishable key** (`pk_live_...` or `pk_test_...`)
3. Copy your **Secret key** (`sk_live_...` or `sk_test_...`)

> ⚠️ Use test keys (`pk_test_` / `sk_test_`) while you're setting up. Switch to live keys when you're ready to go live.

### Step 2.4 — Set up the webhook (do this AFTER deploying to Vercel)
1. Go to **Developers → Webhooks**
2. Click **"Add endpoint"**
3. URL: `https://YOUR-VERCEL-URL.vercel.app/api/webhook`
4. Events: select **`checkout.session.completed`**
5. Copy the **Signing secret** (starts with `whsec_`)

---

## PART 3 — Deploy to Vercel

### Step 3.1 — Install Node.js
1. Go to **https://nodejs.org** and download the LTS version
2. Install it (just click through the installer)
3. Open Terminal (Mac) or Command Prompt (Windows)
4. Type `node --version` — you should see a version number

### Step 3.2 — Install Vercel CLI
```bash
npm install -g vercel
```

### Step 3.3 — Prepare your project files
Your project folder should contain:
```
course-app/
├── server.js
├── package.json
├── vercel.json
├── .env.example
└── public/
    ├── index.html      ← your landing page (rename commonapp-course.html)
    ├── login.html
    ├── success.html
    └── course.html
```

**Important:** Rename `commonapp-course.html` to `index.html` and put it in the `public/` folder.

### Step 3.4 — Create your .env file
1. Duplicate `.env.example` and rename it `.env`
2. Fill in every value with what you collected in Parts 1 and 2

### Step 3.5 — Deploy
```bash
cd course-app
npm install
vercel
```

Follow the prompts:
- Set up and deploy? **Y**
- Which scope? (your username)
- Link to existing project? **N**
- Project name: `commonapp-course` (or whatever you like)
- Directory: `./` (just press Enter)

Vercel will give you a URL like `https://commonapp-course-abc123.vercel.app`

### Step 3.6 — Add environment variables to Vercel
1. Go to **https://vercel.com** → your project → **Settings → Environment Variables**
2. Add each variable from your `.env` file one by one
3. Set `NODE_ENV` = `production`

### Step 3.7 — Redeploy with env vars
```bash
vercel --prod
```

---

## PART 4 — Final configuration

### Step 4.1 — Update Supabase Site URL
1. Go back to Supabase → **Authentication → URL Configuration**
2. Set **Site URL** to your Vercel URL
3. Add to **Redirect URLs**: `https://your-vercel-url.vercel.app/course.html`

### Step 4.2 — Add Stripe webhook (if you haven't yet)
Follow Step 2.4 with your real Vercel URL now.

### Step 4.3 — Update APP_URL in Vercel
1. In Vercel → Settings → Environment Variables
2. Update `APP_URL` to your exact Vercel URL (no trailing slash)
3. Redeploy: `vercel --prod`

---

## PART 5 — Testing

### Test the full flow:
1. Go to your Vercel URL
2. Click **"Enroll Now"** → should redirect to Stripe checkout
3. Use Stripe test card: **4242 4242 4242 4242**, any future date, any CVC
4. Should redirect to `/success.html`
5. Create a password → should land on `/course.html`
6. Sign out → try logging in at `/login.html`

### Switch to live payments:
1. In Stripe dashboard, toggle from Test to **Live mode**
2. Get your live API keys and update them in Vercel environment variables
3. Update `STRIPE_PRICE_ID` with your live price ID
4. Create a new live webhook endpoint
5. Redeploy: `vercel --prod`

---

## Troubleshooting

**"Cannot find module" errors:** Run `npm install` in the project folder

**Stripe webhook errors:** Make sure `STRIPE_WEBHOOK_SECRET` matches the one from your webhook endpoint (not your API key)

**Login not working after payment:** Check that Supabase `service_role` key is correct and the profiles table was created

**Course page redirects to login:** The auth cookie may have expired — just log in again

---

## Custom domain (optional)
1. In Vercel → your project → **Settings → Domains**
2. Add your domain and follow the DNS instructions from your registrar

---

## Need help?
If something isn't working, the most common fixes are:
1. Double-check all environment variables are spelled exactly right
2. Make sure you redeployed after adding env vars (`vercel --prod`)
3. Check the Vercel function logs: Vercel dashboard → your project → **Functions** tab
