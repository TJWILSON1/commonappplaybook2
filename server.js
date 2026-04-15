require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Supabase admin client (service role — never expose this to the browser)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Middleware ────────────────────────────────────────────────────────────────

// Stripe webhook needs the raw body — must come BEFORE express.json()
app.post('/api/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

app.use(cors({ origin: process.env.APP_URL, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Auth middleware ───────────────────────────────────────────────────────────

async function requireAuth(req, res, next) {
  const token = req.cookies['sb-token'];
  if (!token) return res.redirect('/login.html');

  // Verify the JWT with Supabase
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return res.redirect('/login.html');

  // Check the user has paid
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('has_paid')
    .eq('id', user.id)
    .single();

  if (!profile?.has_paid) return res.redirect('/login.html?reason=unpaid');

  req.user = user;
  next();
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Create Stripe checkout session
// Create Stripe checkout session
// type: 'course' (default $35) | 'essay_review' ($15) | 'short_review' ($15)
app.post('/api/create-checkout', async (req, res) => {
  try {
    // Read type from query param (more reliable in serverless) or body fallback
    const type = req.query.type || req.body.type || 'course';
    let lineItems, successUrl;

    if (type === 'essay_review') {
      lineItems = [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Essay Review — The Common App Playbook',
            description: 'Detailed written feedback on your personal statement or supplemental essay, plus one follow-up revision round.',
          },
          unit_amount: 1500,
        },
        quantity: 1,
      }];
      successUrl = `${process.env.APP_URL}/success.html?session_id={CHECKOUT_SESSION_ID}&type=essay_review`;

    } else if (type === 'short_review') {
      lineItems = [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Short Answer Review — The Common App Playbook',
            description: 'Detailed written feedback on activity descriptions, additional info, or short supplemental responses.',
          },
          unit_amount: 1500,
        },
        quantity: 1,
      }];
      successUrl = `${process.env.APP_URL}/success.html?session_id={CHECKOUT_SESSION_ID}&type=short_review`;

    } else {
      // Default: full course
      lineItems = [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }];
      successUrl = `${process.env.APP_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`;
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: successUrl,
      cancel_url: `${process.env.APP_URL}/index.html`,
      customer_email: req.body.email || undefined,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// After Stripe payment — create/link Supabase account
app.get('/api/verify-payment', async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'Missing session_id' });

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid') {
      return res.status(402).json({ error: 'Payment not completed' });
    }

    const email = session.customer_details?.email;
    if (!email) return res.status(400).json({ error: 'No email found' });

    // Check if user already exists
    const { data: existing } = await supabaseAdmin.auth.admin.listUsers();
    const existingUser = existing?.users?.find(u => u.email === email);

    let userId;
    let isNewUser = false;

    if (existingUser) {
      userId = existingUser.id;
    } else {
      // Create new user — they'll set a password via magic link
      const tempPassword = require('crypto').randomBytes(16).toString('hex');
      const { data: newUser, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
      });
      if (error) throw error;
      userId = newUser.user.id;
      isNewUser = true;
    }

    // Mark as paid in profiles table
    await supabaseAdmin.from('profiles').upsert({
      id: userId,
      email,
      has_paid: true,
      stripe_session_id: session_id,
      paid_at: new Date().toISOString(),
    });

    // Send password-set email if new user
    if (isNewUser) {
      await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: `${process.env.APP_URL}/course.html` }
      });
    }

    res.json({ success: true, email, isNewUser });
  } catch (err) {
    console.error('Verify payment error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  // Use the anon client for login
  const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });

  if (error) return res.status(401).json({ error: 'Invalid email or password' });

  // Verify they've paid
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('has_paid')
    .eq('id', data.user.id)
    .single();

  if (!profile?.has_paid) {
    return res.status(403).json({ error: 'No active course purchase found. Please enroll first.' });
  }

  // Set session cookie (httpOnly = JS can't read it — secure!)
  res.cookie('sb-token', data.session.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  res.json({ success: true });
});

// Logout
app.post('/api/logout', (req, res) => {
  res.clearCookie('sb-token');
  res.json({ success: true });
});

