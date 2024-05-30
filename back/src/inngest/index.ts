import { Inngest } from 'inngest';
import { createWrenTokenAccounts, dropTokens } from './functions/solana';
import { UserWithWallet } from '../models';
import { addWrenAddressForUser } from './functions/db';
import { PublicKey } from '@solana/web3.js';

export const getInngestAndFunctions = (eventKey: string) => {
	const inngest = new Inngest({ id: 'my-app', eventKey });
	/**
	 * INNGEST droptokenUpdateUser background function
	 */
	const dropTokensUpdateUser = inngest.createFunction(
		{ id: 'drop-tokens' },
		{ event: 'app/wallet/drop-tokens' },
		async ({ event, step }) => {
			const { data, user } = event;
			const { env } = data;
			const { wallet, userId } = user as UserWithWallet;
			const { solAddress, wrenAddress } = wallet;

			if (!wrenAddress) {
				const tokenAccount = await createWrenTokenAccounts(solAddress, env);
				await addWrenAddressForUser(userId, tokenAccount.toBase58(), env.DB);
			}

			await step.run('drop-tokens', async () => {
				return await dropTokens(solAddress, env);
			});
		}
	);

	return { inngest, fns: [dropTokensUpdateUser] };
};
