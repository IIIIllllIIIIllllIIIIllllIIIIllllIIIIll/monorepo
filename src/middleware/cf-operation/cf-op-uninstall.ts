import { NetworkContext, Address } from "../../types";
import { MultisigInput, CfFreeBalance, CfNonce } from "./types";
import { CfMultiSendOp } from "./cf-multisend-op";

export class CfOpUninstall extends CfMultiSendOp {
	constructor(
		readonly ctx: NetworkContext,
		readonly multisig: Address,
		readonly cfFreeBalance: CfFreeBalance,
		readonly dependencyNonce: CfNonce
	) {
		super(ctx, multisig, cfFreeBalance, dependencyNonce);
	}

	/**
	 * @override common.CfMultiSendOp
	 */
	eachMultisigInput(): Array<MultisigInput> {
		return [
			this.freeBalanceInput(),
			this.dependencyNonceInput()
		];
	}
}