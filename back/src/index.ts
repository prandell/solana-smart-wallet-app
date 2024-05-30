import { serve } from 'inngest/cloudflare';
import { fns } from './inngest';
import { WalletWithBalance, mapFromDbUser, mapfromDbWallet } from './models';
import { createUser, findUserByEmail, findUserBySubOrgId, findWalletForUser, saveWalletForUser } from './inngest/functions/db';
import { createSession, getSessionData } from './inngest/functions/kv';
import {
	createSolanaAccountAddSol,
	deserialiseSignedTxn,
	getSolBalance,
	getTransferWrenTransaction,
	getWrenBalance,
	sendTransferWrenTokens,
	serialiseUnsignedTxn,
} from './inngest/functions/solana';
import { forwardSignedRequest, getCreateUserSubOrgPayload, getTurnkeyAPIClient } from './inngest/functions/turnkey';
import { inngest } from './inngest/client';

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

export interface Env {
	TURNKEY_API_PRIVATE_KEY: string;
	TURNKEY_API_PUBLIC_KEY: string;
	TURNKEY_ORGANIZATION_ID: string;
	WREN_TOKEN_OWNER_PRIVATE_KEY: string;
	WREN_TOKEN_MINT: string;
	WREN_TOKEN_ACCOUNT: string;
	INGEST_SIGNING_KEY: string;
	DB: D1Database;
	sessionstore: KVNamespace;
}

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': 'http://localhost:3000',
	'Access-Control-Allow-Headers': 'Content-Type, sessionId',
	'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
	'Access-Control-Max-Age': '86400',
	'Access-Control-Allow-Credentials': 'true',
};

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const origin = request.headers.get('Origin') || '';
		const { pathname } = new URL(request.url);

		//Ensure Inngest handles itself
		if (pathname === '/api/inngest') {
			return await serve({
				client: inngest,
				functions: fns,
				signingKey: env.INGEST_SIGNING_KEY,
			})({ request, env: env as any });
		}

		//Main handler
		return await handle(request, env);
	},
};

/**
 * Handles request based on HTTP Method
 * @param request
 * @returns
 */
async function handle(request: Request, env: Env) {
	if (request.method === 'OPTIONS') {
		return handleOptions(request);
	} else if (request.method === 'POST') {
		return await handlePost(request, env);
	} else if (request.method === 'GET' || request.method == 'HEAD') {
		return await handleGet(request, env);
	} else {
		return new Response(null, {
			status: 405,
			statusText: 'Method Not Allowed',
		});
	}
}

function handleOptions(request: Request) {
	if (
		request.headers.get('Origin') !== null &&
		request.headers.get('Access-Control-Request-Method') !== null &&
		request.headers.get('Access-Control-Request-Headers') !== null
	) {
		// Handle CORS pre-flight request.
		return new Response(null, {
			headers: CORS_HEADERS,
		});
	} else {
		// Handle standard OPTIONS request.
		return new Response(null, {
			headers: {
				Allow: 'GET, HEAD, POST, OPTIONS',
			},
		});
	}
}

