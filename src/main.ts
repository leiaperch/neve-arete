import './styles.css';
import { Stage } from './stage';
import { Watch, type Colorway } from './watch';
import { Story, type Shot } from './story';
import { ThemeSwitch } from './theme';

const COLORWAYS: Colorway[] = [
  { id: 'neve', name: 'Névé, lunette blanche', variant: 0, swatch: '#e9e8e4', price: 389 },
  { id: 'nuit', name: 'Nuit, noir et laiton', variant: 1, swatch: '#b8914a', price: 429 },
  { id: 'lichen', name: 'Lichen, vert mousse', variant: 2, swatch: '#3f7a5a', price: 389 },
  { id: 'balise', name: 'Balise, rouge de sécurité', variant: 3, swatch: '#c2322b', price: 389 },
];

// un plan par chapitre, dans l'ordre de la page. Repère : cadran face à +Z, centre du cadran en (0, 0, 2,8),
// bracelet refermé derrière jusqu'à z = −3 ; le fond de boîte regarde vers −Z, à l'intérieur de la boucle.
const SHOTS: Shot[] = [
  { id: 'hero', position: [6.5, 3.2, 15.5], target: [0, 0, 0.4] },
  { id: 'cadran', position: [0.4, 0.3, 13.5], target: [0, 0, 2.8] },
  { id: 'altitude', position: [-1.2, 1.4, 7.4], target: [-0.45, 0.45, 2.8] },
  { id: 'lunette', position: [6.8, -3.4, 6.8], target: [0.4, -0.2, 2.6] },
  { id: 'bracelet', position: [8.5, -6, -2.5], target: [0, -1.2, -0.8] },
  // à l'intérieur du bracelet, grand angle, face au fond gravé
  { id: 'fond', position: [0.25, 0.15, -2.7], target: [0, 0, 2], fov: 52 },
  { id: 'coloris', position: [-6.5, 3.4, 15], target: [0, 0, 0.3] },
];

async function boot() {
  const viewport = document.querySelector<HTMLElement>('#viewport')!;
  const bar = document.querySelector<HTMLElement>('#loader-bar')!;
  const stage = new Stage(viewport);
  const themes = new ThemeSwitch((t) => stage.buildStudio(t === 'dark'));
  stage.buildStudio(themes.theme === 'dark');

  const watch = new Watch(stage);
  await watch.load('models/arete.glb', (p) => (bar.style.transform = `scaleX(${p * 0.85})`));

  // sur grand écran, la montre se tient à droite du texte
  const offset = () => {
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    if (w > 900) stage.camera.setViewOffset(w, h, -w * 0.2, 0, w, h);
    else stage.camera.clearViewOffset();
    stage.invalidate();
  };
  const chapters = [...document.querySelectorAll<HTMLElement>('.chapter')];
  const story = new Story(stage, watch.root, SHOTS, chapters);
  new ResizeObserver(() => {
    offset();
    story.zoom = viewport.clientWidth > 900 ? 1 : 1.3;
  }).observe(viewport);
  offset();
  story.onShot = (id) => document.body.setAttribute('data-shot', id);

  await watch.precompile();
  bar.style.transform = 'scaleX(1)';
  document.querySelector('#loader')!.classList.add('done');

  setupClock();
  setupColorways(watch);
  setupEngraving(watch);
  setupOrder();
  liveMetrics(stage);

  if (import.meta.env.DEV) Object.assign(window, { __neve: { stage, watch, story } });
}

function setupClock() {
  const el = document.querySelector('#clock')!;
  const fmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone.split('/').pop()?.replace('_', ' ');
  const tick = () => (el.textContent = `${fmt.format(new Date())} · ${zone}`);
  tick();
  setInterval(tick, 1000);
}

let current = COLORWAYS[0];

function setupColorways(watch: Watch) {
  const host = document.querySelector('#colorways')!;
  const name = document.querySelector('#colorway-name')!;
  const price = document.querySelector('#order-price')!;
  const select = async (c: Colorway) => {
    current = c;
    host.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === c.id)));
    name.textContent = c.name;
    price.textContent = `${c.price} €`;
    document.documentElement.style.setProperty('--colorway', c.swatch);
    await watch.setVariant(c.variant);
  };
  for (const c of COLORWAYS) {
    const b = document.createElement('button');
    b.className = 'colorway';
    b.dataset.id = c.id;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', `${c.name}, ${c.price} euros`);
    b.style.setProperty('--c', c.swatch);
    b.addEventListener('click', () => select(c));
    host.append(b);
  }
  select(COLORWAYS[0]);
}

function setupEngraving(watch: Watch) {
  const input = document.querySelector<HTMLInputElement>('#engrave')!;
  input.addEventListener('input', () => {
    const clean = input.value.toUpperCase().replace(/[^A-Z0-9ÀÂÄÇÉÈÊËÎÏÔÖÙÛÜ '’.\-]/g, '').slice(0, 18);
    if (clean !== input.value) input.value = clean;
    watch.engrave(clean.trim());
  });
}

function setupOrder() {
  const dialog = document.querySelector<HTMLDialogElement>('#order-dialog')!;
  const form = document.querySelector<HTMLFormElement>('#order-form')!;
  const summary = document.querySelector('#order-summary')!;
  const engrave = document.querySelector<HTMLInputElement>('#engrave')!;
  const toast = document.querySelector<HTMLElement>('#toast')!;
  const open = () => {
    const text = engrave.value.trim();
    summary.textContent = `Arête ${current.name.split(',')[0]}, ${current.price} €${text ? `, gravure « ${text} »` : ''}`;
    dialog.showModal();
  };
  document.querySelector('#order')!.addEventListener('click', open);
  document.querySelector('#order-cancel')!.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    dialog.close();
    form.reset();
    toast.textContent = 'Précommande simulée : rien n’a été envoyé, c’est une démonstration.';
    toast.classList.add('on');
    setTimeout(() => toast.classList.remove('on'), 4200);
  });
}

function liveMetrics(stage: Stage) {
  const host = document.querySelector('#metrics')!;
  const out = (k: string) => host.querySelector<HTMLElement>(`[data-live="${k}"]`)!;
  const nf = new Intl.NumberFormat('fr-FR');
  let timer = 0;
  const update = () => {
    const { frames, idle } = stage.stats;
    out('frames').textContent = nf.format(frames);
    out('idle').textContent = `${Math.round((idle / Math.max(1, frames + idle)) * 100)} %`;
    out('calls').textContent = nf.format(stage.renderer.info.render.calls);
    out('dpr').textContent = `${stage.renderer.getPixelRatio().toFixed(2).replace('.', ',')}×`;
  };
  new IntersectionObserver(([e]) => {
    clearInterval(timer);
    if (e.isIntersecting) {
      update();
      timer = window.setInterval(update, 500);
    }
  }).observe(host);
}

boot().catch((err) => {
  console.error(err);
  document.querySelector('#loader')?.classList.add('failed');
});
