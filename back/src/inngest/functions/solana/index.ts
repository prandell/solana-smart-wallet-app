import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import base58 from 'bs58';
import { UserWithWallet } from '../../../models';
import { createTransferInstruction, getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount, transfer } from '@solana/spl-token';
import { addWrenAddressForUser } from '../db';

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

/**
 * Create Solana account on chain by providing SOL
 * @param solanaAddress public key b58 string
 */
export async function createSolanaAccountAddSol(solanaAddress: string) {
	const connection = new Connection(DEVNET_URL, 'confirmed');
	const pubKey = new PublicKey(solanaAddress);
	try {
		await airdropIfRequired(connection, pubKey, 1 * LAMPORTS_PER_SOL, 0.5 * LAMPORTS_PER_SOL);
	} catch (e) {}
}

/**
 * Airdrop Wren tokens to provided b58 public address
 * @param solAddress b58 public address string
 * @param env context
 * @returns signature of transaction and address of user associated token account
 */
export async function dropTokens(solAddress: string, env: Env): Promise<{ signature: string; tokenAccount: PublicKey }> {
	try {
		const connection = new Connection(DEVNET_URL, 'confirmed');
		const wrenTokenChest = loadKeypairFromSecretKey(env.WREN_TOKEN_OWNER_PRIVATE_KEY);
		// Add the recipient public key here.
		const recipient = new PublicKey(solAddress);

		const tokenMintAccount = new PublicKey(env.WREN_TOKEN_MINT);

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
			1 * MINOR_WREN_UNITS_PER_MAJOR_UNITS
		);

		console.log(`✅ Transaction confirmed - https://explorer.solana.com/tx/${signature}?cluster=devnet`);

		return { signature, tokenAccount: destinationTokenAccount.address };
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

export async function getTransferWrenTransaction(
	fromAddress: string,
	toAddress: string,
	amount: number,
	wrenChestPK: string,
	wrenMint: string
) {
	try {
		const connection = new Connection(DEVNET_URL, 'confirmed');
		const wrenTokenChest = loadKeypairFromSecretKey(wrenChestPK);
		// Subtitute in your token mint account
		const tokenMintAccount = new PublicKey(wrenMint);
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
				createTransferInstruction(senderTokenAccount, recipientTokenAccount.address, sender, BigInt(amount * MINOR_UNITS_PER_MAJOR_UNITS)),
			],
			recentBlockhash: latestBlockHash.blockhash,
		}).compileToV0Message();

		console.log('Transaction constructed, returning for signing');
		const txn = new VersionedTransaction(messageV0);

		return txn;
	} catch (e) {
		console.log(e);
		throw new Error('❌ - Building transaction failed');
	}
}

export async function sendTransferWrenTokens(txn: VersionedTransaction) {
	try {
		const connection = new Connection(DEVNET_URL, 'confirmed');
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
