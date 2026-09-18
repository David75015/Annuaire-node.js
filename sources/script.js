let vcfFiles = [];

function encodePath(name) {
	return name.split('/').map(encodeURIComponent).join('/');
}

function renderList(filter = '') {
	const list = document.getElementById('vcf-list');
	if (!list) return;
	list.innerHTML = '';

	const q = filter.trim().toLowerCase();
	const results = q ? vcfFiles.filter(f => f.toLowerCase().includes(q)) : vcfFiles.slice();

	if (results.length === 0) {
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
		// Remove extension for display
		title.textContent = filename.replace(/\.vcf$/i, '');
		left.appendChild(title);

		const right = document.createElement('div');
		right.className = 'vcf-card-right';
		const a = document.createElement('a');
		a.href = 'documents/' + encodePath(filename);
		a.setAttribute('download', filename);
		a.className = 'download-btn';
		a.textContent = 'Télécharger';
		right.appendChild(a);

		li.appendChild(left);
		li.appendChild(right);
		list.appendChild(li);
	});
}

async function loadVcfList() {
	// Première tentative : essayer d'extraire une index HTML depuis /documents/
	try {
		const res = await fetch('documents/', { cache: 'no-cache' });
		const ct = res.headers.get('content-type') || '';
		if (res.ok && ct.includes('text/html')) {
			const html = await res.text();
			const parser = new DOMParser();
			const doc = parser.parseFromString(html, 'text/html');
			const links = Array.from(doc.querySelectorAll('a')).map(a => a.getAttribute('href'));
			const files = links
				.filter(h => h && h.toLowerCase().endsWith('.vcf'))
				.map(h => decodeURIComponent(h.split('/').pop()));
			if (files.length > 0) {
				vcfFiles = files;
				return;
			}
		}
	} catch (err) {
		// silent fallback to JSON
	}

	// Fallback : charger le fichier JSON statique `sources/vcf-list.json`
	try {
		const res2 = await fetch('sources/vcf-list.json', { cache: 'no-cache' });
		if (res2.ok) {
			const data = await res2.json();
			if (Array.isArray(data.files)) vcfFiles = data.files;
		} else {
			vcfFiles = [];
		}
	} catch (err) {
		console.warn('Impossible de charger sources/vcf-list.json, liste vide', err);
		vcfFiles = [];
	}
}

