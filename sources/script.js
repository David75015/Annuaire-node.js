let vcfFiles = [];

function encodePath(name) {
  return name.split('/').map(encodeURIComponent).join('/');
}

function renderList(filter = '') {
  const list = document.getElementById('vcf-list');
  if (!list) return;
  list.innerHTML = '';

  const q = filter.trim().toLowerCase();
  const results = q
    ? vcfFiles.filter(f => f.toLowerCase().includes(q))
    : vcfFiles.slice();

  if (!results.length) {
    const li = document.createElement('li');
    li.textContent = 'Aucun fichier VCF trouvé.';
    list.appendChild(li);
    return;
  }

  results.forEach(filename => {
    const li = document.createElement('li');
    li.className = 'vcf-card';

    const left = document.createElement('div');
    left.className = 'vcf-card-left';

    const title = document.createElement('div');
    title.className = 'vcf-title';
    title.textContent = filename.replace(/\.vcf$/i, '');
    left.appendChild(title);

    const right = document.createElement('div');
    right.className = 'vcf-card-right';

    const a = document.createElement('a');
    a.href = '/documents/' + encodePath(filename);
    a.download = filename;
    a.className = 'download-btn';
    a.textContent = 'Télécharger';
    right.appendChild(a);

    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.type = 'button';
    delBtn.textContent = 'Supprimer';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Supprimer « ${filename} » ? Cette action est irréversible.`)) return;
      try {
        const res = await fetch('/api/vcf/' + encodeURIComponent(filename), { method: 'DELETE' });
        if (!res.ok) {
          alert('Erreur : ' + await res.text());
          return;
        }
        await loadVcfList();
        const cur = document.getElementById('search')?.value || '';
        renderList(cur);
      } catch (err) {
        console.error(err);
        alert('Erreur réseau lors de la suppression.');
      }
    });
    right.appendChild(delBtn);

    li.append(left, right);
    list.appendChild(li);
  });
}

async function loadVcfList() {
  // Première tentative : lister directement le dossier `documents/` (si le serveur renvoie un index HTML)
  try {
    const res = await fetch('documents/', { cache: 'no-store' });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('text/html')) {
      const html = await res.text();
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const links = Array.from(doc.querySelectorAll('a')).map(a => a.getAttribute('href'));
        const files = links
          .filter(h => h && h.toLowerCase().endsWith('.vcf'))
          .map(h => decodeURIComponent(h.split('/').pop()));
        if (files.length) {
          vcfFiles = files;
          return;
        }
      } catch (e) {
        // fallthrough to API
      }
    }
  } catch (err) {
    // ignore and fallback to API
  }

  // Fallback : charger la liste via l'API (DB)
  try {
    const res2 = await fetch('/api/vcf-list', { cache: 'no-store' });
    const data = await res2.json();
    vcfFiles = Array.isArray(data.files) ? data.files : [];
  } catch (err) {
    console.error('Impossible de charger la liste VCF', err);
    vcfFiles = [];
  }
}

function validateContact(email, phone) {
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Email invalide';
  }

  if (phone) {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 15) {
      return 'Numéro de téléphone invalide';
    }
  }

  return '';
}

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('vcf-upload-form');
  const status = document.getElementById('upload-status');
  const search = document.getElementById('search');
  const phoneInput = document.getElementById('contact-phone');

  await loadVcfList();
  renderList();

  search?.addEventListener('input', e => renderList(e.target.value));

  phoneInput?.addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g, '');
  });

  form?.addEventListener('submit', async e => {
    e.preventDefault();

    const name = document.getElementById('contact-name').value.trim();
    const email = document.getElementById('contact-email').value.trim();
    const phone = document.getElementById('contact-phone').value.trim();
    const organization = (document.getElementById('contact-organization')?.value || '').trim();

    if (!name) {
      status.textContent = 'Le nom est requis.';
      return;
    }

    const validationError = validateContact(email, phone);
    if (validationError) {
      status.textContent = validationError;
      return;
    }

    status.textContent = 'Création de la vCard...';

    try {
      const response = await fetch('/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, organization })
      });

      if (!response.ok) {
        status.textContent = 'Erreur : ' + await response.text();
        return;
      }

      const result = await response.json();
      status.textContent = `Contact ajouté : ${result.filename}`;

      await loadVcfList();
      renderList(search?.value || '');
      form.reset();
    } catch (err) {
      console.error(err);
      status.textContent = 'Erreur réseau ou serveur.';
    }
  });
});
