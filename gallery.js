(function () {
  const API_URL = '/api/photos';

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function inferOrientation(width, height) {
    if (!width || !height) return 'landscape';
    if (Math.abs(width - height) < Math.max(width, height) * 0.08) return 'square';
    return width > height ? 'landscape' : 'portrait';
  }

  async function loadPhotos() {
    const res = await fetch(API_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('gallery fetch failed');
    const data = await res.json();
    return {
      photos: Array.isArray(data?.photos) ? data.photos : [],
      archive: Array.isArray(data?.archive) ? data.archive : [],
    };
  }

  async function uploadPhoto(file) {
    const normalizedType = String(file?.type || '').trim().toLowerCase();
    const contentType = normalizedType || 'image/jpeg';
    let orientation = 'landscape';
    const probeUrl = URL.createObjectURL(file);
    try {
      const size = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => reject(new Error('image probe failed'));
        img.src = probeUrl;
      });
      orientation = inferOrientation(size.width, size.height);
    } catch (_err) {
      const bitmap = await createImageBitmap(file);
      try {
        orientation = inferOrientation(bitmap.width, bitmap.height);
      } finally {
        bitmap.close && bitmap.close();
      }
    } finally {
      URL.revokeObjectURL(probeUrl);
    }
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': contentType,
        'x-photo-orientation': orientation,
      },
      body: new Uint8Array(await file.arrayBuffer()),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload?.details || payload?.error || 'upload failed');
    }
    return res.json();
  }

  async function deletePhoto(photoId) {
    const res = await fetch(API_URL, {
      method: 'DELETE',
      headers: { 'x-photo-id': photoId },
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload?.details || payload?.error || 'delete failed');
    }
    return res.json();
  }

  function photoCard(item) {
    const when = item.updated_at ? new Date(item.updated_at).toLocaleString('gl-ES') : 'sen data';
    const orientation = escapeHtml(item.orientation || 'landscape');
    const photoId = escapeHtml(item.id || '');
    const url = escapeHtml(item.u || '');
    return `<article class="gal-card" data-orientation="${orientation}" data-photo-id="${photoId}">
      <img src="${url}" alt="Foto da despedida ${photoId}">
      <div class="gal-meta">${orientation} · ${when}</div>
      <div class="gal-toolbar"><button type="button" data-act="delete">Borrar</button></div>
    </article>`;
  }

  function archiveCard(item) {
    const when = item.updated_at ? new Date(item.updated_at).toLocaleString('gl-ES') : 'sen data';
    const url = escapeHtml(item.u || '');
    return `<article class="archive-card"><img src="${url}" alt="Foto antiga da despedida"><div class="archive-meta">${when}</div></article>`;
  }

  async function renderGallery() {
    const container = document.getElementById('gallery-grid');
    const archiveContainer = document.getElementById('archive-grid');
    if (!container || !archiveContainer) return;
    try {
      const { photos, archive } = await loadPhotos();
      container.innerHTML = photos.length
        ? photos.map(photoCard).join('')
        : '<div class="quote-empty">Aínda non hai fotos subidas. Sede os primeiros en encher a galería.</div>';
      archiveContainer.innerHTML = archive.length
        ? archive.map(archiveCard).join('')
        : '<div class="archive-meta">As fotos borradas ou substituídas aparecerán aquí como arquivo.</div>';
    } catch (_err) {
      container.innerHTML = '<div class="quote-empty">Non se puideron cargar as fotos.</div>';
      archiveContainer.innerHTML = '<div class="archive-meta">Non se puido cargar o arquivo.</div>';
    }
  }

  function setupUploader() {
    const input = document.getElementById('gallery-upload-input');
    const status = document.getElementById('gallery-status');
    if (!input || !status) return;
    input.addEventListener('change', async () => {
      const files = Array.from(input.files || []);
      if (!files.length) return;
      status.textContent = 'Subindo fotos...';
      try {
        for (const file of files) {
          await uploadPhoto(file);
        }
        status.textContent = 'Fotos gardadas.';
        input.value = '';
        await renderGallery();
      } catch (err) {
        status.textContent = `Non se puideron subir: ${err?.message || 'erro'}`;
      }
    });
  }

  function setupGalleryActions() {
    const container = document.getElementById('gallery-grid');
    const status = document.getElementById('gallery-status');
    if (!container || !status) return;
    container.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-act="delete"]');
      if (!btn) return;
      const card = btn.closest('.gal-card');
      const photoId = card?.dataset.photoId;
      if (!photoId) return;
      status.textContent = 'Borrando foto...';
      try {
        await deletePhoto(photoId);
        status.textContent = 'Foto borrada.';
        await renderGallery();
      } catch (err) {
        status.textContent = `Non se puido borrar: ${err?.message || 'erro'}`;
      }
    });
  }

  window.galleryApp = {
    renderGallery,
    setupUploader,
    setupGalleryActions,
    uploadPhoto,
    deletePhoto,
    inferOrientation,
  };
})();
