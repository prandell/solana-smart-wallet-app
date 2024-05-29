import { DEFAULT_ETHEREUM_ACCOUNTS, Turnkey } from '@turnkey/sdk-server';
import { Buffer } from 'node:buffer';
import {
	Connection,
	Keypair,
	LAMPORTS_PER_SOL,
	PublicKey,
	TransactionMessage,
	VersionedTransaction,
} from '@solana/web3.js';
import base58 from 'bs58';
import { createTransferInstruction, getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount, transfer } from '@solana/spl-token';

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
	WREN_TOKEN_OWNER_PRIVATE_KEY: string;
	WREN_TOKEN_MINT: string;
	WREN_TOKEN_ACCOUNT: string;
	DB: D1Database;
	sessionstore: KVNamespace;
}

function generateSessionId(): string {
	return crypto.randomUUID();
}

// Create a new session in the KV store
async function createSession(data: any, env: Env): Promise<string> {
	const sessionId = generateSessionId();
	try {
		await env.sessionstore.put(sessionId, JSON.stringify(data), { expirationTtl: 60 * 60 * 1 });
	} catch (error) {
		console.error('Error creating session: ' + error);
	}
	return sessionId;
}

// Update session data in the KV store
async function updateSession(sessionId: string, data: any, env: Env): Promise<void> {
	await env.sessionstore.put(sessionId, JSON.stringify(data), { expirationTtl: 60 * 60 * 1 });
}

// Add data to an existing session
async function addToSession(sessionId: string, data: any, env: Env): Promise<void> {
	const sessionData = await getSessionData(sessionId, env);
	await updateSession(sessionId, { ...sessionData, ...data }, env);
}

// Retrieve session data from the KV store
async function getSessionData(sessionId: string, env: Env): Promise<any> {
	if (!sessionId) return null;
	const data = await env.sessionstore.get(sessionId);
	return data ? JSON.parse(data) : null;
}

