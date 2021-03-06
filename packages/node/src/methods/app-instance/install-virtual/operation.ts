import { AppInstanceProposal, Node } from "@counterfactual/types";

import { InstructionExecutor, Protocol } from "../../../machine";
import { StateChannel } from "../../../models";
import { Store } from "../../../store";
import {
  NO_APP_INSTANCE_ID_TO_INSTALL,
  VIRTUAL_APP_INSTALLATION_FAIL
} from "../../errors";

export async function installVirtual(
  store: Store,
  instructionExecutor: InstructionExecutor,
  params: Node.InstallParams
): Promise<AppInstanceProposal> {
  const { appInstanceId } = params;

  if (!appInstanceId || !appInstanceId.trim()) {
    throw new Error(NO_APP_INSTANCE_ID_TO_INSTALL);
  }

  const proposal = await store.getAppInstanceProposal(appInstanceId);

  const {
    abiEncodings,
    appDefinition,
    initialState,
    initiatorDeposit,
    initiatorDepositTokenAddress,
    intermediaries,
    outcomeType,
    proposedByIdentifier,
    proposedToIdentifier,
    responderDeposit,
    responderDepositTokenAddress,
    timeout
  } = proposal;

  let updatedStateChannelsMap: Map<string, StateChannel>;

  if (initiatorDepositTokenAddress !== responderDepositTokenAddress) {
    throw new Error(
      "Cannot install virtual app with different token addresses"
    );
  }

  try {
    updatedStateChannelsMap = await instructionExecutor.initiateProtocol(
      Protocol.InstallVirtualApp,
      new Map(Object.entries(await store.getAllChannels())),
      {
        initialState,
        outcomeType,
        initiatorXpub: proposedToIdentifier,
        responderXpub: proposedByIdentifier,
        intermediaryXpub: intermediaries![0],
        defaultTimeout: timeout.toNumber(),
        appInterface: { addr: appDefinition, ...abiEncodings },
        initiatorBalanceDecrement: initiatorDeposit,
        responderBalanceDecrement: responderDeposit,
        tokenAddress: initiatorDepositTokenAddress
      }
    );
  } catch (e) {
    throw new Error(
      // TODO: We should generalize this error handling style everywhere
      `Node Error: ${VIRTUAL_APP_INSTALLATION_FAIL}\nStack Trace: ${e.stack}`
    );
  }

  updatedStateChannelsMap.forEach(
    async stateChannel => await store.saveStateChannel(stateChannel)
  );

  await store.saveRealizedProposedAppInstance(proposal);

  return proposal;
}
