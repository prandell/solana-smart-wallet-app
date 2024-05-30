import { DbUser, DbWallet } from '../../../models';

export async function createUser(email: string, subOrgId: string, DB: D1Database) {
	await DB.prepare('INSERT INTO Users (user_email, sub_org_id) VALUES (?, ?);').bind(email, subOrgId).run();
}

export async function findUserByEmail(email: string, DB: D1Database): Promise<DbUser | null> {
	return await DB.prepare('SELECT * FROM Users WHERE user_email = ?;').bind(email).first();
}

export async function saveWalletForUser(userId: number, walletId: string, ethAddress: string, solAddress: string, DB: D1Database) {
	await DB.prepare('INSERT INTO Wallets (user_id, wallet_id, eth_address, sol_address) VALUES (?, ?, ?, ?);')
		.bind(userId, walletId, ethAddress, solAddress)
		.run();
}

export async function addSolAccountForUser(userId: string, solAddress: string, DB: D1Database) {
	await DB.prepare('UPDATE Wallets SET sol_address = ? WHERE user_id = ?;').bind(solAddress, userId).run();
}

export async function findWalletForUser(userId: number, DB: D1Database): Promise<DbWallet | null> {
	return await DB.prepare('SELECT * FROM Wallets WHERE user_id = ?;').bind(userId).first();
}

export async function addWrenAddressForUser(userId: string, wrenAddress: string, DB: D1Database) {
	await DB.prepare('UPDATE Wallets SET wren_address = ? WHERE user_id = ?;').bind(wrenAddress, userId).run();
}

export async function findUserById(id: string, DB: D1Database): Promise<DbUser | null> {
	return await DB.prepare('SELECT * FROM Users WHERE user_id = ?;').bind(id).first();
}

export async function findUserBySubOrgId(subOrgId: string, DB: D1Database): Promise<DbUser | null> {
	return await DB.prepare('SELECT * FROM Users WHERE sub_org_id = ?;').bind(subOrgId).first();
}
