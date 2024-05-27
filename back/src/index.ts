import { DEFAULT_ETHEREUM_ACCOUNTS, Turnkey } from '@turnkey/sdk-server';
/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

interface Env {
	TURNKEY_API_PRIVATE_KEY: string;
	TURNKEY_API_PUBLIC_KEY: string;
	TURNKEY_ORGANIZATION_ID: string;
	DB: D1Database;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		/**
		 * readRequestBody reads in the incoming request body
		 * Use await readRequestBody(..) in an async function to get the string
		 * @param {Request} request the incoming request to read from
		 */
		async function readRequestBody(request: Request) {
			const contentType = request.headers.get('content-type') || '';
			if (contentType.includes('application/json')) {
				return JSON.stringify(await request.json());
			} else if (contentType.includes('application/text')) {
				return request.text();
			} else if (contentType.includes('text/html')) {
				return request.text();
			} else if (contentType.includes('form')) {
				const formData = (await request.formData()) as any;
				const body: any = {};
				for (const entry of formData.entries()) {
					body[entry[0]] = entry[1];
				}
				return JSON.stringify(body);
			} else {
				// Perhaps some other type of data was submitted in the form
				// like an image, or some other binary data.
				return 'a file';
			}
		}

		const { pathname } = new URL(request.url);

		if (request.method === 'POST') {
			const reqBody = await readRequestBody(request);
			switch (pathname) {
				case '/api/register': {
					const { userEmail, userName, credential } = reqBody as any;
					if (!userEmail || !userName || !credential) {
						return new Response('userEmail, userName, and credentials must all be supplied', { status: 400 });
					}
					const turnkey = new Turnkey({
						apiBaseUrl: 'https://api.turnkey.com',
						apiPrivateKey: env.TURNKEY_API_PRIVATE_KEY,
						apiPublicKey: env.TURNKEY_API_PUBLIC_KEY,
						defaultOrganizationId: env.TURNKEY_ORGANIZATION_ID,
					});

					const apiClient = turnkey.apiClient();

					const subOrganizationConfig = {
						subOrganizationName: userEmail,
						rootUsers: [
							{
								userName: userName,
								userEmail: userEmail,
								apiKeys: [],
								authenticators: [
									{
										authenticatorName: userName,
										challenge: credential.challenge,
										attestation: credential.attestation,
									},
								],
							},
						],
						rootQuorumThreshold: 1,
						wallet: {
							walletName: userName,
							accounts: DEFAULT_ETHEREUM_ACCOUNTS,
						},
					};

					const subOrganizationResponse = await apiClient.createSubOrganization(subOrganizationConfig);
					await env.DB.prepare('INSERT INTO FROM Users (user_email, sub_org_id) VALUES (?, ?);')
						.bind(userEmail, subOrganizationResponse.subOrganizationId)
						.run();

					//Create Solana Account and attach to wallet
					//Storage? How do we resolve back a Users sub-org by their credentials?
				}
				default: {
				}
			}
			return new Response('Not found', { status: 404 });
		} else if (request.method === 'GET') {
			switch (pathname) {
				default: {
				}
			}
			return new Response('Not found', { status: 404 });
		} else {
			return new Response('Not found', { status: 404 });
		}
	},
};
