// =============================================================
// Healthy & Tasty · Menú digital · un solo código React para:
//   data-mode="menu"   -> /          (carta y ticket)
//   data-mode="rapido" -> /rapido/   (cliente rápido: pide y ve el estado de su pedido)
//   data-mode="ia"     -> /ia/       (mesero virtual Gemini)
//   data-mode="admin"  -> /admin/    (panel oculto)
// =============================================================
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';
import htm from 'https://esm.sh/htm@3.1.1';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const html = htm.bind(React.createElement);

// Proyecto Supabase (la anon key es pública por diseño; los permisos los controla RLS)
const SUPABASE_URL = 'https://aswuqsenfjgwqsesethe.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzd3Vxc2VuZmpnd3FzZXNldGhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyMDI1NTQsImV4cCI6MjEwMzc3ODU1NH0.cZCMLIsLAEXwOsbXS7wpfnI7xb-kqK-sduHPjrCndbQ';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const MODE = document.documentElement.dataset.mode || 'menu';
const BASE = document.documentElement.dataset.base || './';
const ROOT_URL = new URL(BASE, location.href).href;
const params = new URLSearchParams(location.search);
const TABLE = params.get('mesa') || '';

// ---------- utilidades ----------
const money = (n) => '$' + Math.round(n || 0).toLocaleString('es-CO');
const asset = (p) => (!p ? '' : /^(https?:|data:)/.test(p) ? p : BASE + p);
const uid = () => Math.random().toString(36).slice(2, 10);
const byId = (list) => Object.fromEntries((list || []).map((x) => [x.id, x]));
const isDrinkCat = (c) => /bebida|caf[eé]/i.test(c?.name || '');
const store = {
  get(k, d = null, s = localStorage) { try { const v = s.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v, s = localStorage) { try { s.setItem(k, JSON.stringify(v)); } catch {} },
  del(k, s = localStorage) { try { s.removeItem(k); } catch {} },
};
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

// ---------- datos ----------
async function loadMenu() {
  const q = (t) => sb.from(t).select('*').order('sort', { ascending: true });
  const [r, c, p, e] = await Promise.all([q('restaurants'), q('categories'), q('products'), q('extras')]);
  for (const x of [r, c, p, e]) if (x.error) throw new Error(x.error.message);
  return { restaurants: r.data, categories: c.data, products: p.data, extras: e.data };
}
function useMenu() {
  const [menu, setMenu] = useState(() => store.get('menu-cache-ht'));
  const [error, setError] = useState(null);
  const reload = useCallback(async () => {
    try { const m = await loadMenu(); setMenu(m); store.set('menu-cache-ht', m); setError(null); }
    catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { menu, error, reload };
}
function publicMenu(m) {
  if (!m) return m;
  const rs = m.restaurants.filter((r) => r.active !== false);
  const cs = m.categories.filter((c) => c.active !== false);
  const cids = new Set(cs.map((c) => c.id));
  return {
    restaurants: rs, categories: cs,
    products: m.products.filter((p) => p.active !== false && cids.has(p.category_id)),
    extras: m.extras.filter((e) => e.active !== false),
  };
}
function applyTheme(colors) {
  const el = document.documentElement;
  const keys = ['bg', 'card', 'primary', 'secondary', 'accent', 'text', 'muted', 'onPrimary'];
  keys.forEach((k) => (colors && colors[k] ? el.style.setProperty('--' + k, colors[k]) : el.style.removeProperty('--' + k)));
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = colors?.bg || '#FDF1F2';
}
// Healthy & Tasty es un solo local: su paleta se aplica a toda la app.
function useTheme(menu) {
  const c = menu?.restaurants?.[0]?.colors;
  useEffect(() => { if (c) applyTheme(c); }, [c]);
}
const imgList = (v) => (v || '').split(',').map((x) => x.trim()).filter(Boolean);
function extrasFor(product, menu) {
  return menu.extras.filter((e) => e.restaurant_id === product.restaurant_id &&
    (!e.category_ids || e.category_ids.length === 0 || e.category_ids.includes(product.category_id)));
}

// ---------- líneas de pedido ----------
function makeLine({ product, half, option, extras, qty, notes }) {
  const base = Math.max(product.price, half?.price || 0); // mitades: se cobra la más cara
  const ex = (extras || []).reduce((s, e) => s + e.price, 0);
  return {
    key: uid(), product_id: product.id, restaurant_id: product.restaurant_id,
    name: product.name, half_id: half?.id || null, half_name: half?.name || null,
    option: option || '', extras: (extras || []).map((e) => ({ id: e.id, name: e.name, price: e.price })),
    qty: qty || 1, notes: notes || '', unit: base + ex,
  };
}
const lineTitle = (l) => (l.half_name ? `Pizza mitades: ½ ${l.name.replace(/^Pizza /i, '')} + ½ ${l.half_name.replace(/^Pizza /i, '')}` : l.name);
const cartTotal = (lines) => lines.reduce((s, l) => s + l.unit * l.qty, 0);
const cartCount = (lines) => lines.reduce((s, l) => s + l.qty, 0);

function useCart() {
  const [lines, setLines] = useState(() => store.get('cart', [], sessionStorage));
  useEffect(() => { store.set('cart', lines, sessionStorage); }, [lines]);
  const add = (l) => setLines((ls) => {
    const same = ls.find((x) => x.product_id === l.product_id && x.half_id === l.half_id && x.option === l.option &&
      x.notes === l.notes && JSON.stringify(x.extras) === JSON.stringify(l.extras));
    return same ? ls.map((x) => (x === same ? { ...x, qty: x.qty + l.qty } : x)) : [...ls, l];
  });
  const setQty = (key, q) => setLines((ls) => (q <= 0 ? ls.filter((x) => x.key !== key) : ls.map((x) => (x.key === key ? { ...x, qty: q } : x))));
  return { lines, setLines, add, setQty, clear: () => setLines([]) };
}

const getCustomer = () => store.get('customer', null);
async function submitOrder({ lines, notes, source, customer, ot }) {
  const c = getCustomer() || {};
  const dom = ot?.mode === 'domicilio';
  if (ot?.mode === 'mesa' && ot.table) store.set('table', ot.table.trim(), sessionStorage);
  if (dom) store.set('customer', { ...c, phone: ot.phone, address: ot.address, lat: ot.lat ?? null, lng: ot.lng ?? null });
  // En mesa solo viajan la mesa y el nombre; los datos de contacto solo se envían en domicilios.
  const payload = { items: lines, total: cartTotal(lines), notes: notes || '', source, order_type: dom ? 'domicilio' : 'mesa',
    table_no: dom ? '' : (ot?.table || '').trim(), customer_name: customer || c.name || '',
    customer_phone: dom ? ot.phone.trim() : '', address: dom ? ot.address.trim() : '', lat: dom ? ot.lat ?? null : null, lng: dom ? ot.lng ?? null : null };
  try {
    const r = await rpc('create_order', { p_order: payload });
    return { ...payload, ...r };
  } catch (e) {
    return { ...payload, code: 'L-' + uid().slice(0, 3).toUpperCase(), created_at: new Date().toISOString(), offline: e.message };
  }
}

// ---------- componentes base ----------
function Glow({ c1, c2, inner, className = '', soft, children, style, ...rest }) {
  return html`<button className=${'glow ' + (soft ? 'soft ' : '') + className}
    style=${{ ...(c1 && { '--c1': c1 }), ...(c2 && { '--c2': c2 }), ...(inner && { '--inner': inner }), ...style }} ...${rest}>
    <div className="inner">${children}</div></button>`;
}
function Sheet({ onClose, children, style }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose?.();
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [onClose]);
  return html`<div className="overlay" onClick=${(e) => e.target === e.currentTarget && onClose?.()}>
    <div className="sheet" style=${style} role="dialog" aria-modal="true">${children}</div></div>`;
}
function Toast({ msg }) { return msg ? html`<div className="toast" role="status">${msg}</div>` : null; }
function useToast() {
  const [msg, setMsg] = useState('');
  const t = useRef();
  const show = (m) => { setMsg(m); clearTimeout(t.current); t.current = setTimeout(() => setMsg(''), 2200); };
  return [msg, show];
}
function Qty({ value, onChange, min = 1 }) {
  return html`<div className="qty"><button aria-label="Menos" onClick=${() => onChange(Math.max(min, value - 1))}>−</button>
    <span>${value}</span><button aria-label="Más" onClick=${() => onChange(value + 1)}>+</button></div>`;
}
function Switch({ on, onChange, label }) {
  return html`<button type="button" className=${'switch' + (on ? ' on' : '')} onClick=${() => onChange(!on)} aria-pressed=${on}><i></i>${label}</button>`;
}
function Loader({ error, onRetry }) {
  return html`<div className="loader"><div className="center">
    ${error ? html`<p>No pudimos cargar el menú.<br/><small className="muted">${error}</small></p>
      <button className="btn btn-primary" onClick=${onRetry}>Reintentar</button>` : html`<div className="spinner"></div>`}
  </div></div>`;
}

// ---------- Estado del pedido (seguimiento en vivo) ----------
const STEPS = [['nuevo', 'Recibido', '🧾'], ['preparando', 'Preparando', '👩‍🍳'], ['listo', 'Listo', '🛎️'], ['entregado', 'Entregado', '✅']];
const FINAL = new Set(['entregado', 'cancelado']);
const STATUS_TEXT = {
  nuevo: 'Recibimos tu pedido', preparando: 'Estamos preparando tu pedido', listo: '¡Tu pedido está listo!',
  entregado: '¡Entregado! Que lo disfrutes', cancelado: 'Este pedido fue cancelado',
};
function useOrderStatus(order, onChange) {
  const [status, setStatus] = useState(order?.status || 'nuevo');
  const cb = useRef(onChange); cb.current = onChange;
  useEffect(() => {
    if (!order?.id || order.offline) return;
    let alive = true, t;
    const tick = async () => {
      try {
        const r = await rpc('order_status', { p_id: order.id });
        if (alive && r?.status) { setStatus(r.status); cb.current?.(r.status); if (FINAL.has(r.status)) return; }
      } catch {}
      if (alive) t = setTimeout(tick, 4000);
    };
    tick();
    return () => { alive = false; clearTimeout(t); };
  }, [order?.id]);
  return status;
}
function StatusTrack({ status }) {
  if (status === 'cancelado') return html`<div className="track-big">❌ ${STATUS_TEXT.cancelado}</div>`;
  const idx = Math.max(0, STEPS.findIndex((x) => x[0] === status));
  return html`<div>
    <div className="steps">${STEPS.map(([k, label, icon], i) => html`<div key=${k} className=${'step' + (i < idx || status === 'entregado' ? ' done' : i === idx ? ' now' : '')}>
      <i>${i < idx || status === 'entregado' ? '✓' : icon}</i>${label}</div>`)}</div>
    <div className="track-big">${STATUS_TEXT[status] || ''}</div>
    ${!FINAL.has(status) && html`<div className="live-status"><span className="dot"></span><small className="muted">Se actualiza solo</small></div>`}
  </div>`;
}
function LiveStatus({ order, onChange }) {
  const status = useOrderStatus(order, onChange);
  if (order.offline) return null;
  return html`<div style=${{ margin: '12px 0 4px' }}><${StatusTrack} status=${status}/></div>`;
}

// ---------- ¿En mesa o a domicilio? ----------
const phoneOk = (p) => (p || '').replace(/\D/g, '').length >= 7;
function newOT(session) {
  const c = getCustomer() || {};
  const table = session?.table || TABLE || store.get('table', '', sessionStorage) || '';
  return { mode: table ? 'mesa' : '', table, phone: c.phone || '', address: c.address || '', lat: c.lat ?? null, lng: c.lng ?? null };
}
const otValid = (ot) => ot.mode === 'mesa' ? !!ot.table.trim() : ot.mode === 'domicilio' ? phoneOk(ot.phone) && (!!ot.address.trim() || ot.lat != null) : false;
function OrderTypeForm({ ot, setOt }) {
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState('');
  const set = (p) => setOt((o) => ({ ...o, ...p }));
  const locate = () => {
    if (!navigator.geolocation) { setErr('Tu navegador no permite obtener la ubicación. Escribe tu dirección.'); return; }
    setLocating(true); setErr('');
    navigator.geolocation.getCurrentPosition(
      (p) => { set({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }); setLocating(false); },
      (e) => { setErr(e.code === 1 ? 'Permiso de ubicación denegado. Actívalo o escribe tu dirección.' : 'No pudimos obtener tu ubicación. Escribe tu dirección.'); setLocating(false); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  };
  const pick = (mode) => { set({ mode }); if (mode === 'domicilio' && ot.lat == null && !ot.address.trim()) locate(); };
  return html`<div className="sec"><div className="sec-title">¿Dónde lo entregamos?</div>
    <div className="opt-grid">
      <button type="button" className=${'opt' + (ot.mode === 'mesa' ? ' on' : '')} onClick=${() => pick('mesa')}>🪑 En mesa</button>
      <button type="button" className=${'opt' + (ot.mode === 'domicilio' ? ' on' : '')} onClick=${() => pick('domicilio')}>🛵 A domicilio</button>
    </div>
    ${ot.mode === 'mesa' && html`<label className="lbl" style=${{ marginTop: 12 }}>Número de mesa<input className="field" inputMode="numeric" value=${ot.table} placeholder="Ej: 7" onChange=${(e) => set({ table: e.target.value })}/></label>`}
    ${ot.mode === 'domicilio' && html`<div style=${{ display: 'grid', gap: 10, marginTop: 12 }}>
      <label className="lbl">Teléfono<input className="field" type="tel" inputMode="tel" value=${ot.phone} placeholder="Ej: 3001234567" onChange=${(e) => set({ phone: e.target.value })}/></label>
      <label className="lbl">Dirección de entrega<input className="field" value=${ot.address} placeholder="Calle, número, barrio…" onChange=${(e) => set({ address: e.target.value })}/></label>
      <button type="button" className="gps-btn" onClick=${locate} disabled=${locating}>${locating ? '📡 Buscando tu ubicación…' : ot.lat != null ? '📍 Actualizar mi ubicación' : '📍 Usar mi ubicación (GPS)'}</button>
      ${ot.lat != null && html`<div className="gps-ok">✓ Ubicación guardada (${ot.lat}, ${ot.lng})</div>`}
      ${err && html`<div className="err" style=${{ marginTop: 0 }}>${err}</div>`}
    </div>`}
  </div>`;
}

// ---------- Instalar como app ----------
let deferredInstall = null;
const installSubs = new Set();
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; installSubs.forEach((f) => f()); });
addEventListener('appinstalled', () => { deferredInstall = null; installSubs.forEach((f) => f()); });
function InstallButton({ className = 'btn btn-ghost', style }) {
  const [, force] = useState(0);
  const [help, setHelp] = useState(false);
  useEffect(() => { const f = () => force((n) => n + 1); installSubs.add(f); return () => installSubs.delete(f); }, []);
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) return null;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const click = async () => {
    if (deferredInstall) { deferredInstall.prompt(); try { await deferredInstall.userChoice; } catch {} deferredInstall = null; force((n) => n + 1); }
    else setHelp(true);
  };
  return html`<span>
    <button type="button" className=${className} style=${{ padding: '10px 14px', fontSize: 14, ...style }} onClick=${click}>📲 Instalar app</button>
    ${help && html`<${Sheet} onClose=${() => setHelp(false)}>
      <div className="row between"><h2>Instalar Healthy & Tasty</h2><button className="icon-btn" onClick=${() => setHelp(false)}>✕</button></div>
      ${ios ? html`<ol style=${{ lineHeight: 1.7 }}><li>Toca el botón <b>Compartir</b> (el cuadro con la flecha ⬆️) de Safari.</li><li>Elige <b>Añadir a pantalla de inicio</b>.</li><li>Toca <b>Añadir</b>.</li></ol>`
        : html`<ol style=${{ lineHeight: 1.7 }}><li>Abre el menú del navegador (<b>⋮</b>).</li><li>Elige <b>Instalar app</b> o <b>Añadir a pantalla de inicio</b>.</li><li>Confirma con <b>Instalar</b>.</li></ol>
          <p className="muted" style=${{ fontSize: 13 }}>Si no aparece, abre esta página en Chrome o Safari (no desde otra app).</p>`}
    <//>`}
  </span>`;
}

// ---------- Datos del cliente (nombre, teléfono, dirección y GPS) ----------
function CustomerForm({ initial, showTable, table: tbl0, cta, onDone }) {
  const [name, setName] = useState(initial?.name || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  const [address, setAddress] = useState(initial?.address || '');
  const [coords, setCoords] = useState(initial?.lat != null ? { lat: initial.lat, lng: initial.lng } : null);
  const [table, setTable] = useState(tbl0 || '');
  const [locating, setLocating] = useState(false);
  const [locErr, setLocErr] = useState('');
  const locate = () => {
    if (!navigator.geolocation) { setLocErr('Tu navegador no permite obtener la ubicación. Escribe tu dirección.'); return; }
    setLocating(true); setLocErr('');
    navigator.geolocation.getCurrentPosition(
      (p) => { setCoords({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }); setLocating(false); },
      (e) => { setLocErr(e.code === 1 ? 'Permiso de ubicación denegado. Actívalo en tu navegador o escribe tu dirección.' : 'No pudimos obtener tu ubicación. Escribe tu dirección.'); setLocating(false); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  };
  const phoneOk = phone.replace(/\D/g, '').length >= 7;
  const ok = name.trim() && phoneOk;
  const go = (e) => {
    e.preventDefault();
    const c = { name: name.trim(), phone: phone.trim(), address: address.trim(), lat: coords?.lat ?? null, lng: coords?.lng ?? null };
    store.set('customer', c); store.set('cname', c.name, sessionStorage);
    onDone(c, table.trim());
  };
  return html`<form onSubmit=${go}>
    <label className="lbl">Tu nombre<input className="field" autoComplete="name" value=${name} placeholder="Ej: Laura Gómez" onChange=${(e) => setName(e.target.value)}/></label>
    <label className="lbl">Teléfono<input className="field" type="tel" inputMode="tel" autoComplete="tel" value=${phone} placeholder="Ej: 3001234567" onChange=${(e) => setPhone(e.target.value)}/></label>
    <label className="lbl">Dirección (opcional, para domicilios)<input className="field" autoComplete="street-address" value=${address} placeholder="Calle, número, barrio…" onChange=${(e) => setAddress(e.target.value)}/></label>
    <button type="button" className="gps-btn" onClick=${locate} disabled=${locating}>${locating ? '📡 Buscando tu ubicación…' : coords ? '📍 Actualizar mi ubicación' : '📍 Usar mi ubicación (GPS)'}</button>
    ${coords && html`<div className="gps-ok">✓ Ubicación guardada (${coords.lat}, ${coords.lng})</div>`}
    ${locErr && html`<div className="err" style=${{ marginTop: 0 }}>${locErr}</div>`}
    ${showTable && html`<label className="lbl">Número de mesa (opcional)<input className="field" inputMode="numeric" value=${table} placeholder="Ej: 7" onChange=${(e) => setTable(e.target.value)}/></label>`}
    <button className="btn btn-primary btn-block" disabled=${!ok}>${cta || 'Continuar →'}</button>
    ${!ok && html`<p className="hint">Falta tu nombre y un teléfono válido.</p>`}
  </form>`;
}
function CustomerGate({ rest, intro, ...p }) {
  return html`<div className="gate"><div className="gate-card">
    <img className="logo" src=${asset(rest?.logo)} alt=${rest?.name || ''}/>
    <h1>¡Bienvenido!</h1>
    <p className="muted" style=${{ margin: 0 }}>${intro}</p>
    <${CustomerForm} ...${p}/>
    <div style=${{ marginTop: 14 }}><${InstallButton}/></div>
  </div></div>`;
}

// ---------- Llamar al mesero ----------
function WaiterButton({ table, name }) {
  const [callId, setCallId] = useState(() => store.get('wcall', null, sessionStorage));
  const [thanks, setThanks] = useState(false);
  const [ask, setAsk] = useState(false);
  const [mesa, setMesa] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!callId) return;
    let alive = true, t;
    const tick = async () => {
      try {
        const r = await rpc('waiter_call_status', { p_id: callId });
        if (alive && (!r || r.attended)) {
          store.del('wcall', sessionStorage); setCallId(null); setThanks(true); setTimeout(() => alive && setThanks(false), 5000); return;
        }
      } catch {}
      if (alive) t = setTimeout(tick, 5000);
    };
    tick();
    return () => { alive = false; clearTimeout(t); };
  }, [callId]);
  const call = async (tb) => {
    setBusy(true); setErr('');
    try {
      const r = await rpc('call_waiter', { p_table: tb, p_name: name || '' });
      store.set('wcall', r.id, sessionStorage); store.set('table', tb, sessionStorage); setCallId(r.id); setAsk(false);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const click = () => { const tb = table || store.get('table', '', sessionStorage); if (tb) call(tb); else setAsk(true); };
  return html`<span>
    <button className=${'btn btn-call' + (callId ? ' waiting' : '')} disabled=${busy || !!callId} onClick=${click}>
      ${callId ? '⏳ Mesero avisado, ya viene' : thanks ? '✅ ¡Listo, el mesero fue!' : '🔔 Llamar mesero'}</button>
    ${err && !ask && html`<div className="err" style=${{ textAlign: 'center' }}>${err}</div>`}
    ${ask && html`<${Sheet} onClose=${() => setAsk(false)}>
      <div className="row between"><h2>¿En qué mesa estás?</h2><button className="icon-btn" onClick=${() => setAsk(false)}>✕</button></div>
      <label className="lbl sec">Número de mesa<input className="field" autoFocus inputMode="numeric" value=${mesa} placeholder="Ej: 7" onChange=${(e) => setMesa(e.target.value)}/></label>
      ${err && html`<div className="err">${err}</div>`}
      <button className="btn btn-primary btn-block sec" disabled=${!mesa.trim() || busy} onClick=${() => call(mesa.trim())}>${busy ? 'Llamando…' : '🔔 Llamar al mesero'}</button>
    <//>`}
  </span>`;
}

// ---------- Ticket virtual ----------
function Ticket({ order, menu, preview, onClose, onConfirm, onNew, busy, live = true }) {
  const R = byId(menu?.restaurants);
  const groups = useMemo(() => {
    const g = {};
    (order.items || []).forEach((l) => (g[l.restaurant_id] ||= []).push(l));
    return Object.entries(g);
  }, [order]);
  const date = new Date(order.created_at || Date.now());
  return html`<div className="overlay" onClick=${(e) => e.target === e.currentTarget && onClose?.()}>
    <div className="ticket-wrap">
      <div className="ticket">
        ${!preview && !order.offline && html`<div className="waiter-flag">🛎️ Tu pedido llegó a la cocina</div>`}
        ${!preview && order.offline && html`<div className="waiter-flag">🛎️ MUESTRA ESTA PANTALLA AL MESERO</div>`}
        <h3>${preview ? 'RESUMEN DE TU PEDIDO' : 'PEDIDO CONFIRMADO'}</h3>
        ${!preview && html`<div className="code">#${order.code}</div>`}
        ${!preview && live && order.id && html`<${LiveStatus} order=${order}/>`}
        <div className="t-foot">
          ${date.toLocaleDateString('es-CO')} · ${date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
          ${order.order_type === 'domicilio' ? html` · <b>🛵 Domicilio</b>` : order.table_no ? html` · <b>Mesa ${order.table_no}</b>` : ''}
          ${order.customer_name ? html` · ${order.customer_name}` : ''}
          ${order.source === 'ia' ? ' · Mesero IA' : ''}
        </div>
        ${(order.customer_phone || order.address || order.lat != null) && html`<div className="t-foot" style=${{ textAlign: 'left', marginTop: 6 }}>
          ${order.customer_phone && html`<div>📞 ${order.customer_phone}</div>`}
          ${order.address && html`<div>📍 ${order.address}</div>`}
          ${order.lat != null && html`<div><a href=${`https://www.google.com/maps?q=${order.lat},${order.lng}`} target="_blank" rel="noopener">Ver en el mapa (${order.lat}, ${order.lng})</a></div>`}
        </div>`}
        <div className="dash"></div>
        ${groups.map(([rid, ls]) => html`<div key=${rid}>
          <span className="t-rest" style=${{ background: R[rid]?.colors?.primary || '#222', color: R[rid]?.colors?.onPrimary || '#fff' }}>${R[rid]?.name || rid}</span>
          ${ls.map((l) => html`<div key=${l.key}>
            <div className="t-line"><span>${l.qty} × ${lineTitle(l)}</span><b>${money(l.unit * l.qty)}</b></div>
            ${l.option && html`<div className="t-sub">› ${l.option}</div>`}
            ${l.extras.map((e) => html`<div className="t-sub" key=${e.id}>+ ${e.name} (${money(e.price)})</div>`)}
            ${l.notes && html`<div className="t-sub">✎ ${l.notes}</div>`}
          </div>`)}
        </div>`)}
        <div className="dash"></div>
        <div className="t-total"><span>TOTAL</span><span>${money(order.total ?? cartTotal(order.items || []))}</span></div>
        ${order.notes && html`<p className="t-foot">Nota: ${order.notes}</p>`}
        ${order.offline && html`<p className="t-foot">⚠️ Sin conexión: el pedido no se guardó en el sistema, muéstralo al mesero.</p>`}
        <div className="dash"></div>
        <p className="t-foot">${preview ? 'Revisa tu pedido antes de confirmarlo' : '¡Gracias! Tu pedido fue enviado'}</p>
      </div>
      <div className="ticket-actions">
        ${preview
          ? html`<button className="btn btn-ghost grow" onClick=${onClose}>Seguir pidiendo</button>
                 <button className="btn btn-primary grow" disabled=${busy} onClick=${onConfirm}>${busy ? 'Enviando…' : 'Confirmar pedido'}</button>`
          : html`<button className="btn btn-ghost grow" onClick=${onClose}>Cerrar</button>
                 ${onNew && html`<button className="btn btn-primary grow" onClick=${onNew}>Nuevo pedido</button>`}`}
      </div>
    </div>
  </div>`;
}

// =============================================================
// MODO MENÚ (3 botones)
// =============================================================
function ProductModal({ product, menu, onClose, onAdd }) {
  const opts = product.options || [];
  const [choice, setChoice] = useState({});
  const [halfOn, setHalfOn] = useState(false);
  const [halfId, setHalfId] = useState('');
  const [sel, setSel] = useState([]);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const halves = menu.products.filter((p) => p.allow_half && p.category_id === product.category_id && p.id !== product.id);
  const half = halfOn ? halves.find((h) => h.id === halfId) : null;
  const extras = extrasFor(product, menu);
  const bordes = extras.filter((e) => e.kind === 'borde');
  const adds = extras.filter((e) => e.kind !== 'borde');
  const chosenExtras = extras.filter((e) => sel.includes(e.id));
  const missing = opts.filter((o) => !choice[o.name]);
  const ready = missing.length === 0 && (!halfOn || half);
  const line = makeLine({ product, half, option: opts.map((o) => choice[o.name] && `${o.name}: ${choice[o.name]}`).filter(Boolean).join(' · '), extras: chosenExtras, qty, notes });
  const toggle = (id, single) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : single ? [...s.filter((x) => !bordes.some((b) => b.id === x)), id] : [...s, id]));

  return html`<${Sheet} onClose=${onClose}>
    <div className="row between"><span className="tiny-badge">${menu.categories.find((c) => c.id === product.category_id)?.name}</span>
      <button className="icon-btn" aria-label="Cerrar" onClick=${onClose}>✕</button></div>
    ${product.image && html`<img src=${asset(product.image)} alt="" style=${{ borderRadius: 16, margin: '10px 0', maxHeight: 220, width: '100%', objectFit: 'cover' }}/>`}
    <h2 style=${{ marginTop: 8 }}>${product.name}</h2>
    <p className="muted" style=${{ margin: 0 }}>${product.description}</p>
    <div className="price" style=${{ marginTop: 8 }}>${money(product.price)}</div>

    ${opts.map((o) => html`<div className="sec" key=${o.name}>
      <div className="sec-title">${o.name} <span className="tiny-badge">Obligatorio</span></div>
      <div className="opt-grid">${o.choices.map((c) => html`<button key=${c} className=${'opt' + (choice[o.name] === c ? ' on' : '')}
        onClick=${() => setChoice({ ...choice, [o.name]: c })}>${c}</button>`)}</div></div>`)}

    ${product.allow_half && halves.length > 0 && html`<div className="sec half-box">
      <${Switch} on=${halfOn} onChange=${setHalfOn} label="🍕 Pedir por mitades (dos sabores)"/>
      ${halfOn && html`<div style=${{ marginTop: 12 }}>
        <div className="muted" style=${{ fontSize: 13, marginBottom: 8 }}>Elige la otra mitad. Se cobra el valor de la mitad más cara.</div>
        <div className="opt-grid">${halves.map((h) => html`<button key=${h.id} className=${'opt' + (halfId === h.id ? ' on' : '')} onClick=${() => setHalfId(h.id)}>
          ½ ${h.name.replace(/^Pizza /i, '')} <small>${money(h.price)}</small></button>`)}</div>
        ${half && html`<p style=${{ margin: '10px 0 0', fontSize: 14 }}>Valor de la pizza: <b>${money(Math.max(product.price, half.price))}</b></p>`}
      </div>`}
    </div>`}

    ${bordes.length > 0 && html`<div className="sec"><div className="sec-title">🧀 Bordes</div>
      <div className="opt-grid">${bordes.map((e) => html`<button key=${e.id} className=${'opt' + (sel.includes(e.id) ? ' on' : '')} onClick=${() => toggle(e.id, true)}>
        ${e.name} <small>+${money(e.price)}</small></button>`)}</div></div>`}
    ${adds.length > 0 && html`<div className="sec"><div className="sec-title">➕ Adicionales</div>
      <div className="opt-grid">${adds.map((e) => html`<button key=${e.id} className=${'opt' + (sel.includes(e.id) ? ' on' : '')} onClick=${() => toggle(e.id)}>
        ${e.name} <small>+${money(e.price)}</small></button>`)}</div></div>`}

    <div className="sec"><div className="sec-title">Notas para la cocina</div>
      <textarea className="field" placeholder="Ej: sin cebolla, término medio…" value=${notes} onChange=${(e) => setNotes(e.target.value)}></textarea></div>

    <div className="row sec" style=${{ position: 'sticky', bottom: -18, background: 'var(--card)', padding: '12px 0 4px' }}>
      <${Qty} value=${qty} onChange=${setQty}/>
      <button className="btn btn-primary grow" disabled=${!ready} onClick=${() => onAdd(line)}>
        ${ready ? `Agregar · ${money(line.unit * qty)}` : missing.length ? `Elige ${missing[0].name.toLowerCase()}` : 'Elige la otra mitad'}</button>
    </div>
  <//>`;
}

function CartSheet({ cart, menu, onClose, onConfirm, busy, session }) {
  const [ot, setOt] = useState(() => newOT(session));
  const [customer, setCustomer] = useState(session?.name || getCustomer()?.name || store.get('cname', '', sessionStorage));
  const [notes, setNotes] = useState('');
  const R = byId(menu.restaurants);
  const rids = [...new Set(cart.lines.map((l) => l.restaurant_id))];
  const drinkCats = menu.categories.filter((c) => isDrinkCat(c) && (rids.length === 0 || rids.includes(c.restaurant_id)));
  const drinks = menu.products.filter((p) => drinkCats.some((c) => c.id === p.category_id));
  const total = cartTotal(cart.lines);
  return html`<${Sheet} onClose=${onClose}>
    <div className="row between"><h2>Tu pedido</h2><button className="icon-btn" aria-label="Cerrar" onClick=${onClose}>✕</button></div>
    ${cart.lines.length === 0 && html`<p className="muted">Aún no has agregado productos.</p>`}
    ${cart.lines.map((l) => html`<div className="line" key=${l.key}>
      <div className="grow">
        <div style=${{ fontWeight: 600 }}>${lineTitle(l)}</div>
        <div className="meta">${R[l.restaurant_id]?.name}${l.option ? ' · ' + l.option : ''}</div>
        ${l.extras.length > 0 && html`<div className="meta">+ ${l.extras.map((e) => e.name).join(', ')}</div>`}
        ${l.notes && html`<div className="meta">✎ ${l.notes}</div>`}
        <div className="price" style=${{ fontSize: 15, marginTop: 4 }}>${money(l.unit * l.qty)}</div>
      </div>
      <${Qty} value=${l.qty} min=${0} onChange=${(q) => cart.setQty(l.key, q)}/>
    </div>`)}

    ${drinks.length > 0 && html`<div className="sec"><div className="sec-title">🥤 ¿Agregamos bebidas?</div>
      <div className="drinks">${drinks.map((d) => html`<${Glow} key=${d.id} soft className="drink" c1=${R[d.restaurant_id]?.colors?.primary} c2=${R[d.restaurant_id]?.colors?.secondary}
        onClick=${() => cart.add(makeLine({ product: d, qty: 1 }))}>
        <div style=${{ fontWeight: 600 }}>${d.name}</div>
        <div className="meta muted" style=${{ fontSize: 12 }}>${R[d.restaurant_id]?.name}</div>
        <div className="row between" style=${{ marginTop: 6 }}><span className="price" style=${{ fontSize: 14 }}>${money(d.price)}</span><b>＋</b></div>
      <//>`)}</div></div>`}

    <${OrderTypeForm} ot=${ot} setOt=${setOt}/>
    <div className="sec grid2">
      ${!session && html`<label className="lbl">Tu nombre<input className="field" value=${customer} placeholder="Opcional" onChange=${(e) => { setCustomer(e.target.value); store.set('cname', e.target.value, sessionStorage); }}/></label>`}
      <label className="lbl" style=${session ? null : { gridColumn: '1/-1' }}>Comentario general<input className="field" value=${notes} placeholder="Opcional" onChange=${(e) => setNotes(e.target.value)}/></label>
    </div>
    <div className="row between sec" style=${{ fontSize: 20, fontWeight: 800 }}><span>Total</span><span>${money(total)}</span></div>
    <button className="btn btn-primary btn-block sec" disabled=${!cart.lines.length || busy || !otValid(ot)} onClick=${() => onConfirm({ ot, notes, customer })}>
      ${busy ? 'Enviando…' : !ot.mode ? 'Elige mesa o domicilio' : !otValid(ot) ? (ot.mode === 'mesa' ? 'Indica tu número de mesa' : 'Completa teléfono y dirección') : 'Confirmar y enviar pedido'}</button>
  <//>`;
}

function CartBar({ lines, onOpen, colors }) {
  if (!lines.length) return null;
  return html`<div className="cart-bar"><${Glow} c1=${colors?.primary} c2=${colors?.secondary} onClick=${onOpen} style=${{ width: '100%' }}>
    <span className="count">${cartCount(lines)}</span><span className="grow">Ver mi pedido</span><b>${money(cartTotal(lines))}</b>
  <//></div>`;
}

function RestaurantView({ rest, menu, cart, onBack, toast, greet, waiter }) {
  const cats = menu.categories.filter((c) => c.restaurant_id === rest.id);
  const [active, setActive] = useState(cats[0]?.id);
  const [prod, setProd] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  const refs = useRef({});
  useEffect(() => { applyTheme(rest.colors); scrollTo(0, 0); }, [rest]);
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActive(e.target.dataset.id)), { rootMargin: '-30% 0px -60% 0px' });
    Object.values(refs.current).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [rest]);
  const c = rest.colors || {};
  return html`<div className="rest-view">
    <div className="wrap rest-head">
      <div className="row between">
        ${onBack ? html`<button className="icon-btn" aria-label="Volver" onClick=${onBack}>←</button>` : html`<span className="row">${TABLE ? html`<span className="badge-table">🪑 Mesa ${TABLE}</span>` : ''}<${InstallButton}/></span>`}
        <button className="btn btn-ghost" style=${{ padding: '10px 14px', fontSize: 14 }} onClick=${() => setShowMenu(true)}>📜 Carta original</button>
      </div>
      <img className="logo" src=${asset(rest.logo)} alt=${rest.name}/>
      ${greet && html`<h1 className="center" style=${{ fontFamily: 'var(--display)', fontSize: 26, margin: '4px 0' }}>${greet}</h1>`}
      <p className="center muted" style=${{ margin: 0, fontSize: 14 }}>${rest.tagline}</p>
      ${waiter && html`<div className="center" style=${{ marginTop: 12 }}><${WaiterButton} table=${waiter.table} name=${waiter.name}/></div>`}
    </div>
    <nav className="chips">${cats.map((cat) => html`<button key=${cat.id} className=${'chip' + (active === cat.id ? ' on' : '')}
      onClick=${() => refs.current[cat.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>${cat.name}</button>`)}</nav>
    <div className="wrap">
      ${cats.map((cat) => {
        const ps = menu.products.filter((p) => p.category_id === cat.id);
        if (!ps.length) return null;
        return html`<section key=${cat.id} data-id=${cat.id} ref=${(el) => (refs.current[cat.id] = el)} style=${{ scrollMarginTop: 70 }}>
          <h2 className="cat-title">${cat.name}</h2>
          ${cat.note && html`<p className="cat-note">${cat.note}</p>`}
          <div className="products">${ps.map((p) => html`<${Glow} key=${p.id} soft className="p-card" c1=${c.primary} c2=${c.secondary} onClick=${() => setProd(p)}>
            ${p.image && html`<img src=${asset(p.image)} alt="" style=${{ borderRadius: 12, height: 140, objectFit: 'cover', width: '100%' }}/>`}
            <h3>${p.name}</h3>
            ${p.description && html`<p>${p.description}</p>`}
            <div className="foot"><span className="row"><span className="price">${money(p.price)}</span>
              ${p.allow_half && html`<span className="tiny-badge">½ mitades</span>`}</span><span className="add-dot">+</span></div>
          <//>`)}</div>
        </section>`;
      })}
    </div>
    ${prod && html`<${ProductModal} product=${prod} menu=${menu} onClose=${() => setProd(null)}
      onAdd=${(l) => { cart.add(l); setProd(null); toast('✓ Agregado: ' + lineTitle(l)); }}/>`}
    ${showMenu && html`<${Sheet} onClose=${() => setShowMenu(false)}>
      <div className="row between" style=${{ marginBottom: 10 }}><h2>Carta ${rest.name}</h2><button className="icon-btn" onClick=${() => setShowMenu(false)}>✕</button></div>
      ${imgList(rest.menu_image).map((m, i) => html`<img key=${m} className="menu-img" style=${{ marginBottom: 10 }} src=${asset(m)} alt=${'Carta ' + rest.name + ' ' + (i + 1)}/>`)}
    <//>`}
  </div>`;
}

function MenuApp() {
  const { menu: raw, error, reload } = useMenu();
  const menu = useMemo(() => publicMenu(raw), [raw]);
  useTheme(menu);
  const cart = useCart();
  const [cartOpen, setCartOpen] = useState(false);
  const [order, setOrder] = useState(() => store.get('last-order', null, sessionStorage));
  const [busy, setBusy] = useState(false);
  const [msg, toast] = useToast();
  useEffect(() => { store.set('last-order', order, sessionStorage); }, [order]);
  const [cust, setCust] = useState(getCustomer);
  if (!menu) return html`<${Loader} error=${error} onRetry=${reload}/>`;
  const rest = menu.restaurants[0];
  if (!rest) return html`<${Loader} error="El menú aún no tiene datos." onRetry=${reload}/>`;

  if (!cust) return html`<${CustomerGate} rest=${rest} intro="Antes de ver la carta, cuéntanos quién eres para atenderte mejor." cta="Ver la carta →" onDone=${(c) => setCust(c)}/>`;

  const confirm = async ({ ot, notes, customer }) => {
    setBusy(true);
    const o = await submitOrder({ lines: cart.lines, ot, notes, source: 'menu', customer });
    setBusy(false); setCartOpen(false); setOrder(o); cart.clear();
  };

  return html`<div>
    <${RestaurantView} rest=${rest} menu=${menu} cart=${cart} toast=${toast} waiter=${{ table: TABLE, name: store.get('cname', '', sessionStorage) }}/>
    ${order && !cartOpen && html`<div className="quick-bar"><button onClick=${() => setOrder({ ...order, __open: true })}>🧾 Ver el estado de mi pedido #${order.code}</button></div>`}
    <${CartBar} lines=${cart.lines} colors=${rest.colors} onOpen=${() => setCartOpen(true)}/>
    ${cartOpen && html`<${CartSheet} cart=${cart} menu=${menu} busy=${busy} onClose=${() => setCartOpen(false)} onConfirm=${confirm}/>`}
    ${order && order.__open !== false && html`<${Ticket} order=${order} menu=${menu} onClose=${() => setOrder({ ...order, __open: false })} onNew=${() => setOrder(null)}/>`}
    <${Toast} msg=${msg}/>
  </div>`;
}

// =============================================================
// MODO CLIENTE RÁPIDO (/rapido/)
// El cliente entra con su nombre, pide, y ve el estado de su pedido en vivo.
// Cuando todo lo que pidió se entrega, su sesión se cierra sola.
// =============================================================
function QuickApp() {
  const { menu: raw, error, reload } = useMenu();
  const menu = useMemo(() => publicMenu(raw), [raw]);
  useTheme(menu);
  const cart = useCart();
  const [sess, setSess] = useState(() => store.get('quick', null));
  const [view, setView] = useState('track');
  const [cartOpen, setCartOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bye, setBye] = useState(null);
  const [msg, toast] = useToast();
  const keep = (sx) => { setSess(sx); if (sx) store.set('quick', sx); else store.del('quick'); };

  // sondeo del estado de cada pedido abierto
  useEffect(() => {
    if (!sess?.orders?.length) return;
    let alive = true, t;
    const tick = async () => {
      const cur = sess.orders;
      const next = await Promise.all(cur.map(async (o) => {
        if (FINAL.has(o.status)) return o;
        try { const r = await rpc('order_status', { p_id: o.id }); return r?.status ? { ...o, status: r.status } : o; } catch { return o; }
      }));
      if (!alive) return;
      if (next.some((o, i) => o.status !== cur[i].status)) { keep({ ...sess, orders: next }); return; }
      t = setTimeout(tick, 4000);
    };
    tick();
    return () => { alive = false; clearTimeout(t); };
  }, [sess]);

  // todo entregado (o cancelado): se cierra la sesión del cliente
  const allDone = !!sess?.orders?.length && sess.orders.every((o) => FINAL.has(o.status));
  useEffect(() => {
    if (!allDone) return;
    setBye({ name: sess.name, delivered: sess.orders.some((o) => o.status === 'entregado') });
    keep(null); cart.clear(); setView('track');
  }, [allDone]);

  if (!menu) return html`<${Loader} error=${error} onRetry=${reload}/>`;
  const rest = menu.restaurants[0];
  if (!rest) return html`<${Loader} error="El menú aún no tiene datos." onRetry=${reload}/>`;

  if (bye) return html`<div className="bye"><div>
    <div className="big">${bye.delivered ? '🌿' : '👋'}</div>
    <h1 style=${{ fontFamily: 'var(--display)' }}>${bye.delivered ? `¡Gracias${bye.name ? ', ' + bye.name : ''}!` : 'Pedido cancelado'}</h1>
    <p className="muted" style=${{ maxWidth: 340, margin: '0 auto 22px' }}>${bye.delivered ? 'Tu pedido fue entregado y tu sesión se cerró. ¡Vuelve pronto a Healthy & Tasty!' : 'Tu sesión se cerró. Puedes iniciar otra cuando quieras.'}</p>
    <button className="btn btn-primary" onClick=${() => setBye(null)}>Nuevo pedido</button></div></div>`;

  if (!sess) return html`<${CustomerGate} rest=${rest} showTable table=${TABLE} initial=${getCustomer()}
    intro="Dinos quién eres y pide en segundos. Verás el estado de tu pedido aquí mismo." cta="Ver la carta →"
    onDone=${(c, table) => { keep({ name: c.name, table, orders: [], started: Date.now() }); setView('menu'); }}/>`;

  const confirm = async ({ ot, notes }) => {
    setBusy(true);
    const o = await submitOrder({ lines: cart.lines, ot, notes, source: 'rapido', customer: sess.name });
    setBusy(false);
    if (o.offline) { toast('No pudimos enviar el pedido. Revisa tu conexión e intenta de nuevo.'); return; }
    keep({ ...sess, table: ot.mode === 'mesa' ? ot.table.trim() : sess.table, orders: [...sess.orders, { id: o.id, code: o.code, total: o.total, items: o.items, status: 'nuevo', created_at: o.created_at }] });
    cart.clear(); setCartOpen(false); setView('track');
  };

  const open = sess.orders.length > 0;
  if (open && view === 'track') return html`<div className="track"><div className="wrap" style=${{ maxWidth: 560 }}>
    <div className="center"><img src=${asset(rest.logo)} alt="" style=${{ width: 90, height: 90, margin: '0 auto', objectFit: 'contain' }}/>
      <h1 style=${{ fontFamily: 'var(--display)', margin: '4px 0 0', fontSize: 28 }}>Hola${sess.name ? ', ' + sess.name : ''} 👋</h1>
      ${sess.table && html`<span className="badge-table" style=${{ marginTop: 6 }}>🪑 Mesa ${sess.table}</span>`}</div>
    ${sess.orders.map((o) => html`<div className="track-card" key=${o.id}>
      <div className="row between"><b>Pedido #${o.code}</b><b>${money(o.total)}</b></div>
      <div className="muted" style=${{ fontSize: 13 }}>${(o.items || []).map((l) => l.qty + '× ' + lineTitle(l)).join(' · ')}</div>
      <${StatusTrack} status=${o.status}/>
    </div>`)}
    <div className="row" style=${{ marginTop: 18 }}>
      <button className="btn btn-ghost grow" onClick=${() => setView('menu')}>➕ Pedir algo más</button></div>
    <div className="center" style=${{ marginTop: 12 }}><${WaiterButton} table=${sess.table} name=${sess.name}/></div>
    <p className="center muted" style=${{ fontSize: 13, marginTop: 14 }}>Cuando todo esté entregado, esta sesión se cierra sola.</p>
  </div></div>`;

  return html`<div>
    <${RestaurantView} rest=${rest} menu=${menu} cart=${cart} toast=${toast} greet=${`Hola, ${sess.name}`} waiter=${{ table: sess.table, name: sess.name }}/>
    ${open && !cartOpen && html`<div className="quick-bar"><button onClick=${() => setView('track')}>🧾 Ver el estado de mi pedido</button></div>`}
    <${CartBar} lines=${cart.lines} colors=${rest.colors} onOpen=${() => setCartOpen(true)}/>
    ${cartOpen && html`<${CartSheet} cart=${cart} menu=${menu} busy=${busy} session=${sess} onClose=${() => setCartOpen(false)} onConfirm=${confirm}/>`}
    <${Toast} msg=${msg}/>
  </div>`;
}

// =============================================================
// MODO MESERO IA (Gemini)
// =============================================================
const QUICK = ['☕ Un café', '🥪 Un sándwich', '🍰 Algo dulce', '🍵 Algo con matcha', '🥗 Algo liviano', '✨ ¿Qué me recomiendas?'];

// Voz: síntesis (Leo habla) + reconocimiento en modo "manos libres".
// El micrófono se reabre solo cada vez que termina una frase; se pausa mientras Leo habla
// para que no se escuche a sí mismo.
function useVoice() {
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [micError, setMicError] = useState('');
  const [ended, setEnded] = useState(0); // cambia cada vez que el micrófono se cierra sin texto -> se reabre
  const recRef = useRef(null);
  const speakTimer = useRef(null);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const voice = useRef(null);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const pick = () => {
      const vs = speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith('es'));
      voice.current = vs.find((v) => /es-co/i.test(v.lang)) || vs.find((v) => /es-(mx|us|419)/i.test(v.lang)) || vs[0] || null;
    };
    pick(); speechSynthesis.addEventListener?.('voiceschanged', pick);
  }, []);
  const speak = (text) => {
    if (!('speechSynthesis' in window) || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\$(\d)/g, '$1').replace(/(\d)\.(\d{3})/g, '$1$2'));
    u.lang = voice.current?.lang || 'es-CO'; if (voice.current) u.voice = voice.current; u.rate = 1.04;
    const done = () => { clearTimeout(speakTimer.current); setSpeaking(false); };
    u.onend = u.onerror = done;
    // "speaking" se marca de inmediato (no en onstart) para cerrar el micrófono antes de que suene la voz.
    setSpeaking(true);
    clearTimeout(speakTimer.current);
    speakTimer.current = setTimeout(done, 4000 + text.length * 90); // por si el navegador nunca dispara onend
    speechSynthesis.speak(u);
  };
  const stop = () => { try { speechSynthesis.cancel(); } catch {} clearTimeout(speakTimer.current); setSpeaking(false); };
  const stopListening = () => {
    const r = recRef.current; recRef.current = null;
    if (r) { r.onend = r.onresult = r.onerror = null; try { r.abort(); } catch {} }
    setListening(false); setInterim('');
  };
  const startListening = (onFinal) => {
    if (!SR || recRef.current) return;
    const r = new SR(); recRef.current = r;
    r.lang = 'es-CO'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    let finalText = '';
    r.onstart = () => { setListening(true); setMicError(''); };
    r.onresult = (e) => {
      const t = [...e.results].map((x) => x[0].transcript).join('');
      setInterim(t);
      if (e.results[e.results.length - 1].isFinal) finalText = t;
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setMicError('Permite el uso del micrófono para hablar con Leo, o escribe tu pedido.');
      else if (e.error === 'audio-capture') setMicError('No encontramos un micrófono en este dispositivo.');
      else if (e.error === 'network') setMicError('El dictado por voz necesita conexión a internet.');
    };
    r.onend = () => {
      if (recRef.current === r) recRef.current = null;
      setListening(false); setInterim('');
      if (finalText.trim()) onFinal(finalText.trim()); else setEnded((n) => n + 1);
    };
    try { r.start(); } catch { recRef.current = null; setTimeout(() => setEnded((n) => n + 1), 600); }
  };
  useEffect(() => () => { stopListening(); stop(); }, []);
  return { speak, stop, startListening, stopListening, speaking, listening, interim, micError, ended, canListen: !!SR };
}

function aiCartToLines(cart, menu) {
  const P = byId(menu.products), E = byId(menu.extras);
  return (Array.isArray(cart) ? cart : []).flatMap((it) => {
    const p = P[it?.product_id];
    if (!p) return [];
    const h = it.half_product_id && P[it.half_product_id];
    const half = h && p.allow_half && h.allow_half && h.id !== p.id ? h : null;
    const ex = (it.extra_ids || []).map((id) => E[id]).filter((e) => e && e.restaurant_id === p.restaurant_id);
    const qty = Math.max(1, Math.min(30, parseInt(it.qty, 10) || 1));
    return [makeLine({ product: p, half, option: it.option || '', extras: ex, qty, notes: it.notes || '' })];
  });
}

function AICheckout({ lines, busy, onClose, onConfirm }) {
  const [ot, setOt] = useState(() => newOT(null));
  return html`<${Sheet} onClose=${onClose}>
    <div className="row between"><h2>Último paso</h2><button className="icon-btn" aria-label="Cerrar" onClick=${onClose}>✕</button></div>
    <div className="row between sec" style=${{ fontSize: 20, fontWeight: 800 }}><span>Total</span><span>${money(cartTotal(lines))}</span></div>
    <${OrderTypeForm} ot=${ot} setOt=${setOt}/>
    <button className="btn btn-primary btn-block sec" disabled=${busy || !otValid(ot)} onClick=${() => onConfirm(ot)}>
      ${busy ? 'Enviando…' : !ot.mode ? 'Elige mesa o domicilio' : !otValid(ot) ? (ot.mode === 'mesa' ? 'Indica tu número de mesa' : 'Completa teléfono y dirección') : 'Enviar pedido'}</button>
  <//>`;
}

function AIApp() {
  const { menu: raw, error, reload } = useMenu();
  const menu = useMemo(() => publicMenu(raw), [raw]);
  useTheme(menu);
  const [cust, setCust] = useState(getCustomer);
  const waiter = 'Leo';
  const greeting = `¡Hola! Bienvenido a Healthy & Tasty 👋 Soy ${waiter}, tu mesero virtual. ¿Qué deseas probar hoy? ¿Algo dulce, un sándwich o un café?`;
  const [started, setStarted] = useState(false);
  const [voiceOn, setVoiceOn] = useState(store.get('voice', true));
  const [history, setHistory] = useState([]);
  const [chat, setChat] = useState([]);
  const [lines, setLines] = useState([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [order, setOrder] = useState(null);
  const [preview, setPreview] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [busy, setBusy] = useState(false);
  const [handsFree, setHandsFree] = useState(true); // micrófono siempre abierto
  const [typing, setTyping] = useState(false);      // mientras escribe, el micrófono solo se pausa
  const voice = useVoice();
  const endRef = useRef();
  const sendRef = useRef(() => {});
  // Llaves obligatorias: scrollIntoView devuelve una Promise en Chrome reciente y React la tomaría como cleanup.
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat, thinking]);
  useEffect(() => { store.set('voice', voiceOn); }, [voiceOn]);
  // Bucle manos libres: el micrófono se reabre solo mientras no esté hablando Leo, pensando o mostrando el ticket.
  const micOpen = started && handsFree && !typing && voice.canListen && !voice.micError && !voice.speaking && !thinking && !order && !preview && !checkout && !busy;
  useEffect(() => {
    if (!micOpen) { voice.stopListening(); return; }
    const t = setTimeout(() => voice.startListening((txt) => sendRef.current(txt)), 300);
    return () => clearTimeout(t);
  }, [micOpen, voice.ended]);

  if (!menu) return html`<div className="ai"><${Loader} error=${error} onRetry=${reload}/></div>`;
  if (!cust) return html`<${CustomerGate} rest=${menu.restaurants[0]} intro="Antes de hablar con Leo, necesitamos tus datos para tomar tu pedido." cta="Hablar con Leo →" initial=${null} onDone=${(c) => setCust(c)}/>`;
  const P = byId(menu.products), R = byId(menu.restaurants);

  const start = () => {
    setStarted(true);
    const intro = `[Sistema] El cliente acaba de escanear el código QR y está sentado${TABLE ? ' en la mesa ' + TABLE : ''}. Ya lo saludaste.`;
    setHistory([{ role: 'user', text: intro }, { role: 'model', text: JSON.stringify({ reply: greeting, suggestions: [], cart: [], stage: 'explorando' }) }]);
    setChat([{ role: 'model', text: greeting }]);
    if (voiceOn) voice.speak(greeting);
  };

  const finish = async (ls, ot) => {
    setBusy(true);
    const o = await submitOrder({ lines: ls, ot, notes: '', source: 'ia', customer: cust?.name });
    setBusy(false); setPreview(false); setCheckout(false); setOrder(o);
  };

  const ask = async (h) => {
    try { return (await rpc('ai_chat', { p_messages: h })) || {}; }
    catch (e) {
      if (/no está configurado|inválida/.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 600)); // un reintento silencioso antes de mostrar error
      return (await rpc('ai_chat', { p_messages: h })) || {};
    }
  };

  const send = async (text) => {
    text = (text || '').trim();
    if (!text || thinking) return;
    voice.stop(); voice.stopListening(); setInput('');
    const h = [...history, { role: 'user', text }];
    setHistory(h); setChat((c) => [...c, { role: 'user', text }]); setThinking(true);
    try {
      const res = await ask(h);
      const reply = typeof res.reply === 'string' && res.reply ? res.reply : 'Disculpa, ¿me lo repites?';
      const sugs = (res.suggestions || []).filter((id) => P[id]).slice(0, 4);
      const newLines = Array.isArray(res.cart) ? aiCartToLines(res.cart, menu) : lines;
      setHistory([...h, { role: 'model', text: JSON.stringify(res) }]);
      setChat((c) => [...c, { role: 'model', text: reply, sugs }]);
      setLines(newLines);
      if (voiceOn) voice.speak(reply);
      if (res.stage === 'confirmado' && newLines.length) setTimeout(() => { setPreview(false); setCheckout(true); }, 900);
    } catch (e) {
      setHistory(history);
      setChat((c) => [...c, { role: 'model', text: '😕 Se me fue la señal un momento. ¿Me repites lo último, por favor?' }]);
      console.warn('ai_chat', e.message);
    } finally { setThinking(false); }
  };
  sendRef.current = send;

  // Botón del micrófono: abre/cierra el modo manos libres; si Leo está hablando, lo interrumpe para escucharte.
  const mic = () => {
    if (voice.speaking) { voice.stop(); setHandsFree(true); return; }
    setHandsFree(!handsFree);
  };
  const status = thinking ? 'Pensando…' : voice.speaking ? 'Hablando…' : voice.listening ? '🎙️ Te escucho, habla cuando quieras' :
    voice.micError ? voice.micError : handsFree && voice.canListen ? 'Abriendo micrófono…' : 'En línea' + (TABLE ? ' · Mesa ' + TABLE : '');

  return html`<div className="ai">
    ${!started && html`<div className="splash"><div>
      <img className="splash-logo" src=${asset(menu.restaurants[0]?.logo)} alt="Healthy & Tasty"/>
      <h1>Hola, soy ${waiter}</h1>
      <p className="muted" style=${{ maxWidth: 420, margin: '0 auto 24px' }}>Tu mesero virtual de Healthy & Tasty. Te ayudo a elegir tu postre, sándwich o bebida y tomo tu pedido.${TABLE ? ` Mesa ${TABLE}.` : ''}</p>
      <${Glow} className="btn" c1="#F7ADB6" c2="#0F3D2C" inner="#0F3D2C" style=${{ color: '#FDF1F2', fontSize: 18, padding: 0 }} onClick=${start}>
        <span style=${{ padding: '16px 34px', display: 'block', fontWeight: 800 }}>Toca para comenzar 🎙️</span><//>
      <div style=${{ marginTop: 16 }}><${InstallButton}/></div>
    </div></div>`}

    <header className="ai-top">
      <div className=${'avatar' + (voice.speaking || thinking ? ' talking' : '')}><span>🤵</span></div>
      <div className="grow"><b>${waiter} · Mesero virtual</b><div className="muted" style=${{ fontSize: 13 }}>${status}</div></div>
      <${WaiterButton} table=${TABLE} name=${cust?.name || ''}/>
      <button className="icon-btn" title=${voiceOn ? 'Silenciar voz' : 'Activar voz'} onClick=${() => { if (voiceOn) voice.stop(); setVoiceOn(!voiceOn); }}>${voiceOn ? '🔊' : '🔇'}</button>
    </header>

    <main className="chat">
      ${chat.map((m, i) => html`<${React.Fragment} key=${i}>
        <div className=${'bubble ' + m.role}>${m.text}</div>
        ${m.sugs?.length > 0 && html`<div className="sugs">${m.sugs.map((id) => {
          const p = P[id], r = R[p.restaurant_id], c = r?.colors || {};
          return html`<${Glow} key=${id} soft className="sug" c1=${c.primary} c2=${c.secondary} inner="var(--card)" onClick=${() => send('Quiero ' + p.name)}>
            <span className="r" style=${{ color: c.primary }}>${menu.categories.find((x) => x.id === p.category_id)?.name || r?.name}</span>
            <b>${p.name}</b><span className="muted" style=${{ fontSize: 12.5 }}>${(p.description || '').slice(0, 80)}${(p.description || '').length > 80 ? '…' : ''}</span>
            <span className="price" style=${{ fontSize: 15 }}>${money(p.price)}</span>
          <//>`;
        })}</div>`}
      <//>`)}
      ${thinking && html`<div className="bubble model"><span className="typing"><i></i><i></i><i></i></span></div>`}
      <div ref=${endRef}></div>
    </main>

    ${lines.length > 0 && html`<div className="order-pill"><${Glow} c1="#F7ADB6" c2="#0F3D2C" inner="var(--card)" style=${{ width: '100%' }} onClick=${() => setPreview(true)}>
      <span className="count">${cartCount(lines)}</span><span className="grow" style=${{ textAlign: 'left' }}>Tu pedido</span><b>${money(cartTotal(lines))}</b><span>›</span>
    <//></div>`}
    ${chat.length <= 2 && html`<div className="quick">${QUICK.map((q) => html`<button key=${q} onClick=${() => send(q.replace(/^\S+\s/, ''))}>${q}</button>`)}</div>`}
    <form className="composer" onSubmit=${(e) => { e.preventDefault(); document.activeElement?.blur(); send(input); }}>
      ${voice.canListen && html`<button type="button" className=${'mic' + (voice.listening ? ' on' : handsFree ? ' armed' : '')}
        aria-label=${handsFree ? 'Cerrar micrófono' : 'Abrir micrófono'} title=${handsFree ? 'Micrófono abierto (toca para cerrarlo)' : 'Micrófono cerrado (toca para abrirlo)'} onClick=${mic}>${handsFree ? '🎙️' : '🔇'}</button>`}
      <input className="field grow" value=${voice.listening && voice.interim ? voice.interim : input}
        placeholder=${voice.listening ? 'Te escucho… habla cuando quieras' : handsFree && voice.canListen ? 'Habla o escribe tu pedido…' : 'Escribe tu pedido…'}
        onFocus=${() => setTyping(true)} onBlur=${() => setTyping(false)} onChange=${(e) => setInput(e.target.value)}/>
      <button className="send" aria-label="Enviar" disabled=${thinking}>➤</button>
    </form>

    ${preview && html`<${Ticket} preview busy=${busy} order=${{ items: lines, total: cartTotal(lines), table_no: TABLE, source: 'ia' }} menu=${menu}
      onClose=${() => setPreview(false)} onConfirm=${() => { setPreview(false); setCheckout(true); }}/>`}
    ${checkout && html`<${AICheckout} lines=${lines} busy=${busy} onClose=${() => setCheckout(false)} onConfirm=${(ot) => finish(lines, ot)}/>`}
    ${order && html`<${Ticket} order=${order} menu=${menu} onClose=${() => setOrder(null)}
      onNew=${() => { setOrder(null); setLines([]); setChat([]); setHistory([]); setStarted(false); setHandsFree(true); }}/>`}
  </div>`;
}

// =============================================================
// ADMIN (/admin)
// =============================================================
const optsToText = (o) => (o || []).map((x) => `${x.name}: ${x.choices.join(', ')}`).join('\n');
const textToOpts = (t) => (t || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const [n, ...rest] = l.split(':');
  const choices = rest.join(':').split(',').map((s) => s.trim()).filter(Boolean);
  return choices.length ? { name: n.trim(), choices } : null;
}).filter(Boolean);
const COLOR_KEYS = [['primary', 'Principal (verde)'], ['secondary', 'Secundario (rosado)'], ['accent', 'Acento'], ['bg', 'Fondo'], ['card', 'Tarjetas'], ['text', 'Texto'], ['muted', 'Texto suave'], ['onPrimary', 'Texto sobre principal']];

function Editor({ title, fields, value, onSave, onClose }) {
  const [v, setV] = useState(value);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k, x) => setV((o) => ({ ...o, [k]: x }));
  const save = async () => {
    setSaving(true); setErr('');
    try { await onSave(v); onClose(); } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };
  return html`<${Sheet} onClose=${onClose}>
    <div className="row between"><h2>${title}</h2><button className="icon-btn" onClick=${onClose}>✕</button></div>
    <div className="grid2 sec">${fields.map((f) => {
      const full = ['textarea', 'options', 'cats', 'colors'].includes(f.type) ? { gridColumn: '1/-1' } : null;
      let input;
      if (f.type === 'textarea') input = html`<textarea className="field" rows=${f.rows || 3} value=${v[f.k] ?? ''} onChange=${(e) => set(f.k, e.target.value)}></textarea>`;
      else if (f.type === 'number') input = html`<input className="field" type="number" inputMode="numeric" value=${v[f.k] ?? 0} onChange=${(e) => set(f.k, parseInt(e.target.value, 10) || 0)}/>`;
      else if (f.type === 'switch') input = html`<${Switch} on=${v[f.k] !== false} onChange=${(x) => set(f.k, x)} label=${f.hint || ''}/>`;
      else if (f.type === 'select') input = html`<select className="field" value=${v[f.k] ?? ''} onChange=${(e) => set(f.k, e.target.value)}>
        ${f.options.map((o) => html`<option key=${o[0]} value=${o[0]}>${o[1]}</option>`)}</select>`;
      else if (f.type === 'options') input = html`<textarea className="field" rows="3" placeholder="Una por línea → Nombre: opción 1, opción 2" value=${v.__opts ?? optsToText(v[f.k])}
        onChange=${(e) => setV((o) => ({ ...o, __opts: e.target.value, [f.k]: textToOpts(e.target.value) }))}></textarea>`;
      else if (f.type === 'cats') input = html`<div className="opt-grid">
        <span className="muted" style=${{ fontSize: 13, width: '100%' }}>Sin selección = aplica a todas las categorías</span>
        ${f.options.map((c) => { const on = (v[f.k] || []).includes(c.id);
          return html`<button type="button" key=${c.id} className=${'opt' + (on ? ' on' : '')}
            onClick=${() => set(f.k, on ? v[f.k].filter((x) => x !== c.id) : [...(v[f.k] || []), c.id])}>${c.name}</button>`; })}</div>`;
      else if (f.type === 'colors') input = html`<div className="grid2">${COLOR_KEYS.map(([ck, cl]) => html`<label key=${ck} className="lbl">${cl}
        <span className="row"><input type="color" value=${v.colors?.[ck] || '#000000'} onChange=${(e) => set('colors', { ...v.colors, [ck]: e.target.value })}
          style=${{ width: 44, height: 40, border: 0, background: 'none' }}/><code>${v.colors?.[ck] || ''}</code></span></label>`)}</div>`;
      else input = html`<input className="field" value=${v[f.k] ?? ''} disabled=${f.readOnly} onChange=${(e) => set(f.k, e.target.value)}/>`;
      return html`<label className="lbl" key=${f.k} style=${full}>${f.label}${input}</label>`;
    })}</div>
    ${err && html`<div className="err">${err}</div>`}
    <div className="row sec"><button className="btn btn-ghost grow" onClick=${onClose}>Cancelar</button>
      <button className="btn btn-primary grow" disabled=${saving} onClick=${save}>${saving ? 'Guardando…' : 'Guardar'}</button></div>
  <//>`;
}