async function handlePost(request: Request, env: Env) {
	const { pathname } = new URL(request.url);
	if (request.headers.get('Content-Type') !== 'application/json') {
		return new Response(null, {
			status: 415,
			statusText: 'Unsupported Media Type',
			headers: CORS_HEADERS,
		});
	}

	// Detect parse failures by setting `json` to null.
	const body = await request.json().catch((e) => null);
	if (body === null) {
		return new Response('JSON parse failure', {
			status: 400,
			statusText: 'Bad Request',
			headers: CORS_HEADERS,
		});
	}

	const apiClient = getTurnkeyAPIClient(env.TURNKEY_API_PRIVATE_KEY, env.TURNKEY_API_PUBLIC_KEY, env.TURNKEY_ORGANIZATION_ID);

	switch (pathname) {
		case '/api/register': {
			const { email, attestation, challenge } = body as any;
			if (!email || !attestation || !challenge) {
				return new Response('email, attestation, and challenge must all be supplied', { status: 400 });
			}

			const subOrganizationConfig = getCreateUserSubOrgPayload(email, challenge, attestation);

			try {
				//Create a Turnkey sub-org for new user
				const subOrganizationResponse = await apiClient.createSubOrganization(subOrganizationConfig);
				const subOrgId = subOrganizationResponse.subOrganizationId;

				//Create user in database with new OrgId
				await createUser(email, subOrgId, env.DB);
				const dbUser = await findUserByEmail(email, env.DB);
				if (!dbUser) {
					return new Response('User creation failed', { status: 500, headers: CORS_HEADERS });
				}

				//Create wallet in database for new user
				const user = mapFromDbUser(dbUser);
				const { wallet } = subOrganizationResponse;
				if (wallet && wallet.walletId && wallet.addresses[0] && wallet.addresses[1]) {
					await saveWalletForUser(user.userId, wallet.walletId, wallet.addresses[0], wallet.addresses[1], env.DB);
				}

				//Create Solana Account and attach to wallet
				const solanaAddress = wallet?.addresses[1] ?? '';
				await createSolanaAccountAddSol(solanaAddress);

				const sessionId = await createSession(user, env.sessionstore);

				return new Response(JSON.stringify({ sessionId }), {
					headers: {
						'Content-Type': 'application/json',
						...CORS_HEADERS,
					},
				});
			} catch (e) {
				console.log(e);
				return new Response('Error while creating new user', { status: 500, headers: CORS_HEADERS });
			}
		}
		case '/api/authenticate': {
			const signedRequest = (body as any).signedWhoamiRequest as any;
			const res = await forwardSignedRequest(signedRequest.url, signedRequest.body, signedRequest.stamp);
			const rJson = (await res.json()) as any;
			const dbUser = await findUserBySubOrgId(rJson.organizationId, env.DB);
			if (!dbUser) {
				return new Response('No user in database', { status: 500, headers: CORS_HEADERS });
			}
			const user = mapFromDbUser(dbUser);
			const sessionId = await createSession(user, env.sessionstore);
			return new Response(JSON.stringify({ sessionId }), {
				status: res.status,
				headers: {
					'Content-Type': 'application/json',
					...CORS_HEADERS,
				},
			});
		}

		case '/api/wallet/drop': {
			const user = await getSessionData(request.headers.get('sessionId') ?? '', env.sessionstore);
			if (!user) {
				return new Response('No current user session', { status: 403, headers: CORS_HEADERS });
			}

			try {
				const dbWallet = await findWalletForUser(user.userId, env.DB);
				if (dbWallet) {
					const { ids } = await inngest.send({
						name: 'app/wallet/drop-tokens',
						user: { ...user, wallet: mapfromDbWallet(dbWallet) },
						data: { env },
					});

					console.log(`Inngest function Id for Airdrop: ${ids}`);

					return new Response(null, {
						status: 200,
						headers: {
							'Content-Type': 'application/json',
							...CORS_HEADERS,
						},
					});
				}
				return new Response('Unable to find wallet for user', { status: 500, headers: CORS_HEADERS });
			} catch (e) {
				console.log(e);
				return new Response('Error while airdropping wren tokens', { status: 500, headers: CORS_HEADERS });
			}
		}

		case '/api/wallet/construct-tx': {
			const { destination, amount } = body as any;
			const user = await getSessionData(request.headers.get('sessionId') ?? '', env.sessionstore);
			if (!user) {
				return new Response('No current user session', { status: 403, headers: CORS_HEADERS });
			}

			try {
				const dbWallet = await findWalletForUser(user.userId, env.DB);
				if (dbWallet) {
					const wallet = mapfromDbWallet(dbWallet);
					const { solAddress, wrenAddress } = wallet;

					if (!wrenAddress) {
						return new Response('No Wren Token available', { status: 403, headers: CORS_HEADERS });
					}

					const txn = await getTransferWrenTransaction(
						solAddress,
						destination,
						parseFloat(amount),
						env.WREN_TOKEN_OWNER_PRIVATE_KEY,
						env.WREN_TOKEN_MINT
					);

					return new Response(JSON.stringify({ unsignedTransaction: serialiseUnsignedTxn(txn), subOrgId: user.subOrgId }), {
						headers: {
							'Content-Type': 'application/json',
							...CORS_HEADERS,
						},
					});
				}
				return new Response('Unable to find wallet for user', { status: 500, headers: CORS_HEADERS });
			} catch (e) {
				console.log(e);
				return new Response('Error while constructing transfer transaction', { status: 500, headers: CORS_HEADERS });
			}
		}

		case '/api/wallet/send-tx': {
			const { signedSendTx } = body as any;
			const user = await getSessionData(request.headers.get('sessionId') ?? '', env.sessionstore);
			if (!user) {
				return new Response('No current user session', { status: 403, headers: CORS_HEADERS });
			}

			try {
				const res = await sendTransferWrenTokens(deserialiseSignedTxn(signedSendTx));
				return new Response(JSON.stringify({ res }), {
					headers: {
						'Content-Type': 'application/json',
						...CORS_HEADERS,
					},
				});
			} catch (e) {
				console.log(e);
				return new Response('Error while sending wren tokens', { status: 500, headers: CORS_HEADERS });
			}
		}
		default: {
			return new Response('Not found', { status: 404, headers: CORS_HEADERS });
		}
	}
}

