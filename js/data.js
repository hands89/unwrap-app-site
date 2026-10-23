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

  window.unwrapData = { fetchMyoCards, fetchRecipes, l1Label };
})();
