const Fastify = require('fastify');
const cron = require('node-cron');

const app = Fastify({ logger: true });
const profileUrl = 'https://api.warframe.com/cdn/getProfileViewingData.php?playerId=5b34dfeaf2f2eb06a02d1fd2';

function findImageUrl(value) {
	if (typeof value === 'string' && /\.(?:png|jpe?g|webp)(?:\?.*)?$/i.test(value)) {
		return value;
	}
	if (!value || typeof value !== 'object') return null;

	if (Array.isArray(value)) {
		for (const item of value) {
			const imageUrl = findImageUrl(item);
			if (imageUrl) return imageUrl;
		}
		return null;
	}

	for (const [key, child] of Object.entries(value)) {
		if (typeof child === 'string' && /(?:image|icon|thumb|loadout)/i.test(key) && /^https?:\/\//i.test(child)) {
			return child;
		}

		const imageUrl = findImageUrl(child);
		if (imageUrl) return imageUrl;
	}

	return null;
}

const itemCatalogUrl = 'https://raw.githubusercontent.com/WFCD/warframe-items/refs/heads/master/data/json/All.json';
const itemImageBaseUrl = 'https://raw.githubusercontent.com/wfcd/warframe-items/master/data/img/';
const warframeApiProxyUrl = 'https://proxy.corsfix.com/?url=';
const warframeApiProxyKey = process.env.WARFRAME_API_PROXY_KEY || '';
let itemCatalogCache = null;

async function fetchWarframeApi(targetUrl, options = {}) {
	const directUrl = new URL(targetUrl);
	const headers = { ...(options.headers || {}) };

	try {
		const directResponse = await fetch(directUrl.toString(), {
			...options,
			headers,
		});
		if (directResponse.ok) return directResponse;
	} catch (error) {
		console.warn('Direct Warframe API fetch failed, retrying with CORS proxy:', error.message);
	}

	const proxyUrl = new URL(warframeApiProxyUrl + encodeURIComponent(directUrl.toString()));
	const proxyResponse = await fetch(proxyUrl.toString(), {
		...options,
		headers: {
			...headers,
			'x-corsfix-key': warframeApiProxyKey,
			'x-forwarded-host': directUrl.host,
			'x-forwarded-proto': directUrl.protocol.replace(':', ''),
		},
	});

	if (!proxyResponse.ok) {
		throw new Error(`Warframe API fetch failed via direct and proxy routes (${proxyResponse.status})`);
	}

	return proxyResponse;
}

async function fetchWarframeItems() {
	if (itemCatalogCache) return itemCatalogCache;

	const response = await fetch(itemCatalogUrl, {
		headers: { accept: 'application/json', 'user-agent': 'warframe-loadout-proxy/1.0' },
	});

	if (!response.ok) {
		throw new Error(`Warframe item catalog request failed: ${response.status}`);
	}

	itemCatalogCache = await response.json();
	return itemCatalogCache;
}

function loadoutSlotName(key) {
	const slotMap = {
		s: 'Warframe',
		p: 'Pistol',
		l: 'Long Gun',
		m: 'Melee',
		h: 'Heavy',
	};

	return slotMap[key] || key.toUpperCase();
}

function formatItemName(value) {
	if (!value) return 'Unknown';
	if (typeof value === 'string') {
		const itemName = value.split('/').pop();
		return (itemName || 'Unknown')
			.replace(/([a-z])([A-Z])/g, '$1 $2')
			.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
			.replace(/[_-]+/g, ' ')
			.trim() || 'Unknown';
	}

	if (typeof value === 'object' && value.ItemType) {
		return formatItemName(value.ItemType);
	}

	return 'Unknown';
}

function getUniqueInventoryEntries(profileResult) {
	const inventory = profileResult?.LoadOutInventory ?? {};
	return [
		...(inventory.Suits ?? []),
		...(inventory.LongGuns ?? []),
		...(inventory.Pistols ?? []),
		...(inventory.Melee ?? []),
		...(inventory.Heavy ?? []),
	];
}

function findItemByType(entries, itemType) {
	if (!itemType) return null;
	return entries.find((item) => item.ItemType === itemType) ?? null;
}

function findItemById(entries, itemId) {
	if (!itemId || !itemId.$oid) return null;
	return entries.find((item) => item.ItemId && item.ItemId.$oid === itemId.$oid) ?? null;
}

async function resolveCatalogItem(itemType) {
	const items = await fetchWarframeItems();
	if (!Array.isArray(items)) return null;
	return items.find((item) => item.uniqueName === itemType) ?? null;
}

