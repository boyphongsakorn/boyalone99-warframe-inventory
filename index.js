const Fastify = require('fastify');

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

app.get('/loadout', async (request, reply) => {
	const playerId = request.query.playerId || '5b34dfeaf2f2eb06a02d1fd2';
	const url = new URL(profileUrl);
	// url.searchParams.set('playerId', playerId);

	let profileResponse;
	try {
		profileResponse = await fetch(url, {
			// headers: { accept: 'application/json', 'user-agent': 'warframe-loadout-proxy/1.0' },
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0^',
				'Referer': 'https://www.warframe.com/'
			},
		});
        // profileResponse = await fetch(url);
        // const url = 'https://api.warframe.com/cdn/getProfileViewingData.php?playerId=5b34dfeaf2f2eb06a02d1fd2';
        // const options = {method: 'GET'};

        // try {
        //     // const response = await fetch(url, options);
        //     // const data = await response.json();
        //     // console.log(data);
        //     profileResponse = await fetch(url, options);
        // } catch (error) {
        //     console.error(error);   
        // }
	} catch (error) {
		return reply.code(502).send({ error: 'Could not reach the Warframe profile API', message: error.message });
	}

	if (!profileResponse.ok) {
        console.log(profileResponse);
		console.log(await profileResponse.text());
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

if (require.main === module) {
	app.listen({ port: Number(process.env.PORT) || 3000, host: process.env.HOST || '0.0.0.0' })
		.catch((error) => {
			app.log.error(error);
			process.exit(1);
		});
}

module.exports = app;