async function handleGet(request: Request, env: Env) {
	const { pathname } = new URL(request.url);
	switch (true) {
		case pathname.startsWith('/api/registration/') && pathname.length > '/api/registration/'.length: {
			const email = pathname.replace('/api/registration/', '');
			const response = await findUserByEmail(email, env.DB);

			if (!response) return new Response(null, { status: 204, headers: CORS_HEADERS });

			return new Response(JSON.stringify(response), {
				headers: {
					'Content-Type': 'application/json',
					...CORS_HEADERS,
				},
			});
		}
		case pathname === '/api/whoami': {
			if (!request.headers.get('sessionId')) {
				return new Response(null, { status: 204, headers: CORS_HEADERS });
			}
			const user = await getSessionData(request.headers.get('sessionId') ?? '', env.sessionstore);
			if (!user) {
				return new Response(null, { status: 204, headers: CORS_HEADERS });
			}
			return new Response(JSON.stringify(user), {
				headers: {
					'Content-Type': 'application/json',
					...CORS_HEADERS,
				},
			});
		}
		case pathname === '/api/wallet': {
			const user = await getSessionData(request.headers.get('sessionId') ?? '', env.sessionstore);
			if (!user) {
				return new Response('No current user session', { status: 403, headers: CORS_HEADERS });
			}

			try {
				const dbWallet = await findWalletForUser(user.userId, env.DB);
				if (dbWallet) {
					const wallet = mapfromDbWallet(dbWallet);
					const { solAddress, wrenAddress } = wallet;
					const balance = await getSolBalance(solAddress);

					const res: WalletWithBalance = { solBalance: balance.toFixed(2), ...wallet };

					//Get wren token balance here
					if (wrenAddress) {
						const wrenBal = await getWrenBalance(solAddress, env.WREN_TOKEN_OWNER_PRIVATE_KEY, env.WREN_TOKEN_MINT);
						res['wrenBalance'] = wrenBal;
					}

					return new Response(JSON.stringify(res), {
						headers: {
							'Content-Type': 'application/json',
							...CORS_HEADERS,
						},
					});
				}
				return new Response('Unable to find wallet for user', { status: 500, headers: CORS_HEADERS });
			} catch (e) {
				console.log(e);
				return new Response('Error while fetching user wallet', { status: 500, headers: CORS_HEADERS });
			}
		}
		default: {
			return new Response('Not found', { status: 404, headers: CORS_HEADERS });
		}
	}
}
