// Unwrap website — shared sign-in.
//
// One Supabase client for every public page. The same accounts as the app:
// anyone who has an Unwrap account can sign in here. Nothing is gated yet;
// this file gives each page the header nav's Sign in / Account link and
// the helpers the gated pages will use (requireAuth, getTier).
//
// The publishable key is safe in a browser: it can only do what the
// database's row-level security allows for the signed-in user.

(function () {
  const SUPABASE_URL = "https://gmxcsjdyzbuucfapjfbr.supabase.co";
  const SUPABASE_KEY = "sb_publishable_OhskKXj-g5xXgx7Xf8UdtA_dBPBgkW9";

  // If the supabase-js script failed to load, the site still works read-only:
  // the menu toggles and the account link just points at Sign in.
  const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

  const $ = (id) => document.getElementById(id);

  // ── Header nav ────────────────────────────────────────────────────────────
  function paintNav(session) {
    const link = document.querySelector(".nav-account");
    if (!link) return;
    if (session) {
      link.textContent = "Account";
      link.href = "/account.html";
      link.classList.add("is-signed-in");
    } else {
      link.textContent = "Sign in";
      const here = location.pathname + location.search;
      link.href = "/login.html" + (here && here !== "/" && !here.startsWith("/login") ? "?next=" + encodeURIComponent(here) : "");
      link.classList.remove("is-signed-in");
    }
  }

  function wireMenuToggle() {
    const toggle = document.querySelector(".menu-toggle");
    const nav = document.querySelector(".nav");
    if (!toggle || !nav) return;
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    }));
  }

  // ── Helpers for pages ─────────────────────────────────────────────────────
  async function getSession() {
    if (!sb) return null;
    const { data: { session } } = await sb.auth.getSession();
    return session;
  }

  // Gated pages call this first. Sends people to sign in and back again.
  async function requireAuth() {
    const session = await getSession();
    if (session) return session;
    location.replace("/login.html?next=" + encodeURIComponent(location.pathname + location.search));
    return null;
  }

  // Asks the get-tier edge function whether this account is a Supporter.
  // Returns { tier: 'user' | 'subscriber', verified, expires_at }.
  async function getTier(session) {
    try {
      const res = await fetch(SUPABASE_URL + "/functions/v1/get-tier", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + session.access_token,
          apikey: SUPABASE_KEY,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { tier: "user", verified: false, error: body.error || ("HTTP " + res.status) };
      return body;
    } catch (e) {
      return { tier: "user", verified: false, error: String(e) };
    }
  }

  async function signOut() {
    await sb.auth.signOut();
    location.href = "/";
  }

  // Safe "next" target: same-site paths only.
  function nextPath(fallback) {
    const n = new URLSearchParams(location.search).get("next") || "";
    return n.startsWith("/") && !n.startsWith("//") ? n : (fallback || "/account.html");
  }

  window.unwrapAuth = { sb, $, getSession, requireAuth, getTier, signOut, nextPath, paintNav };

  document.addEventListener("DOMContentLoaded", async () => {
    wireMenuToggle();
    paintNav(await getSession());
    if (sb) sb.auth.onAuthStateChange((_event, session) => paintNav(session));
  });
})();
