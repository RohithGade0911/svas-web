/* Svas review build — client-side meal engine + dish database/review.
   All data is in window.SVAS_DATA (data.js). Runs fully offline (GitHub Pages friendly). */
(function () {
  const DISHES = (window.SVAS_DATA && window.SVAS_DATA.dishes) || [];

  /* ---------- tabs ---------- */
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('tab-' + t.dataset.tab).classList.add('active');
  }));

  /* ================= MEAL ENGINE ================= */
  const ACT = { sedentary:1.2, light:1.375, moderate:1.55, active:1.725 };
  const BUDGET = { low:1, medium:2, high:3 };
  const DIET = { veg:0, egg:1, 'non-veg':2 };
  const SLOT = { breakfast:0.25, lunch:0.35, snack:0.15, dinner:0.25 };

  function targets(u) {
    const bmr = 10*u.weight + 6.25*u.height - 5*u.age + (u.sex==='male'?5:-161);
    let tdee = bmr * ACT[u.activity];
    if (u.goal==='lose') tdee -= 500; else if (u.goal==='gain') tdee += 400;
    // veg plans can't realistically hit 1.8 g/kg from dal/rice — cap it (engine finding #1)
    let perKg = u.goal==='gain'?2.0 : u.goal==='lose'?1.8 : 1.6;
    if (u.diet==='veg') perKg = Math.min(perKg, 1.4);
    const protein = perKg*u.weight, fat = tdee*0.25/9, carb = (tdee - protein*4 - fat*9)/4;
    return { kcal:Math.round(tdee), protein:Math.round(protein), fat:Math.round(fat), carb:Math.round(carb) };
  }

  function eligible(m, u, slot) {
    if (m.meal !== slot) return false;
    const regionOk = u.regions.includes(m.region) ||
      (m.region==='Andhra & Telangana' && (u.regions.includes('Andhra')||u.regions.includes('Telangana')));
    if (!regionOk) return false;
    if (DIET[m.diet] > DIET[u.diet]) return false;
    if (BUDGET[m.budget] > BUDGET[u.budget]) return false;
    if (u.allergies.some(a => m.allergens.includes(a))) return false;
    if ((u.conditions.includes('diabetic')||u.conditions.includes('pcos')) && /sweet/.test(m.health)) return false;
    if (u.conditions.includes('bp') && m.sodium > 600) return false;
    return true;
  }

  function fit(m, slotKcal, slotProtein) {
    let f = Math.max(0.5, Math.min(2.5, slotKcal/(m.kcal||1)));
    const kcalErr = Math.abs(m.kcal*f - slotKcal)/slotKcal;
    const protErr = Math.abs(m.protein*f - slotProtein)/Math.max(slotProtein,1);
    return { score: kcalErr + 0.7*protErr, f };
  }

  function rng(seed){ let s=seed%2147483647; if(s<=0)s+=2147483646; return ()=>(s=s*16807%2147483647)/2147483647; }

  function buildPlan(u) {
    const T = targets(u), rand = rng(u.seed||((u.age*97+u.weight*13)|0)||42), used = {}, days = [];
    for (let d=0; d<7; d++) {
      const meals = {};
      for (const slot of ['breakfast','lunch','snack','dinner']) {
        const sk = T.kcal*SLOT[slot], sp = T.protein*SLOT[slot];
        let c = DISHES.filter(m => eligible(m,u,slot) && (used[m.id]||0)<2);
        if (!c.length) c = DISHES.filter(m => eligible(m,u,slot));
        const scored = c.map(m => ({ m, ...fit(m,sk,sp) })).sort((a,b)=>a.score-b.score).slice(0,5);
        if (!scored.length){ meals[slot]=null; continue; }
        const p = scored[Math.floor(rand()*scored.length)];
        used[p.m.id] = (used[p.m.id]||0)+1;
        meals[slot] = { m:p.m, f:p.f,
          kcal:Math.round(p.m.kcal*p.f), protein:+(p.m.protein*p.f).toFixed(0),
          fat:+(p.m.fat*p.f).toFixed(0), carb:+(p.m.carb*p.f).toFixed(0) };
      }
      const tot = ['breakfast','lunch','snack','dinner'].reduce((a,s)=>{const x=meals[s];if(x){a.kcal+=x.kcal;a.protein+=x.protein;a.fat+=x.fat;a.carb+=x.carb;}return a;},{kcal:0,protein:0,fat:0,carb:0});
      days.push({ meals, tot });
    }
    return { T, days };
  }

  function readForm(form) {
    const fd = new FormData(form);
    const multi = n => fd.getAll(n);
    return {
      sex:fd.get('sex'), age:+fd.get('age'), weight:+fd.get('weight'), height:+fd.get('height'),
      activity:fd.get('activity'), goal:fd.get('goal'), diet:fd.get('diet'), budget:fd.get('budget'),
      regions:multi('region'), conditions:multi('cond'), allergies:multi('allergy'),
    };
  }

  document.getElementById('profile-form').addEventListener('submit', e => {
    e.preventDefault();
    const u = readForm(e.target);
    const out = document.getElementById('plan-output');
    if (!u.regions.length) { out.innerHTML = '<div class="card empty">Please pick at least one cuisine.</div>'; return; }
    const { T, days } = buildPlan(u);
    const SL = ['breakfast','lunch','snack','dinner'];
    let html = '<div class="card"><h2>Your 7-day plan</h2>'+
      '<div class="target-bar"><span class="pill">🎯 '+T.kcal+' kcal/day</span><span class="pill">'+T.protein+'g protein</span><span class="pill">'+T.carb+'g carb</span><span class="pill">'+T.fat+'g fat</span></div>';
    days.forEach((day,i) => {
      html += '<div class="day"><div class="day-head">Day '+(i+1)+
        '<span class="totals">'+day.tot.kcal+' kcal · '+day.tot.protein+'g P · '+day.tot.carb+'g C · '+day.tot.fat+'g F</span></div>';
      SL.forEach(s => {
        const x = day.meals[s];
        html += '<div class="meal"><div class="slot">'+s+'</div>'+
          (x ? '<div class="dish"><div class="nm">'+x.m.name+(x.f!==1?' <span class="muted">×'+x.f.toFixed(1)+' serving</span>':'')+'</div><div class="nat">'+x.m.native+'</div></div>'+
               '<div class="mac">'+x.kcal+' kcal<br>'+x.protein+'g P</div>'
             : '<div class="dish muted">No matching dish — widen filters</div>')+
          '</div>';
      });
      html += '</div>';
    });
    html += '<p class="muted" style="font-size:.78rem">Portions auto-scaled to hit each meal\'s calorie share. Macros computed from IFCT 2017 — pending dietitian validation.</p></div>';
    out.innerHTML = html;
    out.scrollIntoView({ behavior:'smooth', block:'start' });
  });

  /* ================= DISH DATABASE / REVIEW ================= */
  const REVIEW_KEY = 'svas_review_v1';
  const review = JSON.parse(localStorage.getItem(REVIEW_KEY) || '{}');
  const saveReview = () => localStorage.setItem(REVIEW_KEY, JSON.stringify(review));
  const stat = id => (review[id] && review[id].status) || 'Pending';

  document.getElementById('db-count').textContent = DISHES.length;

  function filtered() {
    const q = document.getElementById('db-search').value.toLowerCase();
    const r = document.getElementById('f-region').value;
    const me = document.getElementById('f-meal').value;
    const di = document.getElementById('f-diet').value;
    const st = document.getElementById('f-status').value;
    return DISHES.filter(d =>
      (!q || d.name.toLowerCase().includes(q) || (d.native||'').includes(q)) &&
      (!r || d.region===r) && (!me || d.meal===me) && (!di || d.diet===di) &&
      (!st || stat(d.id)===st));
  }

  function renderList() {
    const list = document.getElementById('db-list');
    const ds = filtered();
    if (!ds.length){ list.innerHTML = '<div class="empty">No dishes match.</div>'; return; }
    list.innerHTML = ds.map(d => {
      const s = stat(d.id);
      return '<div class="dish-card" data-id="'+d.id+'">'+
        '<div class="nm">'+d.name+'<span class="badge b-'+s.replace(' ','')+'">'+s+'</span></div>'+
        '<div class="nat">'+d.native+'</div>'+
        '<div class="meta">'+d.region+' · '+d.meal+' · '+d.diet+' · ₹'+({low:1,medium:2,high:3}[d.budget])+'</div>'+
        '<div class="mac">'+d.kcal+' kcal · '+d.protein+'g P · '+d.carb+'g C · '+d.fat+'g F</div>'+
        '<div class="tags">'+d.health.split(';').map(t=>t.trim()).filter(Boolean).map(t=>'<span>'+t+'</span>').join('')+'</div>'+
        '</div>';
    }).join('');
    list.querySelectorAll('.dish-card').forEach(c => c.addEventListener('click', () => openDish(c.dataset.id)));
  }

  function openDish(id) {
    const d = DISHES.find(x => x.id===id); if (!d) return;
    const r = review[id] || { status:'Pending', notes:'' };
    const box = document.getElementById('modal-box');
    box.innerHTML =
      '<button class="close" id="m-close">×</button>'+
      '<h3>'+d.name+'</h3><div class="nat" style="color:#2D6A2F;font-family:\'Noto Sans Telugu\',\'Noto Sans Gurmukhi\',sans-serif">'+d.native+'</div>'+
      '<div class="kv">'+d.region+' · '+d.meal+' · '+d.diet+' · serves '+d.servings+' · ~'+d.serving_g+'g/serving · '+(d.prep_min+d.cook_min)+' min</div>'+
      '<div class="macro-grid">'+
        '<div><b>'+d.kcal+'</b><small>kcal</small></div><div><b>'+d.protein+'g</b><small>protein</small></div>'+
        '<div><b>'+d.carb+'g</b><small>carb</small></div><div><b>'+d.fat+'g</b><small>fat</small></div></div>'+
      '<div class="kv">Fiber '+d.fiber+'g · Sodium '+d.sodium+'mg · Calcium '+d.calcium+'mg · Iron '+d.iron+'mg · '+d.protein_pct+'% kcal from protein</div>'+
      '<div class="kv">Per 100g: '+d.kcal100+' kcal'+(d.allergens.length?' · allergens: '+d.allergens.join(', '):' · no flagged allergens')+'</div>'+
      '<b>Ingredients</b><ul class="ing">'+d.ingredients.map(i=>'<li>'+i.name+' — '+i.grams+' g</li>').join('')+'</ul>'+
      '<b>Method</b><ol class="steps">'+d.steps.map(s=>'<li>'+s+'</li>').join('')+'</ol>'+
      '<div class="kv">Source: '+d.source+'</div>'+
      '<div class="review-box"><b>Dietitian review</b>'+
        '<div class="row" style="margin:.5rem 0">'+
          '<select id="m-status"><option'+(r.status==='Pending'?' selected':'')+'>Pending</option>'+
          '<option'+(r.status==='Approved'?' selected':'')+'>Approved</option>'+
          '<option'+(r.status==='Needs fix'?' selected':'')+'>Needs fix</option></select></div>'+
        '<textarea id="m-notes" placeholder="Notes (e.g. reduce oil to 20g, portion looks high)…">'+(r.notes||'')+'</textarea>'+
        '<div class="row" style="margin-top:.5rem"><button class="btn primary" id="m-save">Save review</button></div>'+
      '</div>';
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('m-close').onclick = closeModal;
    document.getElementById('m-save').onclick = () => {
      review[id] = { status:document.getElementById('m-status').value, notes:document.getElementById('m-notes').value };
      saveReview(); closeModal(); renderList();
    };
  }
  function closeModal(){ document.getElementById('modal').classList.add('hidden'); }
  document.getElementById('modal').addEventListener('click', e => { if (e.target.id==='modal') closeModal(); });

  ['db-search','f-region','f-meal','f-diet','f-status'].forEach(id =>
    document.getElementById(id).addEventListener('input', renderList));

  document.getElementById('export-btn').addEventListener('click', () => {
    const esc = s => '"'+String(s==null?'':s).replace(/"/g,'""')+'"';
    const rows = [['dish_id','name','region','meal','diet','kcal','protein_g','fat_g','carb_g','review_status','review_notes']];
    DISHES.forEach(d => { const r = review[d.id]||{};
      rows.push([d.id,d.name,d.region,d.meal,d.diet,d.kcal,d.protein,d.fat,d.carb,r.status||'Pending',r.notes||'']); });
    const csv = rows.map(r => r.map(esc).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download = 'svas_dietitian_review.csv'; a.click();
  });

  renderList();
})();
