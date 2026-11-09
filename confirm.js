(() => {
  const card = document.querySelector(".confirm-card");
  const title = document.querySelector("#confirm-title");
  const message = document.querySelector("#confirm-message");
  const help = document.querySelector("#confirm-help");
  const button = document.querySelector("#confirm-link");
  const params = new URLSearchParams(window.location.search);
  const setState = (state, heading, copy, helpCopy, icon) => {
    card.dataset.state = state;
    title.innerHTML = heading;
    message.textContent = copy;
    help.textContent = helpCopy;
    card.querySelector(".confirm-icon span").textContent = icon;
    button.hidden = state !== "success";
  };

  const config = window.TRikonicSupabaseConfig || {};
  if (!window.supabase?.createClient || !config.url || !config.publishableKey) {
    setState("error", 'We couldn’t confirm your <em>email.</em>', "This confirmation page is temporarily unavailable. Please return to Trikonic and try signing in.", "If you still need help, contact Trikonic Imports using the details on the store.", "!");
    return;
  }

  const client = window.supabase.createClient(config.url, config.publishableKey);
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const authError = params.get("error_description") || params.get("error");

  if (authError) {
    setState("error", 'This link needs a <em>fresh start.</em>', "We couldn’t use this confirmation link. It may have expired or already been used.", "Return to Trikonic, sign in if your account is active, or create a new account to request another confirmation email.", "!");
    return;
  }
  if (!tokenHash || type !== "email") {
    setState("error", 'This link looks <em>incomplete.</em>', "Open the confirmation button from the email Trikonic Imports sent you.", "For your security, confirmation links can only be used once.", "!");
    return;
  }

  client.auth.verifyOtp({ token_hash: tokenHash, type: "email" }).then(({ data, error }) => {
    if (error || !data?.user) {
      setState("error", 'This link needs a <em>fresh start.</em>', "We couldn’t use this confirmation link. It may have expired or already been used.", "Return to Trikonic, sign in if your account is active, or create a new account to request another confirmation email.", "!");
      return;
    }
    history.replaceState(null, "", window.location.pathname);
    setState("success", 'Your email is <em>confirmed.</em>', "Your Trikonic account is ready. You can now sign in and keep track of your order requests.", "You’re on the official Trikonic Imports site. We’ll never ask you to send us your password.", "✓");
  }).catch(() => {
    setState("error", 'This link needs a <em>fresh start.</em>', "We couldn’t use this confirmation link. It may have expired or already been used.", "Return to Trikonic, sign in if your account is active, or create a new account to request another confirmation email.", "!");
  });
})();
