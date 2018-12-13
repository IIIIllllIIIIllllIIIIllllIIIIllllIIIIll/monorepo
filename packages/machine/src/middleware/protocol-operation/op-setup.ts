import * as cf from "@counterfactual/cf.js";
import ConditionalTransactionJson from "@counterfactual/contracts/build/contracts/ConditionalTransaction.json";
import { ethers } from "ethers";

import { MultisigTxOp } from "./multisig-tx-op";
import { MultisigInput, Operation } from "./types";

export class OpSetup extends MultisigTxOp {
  public constructor(
    readonly networkContext: cf.legacy.network.NetworkContext,
    readonly multisig: cf.legacy.utils.Address,
    readonly freeBalanceStateChannel: cf.legacy.app.AppInstance,
    readonly freeBalance: cf.legacy.utils.FreeBalance,
  ) {
    super(multisig, freeBalance);
  }

  multisigInput(): MultisigInput {
    const terms = cf.legacy.utils.FreeBalance.terms();

    const multisigCalldata = new ethers.utils.Interface(
      ConditionalTransactionJson.abi
    ).functions.executeAppConditionalTransaction.encode([
      this.networkContext.registryAddr,
      this.networkContext.nonceRegistryAddr,
      ethers.constants.HashZero, // make the freebalance uninstall key unsettable
      this.freeBalanceStateChannel.cfAddress(),
      [terms.assetType, terms.limit, terms.token]
    ]);

    return new MultisigInput(
      this.networkContext.conditionalTransactionAddr,
      0,
      multisigCalldata,
      Operation.Delegatecall
    );
  }
}
