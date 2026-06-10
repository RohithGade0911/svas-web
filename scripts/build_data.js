// Bundles the Svas food database into a static data.js for the website.
// v2: household portions + plate roles + ingredient substitution groups +
// per-100g ingredient macros (so the browser can recompute when an ingredient is swapped).
//   node scripts/build_data.js   ->  ../data.js
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
const recipes   = parseCSV(path.join(DB,'layer2-recipes/dish_recipes.csv'));
const dingr     = parseCSV(path.join(DB,'layer2-recipes/dish_ingredients.csv'));
const dsteps    = parseCSV(path.join(DB,'layer2-recipes/dish_steps.csv'));
const portions  = parseCSV(path.join(DB,'layer2-recipes/dish_portions.csv'));
const ingMaster = parseCSV(path.join(DB,'layer1-ingredients/ingredients.csv'));
const subsRows  = parseCSV(path.join(DB,'layer2-recipes/ingredient_substitutions.csv'));

// per-100g ingredient macro table (browser recomputes dish macros on swap from this)
const ingredients = {};
ingMaster.forEach(i => ingredients[i.ingredient_id] = {
  name: i.display_name, kcal: NUM(i.kcal_per_100g), p: NUM(i.protein_g), f: NUM(i.fat_g),
  c: NUM(i.carb_g), fib: NUM(i.fiber_g), na: NUM(i.sodium_mg)
});
const ingName = id => (ingredients[id] ? ingredients[id].name : id);

const recipeBy = {}; recipes.forEach(r => recipeBy[r.dish_id] = r);
const portBy   = {}; portions.forEach(p => portBy[p.dish_id] = p);
const ingrBy = {}; dingr.forEach(r => (ingrBy[r.dish_id]=ingrBy[r.dish_id]||[]).push({ id:r.ingredient_id, name: ingName(r.ingredient_id), g: NUM(r.grams) }));
const stepsBy = {}; dsteps.forEach(r => (stepsBy[r.dish_id]=stepsBy[r.dish_id]||[]).push({ n:NUM(r.step_no), t:r.text }));
for (const k in stepsBy) stepsBy[k].sort((a,b)=>a.n-b.n);

const subs = {}; subsRows.forEach(s => subs[s.group] = s.members_healthiest_first.split(';').map(x=>x.trim()).filter(Boolean));

const dishes = catalogue.map(d => {
  const r = recipeBy[d.dish_id] || {}, p = portBy[d.dish_id] || {};
  return {
    id:d.dish_id, name:d.display_name, native:d.native_name, cuisine:d.cuisine, region:d.sub_region,
    meal:d.meal_type, diet:d.diet_type, budget:d.budget_tier, health:d.health_tags, source:d.recipe_source,
    servings:NUM(r.servings), cooked_g:NUM(r.cooked_g), prep_min:NUM(r.prep_min), cook_min:NUM(r.cook_min),
    unit:p.unit||'katori', gpu:NUM(p.grams_per_unit)||130, defU:NUM(p.default_units)||1,
    minU:NUM(p.min_units)||0.5, maxU:NUM(p.max_units)||2, role:p.plate_role||'sabzi',
    ingredients: ingrBy[d.dish_id] || [], steps: (stepsBy[d.dish_id]||[]).map(s=>s.t),
  };
});

// allergen map bundled from the canonical source so app.js never carries its own copy
const allergenMap = JSON.parse(fs.readFileSync(path.join(DB, 'layer1-ingredients/allergen_map.json'), 'utf8'));
const out = 'window.SVAS_DATA = ' + JSON.stringify({ count:dishes.length, ingredients, subs, allergenMap, dishes }, null, 0) + ';\n';
fs.writeFileSync(path.join(__dirname, '../data.js'), out);
console.log(`Wrote data.js: ${dishes.length} dishes, ${Object.keys(ingredients).length} ingredients, ${Object.keys(subs).length} sub-groups (${(out.length/1024).toFixed(0)} KB).`);
