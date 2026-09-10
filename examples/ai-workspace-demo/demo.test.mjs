import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { initialState, applyInstruction, selectVersion, saveVersion } from './model.mjs';
import { mount } from './app.mjs';
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
function fixture(view = 'studio', width = 1024) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>');
  Object.defineProperty(dom.window, 'innerWidth', {value:width, writable:true});
  const doc = dom.window.document;
  const app = mount(doc);
  const click = (action) => {
    const element = doc.querySelector(`[data-action="${action}"]`);
    expect(element, action).not.toBeNull();
    element.click();
  };
  if(view === 'studio') click('view:studio');
  return { dom, doc, app, click };
}
describe('作品版本与指令', () => {
  it('用中文同时修改季节与速度，保留原版本快照', () => {
    const initial = initialState();
    const next = applyInstruction(initial, '换成冬天，骑得慢一点');
    expect(next).toMatchObject({ season:'winter', speed:'slow', dirty:true });
    expect(initial).toMatchObject({ season:'autumn', speed:'normal', dirty:false });
    expect(next.versions[2]).toMatchObject({ season:'autumn', speed:'normal' });
  });
  it('对空输入和不支持的指令给出明确提示，保留作品', () => {
    expect(applyInstruction(initialState(), '   ')).toMatchObject({ reply:{key:'emptyInput'}, dirty:false });
    expect(applyInstruction(initialState(), '帮我发送邮件')).toMatchObject({ season:'autumn', reply:{key:'unsupported'}, dirty:false });
  });
  it('保存新版本后可恢复旧版，再保存时版本号仍递增', () => {
    const saved = saveVersion(applyInstruction(initialState(),'冬天慢一点'));
    expect(saved).toMatchObject({version:4,dirty:false});
    const old = selectVersion(saved,1);
    expect(old).toMatchObject({version:1,season:'spring',speed:'normal'});
    const next = saveVersion(applyInstruction(old,'夏天快一点'));
    expect(next.version).toBe(5);
    expect(next.versions).toHaveLength(5);
    expect(selectVersion(next,4)).toMatchObject({season:'winter',speed:'slow'});
  });
  it('无调整时不创建重复版本，未知版本不会修改作品',()=>{
    const initial=initialState();
    expect(saveVersion(initial)).toBe(initial);
    expect(selectVersion(initial,99)).toBe(initial);
  });
});
describe('中文工作空间交互',()=>{
  it('默认成果占据主区，包含可访问的播放和季节控件',()=>{
    const {doc,dom}=fixture();
    expect(doc.querySelector('h1').textContent).toBe('鳄鱼的四季骑行');
    expect(doc.querySelector('[data-scene]').getAttribute('viewBox')).toBe('0 0 1000 610');
    expect(doc.querySelector('[data-action="play"]').getAttribute('aria-label')).toBe('暂停');
    expect(doc.body.textContent).not.toContain('undefined');
    expect(doc.querySelectorAll('[data-action="language"]')).toHaveLength(0);
    dom.window.close();
  });
  it('季节、播放和速度控件更新作品与状态',()=>{
    const {doc,dom,app,click}=fixture();
    const sky=doc.querySelector('[data-scene] rect').getAttribute('fill');
    click('season:winter');
    expect(doc.querySelector('[data-scene] rect').getAttribute('fill')).not.toBe(sky);
    expect(doc.querySelector('[data-action="season:winter"]').getAttribute('aria-pressed')).toBe('true');
    click('play');expect(app.getState().playing).toBe(false);
    expect(doc.querySelector('[data-action="play"]').getAttribute('aria-label')).toBe('播放');
    const speed=doc.getElementById('speed');speed.value='fast';speed.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    expect(app.getState().speed).toBe('fast');
    dom.window.close();
  });
  it('指令提交修改预览，保存版本，再通过版本菜单恢复',()=>{
    const {doc,dom,app,click}=fixture();
    doc.getElementById('instruction').value='冬天慢一点';
    doc.getElementById('composer').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
    expect(app.getState()).toMatchObject({season:'winter',speed:'slow'});
    expect(doc.querySelector('[role="status"]').textContent).toContain('冬日');
    click('save');expect(app.getState().version).toBe(4);
    expect(doc.querySelector('[data-action="save"]').disabled).toBe(true);
    click('version:1');expect(app.getState().season).toBe('spring');
    dom.window.close();
  });
  it('选中背景明确作用范围，切换面板保留未发送的输入',()=>{
    const {doc,dom,click}=fixture();
    doc.getElementById('instruction').value='还没写完的想法';
    click('select');
    expect(doc.getElementById('composer').textContent).toContain('动画背景');
    click('tab:context');
    expect(doc.querySelector('[role="tabpanel"]').textContent).toContain('角色与配色参考');
    expect(doc.getElementById('instruction').value).toBe('还没写完的想法');
    click('panel');click('panel');
    expect(doc.getElementById('instruction').value).toBe('还没写完的想法');
    click('tab:activity');expect(doc.querySelector('[role="tabpanel"]').textContent).toContain('加入速度控制');
    dom.window.close();
  });
  it('总览、成果库、资料页、计划开关均可操作',()=>{
    const {doc,dom,app,click}=fixture();
    for(const view of ['overview','resources','automations']) {
      click(`view:${view}`);expect(app.getState().view).toBe(view);
      expect(doc.body.textContent).not.toContain('undefined');
    }
    click('routine');expect(doc.querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('false');
    click('document:brief');expect(doc.querySelector('article h1').textContent).toBe('创作说明');
    click('view:studio');click('focus');expect(app.getState().focused).toBe(true);
    click('focus');click('panel');expect(doc.querySelector('[role="tabpanel"]')).toBeNull();
    click('panel');expect(doc.querySelector('[role="tabpanel"]')).not.toBeNull();
    dom.window.close();
  });
  it('HTML 离线交付包含编译后的 Tailwind 样式和脚本，无外部依赖',()=>{
    const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
    const dom=new JSDOM(html, { runScripts:'outside-only' });
    const script=dom.window.document.querySelector('script[type="module"]');
    dom.window.eval(script.textContent);
    expect(dom.window.document.querySelector('h1').textContent).toBe('鳄鱼的四季骑行');
    expect(dom.window.document.querySelector('script[src],link[rel="stylesheet"]')).toBeNull();
    expect(html).not.toContain('i18next');
    expect(html).not.toContain('import {');
    expect(html).toContain('tailwindcss v4');
    expect(html).toContain('@keyframes wheel');
    expect(html).toContain('prefers-reduced-motion');
    dom.window.close();
  });
});

describe('首次打开与窄窗口回归',()=>{
  it('首次打开工作总览，先呈现空间、待处理事项与全局指令入口',()=>{
    const {doc,dom,app}=fixture('overview',850);
    expect(app.getState().view).toBe('overview');
    expect(doc.querySelector('h1').textContent).toBe('每件事，都在向前。');
    expect(doc.getElementById('workspace-command')).not.toBeNull();
    expect(doc.body.textContent).toContain('需要你处理');
    expect(doc.querySelector('[aria-label="快捷导航"]')).not.toBeNull();
    dom.window.close();
  });
  it('窄窗口中的协作入口打开侧面浮层，关闭后保持作品位置',()=>{
    const {doc,dom,app,click}=fixture('studio',600);
    click('panel');expect(app.getState().panelOverlay).toBe(true);
    expect(doc.querySelector('[aria-label="一起创作"]').className).toContain('fixed');
    click('panel');expect(app.getState().panelOverlay).toBe(false);
    expect(doc.querySelector('h1').textContent).toBe('鳄鱼的四季骑行');
    dom.window.close();
  });
});
