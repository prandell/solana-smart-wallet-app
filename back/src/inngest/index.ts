import { EventPayload, EventSchemas, Inngest } from 'inngest';
import {
	DupeEnv,
	createSolanaAccountAddSol,
	createWrenTokenAccounts,
	deserialiseSignedTxn,
	dropTokens,
	sendTransferWrenTokens,
} from '../solana';
import { UserWithWallet } from '../models';

type AppWalletDrop = {
	data: {
		env: DupeEnv;
	};
	user: UserWithWallet;
};

type UserOnlyEvent = {
	user: UserWithWallet;
};

type SendSignedTxn = {
	user: UserWithWallet;
	data: {
		env: DupeEnv;
		signedSendTx: string;
	};
};

type Events = {
	'app/wallet/drop-tokens': AppWalletDrop;
	'app/wallet/wren.created': UserOnlyEvent;
	'app/wallet/init-sol': UserOnlyEvent;
	'app/wallet/send-tx': SendSignedTxn;
};

export const getInngestAndFunctions = (eventKey: string) => {
	const inngest = new Inngest({
		id: 'my-app',
		eventKey,
		schemas: new EventSchemas().fromRecord<Events>(),
	});
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

			await step.waitForEvent('wait-for-wren-creation', { event: 'app/wallet/wren.created', timeout: '1m', match: 'user.userId' });

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
