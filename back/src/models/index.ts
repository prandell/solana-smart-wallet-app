export interface UserWithWallet {
	userId: number;
	subOrgId: string;
	email: string;
	wallet: Wallet;
}

export interface User {
	userId: number;
	subOrgId: string;
	email: string;
}

export interface DbUser {
	user_id: number;
	sub_org_id: string;
	user_email: string;
}

export interface Wallet {
	walletId: string;
	ethAddress: string;
	solAddress: string;
	wrenAddress?: string;
}

export interface WalletWithBalance {
	walletId: string;
	ethAddress: string;
	solAddress: string;
	solBalance: string;
	wrenAddress?: string;
	wrenBalance?: string;
}

export interface DbWallet {
	wallet_id: string;
	eth_address: string;
	sol_address: string;
	wren_address?: string;
}

export function mapFromDbUser(dbUser: DbUser): User {
	return { userId: dbUser['user_id'], email: dbUser['user_email'], subOrgId: dbUser['sub_org_id'] };
}
export function mapfromDbWallet(dbWallet: DbWallet): Wallet {
	return {
		ethAddress: dbWallet.eth_address,
		solAddress: dbWallet.sol_address,
		walletId: dbWallet.wallet_id,
		wrenAddress: dbWallet.wren_address,
	};
}
