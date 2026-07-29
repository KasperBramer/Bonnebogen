/* ============================================================
   BØNNEBOGEN — al logik.
   Ingen byggeproces, ingen npm. Filen kører som den er.
   ============================================================ */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_NAME, APP_TAGLINE } from './config.js';

const BUCKET = 'kaffebilleder';
const PALETTE = ['cobalt', 'jade', 'sun'];   // tildeles efter hvem der kom først

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

/* ---------------- små hjælpere ---------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const raw = s => ({ __raw: s });
const html = (parts, ...vals) => parts.reduce((out, part, i) => {
  if (i >= vals.length) return out + part;
  const v = vals[i];
  return out + part + (v && v.__raw !== undefined ? v.__raw : esc(v));
}, '');

let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

function dateLabel(iso) {
  return new Date(iso).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' });
}

function starRow(n) {
  let out = '<span class="stars" aria-label="' + n + ' ud af 5 stjerner">';
  for (let i = 1; i <= 5; i++) {
    out += `<svg viewBox="0 0 24 24" aria-hidden="true" class="${i <= n ? 'star--on' : 'star--off'}">
      <path d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5 6.1 20.6l1.2-6.5L2.5 9.5l6.6-.9z"/></svg>`;
  }
  return out + '</span>';
}

/* ---------------- tilstand ---------------- */

const state = {
  user: null,
  profiles: new Map(),   // id -> { display_name, color }
  coffees: [],
  urls: new Map(),       // image_path -> signeret url
  sort: 'new',
  newStars: 0,
  newFile: null
};

const me = () => state.profiles.get(state.user?.id);
const colorOf = id => state.profiles.get(id)?.color ?? 'cobalt';
const nameOf = id => state.profiles.get(id)?.display_name ?? 'Ukendt';

/* ============================================================
   LOGIN
   ============================================================ */

function authMessage(text, bad = false) {
  const el = $('#auth-msg');
  el.textContent = text;
  el.classList.toggle('msg--bad', bad);
}

$('#form-login').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#login-email').value.trim();
  const password = $('#login-password').value;
  if (!email || !password) {
    authMessage('Udfyld e-mail og adgangskode — eller brug login-linket nedenfor.', true);
    return;
  }
  $('#btn-login').disabled = true;
  authMessage('Logger ind …');
  const { error } = await sb.auth.signInWithPassword({ email, password });
  $('#btn-login').disabled = false;
  if (error) authMessage('Det virkede ikke: ' + error.message, true);
});

$('#btn-magic').addEventListener('click', async () => {
  const email = $('#login-email').value.trim();
  if (!email) { authMessage('Skriv din e-mail først, så sender jeg et link.', true); return; }
  authMessage('Sender link …');
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href.split('#')[0] }
  });
  authMessage(error ? 'Kunne ikke sende linket: ' + error.message : 'Linket er sendt. Tjek din indbakke.', !!error);
});

$('#btn-logout').addEventListener('click', async () => {
  await sb.auth.signOut();
});

sb.auth.onAuthStateChange((_event, session) => {
  const next = session?.user ?? null;
  const changed = next?.id !== state.user?.id;
  state.user = next;
  if (!changed) return;
  if (next) start();
  else showAuth();
});

function showAuth() {
  $('#view-app').hidden = true;
  $('#view-auth').hidden = false;
  authMessage('');
}

/* ============================================================
   OPSTART
   ============================================================ */

async function start() {
  $('#view-auth').hidden = true;
  $('#view-app').hidden = false;
  $('#brand-name').textContent = APP_NAME;
  $('#brand-tagline').textContent = APP_TAGLINE;
  document.title = APP_NAME;
  $('#feed').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  await loadProfiles();
  await loadCoffees();
}

async function loadProfiles() {
  const { data, error } = await sb.from('profiles')
    .select('id, display_name, created_at')
    .order('created_at', { ascending: true });
  if (error) { toast('Kunne ikke hente profiler.'); return; }
  state.profiles.clear();
  data.forEach((p, i) => state.profiles.set(p.id, {
    display_name: p.display_name,
    color: PALETTE[i % PALETTE.length]
  }));
}

async function loadCoffees() {
  const { data, error } = await sb.from('coffees')
    .select('id, seq, name, roaster, origin, place, brew_method, image_path, created_at, created_by, ' +
            'ratings ( id, stars, note, user_id, updated_at )')
    .order('created_at', { ascending: false });

  if (error) {
    $('#feed').innerHTML = '';
    toast('Kunne ikke hente kafferne: ' + error.message);
    return;
  }

  state.coffees = data;
  await signImages(data);
  render();
}

