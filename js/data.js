// Unwrap website — data access for the signed-in pages.
//
// Every page reads its data through one of these functions, never from
// the Supabase client directly. That keeps the gate in one place:
//
//   Today (soft gate): the pages check tier with get-tier and the browser
//   reads myo_cards / recipes straight from the database, which has a public
//   read policy — the same exposure the app has for free users.
//
//   Later (hard gate): swap the body of fetchMyoCards / fetchRecipes for a
//   call to an edge function that verifies the subscription server-side and
//   returns the rows, then drop the public read policy. No page changes.

(function () {
  const A = window.unwrapAuth;
  const sb = A && A.sb;

  // Friendly names for the category_path L1 keys.
  const L1_LABELS = {
    bread_bakery: "Bread & bakery",
    sauces_condiments: "Sauces & condiments",
    dairy_desserts: "Dairy & desserts",
    crisps: "Crisps",
    drinks: "Drinks",
    spreads: "Spreads",
    biscuits: "Biscuits",
    snacks: "Snacks",
    fruit_vegetables: "Fruit & veg",
    breakfast_cereal: "Breakfast cereal",
    confectionery: "Confectionery",
    grains_rice_pasta: "Grains, rice & pasta",
    meat_poultry: "Meat & poultry",
    soup: "Soup",
    fish_seafood: "Fish & seafood",
    home_baking: "Home baking",
    ready_meals: "Ready meals",
    herbs_spices_seasoning: "Herbs, spices & seasoning",
    pizza: "Pizza",
  };
  function l1Label(key) {
    if (L1_LABELS[key]) return L1_LABELS[key];
    return (key || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  }

  // All live Make Your Own cards. One row per card: the same card is stored
  // once per category it belongs to, so cards sharing a title are folded
  // into one with a list of every category path it appears on.
  async function fetchMyoCards() {
    if (!sb) throw new Error("Not connected");
    const { data, error } = await sb
      .from("myo_cards")
      .select("id, category_path, title, subtitle, description, why_it_helps, ingredients, instructions, time_minutes, cost_band, difficulty, tips, tags, display_order")
      .eq("is_active", true)
      .order("title");
    if (error) throw error;

    const byTitle = new Map();
    for (const row of data || []) {
      const key = row.title.trim().toLowerCase();
      const existing = byTitle.get(key);
      if (existing) {
        existing.paths.push(row.category_path);
        existing.ids.push(row.id);
        continue;
      }
      byTitle.set(key, Object.assign({}, row, { paths: [row.category_path], ids: [row.id] }));
    }
    const cards = Array.from(byTitle.values());
    for (const c of cards) {
      c.l1s = Array.from(new Set(c.paths.map((p) => p.split("/")[0])));
      c.keywords = (c.tags || []).filter((t) => t.startsWith("kw:")).map((t) => t.slice(3));
      c.plainTags = (c.tags || []).filter((t) => !t.startsWith("kw:") && t !== "myo");
    }
    cards.sort((a, b) => a.title.localeCompare(b.title));
    return cards;
  }

  // All live recipes with their ingredients and steps. An ingredient may
  // point at a MYO card (myo_card_id) — the page links those to /myo.html.
  async function fetchRecipes() {
    if (!sb) throw new Error("Not connected");
    const { data, error } = await sb
      .from("recipes")
      .select("id, title, subtitle, intro_text, time_minutes, cost_band, difficulty, tags, recipe_ingredients(ingredient_name, quantity, position, myo_card_id), recipe_steps(step_number, instruction)")
      .eq("is_active", true)
      .order("title");
    if (error) throw error;
    const recipes = (data || []).map((r) => ({
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      intro: r.intro_text,
      time_minutes: r.time_minutes,
      cost_band: r.cost_band,
      difficulty: r.difficulty,
      tags: (r.tags || []).filter((t) => t !== "povo_food"),
      ingredients: (r.recipe_ingredients || []).slice().sort((a, b) => a.position - b.position),
      steps: (r.recipe_steps || []).slice().sort((a, b) => a.step_number - b.step_number).map((s) => s.instruction),
    }));
    return recipes;
  }

  // ── Scan history & product lookup (signed-in, any tier) ──────────────────

  // The signed-in user's scans, newest first, with the product's name and
  // score. RLS limits product_history to the user's own rows.
  async function fetchHistory(limit) {
    if (!sb) throw new Error("Not connected");
    const { data, error } = await sb
      .from("product_history")
      .select("id, barcode, scanned_at")
      .order("scanned_at", { ascending: false })
      .limit(limit || 200);
    if (error) throw error;
    const rows = data || [];

    // The app records the barcode, not the product id, so look the
    // products up by barcode in batches.
    const byBarcode = new Map();
    const codes = Array.from(new Set(rows.map((r) => r.barcode).filter(Boolean)));
    for (let i = 0; i < codes.length; i += 100) {
      const { data: prods, error: pe } = await sb
        .from("products")
        .select("barcode, name, brand, score, nova_group, score_suppressed, category_l1")
        .in("barcode", codes.slice(i, i + 100))
        .eq("is_deleted", false);
      if (pe) throw pe;
      for (const p of prods || []) if (!byBarcode.has(p.barcode)) byBarcode.set(p.barcode, p);
    }

    return rows.map((h) => {
      const p = byBarcode.get(h.barcode);
      return {
        id: h.id,
        barcode: h.barcode,
        scanned_at: h.scanned_at,
        name: p ? p.name : null,
        brand: p ? p.brand : null,
        score: p && !p.score_suppressed ? p.score : null,
        nova_group: p ? p.nova_group : null,
        category_l1: p ? p.category_l1 : null,
      };
    });
  }

  // Name search over the catalogue. Plain ilike — simple on purpose.
  async function searchProducts(term, limit) {
    if (!sb) throw new Error("Not connected");
    const t = String(term || "").trim();
    if (!t) return [];
    const words = t.split(/\s+/).filter(Boolean).slice(0, 4);
    let q = sb.from("products").select("barcode, name, brand, score, nova_group, score_suppressed, category_l1")
      .eq("is_deleted", false)
      .order("score", { ascending: true, nullsFirst: false })
      .limit(limit || 25);
    for (const w of words) q = q.ilike("name", "%" + w.replace(/[%_]/g, "") + "%");
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  // The score with the ingredients behind it (get_product_detail RPC —
  // signed-in only) and the same swaps as the app (get_swap_bundle).
  async function fetchProduct(barcode) {
    if (!sb) throw new Error("Not connected");
    const bc = String(barcode || "").replace(/\D/g, "");
    if (!bc) return null;
    const [d, s] = await Promise.all([
      sb.rpc("get_product_detail", { p_barcode: bc }),
      sb.rpc("get_swap_bundle", { p_barcode: bc }),
    ]);
    if (d.error) throw d.error;
    if (!d.data) return null;
    return Object.assign({}, d.data, { bundle: s.error ? null : s.data });
  }

  // Colour for a 1.0–10.0 score: the app's continuous gradient, green → amber → red.
  function scoreColour(score) {
    if (score == null) return "#9B9384";
    const t = Math.min(1, Math.max(0, (Number(score) - 1) / 9));
    const stops = [[45, 95, 62], [124, 179, 66], [229, 162, 48], [212, 101, 75]];
    const seg = Math.min(2, Math.floor(t * 3)), f = t * 3 - seg;
    const c = stops[seg].map((v, i) => Math.round(v + (stops[seg + 1][i] - v) * f));
    return "rgb(" + c.join(",") + ")";
  }

  window.unwrapData = { fetchMyoCards, fetchRecipes, fetchHistory, searchProducts, fetchProduct, scoreColour, l1Label };
})();
