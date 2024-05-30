import {
	Connection,
	Keypair,
	LAMPORTS_PER_SOL,
	NonceAccount,
	PublicKey,
	SystemProgram,
	TransactionMessage,
	VersionedTransaction,
} from '@solana/web3.js';
import base58 from 'bs58';
import { Buffer } from 'node:buffer';
import { createTransferInstruction, getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';

function loadKeypairFromSecretKey(key: string) {
	const decoded = base58.decode(key);
	return Keypair.fromSecretKey(decoded);
}

const DEVNET_URL = 'https://api.devnet.solana.com';
// Wren token has two decimal places
const MINOR_WREN_UNITS_PER_MAJOR_UNITS = Math.pow(10, 2);

export interface Env {
	TURNKEY_API_PRIVATE_KEY: string;
	TURNKEY_API_PUBLIC_KEY: string;
	TURNKEY_ORGANIZATION_ID: string;
	WREN_TOKEN_OWNER_PRIVATE_KEY: string;
	WREN_TOKEN_MINT: string;
	WREN_TOKEN_ACCOUNT: string;
	NONCE_AUTH_PK: string;
	NONCE_ACCOUNT_PK: string;
	INGEST_SIGNING_KEY: string;
	INNGEST_EVENT_KEY: string;
	DB: D1Database;
	sessionstore: KVNamespace;
}
/**
 * Helper function to Airdrop Sol if needed (replicated from the helper lib)
 * @param connection rpc connection
 * @param pubkey public key of receiever
 * @param amount amount to drop
 * @param minBal amount below which we should drop
 * @returns new balance
 */
async function airdropIfRequired(connection: Connection, pubkey: PublicKey, amount: number, minBal: number) {
	const balance = await connection.getBalance(pubkey, 'confirmed');
	if (balance < minBal) {
		console.log('requesting airdrop');
		const airdropTransactionSignature = await connection.requestAirdrop(pubkey, amount);
		const latestBlockHash = await connection.getLatestBlockhash();
		console.log('confirmating transaction');
		await connection.confirmTransaction(
			{
				blockhash: latestBlockHash.blockhash,
				lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
				signature: airdropTransactionSignature,
			},
			'finalized'
		);
		return await connection.getBalance(pubkey, 'finalized');
	}
	return balance;
}

/**
 * Create Solana account on chain by providing SOL
 * @param solanaAddress public key b58 string
 */
export async function createSolanaAccountAddSol(solanaAddress: string) {
	const connection = new Connection(DEVNET_URL, 'confirmed');
	const pubKey = new PublicKey(solanaAddress);
	try {
		await airdropIfRequired(connection, pubKey, 1 * LAMPORTS_PER_SOL, 0.5 * LAMPORTS_PER_SOL);
	} catch (e) {
		console.log(e);
	}
}

export async function createWrenTokenAccounts(solAddress: string, env: Env) {
	const connection = new Connection(DEVNET_URL, 'confirmed');
	const wrenTokenChest = loadKeypairFromSecretKey(env.WREN_TOKEN_OWNER_PRIVATE_KEY);
	// Add the recipient public key here.
	const recipient = new PublicKey(solAddress);

	const tokenMintAccount = new PublicKey(env.WREN_TOKEN_MINT);
	const destinationTokenAccount = await getOrCreateAssociatedTokenAccount(connection, wrenTokenChest, tokenMintAccount, recipient);
	return destinationTokenAccount.address;
}

export async function getNonceAndAdvance(env: Env) {
	const nonceKeypair = Keypair.fromSecretKey(base58.decode(env.NONCE_ACCOUNT_PK));
	const nonceAuthKP = Keypair.fromSecretKey(base58.decode(env.NONCE_AUTH_PK));
	const connection = new Connection(DEVNET_URL, 'confirmed');

	const accountInfo = await connection.getAccountInfo(nonceKeypair.publicKey);
	if (accountInfo) {
		const nonceAccount = NonceAccount.fromAccountData(accountInfo.data);
		return {
			advanceIX: SystemProgram.nonceAdvance({
				authorizedPubkey: nonceAuthKP.publicKey,
				noncePubkey: nonceKeypair.publicKey,
			}),
			nonceAccount,
			nonceAuth: nonceAuthKP,
		};
	}
	return {};
}

/**
 * Airdrop Wren tokens to provided b58 public address.
 * @param solAddress b58 public address string
 * @param env context
 * @returns signature of transaction and address of user associated token account
 */
export async function dropTokens(solAddress: string, env: Env): Promise<{ signature: string }> {
	try {
		const connection = new Connection(DEVNET_URL, 'confirmed');
		const wrenTokenChest = loadKeypairFromSecretKey(env.WREN_TOKEN_OWNER_PRIVATE_KEY);
		// Add the recipient public key here.
		const recipient = new PublicKey(solAddress);

		const tokenMintAccount = new PublicKey(env.WREN_TOKEN_MINT);

		console.log('Getting/creating party token accounts ...');
		const sourceTokenAccount = await getAssociatedTokenAddress(tokenMintAccount, wrenTokenChest.publicKey);
		const destinationTokenAccount = await getOrCreateAssociatedTokenAccount(connection, wrenTokenChest, tokenMintAccount, recipient);

		// Transfer the tokens
		console.log('Getting durable nonce and advancing ...');
		const { advanceIX, nonceAccount, nonceAuth } = await getNonceAndAdvance(env);
		if (!advanceIX || !nonceAccount) {
			throw new Error('could not advance nonce account');
		}

		console.log('Creating transfer instruction ...');
		const ix = createTransferInstruction(
			sourceTokenAccount,
			destinationTokenAccount.address,
			wrenTokenChest.publicKey,
			1 * MINOR_WREN_UNITS_PER_MAJOR_UNITS
		);

		const messageV0 = new TransactionMessage({
			payerKey: wrenTokenChest.publicKey,
			instructions: [advanceIX, ix],
			recentBlockhash: nonceAccount.nonce,
		}).compileToV0Message();

		const txn = new VersionedTransaction(messageV0);

		// sign the tx with the nonce authority's keypair, and sender
		txn.sign([nonceAuth, wrenTokenChest]);

		console.log('Sending Transfer transaction to Network ...');
		const signature = await connection.sendRawTransaction(txn.serialize(), { maxRetries: 2 });

		console.log('Transaction sent successfully! Confirming ...');
		// Unable to confirm transactions, could be wrangler related

		// const confirmation = await connection.confirmTransaction({
		// 	nonceAccountPubkey: nonceAccount.authorizedPubkey,
		// 	signature,
		// 	nonceValue: nonceAccount.nonce,
		// 	minContextSlot: await connection.getSlot()
		// });
		console.log(`✅ Transaction confirmed - https://explorer.solana.com/tx/${signature}?cluster=devnet`);

		return { signature };
	} catch (e) {
		console.log(e);
		throw new Error('❌ - Transaction failed');
	}
}

export function serialiseUnsignedTxn(txn: VersionedTransaction) {
	return Buffer.from(txn.serialize()).toString('base64');
}

export function deserialiseSignedTxn(txn: string) {
	return VersionedTransaction.deserialize(Buffer.from(txn, 'base64'));
}

export async function getSolBalance(solanaAddress: string) {
	const connection = new Connection(DEVNET_URL, 'confirmed');
	const pubKey = new PublicKey(solanaAddress);
	return (await connection.getBalance(pubKey)) / LAMPORTS_PER_SOL;
}

export async function getWrenBalance(address: string, wrenChestPK: string, wrenMint: string) {
	const connection = new Connection(DEVNET_URL, 'confirmed');
	const wrenTokenChest = loadKeypairFromSecretKey(wrenChestPK);
	const tokenMintAccount = new PublicKey(wrenMint);
	const pubKey = new PublicKey(address);
	const destinationTokenAccount = await getOrCreateAssociatedTokenAccount(connection, wrenTokenChest, tokenMintAccount, pubKey);
	const bal = await connection.getTokenAccountBalance(destinationTokenAccount.address);
	return bal.value.uiAmountString;
}

export async function getTransferWrenTransaction(fromAddress: string, toAddress: string, amount: number, env: Env) {
	try {
		const connection = new Connection(DEVNET_URL, 'confirmed');
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

		console.log('Getting durable nonce and advancing ...');
		const { advanceIX, nonceAccount, nonceAuth } = await getNonceAndAdvance(env);
		if (!advanceIX || !nonceAccount) {
			throw new Error('could not advance nonce account');
		}

		console.log('Constructing transaction ...');
		const messageV0 = new TransactionMessage({
			payerKey: sender,
			instructions: [
				advanceIX,
				createTransferInstruction(senderTokenAccount, recipientTokenAccount.address, sender, BigInt(amount * MINOR_UNITS_PER_MAJOR_UNITS)),
			],
			recentBlockhash: nonceAccount.nonce,
		}).compileToV0Message();

		console.log('Transaction constructed, returning for signing');
		const txn = new VersionedTransaction(messageV0);
		txn.sign([nonceAuth]);

		return txn;
	} catch (e) {
		console.log(e);
		throw new Error('❌ - Building transaction failed');
	}
}

export async function sendTransferWrenTokens(txn: VersionedTransaction, env: Env) {
	try {
		const connection = new Connection(DEVNET_URL, 'confirmed');
		const latestBlockHash = await connection.getLatestBlockhash();

		console.log('Sending Transfer transaction to Network ...');

		const txid = await connection.sendTransaction(txn, { maxRetries: 2 });

		console.log('Transaction sent successfully! Confirming ...');

		// Cannot confirm transactions

		// const { advanceIX, nonceAccount } = await getNonceAndAdvance(env);
		// if (!advanceIX || !nonceAccount) {
		// 	throw new Error('could not advance nonce account');
		// }

		// const confirmation = await connection.confirmTransaction({
		// 	nonceAccountPubkey: nonceAccount.authorizedPubkey,
		// 	signature: txid,
		// 	nonceValue: nonceAccount.nonce,
		// 	minContextSlot: await connection.getSlot(),
		// });

		// if (confirmation.value.err) {
		// 	throw new Error('❌ - Transaction not confirmed.');
		// }

		console.log(`✅ Transaction confirmed - https://explorer.solana.com/tx/${txid}?cluster=devnet`);
		return txid;
	} catch (e) {
		console.log(e);
		throw new Error('❌ - Transaction failed');
	}
}
