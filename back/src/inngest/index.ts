import { Inngest } from 'inngest';
import { dropTokens } from './functions/solana';
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
			const { wallet } = user as UserWithWallet;
			const { solAddress } = wallet;

			const { tokenAccount } = await step.run('drop-tokens', async () => {
				return await dropTokens(solAddress, env);
			});

			if (!wallet.wrenAddress) {
				await addWrenAddressForUser(user['user_id'], (tokenAccount as unknown as PublicKey).toBase58(), env.DB);
			}
		}
	);

	return { inngest, fns: [dropTokensUpdateUser] };
};