// Protected: serve course page
app.get('/course.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'course.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Review submission endpoints ───────────────────────────────────────────────

// Return public Supabase config (anon key is safe to expose)
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
});

// Generate a signed upload URL — verifies Stripe payment first
app.post('/api/get-upload-url', async (req, res) => {
  const { session_id, filename, type } = req.body;
  if (!session_id || !filename) {
    return res.status(400).json({ error: 'Missing session_id or filename' });
  }
  try {
    // Verify payment is real
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid') {
      return res.status(402).json({ error: 'Payment not confirmed' });
    }
    // Clean filename and build storage path
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `${session_id}/${Date.now()}_${safeName}`;
    // Create a signed URL so the browser can upload directly to Supabase Storage
    const { data, error } = await supabaseAdmin.storage
      .from('reviews')
      .createSignedUploadUrl(filePath);
    if (error) throw error;
    res.json({ signedUrl: data.signedUrl, token: data.token, filePath });
  } catch (err) {
    console.error('Get upload URL error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Record completed submission + notify TJ
app.post('/api/submit-review', async (req, res) => {
  const { session_id, type, email, file_path } = req.body;
  if (!session_id || !file_path) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    // Verify payment again
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid') {
      return res.status(402).json({ error: 'Payment not confirmed' });
    }
    const studentEmail = email || session.customer_details?.email || 'unknown';
    // Get public URL for the file
    const { data: urlData } = supabaseAdmin.storage
      .from('reviews')
      .getPublicUrl(file_path);
    // Store in submissions table
    await supabaseAdmin.from('submissions').insert({
      session_id,
      type: type || 'essay_review',
      email: studentEmail,
      file_path,
      file_url: urlData.publicUrl,
      submitted_at: new Date().toISOString(),
    });
    // Send email notification to TJ if Resend is configured
    if (process.env.RESEND_API_KEY) {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        const label = type === 'short_review' ? 'Short Answer Review' : 'Essay Review';
        await resend.emails.send({
          from: process.env.RESEND_FROM || 'onboarding@resend.dev',
          to: 'supertjwilson23@gmail.com',
          subject: `New ${label} Submission — The Common App Playbook`,
          html: `
            <h2>New ${label} submission</h2>
            <p><strong>Student:</strong> ${studentEmail}</p>
            <p><strong>Type:</strong> ${label}</p>
            <p><strong>File:</strong> <a href="${urlData.publicUrl}">Download submission</a></p>
            <p><strong>Submitted:</strong> ${new Date().toLocaleString()}</p>
          `,
        });
      } catch (emailErr) {
        // Non-fatal — submission is still recorded
        console.error('Email notification failed:', emailErr.message);
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Submit review error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Stripe webhook — fires when payment completes
async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email;
    if (email) {
      // Mark user as paid (backup to the verify-payment route)
      const { data: existing } = await supabaseAdmin.auth.admin.listUsers();
      const user = existing?.users?.find(u => u.email === email);
      if (user) {
        await supabaseAdmin.from('profiles').upsert({
          id: user.id,
          email,
          has_paid: true,
          stripe_session_id: session.id,
          paid_at: new Date().toISOString(),
        });
      }
    }
  }
  res.json({ received: true });
}


app.post('/api/set-password', async (req, res) => {
  const { email, password, session_id } = req.body;
  if (!email || !password || !session_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Verify session is still valid
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid') {
      return res.status(402).json({ error: 'Payment not verified' });
    }
    if (session.customer_details?.email !== email) {
      return res.status(403).json({ error: 'Email does not match payment record' });
    }

    // Find user and update their password
    const { data: userList } = await supabaseAdmin.auth.admin.listUsers();
    const user = userList?.users?.find(u => u.email === email);
    if (!user) return res.status(404).json({ error: 'Account not found' });

    await supabaseAdmin.auth.admin.updateUserById(user.id, { password });

    // Now log them in automatically
    const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { data: loginData, error: loginError } = await supabaseAnon.auth.signInWithPassword({ email, password });
    if (loginError) throw loginError;

    res.cookie('sb-token', loginData.session.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Set password error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Forgot password endpoint
app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { error } = await supabaseAnon.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.APP_URL}/reset-password.html`,
    });
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
