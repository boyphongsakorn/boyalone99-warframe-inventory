const cron = require('node-cron');

const profileUrl = 'https://boyalone99-warframe-inventory.vercel.app/loadout';

let lastLoadoutHash = null;

cron.schedule('*/5 * * * *', () => {
	console.log('Checking for loadout updates...');
	//check if loadout is have been updated from the last time, if yes then update it
	if (lastLoadoutHash !== null) {
		fetch(profileUrl, {
			headers: { accept: 'application/json', 'user-agent': 'warframe-loadout-proxy/1.0' },
		})
			.then((response) => response.json())
			.then((data) => {
				const currentLoadoutHash = JSON.stringify(data?.Results?.[0]?.LoadOutInventory ?? {});
				console.log('Current loadout hash:', currentLoadoutHash);
				console.log('Last loadout hash:', lastLoadoutHash);
				if (currentLoadoutHash !== lastLoadoutHash) {
					lastLoadoutHash = currentLoadoutHash;
					console.log('Loadout has been updated.');
					const raw = JSON.stringify({
						"action": {
							"name": "WarframeChange"
						}
					});
					fetch('http://192.168.31.141:7474/DoAction', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json'
						},
						body: raw
					})
						.then(async (response) => {
							const text = await response.text();
							if (!response.ok) {
								throw new Error(`HTTP ${response.status}: ${text}`);
							}
							return text ? JSON.parse(text) : null;
						})
						.then((data) => {
							console.log('Action response:', data);
						})
						.catch((error) => {
							console.error('Error sending action request:', error);
						});
				}
			})
	} else {
		fetch(profileUrl, {
			headers: { accept: 'application/json', 'user-agent': 'warframe-loadout-proxy/1.0' },
		})
			.then((response) => response.json())
			.then((data) => {
				lastLoadoutHash = JSON.stringify(data?.Results?.[0]?.LoadOutInventory ?? {});
				console.log('Current loadout hash:', lastLoadoutHash);
				console.log('Initial loadout hash set.');
			})
	}
});