// Delete a session from the KV store
async function deleteSession(sessionId: string, env: Env): Promise<void> {
	await env.sessionstore.delete(sessionId);
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const origin = request.headers.get('Origin') || '';
		const { pathname } = new URL(request.url);
		const corsHeaders = {
			'Access-Control-Allow-Origin': origin,
			'Access-Control-Allow-Headers': 'Content-Type, sessionId',
			'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
			'Access-Control-Max-Age': '86400',
			'Access-Control-Allow-Credentials': 'true',
		};

		return await handle(request);

		/**
		 * Handles request based on HTTP Method
		 * @param request
		 * @returns
		 */
		async function handle(request: Request) {
			if (request.method === 'OPTIONS') {
				return handleOptions(request);
			} else if (request.method === 'POST') {
				return await handlePost(request);
			} else if (request.method === 'GET' || request.method == 'HEAD') {
				return await handleGet(request);
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
					headers: corsHeaders,
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

		async function handlePost(request: Request) {
			if (request.headers.get('Content-Type') !== 'application/json') {
				return new Response(null, {
					status: 415,
					statusText: 'Unsupported Media Type',
					headers: corsHeaders,
				});
			}

			// Detect parse failures by setting `json` to null.
			const body = await request.json().catch((e) => null);
			if (body === null) {
				return new Response('JSON parse failure', {
					status: 400,
					statusText: 'Bad Request',
					headers: corsHeaders,
				});
			}
			const turnkey = new Turnkey({
				apiBaseUrl: 'https://api.turnkey.com',
				apiPrivateKey: env.TURNKEY_API_PRIVATE_KEY,
				apiPublicKey: env.TURNKEY_API_PUBLIC_KEY,
				defaultOrganizationId: env.TURNKEY_ORGANIZATION_ID,
			});

			const apiClient = turnkey.apiClient();

			switch (pathname) {
				case '/api/register': {
					const { email, attestation, challenge } = body as any;
					if (!email || !attestation || !challenge) {
						return new Response('email, attestation, and challenge must all be supplied', { status: 400 });
					}

					const subOrganizationConfig = {
						subOrganizationName: email,
						rootUsers: [
							{
								userName: email,
								userEmail: email,
								apiKeys: [],
								authenticators: [
									{
										authenticatorName: email,
										challenge: challenge,
										attestation: attestation,
									},
								],
							},
						],
						rootQuorumThreshold: 1,
						wallet: {
							walletName: email,
							accounts: [
								...DEFAULT_ETHEREUM_ACCOUNTS,
								{
									curve: 'CURVE_ED25519',
									pathFormat: 'PATH_FORMAT_BIP32',
									path: "m/44'/501'/0'/0'",
									addressFormat: 'ADDRESS_FORMAT_SOLANA',
								},
							],
						},
					};

					try {
						const subOrganizationResponse = await apiClient.createSubOrganization(subOrganizationConfig as any);
						const subOrgId = subOrganizationResponse.subOrganizationId;
						await createUser(email, subOrgId);

						const user = (await findUserByEmail(email)) as any;
						const { wallet } = subOrganizationResponse;
						if (wallet && wallet.walletId && wallet.addresses[0] && wallet.addresses[1]) {
							await saveWalletForUser(user['user_id'], wallet.walletId, wallet.addresses[0], wallet.addresses[1]);
						}

						//Create Solana Account and attach to wallet
						const solanaAddress = wallet?.addresses[1] ?? '';
						await createSolanaAccountAddSol(solanaAddress);

						const sessionId = await createSession(user, env);

						return new Response(JSON.stringify({ sessionId }), {
							headers: {
								'Content-Type': 'application/json',
								...corsHeaders,
							},
						});
					} catch (e) {
						console.log(e);
						return new Response('Error while creating new user', { status: 500, headers: corsHeaders });
					}
				}
				case '/api/authenticate': {
					const signedRequest = (body as any).signedWhoamiRequest as any;
					const res = await forwardSignedRequest(signedRequest.url, signedRequest.body, signedRequest.stamp);
					const rJson = (await res.json()) as any;
					const user = await findUserBySubOrgId(rJson.organizationId);
					const sessionId = await createSession(user, env);
					return new Response(JSON.stringify({ sessionId }), {
						status: res.status,
						headers: {
							'Content-Type': 'application/json',
							...corsHeaders,
						},
					});
				}

				case '/api/wallet/drop': {
					const user = await getSessionData(request.headers.get('sessionId') ?? '', env);
					if (!user) {
						return new Response('No current user session', { status: 403, headers: corsHeaders });
					}
					try {
						const wallet = await findWalletForUser(user['user_id']);
						//Get wallet balance here
						if (wallet) {
							const solAddress = (wallet as any)['sol_address'];
							const { signature, tokenAccount } = await dropWren(solAddress);

							if (!wallet['wren_address']) {
								await addWrenAddressForUser(user['user_id'], tokenAccount.toBase58());
							}

							return new Response(JSON.stringify({ signature }), {
								headers: {
									'Content-Type': 'application/json',
									...corsHeaders,
								},
							});
						}
						return new Response('Unable to find wallet for user', { status: 500, headers: corsHeaders });
					} catch (e) {
						console.log(e);
						return new Response('Error while airdropping wren tokens', { status: 500, headers: corsHeaders });
					}
				}

				case '/api/wallet/construct-tx': {
					const { destination, amount } = body as any;
					const user = await getSessionData(request.headers.get('sessionId') ?? '', env);
					if (!user) {
						return new Response('No current user session', { status: 403, headers: corsHeaders });
					}

					try {
						const wallet = await findWalletForUser(user['user_id']);
						if (wallet) {
							const wrenAddress = (wallet as any)['wren_address'];
							const solAddress = (wallet as any)['sol_address'];

							if (!wrenAddress) {
								return new Response('No Wren Token available', { status: 403, headers: corsHeaders });
							}

							const txn = await getTransferWrenTransaction(solAddress, destination, parseFloat(amount));

							return new Response(JSON.stringify({ unsignedTransaction: serialiseUnsignedTxn(txn), subOrgId: user['sub_org_id'] }), {
								headers: {
									'Content-Type': 'application/json',
									...corsHeaders,
								},
							});
						}
						return new Response('Unable to find wallet for user', { status: 500, headers: corsHeaders });
					} catch (e) {
						console.log(e);
						return new Response('Error while constructing transfer transaction', { status: 500, headers: corsHeaders });
					}
				}

				case '/api/wallet/send-tx': {
					const { signedSendTx } = body as any;
					const user = await getSessionData(request.headers.get('sessionId') ?? '', env);
					if (!user) {
						return new Response('No current user session', { status: 403, headers: corsHeaders });
					}

					try {
						const res = await sendTransferWrenTokens(deserialiseSignedTxn(signedSendTx));
						return new Response(JSON.stringify({ res }), {
							headers: {
								'Content-Type': 'application/json',
								...corsHeaders,
							},
						});
					} catch (e) {
						console.log(e);
						return new Response('Error while sending wren tokens', { status: 500, headers: corsHeaders });
					}
				}
				default: {
					return new Response('Not found', { status: 404, headers: corsHeaders });
				}
			}
		}

		async function handleGet(request: Request) {
			switch (true) {
				case pathname.startsWith('/api/registration/') && pathname.length > '/api/registration/'.length: {
					const email = pathname.replace('/api/registration/', '');
					const response = await findUserByEmail(email);

					if (!response) return new Response(null, { status: 204, headers: corsHeaders });

					return new Response(JSON.stringify(response), {
						headers: {
							'Content-Type': 'application/json',
							...corsHeaders,
						},
					});
				}
				case pathname === '/api/whoami': {
					if (!request.headers.get('sessionId')) {
						return new Response(null, { status: 204, headers: corsHeaders });
					}
					const user = await getSessionData(request.headers.get('sessionId') ?? '', env);
					if (!user) {
						return new Response(null, { status: 204, headers: corsHeaders });
					}
					return new Response(JSON.stringify(user), {
						headers: {
							'Content-Type': 'application/json',
							...corsHeaders,
						},
					});
				}
				case pathname === '/api/wallet': {
					const user = await getSessionData(request.headers.get('sessionId') ?? '', env);
					if (!user) {
						return new Response('No current user session', { status: 403, headers: corsHeaders });
					}
					try {
						const wallet = await findWalletForUser(user['user_id']);
						if (wallet) {
							const solAddress = (wallet as any)['sol_address'];
							const balance = await getSolBalance(solAddress);

							//Get wren token balance here
							if (wallet['wren_address']) {
								const wrenBal = await getWrenBalance(solAddress);
								wallet['wren_balance'] = wrenBal;
							}

							return new Response(JSON.stringify({ sol_balance: balance.toFixed(2), ...wallet }), {
								headers: {
									'Content-Type': 'application/json',
									...corsHeaders,
								},
							});
						}
						return new Response('Unable to find wallet for user', { status: 500, headers: corsHeaders });
					} catch (e) {
						console.log(e);
						return new Response('Error while fetching user wallet', { status: 500, headers: corsHeaders });
					}
				}
				default: {
					return new Response('Not found', { status: 404, headers: corsHeaders });
				}
			}
		}

		async function createUser(email: string, subOrgId: string) {
			await env.DB.prepare('INSERT INTO Users (user_email, sub_org_id) VALUES (?, ?);').bind(email, subOrgId).run();
		}

		async function findUserByEmail(email: string) {
			const res = await env.DB.prepare('SELECT * FROM Users WHERE user_email = ?;').bind(email).first();
			return res;
		}

		async function saveWalletForUser(userId: string, walletId: string, ethAddress: string, solAddress: string) {
			await env.DB.prepare('INSERT INTO Wallets (user_id, wallet_id, eth_address, sol_address) VALUES (?, ?, ?, ?);')
				.bind(userId, walletId, ethAddress, solAddress)
				.run();
		}

		async function addSolAccountForUser(userId: string, solAddress: string) {
			await env.DB.prepare('UPDATE Wallets SET sol_address = ? WHERE user_id = ?;').bind(solAddress, userId).run();
		}

		async function findWalletForUser(userId: string) {
			return await env.DB.prepare('SELECT * FROM Wallets WHERE user_id = ?;').bind(userId).first();
		}

		async function addWrenAddressForUser(userId: string, wrenAddress: string) {
			await env.DB.prepare('UPDATE Wallets SET wren_address = ? WHERE user_id = ?;').bind(wrenAddress, userId).run();
		}

		async function findUserById(id: string) {
			const res = await env.DB.prepare('SELECT * FROM Users WHERE user_id = ?;').bind(id).first();
			return res;
		}

		async function findUserBySubOrgId(subOrgId: string) {
			const res = await env.DB.prepare('SELECT * FROM Users WHERE sub_org_id = ?;').bind(subOrgId).first();
			return res;
		}

		async function forwardSignedRequest(url: string, body: string, stamp: { stampHeaderName: string; stampHeaderValue: string }) {
			const req = new Request(url, { body, method: 'POST' });
			req.headers.set(stamp.stampHeaderName, stamp.stampHeaderValue);
			const res = await fetch(req);
			return res;
		}

		async function airdropIfRequired(connection: Connection, pubkey: PublicKey, amount: number, minBal: number) {
			const balance = await connection.getBalance(pubkey, 'confirmed');
			if (balance < minBal) {
				const airdropTransactionSignature = await connection.requestAirdrop(pubkey, amount);
				const latestBlockHash = await connection.getLatestBlockhash();
				await connection.confirmTransaction(
					{
						blockhash: latestBlockHash.blockhash,
						lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
						signature: airdropTransactionSignature,
					},
					'finalized'
				);
				return connection.getBalance(pubkey, 'finalized');
			}
			return balance;
		}

		function serialiseUnsignedTxn(txn: VersionedTransaction) {
			return Buffer.from(txn.serialize()).toString('base64');
		}

		function deserialiseSignedTxn(txn: string) {
			return VersionedTransaction.deserialize(Buffer.from(txn, 'base64'));
		}

		async function createSolanaAccountAddSol(solanaAddress: string) {
			const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
			const pubKey = new PublicKey(solanaAddress);
			try {
				await airdropIfRequired(connection, pubKey, 1 * LAMPORTS_PER_SOL, 0.5 * LAMPORTS_PER_SOL);
			} catch (e) {}
		}

		async function getSolBalance(solanaAddress: string) {
			const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
			const pubKey = new PublicKey(solanaAddress);
			return (await connection.getBalance(pubKey)) / LAMPORTS_PER_SOL;
		}

		//Assumes a b58 string
		function loadKeypairFromSecretKey(key: string) {
			const decoded = base58.decode(key);
			return Keypair.fromSecretKey(decoded);
		}

		async function getWrenBalance(address: string) {
			const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
			const wrenTokenChest = loadKeypairFromSecretKey(env.WREN_TOKEN_OWNER_PRIVATE_KEY);
			const tokenMintAccount = new PublicKey(env.WREN_TOKEN_MINT);
			const pubKey = new PublicKey(address);
			const destinationTokenAccount = await getOrCreateAssociatedTokenAccount(connection, wrenTokenChest, tokenMintAccount, pubKey);
			const bal = await connection.getTokenAccountBalance(destinationTokenAccount.address);
			return bal.value.uiAmountString;
		}

		async function getTransferWrenTransaction(fromAddress: string, toAddress: string, amount: number) {
			try {
				const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
				const wrenTokenChest = loadKeypairFromSecretKey(env.WREN_TOKEN_OWNER_PRIVATE_KEY);
				// Subtitute in your token mint account
				const tokenMintAccount = new PublicKey(env.WREN_TOKEN_MINT);
				// Our token has two decimal places
				const MINOR_UNITS_PER_MAJOR_UNITS = Math.pow(10, 2);

				// Add the recipient public key here.
				const recipient = new PublicKey(toAddress);
				const sender = new PublicKey(fromAddress);

				console.log('Getting party token accounts ...');
				const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(connection, wrenTokenChest, tokenMintAccount, recipient);
				const senderTokenAccount = await getAssociatedTokenAddress(tokenMintAccount, sender);

				console.log('Constructing transaction ...');
				const latestBlockHash = await connection.getLatestBlockhash();
				const messageV0 = new TransactionMessage({
					payerKey: sender,
					instructions: [
						createTransferInstruction(
							senderTokenAccount,
							recipientTokenAccount.address,
							sender,
							BigInt(amount * MINOR_UNITS_PER_MAJOR_UNITS)
						),
					],
					recentBlockhash: latestBlockHash.blockhash,
				}).compileToV0Message();

				const txn = new VersionedTransaction(messageV0);

				return txn;
			} catch (e) {
				console.log(e);
				throw new Error('❌ - Building transaction failed');
			}
		}

		async function sendTransferWrenTokens(txn: VersionedTransaction) {
			try {
				const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
				const latestBlockHash = await connection.getLatestBlockhash();

				console.log('Sending Transfer transaction to Network ...');

				const txid = await connection.sendTransaction(txn, { maxRetries: 2 });

				console.log('Transaction sent successfully! Confirming ...');

				const confirmation = await connection.confirmTransaction({
					signature: txid,
					blockhash: latestBlockHash.blockhash,
					lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
				});

				console.log(`✅ Transaction confirmed - https://explorer.solana.com/tx/${txid}?cluster=devnet`);

				if (confirmation.value.err) {
					throw new Error('❌ - Transaction not confirmed.');
				}
				return txid;
			} catch (e) {
				console.log(e);
				throw new Error('❌ - Transaction failed');
			}
		}

		async function dropWren(address: string) {
			try {
				const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
				const wrenTokenChest = loadKeypairFromSecretKey(env.WREN_TOKEN_OWNER_PRIVATE_KEY);
				// Add the recipient public key here.
				const recipient = new PublicKey(address);

				// Subtitute in your token mint account
				const tokenMintAccount = new PublicKey(env.WREN_TOKEN_MINT);

				// Our token has two decimal places
				const MINOR_UNITS_PER_MAJOR_UNITS = Math.pow(10, 2);

				console.log('Getting/creating party token accounts ...');
				const sourceTokenAccount = await getOrCreateAssociatedTokenAccount(
					connection,
					wrenTokenChest,
					tokenMintAccount,
					wrenTokenChest.publicKey
				);
				const destinationTokenAccount = await getOrCreateAssociatedTokenAccount(connection, wrenTokenChest, tokenMintAccount, recipient);

				// Transfer the tokens
				console.log('Initiating airdrop ...');
				const signature = await transfer(
					connection,
					wrenTokenChest,
					sourceTokenAccount.address,
					destinationTokenAccount.address,
					wrenTokenChest,
					1 * MINOR_UNITS_PER_MAJOR_UNITS
				);

				console.log(`✅ Transaction confirmed - https://explorer.solana.com/tx/${signature}?cluster=devnet`);

				return { signature, tokenAccount: destinationTokenAccount.address };
			} catch (e) {
				console.log(e);
				throw new Error('❌ - Transaction failed');
			}
		}
	},
};
