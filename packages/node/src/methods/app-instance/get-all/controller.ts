import { AppInstanceJson, Node } from "@counterfactual/types";
import { jsonRpcMethod } from "rpc-server";

import { RequestHandler } from "../../../request-handler";
import { NodeController } from "../../controller";

/**
 * Gets all installed appInstances across all of the channels open on
 * this Node.
 */
export default class GetAppInstancesController extends NodeController {
  public static readonly methodName = Node.MethodName.GET_APP_INSTANCES;

  @jsonRpcMethod(Node.RpcMethodName.GET_APP_INSTANCES)
  public executeMethod = super.executeMethod;

  protected async executeMethodImplementation(
    requestHandler: RequestHandler
  ): Promise<Node.GetAppInstancesResult> {
    const { store } = requestHandler;

    const ret: AppInstanceJson[] = [];

    const channels = await store.getAllChannels();

    for (const multisigAddress in channels) {
      channels[multisigAddress].appInstances.forEach(appInstance =>
        ret.push(appInstance.toJson())
      );
    }

    return {
      appInstances: ret
    };
  }
}
