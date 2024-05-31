async function fulfillWithTimeLimit<T, K>(timeLimit: number, task: Promise<T>, failureValue: K): Promise<T | K> {
	let timeout;
	const timeoutPromise = new Promise((resolve, reject) => {
		timeout = setTimeout(() => {
			resolve(failureValue);
		}, timeLimit);
	});
	const response = (await Promise.race([task, timeoutPromise])) as K | T;
	if (timeout) {
		//the code works without this but let's be safe and clean up the timeout
		clearTimeout(timeout);
	}
	return response;
}

export function simpleSleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function completeWithLimitAndRetry<T, K = any>(
	fn: Promise<T>,
	retryTimes = 3,
	timeLimit = 5000,
	failureValue = null as K
): Promise<T | K> {
	try {
		console.log(retryTimes);
		const data = await fulfillWithTimeLimit(timeLimit, fn, failureValue);
		if (data == failureValue && retryTimes <= 1) {
			return failureValue;
		} else if (data == failureValue && retryTimes > 1) {
			return await completeWithLimitAndRetry(fn, retryTimes - 1, timeLimit, failureValue);
		} else {
			return data;
		}
	} catch (e: any) {
		if (retryTimes <= 1) {
			return failureValue;
		} else if (retryTimes > 1) {
			return await completeWithLimitAndRetry(fn, retryTimes - 1, timeLimit, failureValue);
		}
	}
	return failureValue;
}
