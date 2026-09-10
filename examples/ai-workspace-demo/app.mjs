import { copy } from './copy.mjs';
import { initialState, seasons, speeds, applyInstruction, selectVersion, saveVersion } from './model.mjs';

const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8Z M2 12l10 5 10-5 M2 16l10 5 10-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  up: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  file: '<path d="M14 3H5v18h14V8ZM14 3v5h5M8 12h8M8 16h6"/>',
  play: '<path d="m9 5 11 7-11 7Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  leaf: '<path d="M20 3C8 1 2 9 6 16s17 3 14-13ZM5 20 16 9"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  pointer: '<path d="m4 3 5 17 3-7 7-3Z"/>',
};
function icon(name, cls = 'size-4') {
  return `<svg class="${cls} shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.spark}</svg>`;
}
const palette = {
  spring: { sky: '#f2f1df', far: '#d5debd', hill: '#b7cb9a', ground: '#859c71', sun: '#f2c677', leaf: '#d6a1ad' },
  summer: { sky: '#eff1dc', far: '#cbd9b8', hill: '#9eb884', ground: '#6f8c62', sun: '#edb75f', leaf: '#7a985b' },
  autumn: { sky: '#f1ebd9', far: '#e3d2ae', hill: '#c8c5a1', ground: '#9ca77d', sun: '#d98951', leaf: '#bf7049' },
  winter: { sky: '#e7eef0', far: '#d4dfe0', hill: '#b9cbd0', ground: '#9eafb2', sun: '#f3dfae', leaf: '#ffffff' },
};
export function scene(season, title, subtitle) {
  const p = palette[season];
  return `<svg data-scene xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 610" role="img" aria-label="${title}" class="h-full w-full">
    <rect width="1000" height="610" fill="${p.sky}"/>
    <circle cx="784" cy="150" r="49" fill="${p.sun}" opacity=".85"/>
    <path d="M0 351Q147 220 338 340T730 295T1080 338V610H0Z" fill="${p.far}"/>
    <path d="M-50 431Q133 279 351 391T700 364T1050 400V610H0Z" fill="${p.hill}"/>
    <path d="M0 481Q200 417 448 471T1000 444V610H0Z" fill="${p.ground}"/>
    <path d="M0 529Q320 481 590 538T1050 518" fill="none" stroke="${p.sky}" stroke-width="40" opacity=".58"/>
    <g fill="none" stroke="#ffffff" stroke-width="2" opacity=".4"><path d="M123 196h60m-25 11h44M814 269h65m-19 10h43M248 343h47"/></g>
    <text x="63" y="94" fill="#555b48" font-family="sans-serif" font-size="13" letter-spacing="3">${subtitle}</text>
    <text x="60" y="143" fill="#354431" font-family="sans-serif" font-size="32" font-weight="500">${title}</text>
    <g stroke="#717c59" stroke-width="5" stroke-linecap="round"><path d="M114 456v-104m0 39-26-22m26 41 23-22M888 459V342m0 42-24-24m24 49 23-28"/></g>
    <g fill="${p.leaf}"><ellipse cx="112" cy="339" rx="33" ry="46"/><ellipse cx="88" cy="367" rx="18" ry="28" transform="rotate(-30 88 367)"/><ellipse cx="136" cy="382" rx="18" ry="28" transform="rotate(35 136 382)"/><ellipse cx="888" cy="329" rx="36" ry="47"/><ellipse cx="862" cy="354" rx="16" ry="28" transform="rotate(-30 862 354)"/><ellipse cx="913" cy="375" rx="18" ry="29" transform="rotate(25 913 375)"/></g>
    <ellipse cx="516" cy="488" rx="169" ry="15" fill="#425b3b" opacity=".13"/>
    <g stroke="#354a3c" stroke-width="8" fill="${p.sky}"><circle cx="397" cy="432" r="65"/><circle cx="627" cy="432" r="65"/></g>
    <g stroke="#6f7d67" stroke-width="2" fill="none">
      <g class="motion-safe:animate-wheel origin-center [transform-box:fill-box]"><circle cx="397" cy="432" r="57"/><path d="M397 375v114m-57-57h114m-97-40 80 80m-80 0 80-80"/></g>
      <g class="motion-safe:animate-wheel origin-center [transform-box:fill-box]"><circle cx="627" cy="432" r="57"/><path d="M627 375v114m-57-57h114m-97-40 80 80m-80 0 80-80"/></g>
    </g>
    <g stroke="#cf734d" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="m397 432 67-101 55 101H397l-10-108m77 7 140-8-85 109m85-109 23 109m-23-109-12-27h33"/></g>
    <path d="M438 325h47m135-30h18" stroke="#344a3a" stroke-width="9" stroke-linecap="round"/>
    <path d="M469 271Q427 301 366 286q27 51 91 44" fill="#617d4e"/>
    <path d="m396 297 4-13 13 14 5-14 13 11" fill="#425e3e"/>
    <path d="M494 268q-28 13-36 53l64 42-12 53" fill="none" stroke="#4b6843" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="m510 417 25 5" stroke="#f1e9cf" stroke-width="15" stroke-linecap="round"/>
    <path d="M478 240q-20 35-16 68l67 16q22-38 10-69Z" fill="#dc8d55"/>
    <path d="M480 264q25 37 59 90l-12 53" fill="none" stroke="#6a8756" stroke-width="22" stroke-linecap="round"/>
    <path d="m528 409 24 8" stroke="#f1e9cf" stroke-width="15" stroke-linecap="round"/>
    <path d="M516 261q35 19 51 50l42-9" fill="none" stroke="#658352" stroke-width="18" stroke-linecap="round"/>
    <path d="M481 207q-17 48 24 57 35 1 57-26h51q26-3 19-26l-70-4q-4-42-41-36-35 0-40 35Z" fill="#6e8b56"/>
    <path d="M559 226h58q-10 20-53 14" fill="#b2bf84"/>
    <path d="M567 226h48" stroke="#415e3c" stroke-width="3" stroke-linecap="round"/>
    <path d="m575 227 5 7 5-7m7 0 5 7 5-7" fill="#f8f2da"/>
    <circle cx="548" cy="195" r="12" fill="#f5f0d9"/><circle cx="552" cy="195" r="4" fill="#304931"/><circle cx="617" cy="214" r="3" fill="#405c35"/>
    <path d="M481 194q13-36 52-27" fill="none" stroke="#455e3e" stroke-width="6" stroke-linecap="round"/>
    <path d="m480 238-39 4 17 13-20 6 46-2" fill="#eee5c7"/>
    <circle cx="519" cy="432" r="12" fill="#e6cfad" stroke="#536947" stroke-width="4"/>
    <g fill="${p.leaf}" opacity=".9"><path d="M713 385q22-20 31-3-20 17-31 3M248 415q18-18 26-2-15 15-26 2M778 452q17-17 28-3-17 16-28 3"/></g>
    <g fill="#f4efdd" opacity=".6"><circle cx="187" cy="461" r="3"/><circle cx="204" cy="452" r="2"/><circle cx="757" cy="487" r="3"/><circle cx="824" cy="461" r="2"/></g>
  </svg>`;
}

