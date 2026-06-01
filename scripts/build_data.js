// Bundles the Svas food database (CSV) into a single static data.js for the website.
// Run locally:  node scripts/build_data.js   ->  writes ../data.js
// The browser then has the whole dataset offline — no server needed (GitHub Pages friendly).
const fs = require('fs');
const path = require('path');

const DB = path.join(__dirname, '../../food-database');

function parseCSV(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  const lines = text.split('\n').filter(l => l.length);
  const split = line => { const o=[]; let c='',q=false;
    for (let i=0;i<line.length;i++){const ch=line[i];
      if(q){ if(ch==='"'&&line[i+1]==='"'){c+='"';i++;} else if(ch==='"')q=false; else c+=ch; }
      else { if(ch==='"')q=true; else if(ch===',') {o.push(c);c='';} else c+=ch; } }
    o.push(c); return o; };
  const h=split(lines[0]);
  return lines.slice(1).map(l=>{const c=split(l);const r={};h.forEach((x,i)=>r[x]=c[i]);return r;});
}
const NUM = v => { const n=parseFloat(v); return isNaN(n)?0:+n; };

const catalogue = parseCSV(path.join(DB,'dishes_mvp.csv'));
const macros    = parseCSV(path.join(DB,'layer3-dishes/dish_macros.csv'));
const recipes   = parseCSV(path.join(DB,'layer2-recipes/dish_recipes.csv'));
const dingr     = parseCSV(path.join(DB,'layer2-recipes/dish_ingredients.csv'));
const dsteps    = parseCSV(path.join(DB,'layer2-recipes/dish_steps.csv'));
const ingMaster = parseCSV(path.join(DB,'layer1-ingredients/ingredients.csv'));

const ingName = {}; ingMaster.forEach(i => ingName[i.ingredient_id] = i.display_name);
const macroBy = {}; macros.forEach(m => macroBy[m.dish_id] = m);
const recipeBy = {}; recipes.forEach(r => recipeBy[r.dish_id] = r);
const ingrBy = {}; dingr.forEach(r => (ingrBy[r.dish_id]=ingrBy[r.dish_id]||[]).push({name: ingName[r.ingredient_id]||r.ingredient_id, grams: NUM(r.grams)}));
const stepsBy = {}; dsteps.forEach(r => (stepsBy[r.dish_id]=stepsBy[r.dish_id]||[]).push({n: NUM(r.step_no), t: r.text}));
for (const k in stepsBy) stepsBy[k].sort((a,b)=>a.n-b.n);

const dishes = catalogue.map(d => {
  const m = macroBy[d.dish_id] || {};
  const r = recipeBy[d.dish_id] || {};
  return {
    id: d.dish_id, name: d.display_name, native: d.native_name,
    cuisine: d.cuisine, region: d.sub_region, meal: d.meal_type, diet: d.diet_type,
    budget: d.budget_tier, protein_source: d.protein_source, health: d.health_tags,
    source: d.recipe_source,
    servings: NUM(r.servings), serving_g: NUM(m.serving_g), prep_min: NUM(r.prep_min), cook_min: NUM(r.cook_min),
    kcal: NUM(m.kcal), protein: NUM(m.protein_g), fat: NUM(m.fat_g), carb: NUM(m.carb_g), fiber: NUM(m.fiber_g),
    kcal100: NUM(m.kcal_100g), sodium: NUM(m.sodium_mg), potassium: NUM(m.potassium_mg),
    calcium: NUM(m.calcium_mg), iron: NUM(m.iron_mg), protein_pct: NUM(m.protein_pct_kcal),
    allergens: (m.allergens||'').split(';').map(s=>s.trim()).filter(Boolean),
    ingredients: ingrBy[d.dish_id] || [], steps: (stepsBy[d.dish_id]||[]).map(s=>s.t),
  };
});

const out = 'window.SVAS_DATA = ' + JSON.stringify({ generated: 'static', count: dishes.length, dishes }, null, 0) + ';\n';
fs.writeFileSync(path.join(__dirname, '../data.js'), out);
console.log(`Wrote data.js with ${dishes.length} dishes (${(out.length/1024).toFixed(0)} KB).`);