async function signImages(coffees) {
  const paths = coffees.map(c => c.image_path).filter(p => p && !state.urls.has(p));
  if (!paths.length) return;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(paths, 60 * 60 * 8);
  if (error || !data) return;
  data.forEach(item => { if (item.signedUrl) state.urls.set(item.path, item.signedUrl); });
}

/* ============================================================
   UDREGNINGER
   ============================================================ */

const avgOf = c => c.ratings.length
  ? c.ratings.reduce((s, r) => s + r.stars, 0) / c.ratings.length
  : null;

function gapOf(c) {
  if (c.ratings.length < 2) return null;
  const stars = c.ratings.map(r => r.stars);
  return Math.max(...stars) - Math.min(...stars);
}

const myRating = c => c.ratings.find(r => r.user_id === state.user.id) ?? null;

/* ============================================================
   RENDERING
   ============================================================ */

function render() {
  renderStats();
  renderFeed();
}

function renderStats() {
  const total = state.coffees.length;
  const cards = [`<div class="stat"><b>${total}</b><span>Kopper</span></div>`];

  for (const [id, p] of state.profiles) {
    const mine = state.coffees.flatMap(c => c.ratings).filter(r => r.user_id === id);
    const avg = mine.length ? (mine.reduce((s, r) => s + r.stars, 0) / mine.length).toFixed(1) : '–';
    cards.push(html`<div class="stat stat--${raw(p.color)}"><b>${avg}</b><span>${p.display_name}</span></div>`);
  }

  const gaps = state.coffees.map(gapOf).filter(g => g !== null);
  const agree = gaps.length ? Math.round(100 * gaps.filter(g => g <= 1).length / gaps.length) + '%' : '–';
  cards.push(`<div class="stat"><b>${agree}</b><span>Enige</span></div>`);

  $('#stats').innerHTML = cards.join('');
}

function sortedCoffees() {
  const list = [...state.coffees];
  switch (state.sort) {
    case 'best':
      return list.filter(c => c.ratings.length).sort((a, b) => avgOf(b) - avgOf(a));
    case 'split':
      return list.filter(c => gapOf(c) !== null).sort((a, b) => gapOf(b) - gapOf(a));
    case 'todo':
      return list.filter(c => !myRating(c));
    default:
      return list;
  }
}

const EMPTY_TEXT = {
  new:   ['Ingen kaffe i bogen endnu.', 'Tryk på plus-knappen og skriv den første ind.'],
  best:  ['Ingen domme afgivet endnu.', 'Giv en kaffe stjerner, så dukker den op her.'],
  split: ['I er ikke uenige om noget endnu.', 'Der skal to domme til den samme kaffe.'],
  todo:  ['Du har dømt hver eneste kop.', 'Godt gået. Tid til at brygge noget nyt.']
};

function renderFeed() {
  const list = sortedCoffees();
  const feed = $('#feed');
  const empty = $('#empty');

  if (!list.length) {
    feed.innerHTML = '';
    const [head, body] = EMPTY_TEXT[state.sort];
    empty.innerHTML = html`<b>${head}</b>${body}`;
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  feed.innerHTML = list.map(cardMarkup).join('');
  feed.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', () => openDetail(el.dataset.id));
    el.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDetail(el.dataset.id); }
    });
  });
}

function cardMarkup(c) {
  const url = c.image_path ? state.urls.get(c.image_path) : null;
  const gap = gapOf(c);
  const meta = [c.roaster, c.origin, c.brew_method, c.place].filter(Boolean).join(' · ');

  const image = raw(url
    ? html`<img src="${url}" alt="" loading="lazy">`
    : '<div class="card__img--none" style="position:absolute;inset:0">Uden billede</div>');

  const rows = [...state.profiles].map(([id, p]) => {
    const r = c.ratings.find(x => x.user_id === id);
    if (!r) {
      return html`<div class="verdict verdict--empty">
        <span class="verdict__who">${p.display_name}</span>
        <span class="verdict__note">Har ikke dømt endnu</span>
        <span class="verdict__score">–</span>
      </div>`;
    }
    return html`<div class="verdict verdict--${raw(p.color)}">
      <span class="verdict__who">${p.display_name}</span>
      <span class="verdict__note">${r.note || ''}</span>
      <span class="verdict__score">${raw(starRow(r.stars))}</span>
    </div>`;
  }).join('');

  return html`
    <article class="card" role="button" tabindex="0" data-id="${c.id}"
             aria-label="${c.name}, se detaljer">
      <div class="card__img">
        ${image}
        <span class="card__seq">#${String(c.seq).padStart(3, '0')}</span>
        ${raw(gap >= 2 ? `<span class="card__flag">Uenighed ${gap}★</span>` : '')}
      </div>
      <div class="card__text">
        <h3 class="card__name">${c.name}</h3>
        <p class="card__meta">${meta || dateLabel(c.created_at)}</p>
      </div>
      <div class="verdicts">${raw(rows)}</div>
    </article>`;
}