document.addEventListener('DOMContentLoaded', async () => {
	const search = document.getElementById('search');
	await loadVcfList();
	renderList();
	if (search) {
		search.addEventListener('input', (e) => renderList(e.target.value));
	}

	// Handle upload form if present
	const uploadForm = document.getElementById('vcf-upload-form');
	const uploadStatus = document.getElementById('upload-status');

	// Force uniquement les chiffres dans le champ téléphone
	const phoneInput = document.getElementById('contact-phone');
	if (phoneInput) {
		phoneInput.addEventListener('input', (e) => {
			const cleaned = e.target.value.replace(/\D/g, '');
			if (e.target.value !== cleaned) e.target.value = cleaned;
		});
		phoneInput.addEventListener('keydown', (e) => {
			const allowed = ['Backspace','Delete','ArrowLeft','ArrowRight','Tab','Home','End'];
			if (allowed.includes(e.key) || e.ctrlKey || e.metaKey) return;
			if (!/^[0-9]$/.test(e.key)) e.preventDefault();
		});
	}
	if (uploadForm) {
		// Validation utilitaire
		function validateContact(email, phone) {
			const res = { ok: true, message: '' };
			if (email) {
				const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
				if (!re.test(email)) {
					res.ok = false;
					res.message = 'Email invalide';
					return res;
				}
			}
			if (phone) {
				const digits = phone.replace(/\D/g, '');
				if (digits.length < 6 || digits.length > 15) {
					res.ok = false;
					res.message = 'Numéro de téléphone invalide';
					return res;
				}
			}
			return res;
		}
		uploadForm.addEventListener('submit', async (ev) => {
			ev.preventDefault();
			if (!uploadStatus) return;
			// Validate inputs before sending
			const emailVal = document.getElementById('contact-email').value.trim();
			const phoneVal = document.getElementById('contact-phone').value.trim();
			const v = validateContact(emailVal, phoneVal);
			// clear previous invalid states
			document.getElementById('contact-email').classList.remove('invalid');
			document.getElementById('contact-phone').classList.remove('invalid');
			if (!v.ok) {
				uploadStatus.textContent = v.message;
				if (v.message.toLowerCase().includes('email')) document.getElementById('contact-email').classList.add('invalid');
				if (v.message.toLowerCase().includes('téléphone') || v.message.toLowerCase().includes('numéro')) document.getElementById('contact-phone').classList.add('invalid');
				return;
			}
			uploadStatus.textContent = 'Envoi en cours...';
			let fd = new FormData(uploadForm);
			// If no file field provided (we removed the input), generate a vCard from fields
			if (!fd.has('vcf') || !fd.get('vcf')) {
				const nameField = document.getElementById('contact-name').value.trim();
				const emailField = document.getElementById('contact-email').value.trim();
				const phoneField = document.getElementById('contact-phone').value.trim();
				const vcardText = makeVCard({ name: nameField, email: emailField, phone: phoneField });
				const filename = (nameField || 'contact').replace(/[^\n+\w\s.-]/g, '').replace(/\s+/g, '_') + '.vcf';
				const blob = new Blob([vcardText], { type: 'text/vcard' });
				const file = new File([blob], filename, { type: 'text/vcard' });
				fd.append('vcf', file);
			}
			try {
				const res = await fetch('/upload', { method: 'POST', body: fd });
				if (res.ok) {
					uploadStatus.textContent = 'Ajout réussi.';
					// recharger la liste depuis la source JSON
					await loadVcfList();
					renderList();
					uploadForm.reset();
				} else {
					const txt = await res.text();
					uploadStatus.textContent = 'Erreur: ' + txt;
				}
			} catch (err) {
				console.error(err);
				uploadStatus.textContent = 'Erreur réseau.';
			}
		});

		// Création côté client d'une vCard et envoi au serveur
		const createBtn = document.getElementById('create-vcf');
		function makeVCard({ name, email, phone }) {
			const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
			if (name) lines.push('FN:' + name);
			if (email) lines.push('EMAIL;TYPE=INTERNET:' + email);
			if (phone) lines.push('TEL;TYPE=VOICE:' + phone);
			lines.push('END:VCARD');
			return lines.join('\r\n');
		}

		if (createBtn) {
			createBtn.addEventListener('click', async () => {
				if (!uploadStatus) return;
				const name = document.getElementById('contact-name').value.trim();
					const email = document.getElementById('contact-email').value.trim();
					const phone = document.getElementById('contact-phone').value.trim();
					// Validate before generating
					const valid = validateContact(email, phone);
					// clear previous invalid states
					document.getElementById('contact-email').classList.remove('invalid');
					document.getElementById('contact-phone').classList.remove('invalid');
					if (!valid.ok) {
						uploadStatus.textContent = valid.message;
						if (valid.message.toLowerCase().includes('email')) document.getElementById('contact-email').classList.add('invalid');
						if (valid.message.toLowerCase().includes('téléphone') || valid.message.toLowerCase().includes('numéro')) document.getElementById('contact-phone').classList.add('invalid');
						return;
					}
				if (!name) {
					uploadStatus.textContent = 'Le nom est requis pour générer la vCard.';
					return;
				}
				uploadStatus.textContent = 'Génération de la vCard...';
				const vcard = makeVCard({ name, email, phone });
				const filename = name.replace(/[^\w\s.-]/g, '').replace(/\s+/g, '_') + '.vcf';
				const blob = new Blob([vcard], { type: 'text/vcard' });
				const file = new File([blob], filename, { type: 'text/vcard' });
				const fd = new FormData();
				fd.append('vcf', file);
				fd.append('name', name);
				fd.append('email', email);
				fd.append('phone', phone);
				try {
					const res = await fetch('/upload', { method: 'POST', body: fd });
					if (res.ok) {
						uploadStatus.textContent = 'vCard générée et ajoutée.';
						await loadVcfList();
						renderList();
						uploadForm.reset();
					} else {
						const txt = await res.text();
						uploadStatus.textContent = 'Erreur: ' + txt;
					}
				} catch (err) {
					console.error(err);
					uploadStatus.textContent = 'Erreur réseau.';
				}
			});
		}

		// 'Ajouter la vCard' : ouvrir le sélecteur de fichiers et uploader
		const addBtn = document.getElementById('add-vcard');
		const fileInput = document.getElementById('vcf-file-input');
		if (addBtn && fileInput) {
			addBtn.addEventListener('click', () => fileInput.click());

			fileInput.addEventListener('change', async (ev) => {
				if (!uploadStatus) return;
				const file = ev.target.files && ev.target.files[0];
				if (!file) return;
				// Validate current fields
				const emailVal = document.getElementById('contact-email').value.trim();
				const phoneVal = document.getElementById('contact-phone').value.trim();
				const v = validateContact(emailVal, phoneVal);
				document.getElementById('contact-email').classList.remove('invalid');
				document.getElementById('contact-phone').classList.remove('invalid');
				if (!v.ok) {
					uploadStatus.textContent = v.message;
					if (v.message.toLowerCase().includes('email')) document.getElementById('contact-email').classList.add('invalid');
					if (v.message.toLowerCase().includes('téléphone') || v.message.toLowerCase().includes('numéro')) document.getElementById('contact-phone').classList.add('invalid');
					fileInput.value = '';
					return;
				}
				// Build FormData and send
				uploadStatus.textContent = 'Envoi du fichier...';
				const fd2 = new FormData();
				fd2.append('vcf', file);
				fd2.append('name', document.getElementById('contact-name').value.trim());
				fd2.append('email', emailVal);
				fd2.append('phone', phoneVal);
				try {
					const res = await fetch('/upload', { method: 'POST', body: fd2 });
					if (res.ok) {
						uploadStatus.textContent = 'vCard ajoutée.';
						await loadVcfList();
						renderList();
						fileInput.value = '';
						uploadForm.reset();
					} else {
						const txt = await res.text();
						uploadStatus.textContent = 'Erreur: ' + txt;
						fileInput.value = '';
					}
				} catch (err) {
					console.error(err);
					uploadStatus.textContent = 'Erreur réseau.';
					fileInput.value = '';
				}
			});
		}
	}
});