async function buildLoadoutHtml(profileResult) {
	const preset = profileResult?.LoadOutPreset ?? {};
	const inventoryEntries = getUniqueInventoryEntries(profileResult);
	const rows = [];
	const orderedKeys = ['s', 'l', 'p', 'm', 'h'];
	const presetEntries = [...orderedKeys.filter((key) => preset[key]), ...Object.keys(preset).filter((key) => !orderedKeys.includes(key))];

	for (const key of presetEntries) {
		const value = preset[key];
		if (!value || typeof value !== 'object' || !value.ItemId) continue;

		const slotItem = findItemById(inventoryEntries, value.ItemId) ?? findItemByType(inventoryEntries, value.ItemType);
		if (!slotItem) continue;
		const itemType = slotItem?.ItemType ?? null;
		const catalogItem = itemType ? await resolveCatalogItem(itemType) : null;
		const itemLabel = catalogItem?.name || formatItemName(slotItem) || formatItemName(value.ItemId);
		const imageUrl = catalogItem?.imageName ? `${itemImageBaseUrl}${catalogItem.imageName}` : '';
		const isLastSingleItem = rows.length === 4; // 5 total items -> last item spans both columns

		rows.push(`
			<li class="slot-item${isLastSingleItem ? ' wide' : ''}">
				${imageUrl ? `<img class="slot-image" src="${imageUrl}" alt="${itemLabel}" />` : '<div class="slot-image placeholder">No image</div>'}
				<div class="slot-heading">
					<span class="slot-name">${loadoutSlotName(key)}</span>
					<span class="slot-value">${itemLabel}</span>
				</div>
			</li>`);
	}

	return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="utf-8" />
			<meta name="viewport" content="width=device-width, initial-scale=1" />
			<title>Current Loadout</title>
			<style>
				:root {
					color-scheme: dark;
					--bg: #000000;
					--panel: #111827;
					--primary: #7dd3fc;
					--text: #f8fafc;
					--muted: #cbd5e1;
					--border: rgba(255,255,255,0.12);
				}
				* { box-sizing: border-box; }
				body {
					margin: 0;
					background: var(--bg);
					color: var(--text);
					font-family: Arial, sans-serif;
					display: flex;
					align-items: flex-start;
					justify-content: center;
					min-height: 100vh;
					padding-top: 0;
				}
				.panel {
					width: 400px;
					height: auto;
					padding: 16px 10px 12px;
					background: rgba(17, 24, 39, 0.95);
					border: 1px solid var(--border);
					border-radius: 18px;
					box-shadow: 0 0 0 2px rgba(125, 211, 252, 0.12);
					overflow: hidden;
				}
				h1 {
					margin: 0 0 14px;
					text-align: center;
					font-size: 1.8rem;
					color: var(--primary);
				}
				ul {
					list-style: none;
					padding: 0;
					margin: 0;
					display: flex;
					flex-direction: column;
					gap: 12px;
				}
				.slot-item {
					display: flex;
					flex-direction: column;
					align-items: center;
					justify-content: flex-start;
					gap: 8px;
					padding: 10px 8px;
					border-radius: 12px;
					background: rgba(255,255,255,0.03);
					border: 1px solid var(--border);
					min-height: 200px;
				}
				.slot-item.wide {
					grid-column: auto;
				}
				.slot-heading {
					display: flex;
					flex-direction: column;
					align-items: center;
					text-align: center;
					gap: 4px;
				}
				.slot-name {
					font-size: 0.7rem;
					font-weight: 700;
					letter-spacing: 0.08em;
					text-transform: uppercase;
					color: var(--primary);
				}
				.slot-value {
					font-size: 0.95rem;
					font-weight: 700;
					color: var(--text);
				}
				.slot-image {
					width: 180px;
					height: 180px;
					object-fit: contain;
					border-radius: 12px;
					background: rgba(255,255,255,0.04);
					padding: 8px;
				}
				.placeholder {
					display: grid;
					place-items: center;
					font-size: 0.75rem;
					color: var(--muted);
					border: 1px dashed var(--border);
				}
			</style>
		</head>
		<body>
			<div class="panel">
				<h1>Current Loadout</h1>
				<ul>
					${rows.join('')}
				</ul>
			</div>
		</body>
		</html>`;
}

app.get('/loadout', async (request, reply) => {
	const playerId = request.query.playerId || '5b34dfeaf2f2eb06a02d1fd2';
	const url = new URL(profileUrl);
	url.searchParams.set('playerId', playerId);

	let profileResponse;
	try {
		// profileResponse = await fetchWarframeApi(url.toString(), {
		// 	headers: { accept: 'application/json', 'user-agent': 'warframe-loadout-proxy/1.0' },
		// });
		profileResponse = await fetch(url.toString(), {
			headers: { accept: 'application/json', 'user-agent': 'warframe-loadout-proxy/1.0' },
		});
	} catch (error) {
		return reply.code(502).send({ error: 'Could not reach the Warframe profile API', message: error.message });
	}

	if (!profileResponse.ok) {
		return reply.code(502).send({
			error: 'Warframe profile API returned an error',
			status: profileResponse.status,
		});
	}

	let profile;
	try {
		profile = await profileResponse.json();
	} catch {
		return reply.code(502).send({ error: 'Warframe profile API returned invalid JSON' });
	}

	const wantsHtml = request.query.format === 'html' || (request.headers.accept || '').includes('text/html');
	if (wantsHtml) {
		const profileResult = profile?.Results?.[0];
		if (!profileResult || !profileResult.LoadOutPreset) {
			return reply.code(404).send({ error: 'No loadout preset was found in the profile response' });
		}

		return reply.type('text/html; charset=utf-8').send(await buildLoadoutHtml(profileResult));
	}

	const imageUrl = findImageUrl(profile);
	if (!imageUrl) {
		return reply.code(404).send({ error: 'No loadout image was found in the profile response' });
	}

	let imageResponse;
	try {
		imageResponse = await fetch(imageUrl);
	} catch (error) {
		return reply.code(502).send({ error: 'Could not reach the loadout image URL', message: error.message });
	}

	if (!imageResponse.ok) {
		return reply.code(502).send({ error: 'Loadout image URL returned an error', status: imageResponse.status });
	}

	reply.header('content-type', imageResponse.headers.get('content-type') || 'image/png');
	return reply.send(Buffer.from(await imageResponse.arrayBuffer()));
});

let lastLoadoutHash = null;

// cron.schedule('*/15 * * * *', () => {
// 	console.log('Checking for loadout updates...');
// 	//check if loadout is have been updated from the last time, if yes then update it
// 	if (lastLoadoutHash !== null) {
// 		fetchWarframeApi(profileUrl, {
// 			headers: { accept: 'application/json', 'user-agent': 'warframe-loadout-proxy/1.0' },
// 		})
// 			.then((response) => response.json())
// 			.then((data) => {
// 				const currentLoadoutHash = JSON.stringify(data?.Results?.[0]?.LoadOutInventory ?? {});
// 				console.log('Current loadout hash:', currentLoadoutHash);
// 				console.log('Last loadout hash:', lastLoadoutHash);
// 				if (currentLoadoutHash !== lastLoadoutHash) {
// 					lastLoadoutHash = currentLoadoutHash;
// 					console.log('Loadout has been updated.');
// 					const raw = JSON.stringify({
// 						"action": {
// 							"name": "WarframeChange"
// 						}
// 					});
// 					fetch('http://192.168.31.141:7474/DoAction', {
// 						method: 'POST',
// 						headers: {
// 							'Content-Type': 'application/json'
// 						},
// 						body: raw
// 					})
// 						.then((response) => response.json())
// 						.then((data) => {
// 							console.log('Action response:', data);
// 						})
// 						.catch((error) => {
// 							console.error('Error sending action request:', error);
// 						});
// 				}
// 			})
// 	} else {
// 		fetchWarframeApi(profileUrl, {
// 			headers: { accept: 'application/json', 'user-agent': 'warframe-loadout-proxy/1.0' },
// 		})
// 			.then((response) => response.json())
// 			.then((data) => {
// 				lastLoadoutHash = JSON.stringify(data?.Results?.[0]?.LoadOutInventory ?? {});
// 				console.log('Current loadout hash:', lastLoadoutHash);
// 				console.log('Initial loadout hash set.');
// 			})
// 	}
// });

if (require.main === module) {
	app.listen({ port: Number(process.env.PORT) || 3000})
		.catch((error) => {
			app.log.error(error);
			process.exit(1);
		});

	module.exports = app;
} else {
	const start = async () => {
		try {
			await app.listen({ port: port, host: '0.0.0.0' })
		} catch (err) {
			app.log.error(err)
			process.exit(1)
		}
	}

	start()
}