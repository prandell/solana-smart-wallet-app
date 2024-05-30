import { DEFAULT_ETHEREUM_ACCOUNTS, Turnkey, TurnkeyApiClient } from '@turnkey/sdk-server';

export const getTurnkeyAPIClient = (privateKey: string, publicKey: string, defaultOrgId: string): TurnkeyApiClient => {
	const tk = new Turnkey({
		apiBaseUrl: 'https://api.turnkey.com',
		apiPrivateKey: privateKey,
		apiPublicKey: publicKey,
		defaultOrganizationId: defaultOrgId,
	});
	return tk.apiClient();
};

export async function forwardSignedRequest(url: string, body: string, stamp: { stampHeaderName: string; stampHeaderValue: string }) {
	const req = new Request(url, { body, method: 'POST' });
	req.headers.set(stamp.stampHeaderName, stamp.stampHeaderValue);
	const res = await fetch(req);
	return res;
}

export const getCreateUserSubOrgPayload = (email: string, challenge: any, attestation: any): any => {
	return {
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
};
