// Settings: theme, the explicit half of "ask, don't ambush" (Update), and About.
import { mountShell, el } from '../nav';
import { registerServiceWorker, onUpdateAvailable, applyUpdate, checkForUpdate, isUpdateWaiting } from '../sw-register';
import { currentTheme, toggleTheme, type Theme } from '../theme';
import { VERSION } from '../version';
import { log } from '../log';

function appearancePanel(): HTMLElement {
  const panel = el('section', 'panel');
  const themeBtn = el('button', 'btn btn-secondary');
  const paint = (theme: Theme): void => {
    themeBtn.textContent = `Theme: ${theme} (tap to switch)`;
  };
  paint(currentTheme());
  themeBtn.addEventListener('click', () => paint(toggleTheme()));
  panel.append(el('h2', undefined, 'Appearance'), themeBtn);
  return panel;
}

function updatePanel(): HTMLElement {
  const panel = el('section', 'panel');
  const build = el('p', 'mono', `build ${VERSION}`);
  build.setAttribute('data-version-stamp', '');
  const status = el('p');
  const btn = el('button', 'btn btn-primary');
  btn.setAttribute('data-testid', 'update-button');
  const toReady = (): void => {
    btn.textContent = 'Update available — reload to apply';
    status.textContent = 'A newer version has been downloaded.';
  };
  const toIdle = (): void => {
    btn.textContent = 'Check for updates';
    status.textContent = "You're on the latest version.";
  };
  if (isUpdateWaiting()) toReady();
  else toIdle();
  onUpdateAvailable(toReady);
  btn.addEventListener('click', () => {
    if (isUpdateWaiting()) {
      applyUpdate();
      return;
    }
    status.textContent = 'Checking…';
    void checkForUpdate().then((waiting) => {
      if (waiting) toReady();
      else status.textContent = "You're on the latest version.";
    });
  });
  panel.append(el('h2', undefined, 'Updates'), status, btn, build);
  return panel;
}

function aboutPanel(): HTMLElement {
  const panel = el('section', 'panel');
  const p = el('p');
  const src = el('a', undefined, 'source');
  src.href = 'https://github.com/CroftCommunity/regift';
  p.append(
    document.createTextNode(
      'regift runs entirely on your device: nothing you share is sent anywhere except to the app you hand the file to. The ',
    ),
    src,
    document.createTextNode(' is AGPL-3.0.'),
  );
  panel.append(el('h2', undefined, 'About'), p);
  return panel;
}

const app = document.getElementById('app');
if (!app) throw new Error('settings: #app not found');
const content = el('div');
content.append(el('h1', undefined, 'Settings'), appearancePanel(), updatePanel(), aboutPanel());
mountShell(app, content);
registerServiceWorker();
log.info('shell mounted', 'settings');