/* ---------------- sorteringsknapper ---------------- */

$('#sortbar').addEventListener('click', e => {
  const btn = e.target.closest('button[data-sort]');
  if (!btn) return;
  state.sort = btn.dataset.sort;
  $('#sortbar').querySelectorAll('button').forEach(b => b.classList.toggle('is-on', b === btn));
  renderFeed();
});

/* ============================================================
   STJERNEVÆLGER
   ============================================================ */

function buildStarPicker(container, value, onPick) {
  container.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(i === value));
    b.setAttribute('aria-label', i + ' stjerner');
    b.innerHTML = `<svg viewBox="0 0 24 24" class="${i <= value ? 'star--on' : 'star--off'}">
      <path d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5 6.1 20.6l1.2-6.5L2.5 9.5l6.6-.9z"/></svg>`;
    b.addEventListener('click', () => { onPick(i); buildStarPicker(container, i, onPick); });
    container.appendChild(b);
  }
}

/* ============================================================
   BILLEDBEHANDLING
   ============================================================ */

async function shrink(file, maxSide = 1600, quality = 0.82) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
  return blob ?? file;
}

/* ============================================================
   NY KAFFE
   ============================================================ */

const dlgNew = $('#dlg-new');

$('#btn-new').addEventListener('click', () => {
  $('#form-new').reset();
  state.newStars = 0;
  state.newFile = null;
  $('#photo-preview').hidden = true;
  $('#photo-preview').removeAttribute('src');
  $('#new-msg').textContent = '';
  $('#new-msg').classList.remove('msg--bad');
  buildStarPicker($('#new-stars'), 0, v => { state.newStars = v; });
  dlgNew.showModal();
});

$('#new-photo').addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (!file) return;
  state.newFile = file;
  const img = $('#photo-preview');
  img.src = URL.createObjectURL(file);
  img.hidden = false;
});

$('#form-new').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('#new-msg');
  const name = $('#new-name').value.trim();

  if (!name) { msg.textContent = 'Kaffen mangler et navn.'; msg.classList.add('msg--bad'); return; }
  if (!state.newStars) { msg.textContent = 'Vælg mellem 1 og 5 stjerner.'; msg.classList.add('msg--bad'); return; }

  msg.classList.remove('msg--bad');
  $('#btn-save').disabled = true;

  try {
    let path = null;
    if (state.newFile) {
      msg.textContent = 'Lægger billedet op …';
      const blob = await shrink(state.newFile);
      path = `${state.user.id}/${crypto.randomUUID()}.jpg`;
      const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
    }

    msg.textContent = 'Gemmer …';
    const { data: coffee, error } = await sb.from('coffees').insert({
      created_by: state.user.id,
      name,
      roaster: $('#new-roaster').value.trim() || null,
      origin: $('#new-origin').value.trim() || null,
      place: $('#new-place').value.trim() || null,
      brew_method: $('#new-method').value || null,
      image_path: path
    }).select('id').single();
    if (error) throw error;

    const rating = await sb.from('ratings').insert({
      coffee_id: coffee.id,
      user_id: state.user.id,
      stars: state.newStars,
      note: $('#new-note').value.trim() || null
    });
    if (rating.error) throw rating.error;

    dlgNew.close();
    toast('Skrevet i bogen.');
    await loadCoffees();
  } catch (err) {
    msg.textContent = 'Det gik galt: ' + (err.message || err);
    msg.classList.add('msg--bad');
  } finally {
    $('#btn-save').disabled = false;
  }
});

/* ============================================================
   DETALJE + EGEN DOM
   ============================================================ */

const dlgDetail = $('#dlg-detail');
let detailStars = 0;

