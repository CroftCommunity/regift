// The ambient half of "ask, don't ambush": when an updated worker is waiting, a
// small transient toast offers to reload into it. The explicit half is the
// Settings → Update button. Both call applyUpdate(); neither swaps under a live
// session without the user's click.
import { onUpdateAvailable, applyUpdate } from './sw-register';

let mounted = false;

export function mountUpdateToast(): void {
  if (mounted) return;
  mounted = true;
  onUpdateAvailable(() => {
    if (document.querySelector('.update-toast')) return;
    const toast = document.createElement('div');
    toast.className = 'update-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('data-testid', 'update-toast');

    const label = document.createElement('span');
    label.textContent = 'A new version is available.';

    const reload = document.createElement('button');
    reload.className = 'btn btn-primary';
    reload.textContent = 'Reload';
    reload.addEventListener('click', () => applyUpdate());

    const dismiss = document.createElement('button');
    dismiss.className = 'btn btn-secondary';
    dismiss.textContent = 'Later';
    dismiss.setAttribute('aria-label', 'Dismiss update notice');
    dismiss.addEventListener('click', () => toast.remove());

    toast.append(label, reload, dismiss);
    document.body.append(toast);
  });
}
