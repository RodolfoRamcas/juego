/**
 * NETMETRO - MODAL DE VINCULACIÓN DEL MANDO MÓVIL
 * Muestra el QR (y el enlace) con el que el teléfono se une a la sala del RemoteController,
 * y el estado de la conexión. La librería de QR se carga solo al abrir el modal por primera vez.
 */

const QR_LIBRARY_URL = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const STATUS_TEXT = {
  closed: 'Preparando sala...',
  waiting: 'Esperando a que el teléfono escanee el código...',
  connected: '✅ Mando conectado. ¡Listo para jugar!',
  unavailable: '⚠️ Sin conexión al servidor: el mando móvil necesita Supabase.',
  error: '⚠️ No se pudo abrir la sala en el servidor. Cierra y vuelve a intentarlo.'
};

export function setupPadPairing(engine) {
  const remote = engine.remoteController;
  const modal = document.getElementById('modal-pad');
  const qrBox = document.getElementById('pad-qr');
  const link = document.getElementById('pad-link');
  const statusDot = document.getElementById('pad-status-dot');
  const statusText = document.getElementById('pad-status-text');
  const warning = document.getElementById('pad-warning');
  const disconnectBtn = document.getElementById('btn-pad-disconnect');
  const hudBtn = document.getElementById('btn-open-pad');

  let autoCloseTimer = null;
  let pausedByModal = false;

  function renderStatus(status) {
    statusText.textContent = STATUS_TEXT[status] || '';
    statusDot.className = `dot-indicator ${status === 'connected' ? 'dot-online' : 'dot-offline'}`;
    disconnectBtn.classList.toggle('hidden', status === 'closed' || status === 'unavailable');
    hudBtn.classList.toggle('active', status === 'connected');
    qrBox.classList.toggle('pad-qr-connected', status === 'connected');
  }

  remote.onStatusChange = (status) => {
    renderStatus(status);
    if (status === 'connected' && !modal.classList.contains('hidden')) {
      // Recién conectado: cerrar el modal solo para despejar la vista y empezar a jugar
      clearTimeout(autoCloseTimer);
      autoCloseTimer = setTimeout(closeModal, 1200);
    }
  };

  async function openModal() {
    modal.classList.remove('hidden');
    // Mientras se escanea el código, la partida no debe seguir corriendo
    if (engine.state === 'PLAYING' && engine.speed !== 0) {
      engine.setSpeed(0);
      pausedByModal = true;
    }

    renderStatus(remote.status);
    warning.classList.toggle('hidden', !LOCAL_HOSTNAMES.has(window.location.hostname));
    warning.textContent = 'Abriste el juego desde "localhost": el teléfono no puede llegar a esa dirección. ' +
      'Ábrelo usando la IP de tu PC en la red local (p. ej. http://192.168.1.20:5500) o desde la versión publicada.';

    const opened = await remote.open();
    if (!opened) {
      qrBox.innerHTML = '<span class="pad-qr-placeholder">📵</span>';
      link.textContent = '';
      link.removeAttribute('href');
      return;
    }

    const url = remote.getControllerUrl();
    link.textContent = url;
    link.href = url;
    try {
      await loadQrLibrary();
      const qr = window.qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      qrBox.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    } catch (e) {
      console.warn('No se pudo generar el QR:', e);
      qrBox.innerHTML = '<span class="pad-qr-placeholder">Abre el enlace de abajo en tu teléfono</span>';
    }
  }

  function closeModal() {
    clearTimeout(autoCloseTimer);
    modal.classList.add('hidden');
    if (pausedByModal) {
      pausedByModal = false;
      if (engine.state === 'PLAYING') engine.setSpeed(1);
    }
  }

  document.getElementById('btn-open-pad-menu').addEventListener('click', openModal);
  hudBtn.addEventListener('click', openModal);
  document.getElementById('btn-close-pad').addEventListener('click', closeModal);

  disconnectBtn.addEventListener('click', async () => {
    await remote.close();
    qrBox.innerHTML = '';
    link.textContent = '';
    // Abrir otra sala nueva de inmediato, por si se quiere vincular otro teléfono
    openModal();
  });

  renderStatus(remote.status);
}

function loadQrLibrary() {
  if (window.qrcode) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = QR_LIBRARY_URL;
    script.onload = resolve;
    script.onerror = () => reject(new Error('No se pudo cargar la librería de QR'));
    document.head.appendChild(script);
  });
}
