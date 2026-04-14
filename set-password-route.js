// ADD THIS ROUTE TO server.js before the app.listen() line

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
