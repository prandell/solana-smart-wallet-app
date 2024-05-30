import { Inngest } from 'inngest';
import { createSolanaAccountAddSol, deserialiseSignedTxn, dropTokens, sendTransferWrenTokens } from '../solana';
import { UserWithWallet } from '../models';

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

			await step.run('drop-tokens', async () => {
				return await dropTokens(solAddress, env);
			});
		}
	);

	const initiateSolAccount = inngest.createFunction(
		{ id: 'initiate-sol-account' },
		{ event: 'app/wallet/init-sol' },
		async ({ event, step }) => {
			const { user } = event;
			const { wallet } = user as UserWithWallet;
			const { solAddress } = wallet;

			await step.run('create-sol-acc', async () => {
				return await createSolanaAccountAddSol(solAddress);
			});
		}
	);

	const sendSignedTransfer = inngest.createFunction({ id: 'send-signed-txn' }, { event: 'app/wallet/send-tx' }, async ({ event, step }) => {
		const { data } = event;
		const { signedSendTx, env } = data;

		await step.run('send-wren', async () => {
			return await sendTransferWrenTokens(deserialiseSignedTxn(signedSendTx), env);
		});
	});

	return { inngest, fns: [dropTokensUpdateUser, initiateSolAccount, sendSignedTransfer] };
};
