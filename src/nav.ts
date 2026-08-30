// Shared shell chrome (croft-pwa chassis): topbar, tab bar, build stamp. Pages,
// not modals — navigation is real links between real documents.
import { VERSION } from './version';
import { currentTheme, toggleTheme } from './theme';
import { mountUpdateToast } from './update-toast';

const CROFT_HOME = 'https://croft.ing';

interface Tab {
  readonly href: string;
  readonly label: string;
  readonly active: readonly string[];
}

const TABS: readonly Tab[] = [
  { href: 'index.html', label: 'Regift', active: ['index.html'] },
  { href: 'settings.html', label: 'Settings', active: ['settings.html'] },
];

function currentPage(): string {
  const last = location.pathname.split('/').pop();
  return last && last.length > 0 ? last : 'index.html';
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderTopbar(): HTMLElement {
  const bar = el('header', 'topbar');
  const wordmark = el('a', 'wordmark', 'regift');
  wordmark.href = 'index.html';
  const theme = el('button', 'topbar-action');
  const paint = (): void => {
    theme.textContent = currentTheme() === 'dark' ? 'Light' : 'Dark';
    theme.setAttribute('aria-label', 'Toggle colour theme');
  };
  paint();
  theme.addEventListener('click', () => {
    toggleTheme();
    paint();
  });
  bar.append(wordmark, theme);
  return bar;
}

function renderTabs(page: string): HTMLElement {
  const nav = el('nav', 'tabs');
  nav.setAttribute('aria-label', 'Sections');
  for (const tab of TABS) {
    const link = el('a', 'tab', tab.label);
    link.href = tab.href;
    if (tab.active.includes(page)) link.setAttribute('aria-current', 'page');
    nav.append(link);
  }
  return nav;
}

function renderFooter(): HTMLElement {
  const footer = el('footer', 'build-stamp');
  const stamp = el('span', 'mono', VERSION);
  stamp.setAttribute('data-version-stamp', '');
  const croft = el('a', 'croft-attr', 'Croft');
  croft.href = CROFT_HOME;
  croft.setAttribute('aria-label', 'A Croft project');
  footer.append(stamp, croft);
  return footer;
}

export function mountShell(app: HTMLElement, content: HTMLElement): void {
  const main = el('main');
  main.append(content);
  app.append(renderTopbar(), renderTabs(currentPage()), main, renderFooter());
  mountUpdateToast();
}
