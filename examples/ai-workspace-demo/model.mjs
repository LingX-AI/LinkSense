export const seasons = ['spring', 'summer', 'autumn', 'winter'];
export const speeds = ['slow', 'normal', 'fast'];
export function initialState() {
  return {
    view: 'studio', panel: 'collaborate', panelOpen: true, focused: false, mobileNav: false,
    season: 'autumn', speed: 'normal', playing: true, selected: false, dirty: false,
    version: 3, routine: true, reply: null,
    versions: [
      { id: 1, season: 'spring', speed: 'normal', label: 'v1' },
      { id: 2, season: 'summer', speed: 'fast', label: 'v2' },
      { id: 3, season: 'autumn', speed: 'normal', label: 'v3' },
    ],
  };
}
export function applyInstruction(state, input) {
  const text = input.trim().toLowerCase();
  if (!text) return { ...state, reply: { key: 'emptyInput' } };
  const match = [ [/春|spring/, 'spring'], [/夏|summer/, 'summer'], [/秋|autumn|fall/, 'autumn'], [/冬|winter/, 'winter'] ].find(([pattern]) => pattern.test(text));
  const speed = /慢|slow/.test(text) ? 'slow' : /快|fast/.test(text) ? 'fast' : /正常|normal/.test(text) ? 'normal' : null;
  if (!match && !speed) return { ...state, reply: { key: 'unsupported' } };
  const next = { ...state, season: match?.[1] ?? state.season, speed: speed ?? state.speed, dirty: true };
  return { ...next, reply: { key: 'updateReply', season: next.season, speed: next.speed } };
}
export function selectVersion(state, id) {
  const version = state.versions.find((item) => item.id === id);
  if (!version) return state;
  return { ...state, version: id, season: version.season, speed: version.speed, dirty: false, reply: { key: 'versionSelected', version: `v${id}` } };
}
export function saveVersion(state) {
  if (!state.dirty) return state;
  const id = Math.max(...state.versions.map((v) => v.id)) + 1;
  return { ...state, version: id, dirty: false, versions: [...state.versions, { id, season: state.season, speed: state.speed, label: 'customVersion' }], reply: { key: 'savedReply', version: `v${id}` } };
}
