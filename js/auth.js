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
    const setOpen = (open) => {
      nav.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
    };
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(!nav.classList.contains("is-open"));
    });
    nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
    // Close on a tap outside the panel, or Escape (focus goes back to the burger).
    document.addEventListener("click", (e) => {
      if (nav.classList.contains("is-open") && !nav.contains(e.target)) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && nav.classList.contains("is-open")) { setOpen(false); toggle.focus(); }
    });
  }

  // Hero videos: respect "reduce motion" by holding on the poster frame.
  function calmHeroVideos() {
    if (!window.matchMedia || !matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.querySelectorAll("video.hero-video").forEach((v) => { v.removeAttribute("autoplay"); v.pause(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", calmHeroVideos);
  else calmHeroVideos();

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

  // True when this browser holds a saved sign-in. A hint for the first paint
  // only: every real decision still goes through getSession().
  function maybeSignedIn() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        if (/^sb-.+-auth-token$/.test(localStorage.key(i))) return true;
      }
    } catch (e) { /* storage blocked: treat as signed out */ }
    return false;
  }

  // Membership, remembered for this browser tab so each page doesn't wait on
  // the get-tier function again: 10 minutes for a Supporter, 1 minute otherwise
  // (so a new membership shows up quickly). Only confirmed answers are kept.
  const TIER_KEY = "unwrap.tier";
  function peekTier(uid) {
    try {
      const c = JSON.parse(sessionStorage.getItem(TIER_KEY) || "null");
      if (c && (!uid || c.uid === uid) && Date.now() < c.until) return c.tier;
    } catch (e) { /* ignore */ }
    return null;
  }
  async function getTierCached(session) {
    const uid = session.user.id;
    const hit = peekTier(uid);
    if (hit) return hit;
    const t = await getTier(session);
    if (t && t.verified) {
      try {
        sessionStorage.setItem(TIER_KEY, JSON.stringify({ uid, tier: t, until: Date.now() + (t.tier === "subscriber" ? 10 : 1) * 60000 }));
      } catch (e) { /* ignore */ }
    }
    return t;
  }
  function forgetCached() {
    try {
      Object.keys(sessionStorage).filter((k) => k.startsWith("unwrap.")).forEach((k) => sessionStorage.removeItem(k));
    } catch (e) { /* ignore */ }
  }

  async function signOut() {
    forgetCached();
    // This browser only: Supabase's default ends every session, which signed
    // people out of the app on their phone too (found 4 Nov 2026).
    await sb.auth.signOut({ scope: "local" });
    location.href = "/";
  }

  // Safe "next" target: same-site paths only.
  function nextPath(fallback) {
    const n = new URLSearchParams(location.search).get("next") || "";
    return n.startsWith("/") && !n.startsWith("//") ? n : (fallback || "/account.html");
  }

  // ── Where an account was made ─────────────────────────────────────────────
  // Accounts made on the website carry signup_source: "web" in their user
  // metadata, so the admin Numbers tab can count them apart from app sign-ups.
  // Email sign-ups set it in signUp() (login.html). Google and Apple set it
  // here, on the first sign-in, while the account is only minutes old; an
  // older account signing in here for the first time was made in the app.
  async function tagWebSignup() {
    if (!sb) return;
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user || (user.user_metadata || {}).signup_source) return;
      if (Date.now() - new Date(user.created_at).getTime() > 15 * 60000) return;
      await sb.auth.updateUser({ data: { signup_source: "web" } });
    } catch (e) { /* counting only: never block sign-in */ }
  }

  // ── A gentle word about the app, once ─────────────────────────────────────
  // For accounts made on the website (teachers downloading packs, mostly).
  // Shown once per account, on whichever page gets there first: it is marked
  // seen (in the account's metadata, so every device agrees) as soon as it shows.
  async function appNudge(after) {
    if (!sb || !after || document.getElementById("app-nudge")) return;
    let user;
    try { ({ data: { user } } = await sb.auth.getUser()); } catch (e) { return; }
    const m = (user && user.user_metadata) || {};
    if (m.signup_source !== "web" || m.app_nudge_seen) return;
    const S = window.UNWRAP_STORE || {};
    const box = document.createElement("aside");
    box.className = "app-nudge"; box.id = "app-nudge";
    box.setAttribute("aria-label", "The Unwrap app");
    box.innerHTML =
      '<button type="button" class="app-nudge-x" aria-label="Close">×</button>' +
      '<img src="/assets/images/logo.png" alt="" width="40" height="40" class="app-nudge-mark">' +
      '<div class="app-nudge-body">' +
        '<h3>Your account works in the app too</h3>' +
        '<p>Scan a barcode in the shop and Unwrap shows how processed it is, what each ingredient is in plain English, and simpler swaps. Free to download.</p>' +
        '<div class="app-nudge-actions">' +
          '<a class="btn btn-primary" data-store="ios" href="' + (S.ios || "/app.html") + '" target="_blank" rel="noopener">iPhone</a>' +
          '<a class="btn btn-outline" data-store="android" href="' + (S.android || "/app.html") + '" target="_blank" rel="noopener">Android</a>' +
          '<button type="button" class="link-btn app-nudge-later">Not now</button>' +
        '</div>' +
      '</div>';
    const close = () => box.remove();
    box.querySelector(".app-nudge-x").addEventListener("click", close);
    box.querySelector(".app-nudge-later").addEventListener("click", close);
    after.insertAdjacentElement("afterend", box);
    sb.auth.updateUser({ data: { app_nudge_seen: new Date().toISOString() } }).catch(() => {});
  }

  window.unwrapAuth = { sb, $, getSession, requireAuth, getTier, getTierCached, peekTier, maybeSignedIn, signOut, nextPath, paintNav, tagWebSignup, appNudge };

  document.addEventListener("DOMContentLoaded", async () => {
    wireMenuToggle();
    if (maybeSignedIn()) paintNav({});   // show "Account" straight away; corrected below if the sign-in has lapsed
    paintNav(await getSession());
    if (sb) sb.auth.onAuthStateChange((_event, session) => paintNav(session));
  });
})();