function openDetail(id) {
  const c = state.coffees.find(x => x.id === id);
  if (!c) return;
  const url = c.image_path ? state.urls.get(c.image_path) : null;
  const mine = myRating(c);
  detailStars = mine?.stars ?? 0;

  const specs = [
    ['Rister', c.roaster],
    ['Oprindelse', c.origin],
    ['Metode', c.brew_method],
    ['Sted', c.place],
    ['Drukket', dateLabel(c.created_at)],
    ['Skrevet ind af', nameOf(c.created_by)]
  ].filter(([, v]) => v);

  const judges = [...state.profiles].map(([pid, p]) => {
    const r = c.ratings.find(x => x.user_id === pid);
    return html`<div class="judge judge--${raw(p.color)}">
      <span class="judge__who">${p.display_name} ${raw(r ? starRow(r.stars) : '')}</span>
      ${raw(r
        ? (r.note ? html`<p class="judge__note">${r.note}</p>` : '<p class="judge__none">Ingen ord, kun stjerner.</p>')
        : '<p class="judge__none">Har ikke dømt endnu.</p>')}
    </div>`;
  }).join('');

  $('#detail-title').textContent = '#' + String(c.seq).padStart(3, '0');
  $('#detail-body').innerHTML = html`
    ${raw(url ? html`<img class="detail__img" src="${url}" alt="${c.name}">` : '')}
    <h3 class="detail__name">${c.name}</h3>
    <dl class="spec">${raw(specs.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`).join(''))}</dl>
    ${raw(judges)}

    <div class="mine">
      <p class="eyebrow">${raw(mine ? 'Ret din dom' : 'Din dom')}</p>
      <div class="stars stars--input" id="detail-stars" role="radiogroup" aria-label="Stjerner"></div>
      <label class="field" style="margin-top:14px">
        <span>Kort note</span>
        <textarea id="detail-note" rows="3" maxlength="400">${mine?.note ?? ''}</textarea>
      </label>
      <button class="btn btn--primary" type="button" id="btn-rate" style="margin-top:14px;width:100%">
        ${raw(mine ? 'Gem ændringen' : 'Afgiv dom')}
      </button>
      <p class="msg" id="detail-msg" role="status" aria-live="polite"></p>
    </div>

    ${raw(c.created_by === state.user.id
      ? '<div class="detail__foot"><button class="btn btn--tiny btn--danger" type="button" id="btn-delete">Slet denne kaffe</button></div>'
      : '')}
  `;

  buildStarPicker($('#detail-stars'), detailStars, v => { detailStars = v; });

  $('#btn-rate').addEventListener('click', () => saveRating(c));
  $('#btn-delete')?.addEventListener('click', () => removeCoffee(c));

  dlgDetail.showModal();
  $('#detail-body').scrollTop = 0;
}

async function saveRating(c) {
  const msg = $('#detail-msg');
  if (!detailStars) {
    msg.textContent = 'Vælg mellem 1 og 5 stjerner.';
    msg.classList.add('msg--bad');
    return;
  }
  msg.classList.remove('msg--bad');
  msg.textContent = 'Gemmer …';
  $('#btn-rate').disabled = true;

  const { error } = await sb.from('ratings').upsert({
    coffee_id: c.id,
    user_id: state.user.id,
    stars: detailStars,
    note: $('#detail-note').value.trim() || null
  }, { onConflict: 'coffee_id,user_id' });

  $('#btn-rate').disabled = false;

  if (error) {
    msg.textContent = 'Kunne ikke gemme: ' + error.message;
    msg.classList.add('msg--bad');
    return;
  }
  dlgDetail.close();
  toast('Din dom er gemt.');
  await loadCoffees();
}

async function removeCoffee(c) {
  if (!confirm(`Slet "${c.name}"? Billedet og begges domme forsvinder også.`)) return;
  if (c.image_path) await sb.storage.from(BUCKET).remove([c.image_path]);
  const { error } = await sb.from('coffees').delete().eq('id', c.id);
  if (error) { toast('Kunne ikke slette: ' + error.message); return; }
  dlgDetail.close();
  toast('Slettet.');
  await loadCoffees();
}

/* ============================================================
   START
   ============================================================ */

(async () => {
  if (SUPABASE_URL.includes('DIT-PROJEKT')) {
    document.body.innerHTML =
      '<div style="max-width:34rem;margin:12vh auto;padding:0 22px;font-family:system-ui">' +
      '<h1 style="font-size:1.4rem">Bønnebogen mangler sine nøgler</h1>' +
      '<p>Åbn <code>assets/config.js</code> og indsæt din Supabase Project URL og anon-nøgle. ' +
      'Fremgangsmåden står i <code>README.md</code>.</p></div>';
    return;
  }
  const { data } = await sb.auth.getSession();
  state.user = data.session?.user ?? null;
  if (state.user) start(); else showAuth();
})();
