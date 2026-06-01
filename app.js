/* Svas review build v2 — client-side engine with household portions, combo-plates,
   dish-swap (↻) and ingredient-swap (↻ + live macro recompute). Fully offline. */
(function () {
  const D = window.SVAS_DATA || {};
  const ING = D.ingredients || {}, SUBS = D.subs || {}, DISHES = D.dishes || [];

  /* substitution reverse map */
  const GROUP_OF = {};
  Object.entries(SUBS).forEach(([g, arr]) => arr.forEach(id => { if (!(id in GROUP_OF)) GROUP_OF[id] = g; }));
  // Only auxiliary ingredients may be swapped — never a dish's defining base.
  // (e.g. green gram IS pesarattu; you can't make it from chana dal.) To change the
  // core ingredient, swap the whole DISH instead (dish-level ↻).
  const SAFE_SWAP = new Set(['cooking_oil', 'sweetener', 'milk']);
  const hasAlt = id => { const g = GROUP_OF[id]; return !!g && SAFE_SWAP.has(g) && SUBS[g].length > 1; };
  const nextAlt = id => { const g = GROUP_OF[id]; if (!g) return id; const a = SUBS[g]; return a[(a.indexOf(id) + 1) % a.length]; };

  /* allergens (derived from ingredients so swaps update them) */
  const ALLERGEN = {
    dairy:['milk_buffalo','milk_cow','low_fat_milk','paneer','khoa','curd','buttermilk','butter','ghee','cream'],
    gluten:['wheat_atta','wheat_maida','wheat_semolina_rava','broken_wheat'], peanut:['groundnut'],
    treenut:['cashew','coconut_fresh','coconut_dry'], sesame:['sesame'],
    egg:['egg_whole','egg_white','egg_yolk'], fish:['fish_rohu','fish_catla'], shellfish:['prawns'],
    soy:['soya_bean','soya_chunks','tofu'], mustard:['mustard_seeds','mustard_oil','mustard_leaves'],
  };
  const ALLERGEN_OF = {};
  Object.entries(ALLERGEN).forEach(([a, ids]) => ids.forEach(id => (ALLERGEN_OF[id] = ALLERGEN_OF[id] || []).push(a)));
  const allergensOf = ings => { const s = new Set(); ings.forEach(x => (ALLERGEN_OF[x.id] || []).forEach(a => s.add(a))); return [...s]; };

  /* region-aware native names for the shared base staples (rice/chapati/curd) */
  const LANG_OF = { 'Andhra':'te','Telangana':'te','Andhra & Telangana':'te','Tamil Nadu':'ta','Karnataka':'kn',
    'Kerala':'ml','Punjab':'pa','West Bengal':'bn','Tripura':'bn','Assam':'bn','Odisha':'or','Gujarat':'gu',
    'Maharashtra':'hi','Goa':'hi','Rajasthan':'hi','Uttar Pradesh':'hi','Kashmir':'hi','Madhya Pradesh':'hi',
    'Bihar':'hi','Jharkhand':'hi','Chhattisgarh':'hi','Haryana':'hi','Himachal Pradesh':'hi','Uttarakhand':'hi' };
  const BASE_NATIVE = {
    base_steamed_rice:{te:'అన్నం',ta:'சாதம்',kn:'ಅನ್ನ',ml:'ചോറ്',pa:'ਚੌਲ',bn:'ভাত',or:'ଭାତ',gu:'ભાત',hi:'चावल'},
    base_chapati:{te:'చపాతీ',ta:'சப்பாத்தி',kn:'ಚಪಾತಿ',ml:'ചപ്പാത്തി',pa:'ਰੋਟੀ',bn:'রুটি',or:'ରୁଟି',gu:'રોટલી',hi:'रोटी'},
    base_curd:{te:'పెరుగు',ta:'தயிர்',kn:'ಮೊಸರು',ml:'തൈര്',pa:'ਦਹੀਂ',bn:'দই',or:'ଦହି',gu:'દહીં',hi:'दही'},
  };
  function nativeOf(dish){
    if (BASE_NATIVE[dish.id]) { const lang = LANG_OF[(U && U.regions && U.regions[0]) || '']; return lang ? (BASE_NATIVE[dish.id][lang]||'') : ''; }
    return dish.native || '';
  }

  /* macro helpers */
  const cloneIngs = d => d.ingredients.map(x => ({ id: x.id, name: x.name, g: x.g }));
  function totals(ings) { let t = { kcal:0,p:0,f:0,c:0,fib:0,na:0 };
    ings.forEach(x => { const m = ING[x.id]; if (!m) return; const k = x.g/100;
      t.kcal+=k*m.kcal; t.p+=k*m.p; t.f+=k*m.f; t.c+=k*m.c; t.fib+=k*m.fib; t.na+=k*(m.na||0); }); return t; }
  function unitMacros(dish, ings, units) { const t = totals(ings); const f = dish.cooked_g ? dish.gpu*units/dish.cooked_g : 0;
    return { kcal:Math.round(t.kcal*f), p:+(t.p*f).toFixed(1), fat:+(t.f*f).toFixed(1), c:+(t.c*f).toFixed(1), fib:+(t.fib*f).toFixed(1), na:Math.round(t.na*f), grams:Math.round(dish.gpu*units) }; }
  const round5 = u => Math.round(u*2)/2;
  function unitsForKcal(dish, ings, targetKcal) { const t = totals(ings);
    const perU = dish.cooked_g ? t.kcal*dish.gpu/dish.cooked_g : 0;
    if (perU <= 0) return dish.defU; return Math.max(dish.minU, Math.min(dish.maxU, round5(targetKcal/perU) || dish.defU)); }
  function portionLabel(dish, u) { const pl = {piece:'pieces',cup:'cups',glass:'glasses',bowl:'bowls'};
    if (u === 1) return '1 ' + dish.unit; const n = Number.isInteger(u) ? u : u.toFixed(1); return n + ' ' + (pl[dish.unit] || dish.unit); }

  /* eligibility */
  const DIET = { veg:0, egg:1, 'non-veg':2 };
  const regionOk = (d,u) => d.region==='All' || d.cuisine==='Both' || u.regions.includes(d.region) ||
    (d.region==='Andhra & Telangana' && (u.regions.includes('Andhra')||u.regions.includes('Telangana')));
  const gramsOf = (d,id) => { const x = d.ingredients.find(i=>i.id===id); return x?x.g:0; };
  const hasAddedSugar = d => gramsOf(d,'sugar')>=12 || gramsOf(d,'jaggery')>=15;
  const isRefined = d => gramsOf(d,'wheat_maida')>=50;
  function eligible(d, u) {
    if (!regionOk(d,u)) return false;
    if (DIET[d.diet] > DIET[u.diet]) return false;
    // Avoid (allergies): strict exclusion (uses live ingredient list)
    if (u.allergies.some(a => allergensOf(d.ingredients).includes(a))) return false;
    // Diabetic / PCOS: no sweets or added-sugar dishes (low-GI intent)
    if ((u.conditions.includes('diabetic')||u.conditions.includes('pcos')) && (/sweet/.test(d.health) || hasAddedSugar(d))) return false;
    // BP / low-sodium: drop high-sodium dishes
    if (u.conditions.includes('bp') && unitMacros(d, d.ingredients, d.defU).na > 600) return false;
    return true;
  }
  // soft preference (higher = ranked first) — steers plans healthier for conditions/goal
  function condBonus(d, u) {
    let b = 0; const t = d.health || '';
    if (u.conditions.includes('diabetic') || u.conditions.includes('pcos')) {
      if (/diabetic-friendly|millet|high-fiber/.test(t)) b += 70;
      if (isRefined(d)) b -= 60;
    }
    if (u.conditions.includes('bp')) { const na = unitMacros(d, d.ingredients, d.defU).na; b += na<300?40 : na>450?-40:0; }
    if (u.goal==='lose' && /low-cal|light|high-fiber/.test(t)) b += 25;
    return b;
  }

  /* targets */
  const ACT = { sedentary:1.2, light:1.375, moderate:1.55, active:1.725 };
  const SLOT = { breakfast:0.25, lunch:0.35, snack:0.15, dinner:0.25 };
  function targets(u) {
    const bmr = 10*u.weight + 6.25*u.height - 5*u.age + (u.sex==='male'?5:-161);
    const tdee = bmr*ACT[u.activity];
    let kcal = tdee; if (u.goal==='lose') kcal-=500; else if (u.goal==='gain') kcal+=400;
    const lowGI = u.conditions.includes('diabetic') || u.conditions.includes('pcos');
    let perKg = u.goal==='gain'?2.0 : u.goal==='lose'?1.8 : 1.6;
    if (lowGI) perKg = Math.max(perKg, 1.6);          // protein aids satiety/insulin response
    if (u.diet==='veg') perKg = Math.min(perKg, 1.4); // realistic ceiling for veg plans
    const fatPct = lowGI ? 0.30 : 0.25;               // diabetic/PCOS: more fat, fewer carbs
    const protein = perKg*u.weight, fat = kcal*fatPct/9, carb = Math.max(0,(kcal - protein*4 - fat*9)/4);
    return { bmr:Math.round(bmr), tdee:Math.round(tdee), kcal:Math.round(kcal),
      protein:Math.round(protein), fat:Math.round(fat), carb:Math.round(carb), fatPct, lowGI };
  }
  const rng = seed => { let s=seed%2147483647; if(s<=0)s+=2147483646; return ()=>(s=s*16807%2147483647)/2147483647; };

  /* build a component: a ranked pool of dishes for a role + chosen units */
  function makeComp(u, roleFilter, slotKcal, rand, used, role) {
    let pool = DISHES.filter(d => eligible(d,u) && roleFilter(d));
    if (!pool.length) return null;
    // least-used FIRST (rotate through the whole pool before repeating), then macro-fit + jitter.
    // This maximises day-to-day variety even when a single small-pool state is selected.
    pool = pool.map(d => ({ d, key: (used[d.id]||0)*100000 + Math.abs(unitMacros(d, d.ingredients, d.defU).kcal - slotKcal) + rand()*90 - condBonus(d,u) }))
               .sort((a,b)=>a.key-b.key).map(x=>x.d);
    const dish = pool[0];
    used[dish.id] = (used[dish.id]||0)+1;
    return { role, pool, idx:0, dish, ings: cloneIngs(dish), units: unitsForKcal(dish, dish.ingredients, slotKcal), targetKcal: slotKcal };
  }

  function buildPlan(u) {
    const T = targets(u), rand = rng(u.seed || ((u.age*131 + u.weight*17 + u.height)|0) || 42), used = {}, days = [];
    const isVeg = u.diet === 'veg';
    for (let day=0; day<7; day++) {
      const slots = {};
      // breakfast & snack: single item, with fallbacks so the slot is never empty
      // (some regions have no breakfast-tagged dish -> fall back to a snack, then any complete dish)
      const bk = T.kcal*SLOT.breakfast, sn = T.kcal*SLOT.snack;
      slots.breakfast = { kind:'single', items:[
        makeComp(u, d=>d.meal==='breakfast', bk, rand, used, 'meal')
        || makeComp(u, d=>d.meal==='snack' && d.role!=='sweet', bk, rand, used, 'meal')
        || makeComp(u, d=>d.role==='complete', bk, rand, used, 'meal')
      ].filter(Boolean) };
      slots.snack = { kind:'single', items:[
        makeComp(u, d=>d.meal==='snack', sn, rand, used, 'snack')
        || makeComp(u, d=>['side','sweet','drink'].includes(d.role), sn, rand, used, 'snack')
        || makeComp(u, d=>d.role==='complete', sn, rand, used, 'snack')
      ].filter(Boolean) };
      // lunch & dinner: thali (grain + dal/main + sabzi [+curd]) OR occasional one-dish complete
      for (const slot of ['lunch','dinner']) {
        const sk = T.kcal*SLOT[slot];
        const tryComplete = () => makeComp(u, d=>(d.meal===slot)&&d.role==='complete', sk, rand, used, 'meal');
        if (rand() < 0.22) { const c = tryComplete(); if (c) { slots[slot] = { kind:'single', items:[c] }; continue; } }
        const items = [];
        const grain = makeComp(u, d=>d.role==='grain', sk*0.45, rand, used, 'grain');
        const prot  = isVeg ? makeComp(u, d=>d.role==='dal', sk*0.35, rand, used, 'dal')
                            : (makeComp(u, d=>d.role==='main', sk*0.40, rand, used, 'main') || makeComp(u, d=>d.role==='dal', sk*0.35, rand, used, 'dal'));
        const sabzi = makeComp(u, d=>d.role==='sabzi', sk*0.20, rand, used, 'sabzi');
        [grain, prot, sabzi].forEach(c => c && items.push(c));
        // can't form a real thali (e.g. an all-"complete" set like the high-protein bowls) -> serve one complete dish
        if (items.filter(c => c.role !== 'side').length < 2) {
          const c = tryComplete(); if (c) { slots[slot] = { kind:'single', items:[c] }; continue; }
        }
        if (!u.allergies.includes('dairy')) { const curd = DISHES.find(d=>d.id==='base_curd');
          if (curd && eligible(curd,u)) items.push({ role:'side', pool:[curd], idx:0, dish:curd, ings:cloneIngs(curd), units:1, targetKcal:0 }); }
        slots[slot] = items.length ? { kind:'plate', items } : { kind:'single', items:[ tryComplete() ].filter(Boolean) };
      }
      days.push({ slots });
    }
    return { T, days };
  }

  /* ---------- rendering ---------- */
  function dayTotals(day) { let t={kcal:0,p:0,c:0,f:0};
    ['breakfast','lunch','snack','dinner'].forEach(s => (day.slots[s].items||[]).forEach(c => { const m=unitMacros(c.dish,c.ings,c.units); t.kcal+=m.kcal;t.p+=m.p;t.c+=m.c;t.f+=m.fat; })); return t; }

  function compHTML(c, di, slot, ci) {
    const m = unitMacros(c.dish, c.ings, c.units);
    const swapped = c.ings.some((x,i)=>x.id!==c.dish.ingredients[i].id);
    return '<div class="comp">'+
      '<div class="cinfo">'+
        '<div class="nm">'+c.dish.name+(swapped?' <span class="edited">· edited</span>':'')+'</div>'+
        '<div class="nat">'+nativeOf(c.dish)+'</div>'+
        '<div class="por">'+portionLabel(c.dish,c.units)+' · ~'+m.grams+' g'+'</div>'+
      '</div>'+
      '<div class="cmac">~'+m.kcal+' kcal<br>'+m.p+'g P</div>'+
      '<div class="cact">'+
        (c.pool.length>1?'<button class="rf" title="Swap dish" data-a="dish" data-d="'+di+'" data-s="'+slot+'" data-c="'+ci+'">↻</button>':'')+
        '<button class="rf det" title="Ingredients / swap ingredient" data-a="detail" data-d="'+di+'" data-s="'+slot+'" data-c="'+ci+'">⋯</button>'+
      '</div></div>';
  }

  let PLAN = null, U = null;
  function renderPlan() {
    const out = document.getElementById('plan-output'); const T = PLAN.T;
    let h = '<div class="card"><h2>Your 7-day plan</h2>'+
      '<div class="target-bar"><span class="pill">🎯 '+T.kcal+' kcal/day</span><span class="pill">'+T.protein+'g protein</span><span class="pill">'+T.carb+'g carb</span><span class="pill">'+T.fat+'g fat</span></div>'+
      '<p class="muted" style="font-size:.78rem">Portions in everyday measures (pieces, cups, katori, glass). ↻ swaps the dish; ⋯ opens ingredients where you can swap an ingredient (e.g. oil → olive oil). Macros are approximate.</p>';
    PLAN.days.forEach((day, di) => {
      const t = dayTotals(day);
      h += '<div class="day"><div class="day-head">Day '+(di+1)+'<span class="totals">~'+t.kcal+' kcal · '+t.p.toFixed(0)+'g P · '+t.c.toFixed(0)+'g C · '+t.f.toFixed(0)+'g F</span></div>';
      ['breakfast','lunch','snack','dinner'].forEach(slot => {
        const sl = day.slots[slot];
        h += '<div class="slot-block"><div class="slot-label">'+slot+(sl.kind==='plate'?' · thali':'')+'</div><div class="slot-items">';
        if (sl.items.length) sl.items.forEach((c,ci)=> h += compHTML(c, di, slot, ci));
        else h += '<div class="comp muted">No matching dish — widen filters</div>';
        h += '</div></div>';
      });
      h += '</div>';
    });
    h += '</div>'; out.innerHTML = h;
    out.querySelectorAll('.rf').forEach(b => b.addEventListener('click', onPlanAction));
  }

  function onPlanAction(e) {
    const b = e.currentTarget, di=+b.dataset.d, slot=b.dataset.s, ci=+b.dataset.c;
    const c = PLAN.days[di].slots[slot].items[ci];
    if (b.dataset.a === 'dish') { c.idx = (c.idx+1)%c.pool.length; c.dish = c.pool[c.idx]; c.ings = cloneIngs(c.dish);
      c.units = c.targetKcal ? unitsForKcal(c.dish, c.dish.ingredients, c.targetKcal) : c.dish.defU; renderPlan(); }
    else openModal(c.dish, c); // ⋯ detail with ingredient swap bound to this plan component
  }

  /* ---------- modal: ingredients + ingredient-swap + recompute ---------- */
  function openModal(dish, comp) {
    const ings = comp ? comp.ings : cloneIngs(dish);   // edit comp's copy if from plan, else transient
    const units = comp ? comp.units : dish.defU;
    const box = document.getElementById('modal-box');
    const render = () => {
      const m = unitMacros(dish, ings, units), al = allergensOf(ings);
      box.innerHTML =
        '<button class="close" id="m-close">×</button>'+
        '<h3>'+dish.name+'</h3><div class="nat" style="color:#2D6A2F">'+nativeOf(dish)+'</div>'+
        '<div class="kv">'+dish.region+' · '+dish.meal+' · '+dish.diet+' · '+portionLabel(dish,units)+' (~'+m.grams+' g) · '+(dish.prep_min+dish.cook_min)+' min</div>'+
        '<div class="macro-grid"><div><b>~'+m.kcal+'</b><small>kcal</small></div><div><b>'+m.p+'g</b><small>protein</small></div>'+
          '<div><b>'+m.c+'g</b><small>carb</small></div><div><b>'+m.fat+'g</b><small>fat</small></div></div>'+
        '<div class="kv">Fiber '+m.fib+'g · Sodium '+m.na+'mg'+(al.length?' · allergens: '+al.join(', '):' · no flagged allergens')+' <span class="muted">(per '+portionLabel(dish,units)+')</span></div>'+
        '<b>Ingredients</b> <span class="muted" style="font-size:.72rem">— ↻ swaps to a healthier/alt ingredient</span>'+
        '<ul class="ing">'+ ings.map((x,i)=> '<li>'+x.name+' — '+x.g+' g'+
            (hasAlt(x.id)?' <button class="rf ing-rf" data-i="'+i+'" title="Swap ingredient">↻</button>':'')+
            (x.id!==dish.ingredients[i].id?' <span class="edited">(was '+dish.ingredients[i].name+')</span>':'')+'</li>').join('')+'</ul>'+
        '<b>Method</b><ol class="steps">'+dish.steps.map(s=>'<li>'+s+'</li>').join('')+'</ol>'+
        '<div class="kv">Source: '+dish.source+'</div>'+ reviewBoxHTML(dish.id);
      box.querySelector('#m-close').onclick = closeModal;
      box.querySelectorAll('.ing-rf').forEach(btn => btn.addEventListener('click', () => {
        const i = +btn.dataset.i; ings[i].id = nextAlt(ings[i].id); ings[i].name = ING[ings[i].id] ? ING[ings[i].id].name : ings[i].id;
        render(); if (comp) renderPlan(); // reflect swap back into the plan
      }));
      bindReview(dish.id, box);
    };
    render();
    document.getElementById('modal').classList.remove('hidden');
  }
  function closeModal(){ document.getElementById('modal').classList.add('hidden'); }
  document.getElementById('modal').addEventListener('click', e => { if (e.target.id==='modal') closeModal(); });

  /* ---------- form ---------- */
  function readForm(form) { const fd = new FormData(form); const m = n => fd.getAll(n);
    return { sex:fd.get('sex'), age:+fd.get('age'), weight:+fd.get('weight'), height:+fd.get('height'),
      activity:fd.get('activity'), goal:fd.get('goal'), diet:fd.get('diet'),
      regions:m('region'), conditions:m('cond'), allergies:m('allergy') }; }
  let T = null;
  function calcIntake() {
    U = readForm(document.getElementById('profile-form'));
    const io = document.getElementById('intake-output');
    if (!U.regions.length) { io.innerHTML = '<div class="card empty">Please pick at least one cuisine.</div>'; document.getElementById('plan-btn').disabled = true; return; }
    T = targets(U); renderIntake(U, T);
    document.getElementById('plan-btn').disabled = false;
    document.getElementById('plan-output').innerHTML = '';
    io.scrollIntoView({ behavior:'smooth', block:'start' });
  }
  function renderIntake(u, T) {
    const goalNote = u.goal==='lose' ? '500 kcal deficit (fat loss)' : u.goal==='gain' ? '400 kcal surplus (muscle gain)' : 'maintenance';
    const pKcal=T.protein*4, cKcal=T.carb*4, fKcal=T.fat*9, tot=pKcal+cKcal+fKcal||1, pct=v=>Math.round(v/tot*100);
    const conds = u.conditions.length ? u.conditions.map(c=>({diabetic:'diabetic-friendly',pcos:'PCOS',bp:'low-sodium'}[c]||c)).join(', ') : null;
    const bar = (label,g,kcal,color)=>'<div class="mrow"><div class="mlab">'+label+'</div>'+
      '<div class="mtrack"><div class="mfill" style="width:'+pct(kcal)+'%;background:'+color+'"></div></div>'+
      '<div class="mval"><b>'+g+' g</b> · '+pct(kcal)+'%</div></div>';
    document.getElementById('intake-output').innerHTML =
      '<div class="card intake"><h2>Your daily intake</h2>'+
      '<div class="kcal-big">'+T.kcal+' <span>kcal / day</span></div>'+
      '<div class="muted" style="font-size:.8rem;margin-bottom:.9rem">BMR '+T.bmr+' · TDEE '+T.tdee+' · '+goalNote+'</div>'+
      bar('Protein',T.protein,pKcal,'#2D6A2F')+bar('Carbs',T.carb,cKcal,'#E8A020')+bar('Fat',T.fat,fKcal,'#C1440E')+
      (conds? '<div class="adj">⚖ Targets &amp; dishes adjusted for: <b>'+conds+'</b>'+(T.lowGI?' — more protein, fewer carbs':'')+'</div>':'')+
      (u.allergies.length? '<div class="adj">🚫 Avoiding: <b>'+u.allergies.join(', ')+'</b></div>':'')+
      '<p class="muted" style="font-size:.75rem;margin-top:.6rem">Approximate (Mifflin-St Jeor). Now generate a plan built to these numbers.</p></div>';
  }
  function genPlan() {
    if (!U || !T) { calcIntake(); }
    if (!U || !U.regions.length) return;
    PLAN = buildPlan(U); renderPlan();
    document.getElementById('plan-output').scrollIntoView({ behavior:'smooth', block:'start' });
  }
  document.getElementById('profile-form').addEventListener('submit', e => { e.preventDefault(); calcIntake(); });
  document.getElementById('plan-btn').addEventListener('click', genPlan);

  /* ---------- tabs ---------- */
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(x=>x.classList.remove('active'));
    t.classList.add('active'); document.getElementById('tab-'+t.dataset.tab).classList.add('active');
  }));

  /* ================= DISH DATABASE / REVIEW ================= */
  const RK = 'svas_review_v1';
  const review = JSON.parse(localStorage.getItem(RK) || '{}');
  const saveReview = () => localStorage.setItem(RK, JSON.stringify(review));
  const stat = id => (review[id] && review[id].status) || 'Pending';
  function reviewBoxHTML(id){ const r = review[id]||{status:'Pending',notes:''};
    return '<div class="review-box"><b>Dietitian review</b><div class="row" style="margin:.5rem 0">'+
      '<select id="m-status"><option'+(r.status==='Pending'?' selected':'')+'>Pending</option>'+
      '<option'+(r.status==='Approved'?' selected':'')+'>Approved</option>'+
      '<option'+(r.status==='Needs fix'?' selected':'')+'>Needs fix</option></select></div>'+
      '<textarea id="m-notes" placeholder="Notes (e.g. portion ok, swap oil, less ghee)…">'+(r.notes||'')+'</textarea>'+
      '<div class="row" style="margin-top:.5rem"><button class="btn primary" id="m-save">Save review</button></div></div>'; }
  function bindReview(id, box){ const s=box.querySelector('#m-save'); if(!s) return;
    s.onclick = () => { review[id] = { status:box.querySelector('#m-status').value, notes:box.querySelector('#m-notes').value }; saveReview(); renderList(); }; }

  const elCount = document.getElementById('db-count'); if (elCount) elCount.textContent = DISHES.length;
  function filtered() {
    const q=(document.getElementById('db-search').value||'').toLowerCase(), r=document.getElementById('f-region').value,
      me=document.getElementById('f-meal').value, di=document.getElementById('f-diet').value, st=document.getElementById('f-status').value;
    return DISHES.filter(d => (!q || d.name.toLowerCase().includes(q) || (d.native||'').includes(q)) &&
      (!r || d.region===r) && (!me || d.meal===me) && (!di || d.diet===di) && (!st || stat(d.id)===st));
  }
  function renderList() {
    const list = document.getElementById('db-list'); const ds = filtered();
    if (!ds.length) { list.innerHTML = '<div class="empty">No dishes match.</div>'; return; }
    list.innerHTML = ds.map(d => { const s=stat(d.id); const m=unitMacros(d, d.ingredients, d.defU);
      return '<div class="dish-card" data-id="'+d.id+'"><div class="nm">'+d.name+'<span class="badge b-'+s.replace(' ','')+'">'+s+'</span></div>'+
        '<div class="nat">'+(d.native||'')+'</div>'+
        '<div class="meta">'+d.region+' · '+d.meal+' · '+d.diet+' · '+portionLabel(d,d.defU)+'</div>'+
        '<div class="mac">~'+m.kcal+' kcal · '+m.p+'g P · '+m.c+'g C · '+m.fat+'g F <span class="muted">/ '+portionLabel(d,d.defU)+'</span></div>'+
        '<div class="tags">'+(d.health||'').split(';').map(t=>t.trim()).filter(Boolean).map(t=>'<span>'+t+'</span>').join('')+'</div></div>'; }).join('');
    list.querySelectorAll('.dish-card').forEach(c => c.addEventListener('click', () => { const d=DISHES.find(x=>x.id===c.dataset.id); openModal(d, null); }));
  }
  ['db-search','f-region','f-meal','f-diet','f-status'].forEach(id => { const el=document.getElementById(id); if(el) el.addEventListener('input', renderList); });
  document.getElementById('export-btn').addEventListener('click', () => {
    const esc = s => '"'+String(s==null?'':s).replace(/"/g,'""')+'"';
    const rows = [['dish_id','name','region','meal','diet','portion','kcal','protein_g','review_status','review_notes']];
    DISHES.forEach(d => { const r=review[d.id]||{}; const m=unitMacros(d,d.ingredients,d.defU);
      rows.push([d.id,d.name,d.region,d.meal,d.diet,portionLabel(d,d.defU),m.kcal,m.p,r.status||'Pending',r.notes||'']); });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map(r=>r.map(esc).join(',')).join('\n')],{type:'text/csv'}));
    a.download = 'svas_dietitian_review.csv'; a.click();
  });
  renderList();
})();