function DelBtn({ onDelete }) {
  const [ask, setAsk] = useState(false);
  useEffect(() => { if (ask) { const t = setTimeout(() => setAsk(false), 3000); return () => clearTimeout(t); } }, [ask]);
  return ask ? html`<button className="btn btn-danger" style=${{ padding: '8px 12px', fontSize: 13 }} onClick=${onDelete}>¿Eliminar?</button>`
    : html`<button className="icon-btn" title="Eliminar" onClick=${() => setAsk(true)}>🗑️</button>`;
}

// Sirena fuerte + voz: "El cliente de la mesa N te llama". Se repite hasta que se marque como atendido.
function playSiren(ctx) {
  const t0 = ctx.currentTime, g = ctx.createGain(), o = ctx.createOscillator();
  o.type = 'square'; g.gain.setValueAtTime(1, t0); g.gain.setValueAtTime(0, t0 + 1.5);
  for (let i = 0; i < 6; i++) o.frequency.setValueAtTime(i % 2 ? 880 : 1320, t0 + i * 0.25);
  o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + 1.5);
}
function WaiterAlarm({ token, onLogout }) {
  const [calls, setCalls] = useState([]);
  const [armed, setArmed] = useState(false);
  const ctx = useRef(null);
  const callsRef = useRef([]); callsRef.current = calls;
  useEffect(() => {
    const unlock = () => {
      try {
        const C = window.AudioContext || window.webkitAudioContext;
        ctx.current ||= new C();
        ctx.current.resume().then(() => setArmed(ctx.current.state === 'running'));
        speechSynthesis.getVoices();
      } catch {}
    };
    unlock();
    const evs = ['pointerdown', 'keydown'];
    evs.forEach((e) => addEventListener(e, unlock));
    return () => evs.forEach((e) => removeEventListener(e, unlock));
  }, []);
  useEffect(() => {
    let alive = true, t;
    const tick = async () => {
      try { const r = await rpc('admin_calls', { p_token: token }); if (alive) setCalls(r || []); }
      catch (e) { if (/Sesión expirada/.test(e.message)) { onLogout(); return; } }
      if (alive) t = setTimeout(tick, 3000);
    };
    tick();
    return () => { alive = false; clearTimeout(t); };
  }, [token]);
  const key = calls.map((c) => c.id).join(',');
  useEffect(() => {
    if (!key || !armed) return;
    let stop = false, t, v;
    const ring = () => {
      if (stop) return;
      try { playSiren(ctx.current); } catch {}
      v = setTimeout(() => {
        try {
          speechSynthesis.cancel();
          callsRef.current.forEach((c) => {
            const u = new SpeechSynthesisUtterance(`El cliente de la mesa ${c.table_no}`);
            u.lang = 'es-CO'; u.volume = 1; u.rate = 0.95; speechSynthesis.speak(u);
          });
        } catch {}
      }, 1700);
      t = setTimeout(ring, 9000);
    };
    ring();
    return () => { stop = true; clearTimeout(t); clearTimeout(v); try { speechSynthesis.cancel(); } catch {} };
  }, [key, armed]);
  const done = async (c) => {
    setCalls((l) => l.filter((x) => x.id !== c.id));
    try { await rpc('admin_call_done', { p_token: token, p_id: c.id }); } catch {}
  };
  if (!calls.length && armed) return null;
  return html`<div className=${'call-banner' + (calls.length ? '' : ' armhint')}>
    ${calls.map((c) => html`<div className="call" key=${c.id}><span style=${{ fontSize: 26 }}>🔔</span>
      <div className="grow">El cliente de la mesa ${c.table_no} te llama<br/><small>${c.customer_name ? c.customer_name + ' · ' : ''}${new Date(c.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</small></div>
      <button onClick=${() => done(c)}>Atendido</button></div>`)}
    ${!armed && html`<div className="call" style=${{ animation: 'none' }}><span style=${{ fontSize: 22 }}>🔊</span>
      <div className="grow" style=${{ fontSize: 15 }}>Toca para activar el sonido de los llamados<br/><small>El navegador lo exige una vez al abrir esta página</small></div>
      <button onClick=${() => { try { ctx.current ||= new (window.AudioContext || window.webkitAudioContext)(); ctx.current.resume().then(() => setArmed(true)); } catch {} }}>Activar</button></div>`}
  </div>`;
}

function AdminApp() {
  const [token, setToken] = useState(() => store.get('adm-token', null, sessionStorage));
  const logout = async () => { try { await rpc('admin_logout', { p_token: token }); } catch {} store.del('adm-token', sessionStorage); setToken(null); };
  if (!token) return html`<${AdminLogin} onLogin=${(t) => { store.set('adm-token', t, sessionStorage); setToken(t); }}/>`;
  return html`<${React.Fragment}><${AdminPanel} token=${token} onLogout=${logout}/><${WaiterAlarm} token=${token} onLogout=${logout}/><//>`;
}

function AdminLogin({ onLogin }) {
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { onLogin(await rpc('admin_login', { p_user: u, p_pass: p })); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return html`<div className="admin login"><form className="panel" onSubmit=${go}>
    <h2 style=${{ margin: '0 0 4px' }}>Panel de administración</h2><p className="muted" style=${{ marginTop: 0 }}>Ingresa con tu usuario.</p>
    <label className="lbl">Usuario<input className="field" autoComplete="username" value=${u} onChange=${(e) => setU(e.target.value)}/></label>
    <label className="lbl" style=${{ marginTop: 12 }}>Contraseña<input className="field" type="password" autoComplete="current-password" value=${p} onChange=${(e) => setP(e.target.value)}/></label>
    ${err && html`<div className="err">${err}</div>`}
    <button className="btn btn-primary btn-block" style=${{ marginTop: 18 }} disabled=${busy || !u || !p}>${busy ? 'Validando…' : 'Entrar'}</button>
  </form></div>`;
}

const TABS = [['productos', '🍽️ Productos'], ['categorias', '🗂️ Categorías'], ['adicionales', '➕ Adicionales'], ['restaurantes', '🏪 Mi local'],
  ['pedidos', '🧾 Pedidos'], ['ia', '🤖 Mesero IA'], ['qr', '🔳 Códigos QR'], ['seguridad', '🔐 Seguridad']];

function AdminPanel({ token, onLogout }) {
  const { menu, error, reload } = useMenu();
  const [tab, setTab] = useState(store.get('adm-tab', 'productos'));
  const [rid, setRid] = useState(store.get('adm-rid', 'healthy'));
  const [edit, setEdit] = useState(null);
  const [msg, toast] = useToast();
  useEffect(() => { store.set('adm-tab', tab); }, [tab]);
  useEffect(() => { store.set('adm-rid', rid); }, [rid]);
  if (!menu) return html`<div className="admin"><${Loader} error=${error} onRetry=${reload}/></div>`;

  const wrap = (fn) => async (...a) => {
    try { return await fn(...a); } catch (e) { if (/Sesión expirada/.test(e.message)) onLogout(); throw e; }
  };
  const save = wrap(async (table, row) => { const { __opts, ...clean } = row; await rpc('admin_save', { p_token: token, p_table: table, p_row: clean }); await reload(); toast('✓ Guardado'); });
  const del = wrap(async (table, id) => { await rpc('admin_delete', { p_token: token, p_table: table, p_id: String(id) }); await reload(); toast('Eliminado'); });
  const quick = (table, row, patch) => save(table, { ...row, ...patch }).catch((e) => toast(e.message));

  const cats = menu.categories.filter((c) => c.restaurant_id === rid);
  const R = menu.restaurants.find((r) => r.id === rid);
  const catOpts = cats.map((c) => [c.id, c.name]);
  const productFields = [
    { k: 'name', label: 'Nombre' }, { k: 'price', label: 'Precio (COP)', type: 'number' },
    { k: 'description', label: 'Descripción', type: 'textarea' },
    { k: 'category_id', label: 'Categoría', type: 'select', options: catOpts }, { k: 'sort', label: 'Orden', type: 'number' },
    { k: 'options', label: 'Opciones obligatorias (ej. Salsa: Ají, Ahogado)', type: 'options' },
    { k: 'active', label: 'Visible', type: 'switch', hint: 'Activo' },
    { k: 'image', label: 'URL de imagen (opcional)' }, { k: 'tags', label: 'Palabras clave para la IA' },
  ];
  const newProduct = () => ({ restaurant_id: rid, category_id: cats[0]?.id, name: '', description: '', price: 0, image: '', options: [], allow_half: false, tags: '', sort: 99, active: true });
  const categoryFields = [{ k: 'name', label: 'Nombre' }, { k: 'sort', label: 'Orden', type: 'number' }, { k: 'note', label: 'Nota (se muestra bajo el título)', type: 'textarea', rows: 2 }, { k: 'active', label: 'Visible', type: 'switch', hint: 'Activa' }];
  const extraFields = [{ k: 'name', label: 'Nombre' }, { k: 'price', label: 'Precio (COP)', type: 'number' },
    { k: 'kind', label: 'Tipo', type: 'select', options: [['adicional', 'Adicional'], ['borde', 'Opción exclusiva (solo una por producto)']] },
    { k: 'sort', label: 'Orden', type: 'number' }, { k: 'category_ids', label: 'Aplica a categorías', type: 'cats', options: cats }, { k: 'active', label: 'Visible', type: 'switch', hint: 'Activo' }];
  const restFields = (isNew) => [{ k: 'id', label: 'Id (sin espacios)', readOnly: !isNew }, { k: 'name', label: 'Nombre' }, { k: 'tagline', label: 'Lema' },
    { k: 'sort', label: 'Orden', type: 'number' }, { k: 'logo', label: 'Logo (ruta o URL)' }, { k: 'menu_image', label: 'Imágenes de la carta (rutas o URLs separadas por coma)' },
    { k: 'colors', label: 'Colores', type: 'colors' }, { k: 'active', label: 'Visible', type: 'switch', hint: 'Activo' }];

  const RestPicker = html`<div className="row" style=${{ flexWrap: 'wrap', marginBottom: 14 }}>${menu.restaurants.map((r) => html`<button key=${r.id}
    className=${'chip' + (rid === r.id ? ' on' : '')} style=${rid === r.id ? { background: r.colors?.primary, color: r.colors?.onPrimary, borderColor: r.colors?.primary } : null}
    onClick=${() => setRid(r.id)}>${r.name}</button>`)}</div>`;

  let body;
  if (tab === 'productos') body = html`${RestPicker}
    <button className="btn btn-primary" style=${{ marginBottom: 14 }} onClick=${() => setEdit({ table: 'products', title: 'Nuevo producto', fields: productFields, value: newProduct() })}>＋ Nuevo producto</button>
    ${cats.map((c) => html`<div className="panel" key=${c.id}><b>${c.name}</b>${c.active === false && html` <span className="tiny-badge">oculta</span>`}
      ${menu.products.filter((p) => p.category_id === c.id).map((p) => html`<div className=${'a-row' + (p.active === false ? ' off' : '')} key=${p.id}>
        <div className="grow"><div>${p.name} ${p.allow_half && html`<span className="tiny-badge">½</span>`}</div>
          <div className="muted" style=${{ fontSize: 13 }}>${money(p.price)}${p.options?.length ? ' · ' + p.options.map((o) => o.name).join(', ') : ''}</div></div>
        <${Switch} on=${p.active !== false} onChange=${(x) => quick('products', p, { active: x })}/>
        <button className="icon-btn" title="Editar" onClick=${() => setEdit({ table: 'products', title: 'Editar producto', fields: productFields, value: p })}>✏️</button>
        <${DelBtn} onDelete=${() => del('products', p.id).catch((e) => toast(e.message))}/>
      </div>`)}</div>`)}
    ${menu.products.some((p) => p.restaurant_id === rid && !p.category_id) && html`<div className="panel"><b>Sin categoría</b>
      ${menu.products.filter((p) => p.restaurant_id === rid && !p.category_id).map((p) => html`<div className="a-row" key=${p.id}><span className="grow">${p.name}</span>
        <button className="icon-btn" onClick=${() => setEdit({ table: 'products', title: 'Editar producto', fields: productFields, value: p })}>✏️</button></div>`)}</div>`}`;
  else if (tab === 'categorias') body = html`${RestPicker}
    <button className="btn btn-primary" style=${{ marginBottom: 14 }} onClick=${() => setEdit({ table: 'categories', title: 'Nueva categoría', fields: categoryFields, value: { restaurant_id: rid, name: '', note: '', sort: cats.length + 1, active: true } })}>＋ Nueva categoría</button>
    <div className="panel">${cats.map((c) => html`<div className=${'a-row' + (c.active === false ? ' off' : '')} key=${c.id}>
      <div className="grow"><div>${c.name}</div><div className="muted" style=${{ fontSize: 13 }}>Orden ${c.sort} · ${menu.products.filter((p) => p.category_id === c.id).length} productos</div></div>
      <${Switch} on=${c.active !== false} onChange=${(x) => quick('categories', c, { active: x })}/>
      <button className="icon-btn" onClick=${() => setEdit({ table: 'categories', title: 'Editar categoría', fields: categoryFields, value: c })}>✏️</button>
      <${DelBtn} onDelete=${() => del('categories', c.id).catch((e) => toast(e.message))}/></div>`)}</div>`;
  else if (tab === 'adicionales') body = html`${RestPicker}
    <button className="btn btn-primary" style=${{ marginBottom: 14 }} onClick=${() => setEdit({ table: 'extras', title: 'Nuevo adicional', fields: extraFields, value: { restaurant_id: rid, name: '', price: 0, kind: 'adicional', category_ids: [], sort: 99, active: true } })}>＋ Nuevo adicional / borde</button>
    <div className="panel">${menu.extras.filter((e) => e.restaurant_id === rid).map((e) => html`<div className=${'a-row' + (e.active === false ? ' off' : '')} key=${e.id}>
      <div className="grow"><div>${e.kind === 'borde' ? '🧀 ' : ''}${e.name}</div><div className="muted" style=${{ fontSize: 13 }}>${money(e.price)} · ${
        e.category_ids?.length ? menu.categories.filter((c) => e.category_ids.includes(c.id)).map((c) => c.name).join(', ') : 'Todas las categorías'}</div></div>
      <${Switch} on=${e.active !== false} onChange=${(x) => quick('extras', e, { active: x })}/>
      <button className="icon-btn" onClick=${() => setEdit({ table: 'extras', title: 'Editar adicional', fields: extraFields, value: e })}>✏️</button>
      <${DelBtn} onDelete=${() => del('extras', e.id).catch((x) => toast(x.message))}/></div>`)}</div>`;
  else if (tab === 'restaurantes') body = html`

    ${menu.restaurants.map((r) => html`<div className="panel row" key=${r.id} style=${{ background: r.colors?.card, color: r.colors?.text }}>
      <img src=${asset(r.logo)} alt="" style=${{ height: 56, width: 80, objectFit: 'contain' }}/>
      <div className="grow"><b>${r.name}</b><div style=${{ fontSize: 13, opacity: .7 }}>${r.tagline}</div>
        <div className="row" style=${{ gap: 4, marginTop: 6 }}>${COLOR_KEYS.map(([k]) => html`<span key=${k} title=${k} style=${{ width: 16, height: 16, borderRadius: 5, background: r.colors?.[k], border: '1px solid #8884' }}></span>`)}</div></div>
      <button className="icon-btn" onClick=${() => setEdit({ table: 'restaurants', title: 'Editar restaurante', fields: restFields(false), value: r })}>✏️</button>
</div>`)}`;
  else if (tab === 'pedidos') body = html`<${AdminOrders} token=${token} menu=${menu} toast=${toast} onLogout=${onLogout}/>`;
  else if (tab === 'ia') body = html`<${AdminAI} token=${token} menu=${menu} save=${save} toast=${toast}/>`;
  else if (tab === 'qr') body = html`<${AdminQR}/>`;
  else body = html`<${AdminSecurity} token=${token} toast=${toast} onLogout=${onLogout}/>`;

  return html`<div className="admin">
    <header className="admin-top"><b className="grow">⚙️ Healthy & Tasty · Administración</b>
      <a className="pill-link" style=${{ padding: '8px 14px' }} href=${ROOT_URL} target="_blank">Ver menú</a>
      <a className="pill-link" style=${{ padding: '8px 14px' }} href=${ROOT_URL + 'rapido/'} target="_blank">Cliente rápido</a>
      <a className="pill-link" style=${{ padding: '8px 14px' }} href=${ROOT_URL + 'ia/'} target="_blank">Ver IA</a>
      <button className="btn btn-ghost" style=${{ padding: '8px 14px' }} onClick=${onLogout}>Salir</button></header>
    <nav className="tabs">${TABS.map(([k, l]) => html`<button key=${k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${l}</button>`)}</nav>
    <div className="wrap" style=${{ paddingBottom: 40 }}>${body}</div>
    ${edit && html`<${Editor} ...${edit} onClose=${() => setEdit(null)} onSave=${(v) => save(edit.table, v)}/>`}
    <${Toast} msg=${msg}/>
  </div>`;
}

function AdminOrders({ token, menu, toast, onLogout }) {
  const [orders, setOrders] = useState(null);
  const [view, setView] = useState(null);
  const load = useCallback(async () => {
    try { setOrders(await rpc('admin_orders', { p_token: token, p_limit: 150 })); }
    catch (e) { if (/Sesión expirada/.test(e.message)) onLogout(); else toast(e.message); }
  }, [token]);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  const setStatus = async (o, s) => { try { await rpc('admin_order_status', { p_token: token, p_id: o.id, p_status: s }); load(); } catch (e) { toast(e.message); } };
  if (!orders) return html`<div className="spinner" style=${{ margin: '40px auto' }}></div>`;
  const today = orders.filter((o) => new Date(o.created_at).toDateString() === new Date().toDateString() && o.status !== 'cancelado');
  return html`<div>
    <div className="grid2" style=${{ marginBottom: 14 }}>
      <div className="panel"><div className="muted">Pedidos hoy</div><div style=${{ fontSize: 28, fontWeight: 800 }}>${today.length}</div></div>
      <div className="panel"><div className="muted">Ventas hoy</div><div style=${{ fontSize: 28, fontWeight: 800 }}>${money(today.reduce((s, o) => s + o.total, 0))}</div></div>
    </div>
    <div className="panel">${orders.length === 0 && html`<p className="muted">Todavía no hay pedidos.</p>`}
      ${orders.map((o) => html`<div className="a-row" key=${o.id} style=${{ flexWrap: 'wrap' }}>
        <button className="grow" style=${{ textAlign: 'left' }} onClick=${() => setView(o)}>
          <b>#${o.code}</b> ${o.customer_name && html`· ${o.customer_name}`}${o.customer_phone && html` · 📞 ${o.customer_phone}`} ${o.order_type === 'domicilio' ? html`· 🛵 Domicilio` : o.table_no && html`· Mesa ${o.table_no}`} · ${money(o.total)} ${o.source === 'ia' ? '· 🤖' : o.source === 'rapido' ? '· ⚡' : ''}
          <div className="muted" style=${{ fontSize: 13 }}>${o.address ? '📍 ' + o.address + (o.lat != null ? ` (${o.lat}, ${o.lng})` : '') + ' · ' : o.lat != null ? `📍 ${o.lat}, ${o.lng} · ` : ''}${new Date(o.created_at).toLocaleString('es-CO')} · ${(o.items || []).map((l) => l.qty + '× ' + lineTitle(l)).join(', ')}</div></button>
        <span className=${'status st-' + o.status}>${o.status}</span>
        <select className="field" style=${{ width: 140, padding: '8px 10px' }} value=${o.status} onChange=${(e) => setStatus(o, e.target.value)}>
          ${['nuevo', 'preparando', 'listo', 'entregado', 'cancelado'].map((s) => html`<option key=${s}>${s}</option>`)}</select>
      </div>`)}</div>
    ${view && html`<${Ticket} live=${false} order=${view} menu=${menu} onClose=${() => setView(null)}/>`}
  </div>`;
}

function AdminAI({ token, menu, save, toast }) {
  const [settings, setSettings] = useState(null);
  const [key, setKey] = useState('');
  const [status, setStatus] = useState(null);
  const [test, setTest] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    sb.from('settings').select('*').then(({ data }) => setSettings(Object.fromEntries((data || []).map((r) => [r.key, r.value]))));
    rpc('admin_secret_status', { p_token: token }).then(setStatus).catch(() => {});
  }, []);
  if (!settings) return html`<div className="spinner" style=${{ margin: '40px auto' }}></div>`;
  const put = async (k) => { try { await save('settings', { key: k, value: settings[k] ?? '' }); } catch (e) { toast(e.message); } };
  const saveKey = async () => {
    try { await rpc('admin_set_secret', { p_token: token, p_key: 'gemini_key', p_value: key.trim() }); setKey(''); setStatus(await rpc('admin_secret_status', { p_token: token })); toast('✓ API key guardada'); }
    catch (e) { toast(e.message); }
  };
  const run = async () => {
    setBusy(true); setTest('');
    try { const r = await rpc('ai_chat', { p_messages: [{ role: 'user', text: 'Hola, ¿qué me recomiendas de postre?' }] }); setTest(JSON.stringify(r, null, 2)); }
    catch (e) { setTest('Error: ' + e.message); } finally { setBusy(false); }
  };
  return html`<div>
    <div className="panel"><b>API key de Google Gemini</b>
      <p className="muted" style=${{ fontSize: 14 }}>Se guarda solo en la base de datos y nunca se envía al navegador del cliente.
        Estado: ${status ? (status.gemini_key_set ? html`<b style=${{ color: '#7fd483' }}>configurada (${status.gemini_key_hint})</b>` : html`<b style=${{ color: '#ef8a88' }}>sin configurar</b>`) : '…'}</p>
      <div className="row"><input className="field grow" type="password" placeholder="Pega una nueva API key" value=${key} onChange=${(e) => setKey(e.target.value)}/>
        <button className="btn btn-primary" disabled=${!key.trim()} onClick=${saveKey}>Guardar</button></div></div>
    <div className="panel"><b>Modelo</b>
      <div className="row" style=${{ marginTop: 8 }}><input className="field grow" list="models" value=${settings.ai_model || ''} onChange=${(e) => setSettings({ ...settings, ai_model: e.target.value })}/>
        <datalist id="models"><option value="gemini-flash-lite-latest"/><option value="gemini-flash-latest"/><option value="gemini-2.5-flash"/><option value="gemini-pro-latest"/></datalist>
        <button className="btn btn-primary" onClick=${() => put('ai_model')}>Guardar</button></div>
      <p className="muted" style=${{ fontSize: 13 }}>Recomendado: gemini-flash-lite-latest (responde en ~1 segundo).</p></div>
    <div className="panel"><b>Instrucciones del mesero (prompt)</b>
      <p className="muted" style=${{ fontSize: 13 }}>La carta actual se añade automáticamente al final. Mantén el formato JSON descrito.</p>
      <textarea className="field" rows="16" value=${settings.ai_prompt || ''} onChange=${(e) => setSettings({ ...settings, ai_prompt: e.target.value })}></textarea>
      <button className="btn btn-primary" style=${{ marginTop: 10 }} onClick=${() => put('ai_prompt')}>Guardar instrucciones</button></div>
    <div className="panel"><b>Probar el mesero</b>
      <button className="btn btn-ghost" style=${{ marginLeft: 10 }} disabled=${busy} onClick=${run}>${busy ? 'Consultando…' : 'Enviar mensaje de prueba'}</button>
      ${test && html`<pre style=${{ whiteSpace: 'pre-wrap', fontSize: 13, marginTop: 12 }}>${test}</pre>`}</div>
  </div>`;
}

function AdminQR() {
  const [mesa, setMesa] = useState('');
  const [imgs, setImgs] = useState({});
  const links = [['Menú digital', ROOT_URL], ['Cliente rápido', ROOT_URL + 'rapido/'], ['Mesero IA', ROOT_URL + 'ia/']].map(([n, u]) => [n, u + (mesa ? '?mesa=' + encodeURIComponent(mesa) : '')]);
  useEffect(() => {
    let alive = true;
    import('https://esm.sh/qrcode@1.5.4').then(async (m) => {
      const QR = m.default || m;
      const out = {};
      for (const [, u] of links) out[u] = await QR.toDataURL(u, { width: 900, margin: 2, errorCorrectionLevel: 'H' });
      if (alive) setImgs(out);
    });
    return () => { alive = false; };
  }, [mesa]);
  return html`<div>
    <div className="panel"><label className="lbl">Número de mesa (opcional, se incluye en el QR)
      <input className="field" style=${{ maxWidth: 200 }} value=${mesa} placeholder="Ej: 5" onChange=${(e) => setMesa(e.target.value.trim())}/></label></div>
    <div className="grid2">${links.map(([n, u]) => html`<div className="qr-card" key=${n}>
      <b style=${{ fontSize: 18 }}>${n}${mesa ? ' · Mesa ' + mesa : ''}</b>
      ${imgs[u] ? html`<img src=${imgs[u]} alt=${'QR ' + n}/>` : html`<div className="spinner" style=${{ margin: '80px auto', borderTopColor: '#111' }}></div>`}
      <div style=${{ fontSize: 12, wordBreak: 'break-all', margin: '6px 0 10px' }}>${u}</div>
      <a className="btn btn-primary" style=${{ background: '#111', color: '#fff', textDecoration: 'none' }} href=${imgs[u]} download=${`qr-${n.toLowerCase().replace(/\s+/g, '-')}${mesa ? '-mesa-' + mesa : ''}.png`}>Descargar PNG</a>
    </div>`)}</div>
  </div>`;
}

function AdminSecurity({ token, toast, onLogout }) {
  const [p1, setP1] = useState(''); const [p2, setP2] = useState('');
  const go = async () => {
    if (p1 !== p2) return toast('Las contraseñas no coinciden');
    try { await rpc('admin_change_password', { p_token: token, p_new: p1 }); setP1(''); setP2(''); toast('✓ Contraseña actualizada'); } catch (e) { toast(e.message); }
  };
  return html`<div className="panel" style=${{ maxWidth: 460 }}><b>Cambiar contraseña</b>
    <label className="lbl" style=${{ marginTop: 12 }}>Nueva contraseña<input className="field" type="password" value=${p1} onChange=${(e) => setP1(e.target.value)}/></label>
    <label className="lbl" style=${{ marginTop: 12 }}>Repetir contraseña<input className="field" type="password" value=${p2} onChange=${(e) => setP2(e.target.value)}/></label>
    <div className="row" style=${{ marginTop: 16 }}><button className="btn btn-primary" disabled=${!p1} onClick=${go}>Actualizar</button>
      <button className="btn btn-ghost" onClick=${onLogout}>Cerrar sesión</button></div></div>`;
}

// ---------- arranque ----------
const App = { menu: MenuApp, rapido: QuickApp, ia: AIApp, admin: AdminApp }[MODE] || MenuApp;
createRoot(document.getElementById('root')).render(html`<${App}/>`);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => navigator.serviceWorker.register(BASE + 'sw.js', { scope: BASE }).catch(() => {}));
}
