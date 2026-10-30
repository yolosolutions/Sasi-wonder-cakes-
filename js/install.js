// Makes the site installable as an app: registers the service worker (sw.js) and powers the "Install app" button.
// Android and desktop Chrome offer a real install prompt. iPhone has none, so the button shows the steps instead.
(function () {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
  }

  const slot = document.getElementById('install');
  const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (!slot || installed) return; // no button on this page, or this already IS the installed app

  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let offer = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); offer = e; slot.hidden = false; });
  window.addEventListener('appinstalled', () => { slot.hidden = true; offer = null; });
  if (ios) slot.hidden = false;

  slot.addEventListener('click', async () => {
    if (offer) {
      offer.prompt();
      try { await offer.userChoice; } catch (e) { /* closed without choosing */ }
      offer = null; slot.hidden = true;
      return;
    }
    await SWC.ask({
      title: 'Add this to your home screen',
      text: '1. Tap the Share button (the square with an arrow) at the bottom of Safari.\n2. Scroll down and tap "Add to Home Screen".\n3. Tap "Add". The app icon appears on your home screen.',
      yes: 'Got it', single: true,
    });
  });
})();