export function mount(doc) {
  let state = initialState();
  let lastFocus = null;
  const root = doc.getElementById('app');
  const t = (key) => copy[key];
  const button = (action, label, symbol, cls = '', attrs = '') => `<button type="button" data-action="${action}" class="inline-flex items-center justify-center gap-2 rounded-lg transition-colors disabled:cursor-default disabled:opacity-40 ${cls}" ${attrs}>${symbol ? icon(symbol) : ''}${label ? `<span>${label}</span>` : ''}</button>`;
  const subtle = 'px-3 py-2 text-xs text-muted hover:bg-black/5 hover:text-ink';
  const nav = (key, symbol) => button(`view:${key}`, t(key), symbol, `w-full justify-start! px-3 py-2.5 text-[13px] ${state.view === key ? 'bg-white/10 text-white' : 'text-stone-400 hover:bg-white/5 hover:text-white'}`, `aria-current="${state.view === key ? 'page' : 'false'}"`);
  function sidebar() {
    return `<aside class="${state.focused ? 'hidden' : state.mobileNav ? 'fixed inset-y-0 left-0 z-40 flex w-64' : 'hidden w-56 shrink-0 lg:flex'} flex-col bg-[#252923] text-white">
      <div class="flex h-20 items-center gap-2.5 px-6"><span class="grid size-7 place-items-center rounded-lg bg-[#c8dbad] text-[#293825]">${icon('layers', 'size-4')}</span><span class="text-xl font-semibold tracking-tight">${t('brand')}</span>${state.mobileNav ? button('mobile', '', 'x', 'ml-auto p-1', `aria-label="${t('close')}"`) : ''}</div>
      <div class="px-4">${button('search', t('searchShort') + '<kbd class="ml-16 text-[10px]">⌘ K</kbd>', 'search', 'w-full justify-start! rounded-lg border border-white/10 px-3 py-2 text-xs text-stone-400')}</div>
      <nav aria-label="${t('workspace')}" class="space-y-1 px-3 pt-6">${nav('overview','grid')}${nav('resources','layers')}${nav('automations','clock')}</nav>
      <div class="mt-9 flex items-center justify-between px-6 text-[10px] tracking-[.14em] text-stone-500"><span>${t('workspace')}</span>${icon('plus', 'size-3')}</div>
      <div class="mt-3 px-3">${nav('studio','spark')}<div class="ml-5 mt-1 space-y-1 border-l border-white/10 pl-3"><button data-action="view:studio" class="w-full rounded-md px-3 py-2 text-left text-xs text-[#c6d5b4]">${t('campaign')}</button><button data-action="document:brief" class="w-full rounded-md px-3 py-2 text-left text-xs text-stone-400 hover:text-white">${t('brief')}</button></div></div>
      <div class="mt-auto px-5 pb-5 pt-8"><div class="mb-5 rounded-xl border border-white/10 p-3.5"><div class="mb-2 flex items-center gap-2 text-[11px] text-[#bfcbb3]"><span class="size-1.5 rounded-full bg-[#aeca8f]"></span>${t('connected')}</div><p class="text-[10px] leading-5 text-stone-500">${t('tagline')}</p></div><div class="flex items-center gap-2.5 border-t border-white/10 pt-4"><span class="grid size-8 place-items-center rounded-full bg-[#a0ae90] text-xs text-[#283321]">O</span><div><p class="text-xs text-stone-200">One</p><p class="mt-1 text-[10px] text-stone-500">${t('personal')}</p></div></div></div>
    </aside>`;
  }
  function header() {
    return `<header class="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-line bg-[#fafbf7] px-4 sm:px-7"><div class="flex min-w-0 items-center gap-3 text-xs">${button('mobile', '', 'menu', 'p-1 lg:hidden', `aria-label="${t('mobileMenu')}"`)}<span class="hidden text-muted sm:inline">${t('personal')}</span><span class="hidden text-stone-300 sm:inline">/</span><span class="truncate">${t(state.view === 'document' ? (state.document ?? 'brief') : state.view)}</span><span class="hidden rounded border border-line px-1.5 py-0.5 text-[9px] tracking-wide text-muted sm:inline">${t('demo')}</span></div><div class="flex shrink-0 items-center gap-2">${button('search', '', 'search', 'p-2 text-muted hover:bg-black/5', `aria-label="${t('search')}"`)}${button('new', t('newWork'), 'plus', 'border border-line bg-white px-3 py-2 text-[11px] shadow-xs')}</div></header>`;
  }
  function versionList() {
    return `<div class="absolute right-0 top-10 z-20 w-64 rounded-xl border border-line bg-white p-2 shadow-xl"><p class="px-2 py-2 text-[10px] text-muted">${t('versionNote')}</p>${[...state.versions].reverse().map(v => `<button data-action="version:${v.id}" class="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-paper"><span class="grid size-8 place-items-center rounded-md bg-paper font-mono text-xs">v${v.id}</span><span class="flex-1 text-xs">${t(v.label)}</span>${v.id === state.version ? icon('check') : ''}</button>`).join('')}</div>`;
  }
  function studio() {
    const speedClass = { slow: '[--ride-duration:4s]', normal: '[--ride-duration:2s]', fast: '[--ride-duration:.8s]' }[state.speed];
    return `<div class="flex min-h-0 flex-1 flex-col xl:flex-row"><section class="min-w-0 flex-1 overflow-y-auto px-4 py-7 sm:px-8 xl:px-9">
      <div class="mx-auto max-w-6xl"><div class="mb-6 flex flex-wrap items-start justify-between gap-3"><div><div class="mb-3 flex items-center gap-2 text-[10px] tracking-wide text-muted"><span class="size-1.5 rounded-full bg-[#88a16e]"></span>${t('creative')}<span class="px-1 text-stone-300">/</span>${t('campaign')}</div><h1 class="text-2xl font-medium tracking-tight sm:text-[28px]">${t('object')}</h1><p class="mt-2 text-xs leading-5 text-muted">${t('objectSub')}</p></div>${button('export', t('export'), 'download', 'border border-line bg-white px-3 py-2 text-xs hover:bg-stone-50')}</div>
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2"><div class="flex items-center gap-3 text-[11px]"><span class="font-medium">${t('preview')}</span><span class="h-3 w-px bg-line"></span><span class="flex items-center gap-1 text-muted">${state.dirty ? '<span class="size-1.5 rounded-full bg-amber-500"></span>' : icon('check','size-3')}${t(state.dirty ? 'draft' : 'saved')}</span></div><div class="flex items-center gap-1"><details class="relative"><summary class="flex list-none items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] hover:bg-black/5">${t('history')} <span class="font-mono text-muted">v${state.version}</span>${icon('down','size-3')}</summary>${versionList()}</details>${button('focus','', 'expand', 'p-2 text-muted hover:bg-black/5', `aria-label="${t(state.focused ? 'exitFocus' : 'focus')}" title="${t(state.focused ? 'exitFocus' : 'focus')}"`)}${button('panel','', 'panel', 'p-2 text-muted hover:bg-black/5', `aria-label="${t(state.panelOpen ? 'hidePanel' : 'showPanel')}" aria-expanded="${state.panelOpen}"`)}</div></div>
      <div class="overflow-hidden rounded-xl border ${state.selected ? 'border-accent ring-2 ring-accent/15' : 'border-[#d9ddd0]'} bg-[#f1ebd9] shadow-[0_8px_32px_-16px_#4d58373b]"><div class="relative ${speedClass} ${state.playing ? '' : '[&_svg_g]:[animation-play-state:paused]'}"><div class="absolute left-5 top-4 z-10 flex items-center gap-1.5 rounded-full border border-black/5 bg-white/45 px-2.5 py-1 text-[8px] tracking-[.14em] text-[#566149]"><span class="size-1 rounded-full bg-[#75875f]"></span>${t('live')}</div><div class="aspect-[1000/610]">${scene(state.season,t('sceneTitle'),t('sceneSub'))}</div>${button('select', t(state.selected ? 'background' : 'selectBackground'), 'pointer', `absolute bottom-4 right-4 border border-white/40 px-2.5 py-1.5 text-[10px] shadow-sm backdrop-blur-md ${state.selected ? 'bg-accent text-white' : 'bg-white/65 text-[#46513e]'}`, `aria-pressed="${state.selected}"`)}</div>
      <div class="flex flex-wrap items-center justify-between gap-3 border-t border-black/5 bg-[#fafbf6] px-4 py-3"><div class="flex items-center gap-3">${button('play','', state.playing ? 'pause' : 'play','size-8 rounded-full! border border-line bg-white text-ink', `aria-label="${t(state.playing ? 'pause' : 'play')}" aria-pressed="${state.playing}"`)}<span class="font-mono text-[10px] text-muted">00:00 <span class="px-1 text-stone-300">/</span> ∞</span><label class="sr-only" for="speed">${t('speed')}</label><select id="speed" class="rounded-md border border-line bg-transparent px-2 py-1 text-[10px]">${speeds.map(s => `<option value="${s}" ${s===state.speed?'selected':''}>${t(s)}</option>`).join('')}</select></div><div class="flex items-center gap-1" role="group" aria-label="${t('season')}">${seasons.map(s=>button(`season:${s}`,t(s),'',`px-2.5 py-1.5 text-[10px] ${state.season===s ? 'bg-[#e5eadb] font-medium text-[#455738]' : 'text-muted hover:bg-black/5'}`,`aria-pressed="${state.season===s}"`)).join('')}</div></div></div>
      <div class="mt-6 flex items-center justify-between"><h2 class="text-[11px] font-medium text-muted">${t('related')}</h2><span class="font-mono text-[10px] text-stone-400">03</span></div><div class="mt-3 grid gap-3 sm:grid-cols-2">${resourceCard('brief','file','bg-[#e9e6dd]','briefSub')}${resourceCard('notes','spark','bg-[#e4e9dc]','notesSub')}</div><p class="py-6 text-center text-[9px] tracking-[.1em] text-stone-400">${t('footer')}</p></div>
      </section>${state.panelOpen && !state.focused ? collaborationPanel() : ''}</div>`;
  }
  function resourceCard(key, symbol, color, sub) {
    return `<button data-action="document:${key}" class="group flex items-center gap-3 rounded-xl border border-line bg-[#fafbf8] p-3.5 text-left transition hover:border-stone-400"><span class="grid size-10 shrink-0 place-items-center rounded-lg ${color} text-[#68715e]">${icon(symbol,'size-4')}</span><span class="min-w-0 flex-1"><span class="block text-xs font-medium">${t(key)}</span><span class="mt-1.5 block text-[10px] text-muted">${t(sub)}</span></span>${icon('chevron','size-3 text-stone-400')}</button>`;
  }
  function replyText() {
    if (!state.reply) return '';
    const reply = state.reply;
    if (reply.key === 'updateReply') return '已调整为「' + t(reply.season) + '」，速度为「' + t(reply.speed) + '」。预览已更新，可保存为新版本。';
    if (reply.key === 'savedReply') return '已保存为 ' + reply.version + '。你可以在版本列表中回看。';
    if (reply.key === 'versionSelected') return '正在查看 ' + reply.version + '。';
    return t(reply.key);
  }
  function collaborationPanel() {
    const tabs = ['collaborate','context','activity'];
    let content = '';
    if(state.panel === 'collaborate') content = `<div class="mb-6 flex items-center gap-2.5"><span class="grid size-8 place-items-center rounded-full bg-[#e7ecdd] text-[#627a4a]">${icon('spark')}</span><div><p class="text-xs font-semibold">${t('assistant')}</p><p class="mt-1 text-[9px] text-muted">${t('assistantMeta')}</p></div></div><p class="text-[12px] leading-7 text-[#5e655a]">${t('welcome')}</p><div class="mt-5 rounded-xl border border-line bg-[#f7f8f2] p-4"><p class="mb-3 text-[11px] font-medium">${t('doneTitle')}</p>${['doneOne','doneTwo','doneThree'].map(key=>`<p class="mt-2.5 flex items-center gap-2 text-[10px] text-muted">${icon('check','size-3 text-[#81956b]')}${t(key)}</p>`).join('')}<div class="mt-4 border-t border-line pt-3 text-[9px] text-[#7a8a6a]">${t('ready')} <span class="px-1.5 text-stone-300">·</span> v${state.version}</div></div><p class="mb-3 mt-7 text-[10px] text-muted">${t('suggestionTitle')}</p><div class="space-y-2">${button('suggest:autumn',t('suggestAutumn'),'leaf','w-full justify-start! border border-line px-3 py-2.5 text-[10px] text-[#656e5a] hover:bg-paper')}${button('suggest:winter',t('suggestWinter'),'spark','w-full justify-start! border border-line px-3 py-2.5 text-[10px] text-[#656e5a] hover:bg-paper')}</div>${state.reply ? `<div role="status" class="mt-5 rounded-xl bg-[#edf2e6] p-3 text-[11px] leading-6 text-[#536744]">${replyText()}</div>` : ''}`;
    if(state.panel === 'context') content = `<p class="mb-5 text-xs leading-6 text-muted">${t('contextDescription')}</p>${['brief','notes','reference'].map((key,i)=>`<div class="mb-3 rounded-xl border border-line p-4"><div class="mb-3 flex items-center gap-2 text-xs">${icon('file')}${t(key)}</div><p class="text-[11px] leading-6 text-muted">${t(['contextBrief','contextNotes','contextReference'][i])}</p><p class="mt-3 text-[9px] text-[#8a9b75]">${t('contextScope')}</p></div>`).join('')}`;
    if(state.panel === 'activity') content = `<div class="ml-2 border-l border-line pl-5">${['activityOne','activityTwo','activityThree'].map((key,i)=>`<div class="relative pb-8"><span class="absolute -left-[26px] top-1 size-2 rounded-full bg-[#91a77b] ring-4 ring-[#fcfcf9]"></span><p class="text-[11px]">${t(key)}</p><p class="mt-2 text-[10px] text-muted">${t(['justNow','beforeFive','beforeTwelve'][i])}</p></div>`).join('')}</div>`;
    return `<aside aria-label="${t('collaborate')}" class="flex shrink-0 flex-col border-t border-line bg-[#fcfcf9] xl:w-[304px] xl:border-l xl:border-t-0 2xl:w-[330px]"><div class="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5" role="tablist">${tabs.map(key=>button(`tab:${key}`,t(key),'',`h-full rounded-none! border-b-2 px-0 text-[11px] ${state.panel===key?'border-[#536747] text-[#3f5135]':'border-transparent text-muted'}`,`role="tab" aria-selected="${state.panel===key}"`)).join('')}${button('panel','','panel','ml-auto p-1 text-stone-400',`aria-label="${t('hidePanel')}"`)}</div><div class="min-h-0 flex-1 overflow-y-auto px-5 py-6" role="tabpanel">${content}</div><form id="composer" class="m-4 rounded-xl border border-[#d9ddd1] bg-white p-3 shadow-[0_4px_20px_-12px_#43553650]"><div class="mb-2 flex items-center gap-1.5 text-[9px] text-muted"><span>${t('scope')}</span><button type="button" data-action="select" class="flex items-center gap-1 rounded bg-[#eef0e8] px-1.5 py-1 text-[#637151]">${icon(state.selected?'pointer':'layers','size-3')}${t(state.selected?'background':'selection')}</button></div><label class="sr-only" for="instruction">${t('placeholder')}</label><textarea id="instruction" rows="3" maxlength="500" class="w-full resize-none border-0 bg-transparent py-1 text-xs leading-6 placeholder:text-stone-400 focus:outline-none" placeholder="${t('placeholder')}"></textarea><div class="flex items-center justify-between gap-1"><span class="text-[8px] text-stone-400">${t('demoHint')}</span><button type="submit" aria-label="${t('send')}" class="grid size-7 place-items-center rounded-lg bg-accent text-white hover:bg-blue-700">${icon('up','size-4')}</button></div></form>${button('save', t('save'), 'check', 'mx-4 mb-4 border border-line bg-[#f0f3e9] px-3 py-2.5 text-[11px] text-[#5c714b]',state.dirty?'':'disabled')}</aside>`;
  }
  function overview() {
    return `<section class="flex-1 overflow-y-auto p-5 sm:p-10"><div class="mx-auto max-w-5xl"><p class="mt-5 text-[10px] tracking-[.22em] text-[#89957a]">${t('homeEyebrow')}</p><h1 class="mt-5 max-w-2xl text-3xl leading-tight tracking-tight sm:text-5xl">${t('greeting')}</h1><p class="mt-5 text-sm leading-7 text-muted">${t('homeSubtitle')}</p><div class="mb-12 mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#dedfcf] bg-[#eceedd] p-6"><div><p class="mb-3 flex items-center gap-2 text-[10px] text-[#7b845c]">${icon('spark','size-3')}${t('attention')}</p><p class="text-lg">${t('attentionTitle')}</p><p class="mt-2 text-xs text-muted">${t('attentionText')}</p></div>${button('view:studio',t('review'),'arrow','bg-[#3c4c32] px-4 py-3 text-xs text-white hover:bg-[#526345]')}</div><div class="mb-4 flex items-center justify-between"><h2 class="text-sm">${t('continuing')}</h2><span class="text-[10px] text-muted">${t('spaceNote')}</span></div><button data-action="view:studio" class="grid w-full overflow-hidden rounded-2xl border border-line bg-white text-left md:grid-cols-2"><div class="overflow-hidden">${scene('autumn',t('sceneTitle'),t('sceneSub'))}</div><div class="flex flex-col items-start justify-center p-8"><span class="text-[10px] text-muted">${t('studio')}</span><h3 class="mt-3 text-2xl">${t('object')}</h3><p class="mt-3 text-xs leading-6 text-muted">${t('projectDescription')}</p><span class="mt-6 flex items-center gap-2 text-xs text-[#647b50]">${t('review')}${icon('arrow')}</span></div></button></div></section>`;
  }
  function library() {
    return `<section class="flex-1 overflow-y-auto p-5 sm:p-10"><div class="mx-auto max-w-5xl"><p class="mb-4 text-[10px] tracking-widest text-muted">${t('resources')}</p><h1 class="text-3xl tracking-tight">${t('libraryTitle')}</h1><p class="mt-4 text-sm text-muted">${t('librarySubtitle')}</p><div class="mt-10 grid gap-5 md:grid-cols-3"><button data-action="view:studio" class="overflow-hidden rounded-xl border border-line bg-white text-left"><div>${scene(state.season,t('sceneTitle'),t('sceneSub'))}</div><div class="p-5"><p class="text-sm">${t('object')}</p><p class="mt-2 text-[10px] text-muted">${t('fileType')} · v${state.version}</p></div></button>${['brief','notes'].map((key,i)=>`<button data-action="document:${key}" class="rounded-xl border border-line bg-[#fcfcf7] p-6 text-left"><span class="mb-6 grid size-12 place-items-center rounded-xl ${i?'bg-[#e8edde]':'bg-[#eee8db]'} text-[#7a846e]">${icon(i?'spark':'file','size-6')}</span><h2 class="text-sm">${t(key)}</h2><p class="mt-3 text-[11px] leading-6 text-muted">${t(i?'contextNotes':'contextBrief')}</p><p class="mt-5 text-[10px] text-muted">${t(i?'noteType':'docType')}</p></button>`).join('')}</div></div></section>`;
  }
  function routines() {
    return `<section class="flex-1 overflow-y-auto p-5 sm:p-10"><div class="mx-auto max-w-4xl"><p class="mb-4 text-[10px] tracking-widest text-muted">${t('automations')}</p><h1 class="text-3xl">${t('runningTitle')}</h1><p class="mt-4 text-sm leading-7 text-muted">${t('runningSubtitle')}</p><div class="mt-10 rounded-2xl border border-line bg-white p-6"><div class="flex items-center gap-4"><span class="grid size-12 shrink-0 place-items-center rounded-xl bg-[#edf0e4] text-[#73885c]">${icon('clock','size-6')}</span><div class="flex-1"><h2 class="text-base">${t('routine')}</h2><p class="mt-1 text-[11px] text-muted">${t('schedule')}</p></div><button data-action="routine" role="switch" aria-checked="${state.routine}" aria-label="${t('routine')}" class="flex h-6 w-11 shrink-0 items-center rounded-full p-1 ${state.routine?'justify-end bg-[#7d9665]':'justify-start bg-stone-300'}"><span class="size-4 rounded-full bg-white shadow-sm"></span></button></div><p class="mt-5 text-xs leading-7 text-muted">${t('routineDesc')}</p><p class="mt-5 border-t border-line pt-4 text-xs text-[#7b8c68]" role="status">${t(state.routine?'enabled':'disabled')}</p></div><p class="mt-4 text-[11px] text-muted">${t('routineHint')}</p></div></section>`;
  }
  function documentView() {
    const key = state.document ?? 'brief';
    return `<section class="flex-1 overflow-y-auto px-5 py-8 sm:px-10">${button('view:studio',t('back'),'arrow',subtle)}<article class="mx-auto mt-5 max-w-2xl rounded-xl border border-line bg-[#fffefa] px-7 py-12 shadow-sm sm:px-14"><span class="text-[10px] tracking-wide text-muted">${t('studio')} / ${t('campaign')}</span><h1 class="mb-8 mt-7 text-3xl">${t(key)}</h1><p class="mb-7 text-sm leading-8 text-[#6e7568]">${t(key==='notes'?'contextNotes':'contextBrief')}</p><div class="mb-7 flex gap-2"><span class="h-10 flex-1 rounded bg-[#6e8b56]"></span><span class="h-10 flex-1 rounded bg-[#f1ebd9]"></span><span class="h-10 flex-1 rounded bg-[#dc8d55]"></span></div><p class="text-sm leading-8 text-[#6e7568]">${t('contextReference')}</p><div class="mt-10 border-t border-line pt-5">${button('view:studio',t('review'),'arrow','text-xs text-[#71825e]')}</div></article></section>`;
  }
  function dialogs() {
    return `<dialog id="search-dialog" class="fixed inset-0 m-auto max-h-[80dvh] w-[min(560px,calc(100%_-_32px))] rounded-2xl border border-line bg-white p-0 shadow-2xl backdrop:bg-[#1c271e]/35 backdrop:backdrop-blur-sm"><div class="flex items-center gap-3 border-b border-line p-4">${icon('search','size-5 text-muted')}<input id="search-input" aria-label="${t('search')}" placeholder="${t('search')}" class="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none">${button('close-search','','x','p-1 text-muted',`aria-label="${t('close')}"`)}</div><p class="px-5 pt-4 text-[10px] text-muted">${t('searchHint')}</p><div id="search-results" class="p-3"></div></dialog><dialog id="new-dialog" class="fixed inset-0 m-auto w-[min(440px,calc(100%_-_32px))] rounded-2xl border border-line bg-white p-7 shadow-2xl backdrop:bg-[#1c271e]/35"><div class="flex justify-between">${icon('spark','size-7 text-[#839b68]')}${button('close-new','','x','p-1 text-muted',`aria-label="${t('close')}"`)}</div><h2 class="mt-6 text-xl">${t('quickStart')}</h2><p class="my-5 text-sm leading-7 text-muted">${t('quickText')}</p>${button('view:studio',t('review'),'arrow','w-full bg-[#3c4c32] px-4 py-3 text-xs text-white')}</dialog>`;
  }
  function render() {
    const active = doc.activeElement;
    const action = active?.getAttribute('data-action');
    state.draftInput = doc.getElementById('instruction')?.value ?? state.draftInput ?? '';
    const composerValue = state.draftInput;
    doc.documentElement.lang = 'zh-CN';
    doc.title = t('title');
    root.innerHTML = `<div class="flex min-h-dvh xl:h-dvh xl:overflow-hidden">${sidebar()}<main class="flex min-h-dvh min-w-0 flex-1 flex-col xl:min-h-0">${header()}${state.view==='studio'?studio():state.view==='overview'?overview():state.view==='resources'?library():state.view==='automations'?routines():documentView()}</main>${dialogs()}</div>`;
    const composer = doc.getElementById('instruction');
    if (composer) composer.value = composerValue;
    if(action) [...root.querySelectorAll('[data-action]')].find(el => el.getAttribute('data-action') === action)?.focus({ preventScroll: true });
  }
  function searchResults(query='') {
    const keys = ['overview','studio','resources','automations'];
    const found = keys.filter(key=>(t(key)+(key==='studio'?t('object')+t('preview'):'')).toLowerCase().includes(query.toLowerCase()));
    doc.getElementById('search-results').innerHTML = found.length ? found.map(key=>button(`view:${key}`,t(key),'arrow','w-full justify-start! px-3 py-3 text-sm hover:bg-paper')).join('') : `<p class="p-3 text-xs leading-6 text-muted">${t('noResults')}</p>`;
  }
  function openDialog(id) { lastFocus = doc.activeElement; doc.getElementById(id).showModal(); }
  function closeDialog(id) { doc.getElementById(id).close(); lastFocus?.focus(); }
  function submit() {
    const input = doc.getElementById('instruction');
    state = applyInstruction(state,input.value);
    state.panel = 'collaborate';
    if(state.reply.key==='updateReply') input.value='';
    render();
    doc.getElementById('instruction')?.focus();
  }
  function download() {
    const svg = root.querySelector('[data-scene]').cloneNode(true);
    // Export a portable, static SVG: the workspace alone owns playback controls.
    svg.querySelectorAll('[class]').forEach(node=>node.removeAttribute('class'));
    const blob = new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a'); a.href=url; a.download=`seasonal-ride-v${state.version}.svg`; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function actionHandler(action) {
    const [kind,value] = action.split(':');
    if(kind==='view') { state.view=value; state.focused=false; state.mobileNav=false; }
    else if(kind==='season' && seasons.includes(value)) state={...state,season:value,dirty:true};
    else if(kind==='play') state.playing=!state.playing;
    else if(kind==='select') { state.selected=!state.selected; if(state.selected){state.panelOpen=true;state.panel='collaborate';} }
    else if(kind==='focus') state.focused=!state.focused;
    else if(kind==='panel') {state.panelOpen=!state.panelOpen; if(state.focused) state.focused=false;}
    else if(kind==='tab') state.panel=value;
    else if(kind==='mobile') state.mobileNav=!state.mobileNav;
    else if(kind==='routine') state.routine=!state.routine;
    else if(kind==='version') state=selectVersion(state,Number(value));
    else if(kind==='save') state=saveVersion(state);
    else if(kind==='suggest') {state=applyInstruction(state,t(value==='autumn'?'suggestAutumn':'suggestWinter'));state.panel='collaborate';}
    else if(kind==='document') {state.view='document';state.document=value;state.mobileNav=false;}
    else if(kind==='search') {openDialog('search-dialog'); searchResults(); doc.getElementById('search-input').focus(); return;}
    else if(kind==='new') {openDialog('new-dialog');return;}
    else if(kind==='close-search') {closeDialog('search-dialog');return;}
    else if(kind==='close-new') {closeDialog('new-dialog');return;}
    else if(kind==='export') {download();return;}
    render();
  }
  root.addEventListener('click',event=>{
    const action = event.target.closest('[data-action]')?.getAttribute('data-action');
    if(action) actionHandler(action);
  });
  root.addEventListener('submit',event=>{if(event.target.id==='composer'){event.preventDefault();submit();}});
  root.addEventListener('change',event=>{if(event.target.id==='speed' && speeds.includes(event.target.value)){state={...state,speed:event.target.value,dirty:true};render();}});
  root.addEventListener('input',event=>{if(event.target.id==='search-input')searchResults(event.target.value);});
  doc.addEventListener('keydown',event=>{
    if((event.metaKey||event.ctrlKey) && event.key.toLowerCase()==='k'){event.preventDefault();openDialog('search-dialog');searchResults();doc.getElementById('search-input').focus();}
    if(event.key==='Enter' && !event.shiftKey && !event.isComposing && event.target.id==='instruction'){event.preventDefault();submit();}
    if(event.key==='Escape' && state.mobileNav){state.mobileNav=false;render();}
  });
  render();
  return { getState:()=>structuredClone(state), render };
}
if(typeof document !== 'undefined') mount(document);
