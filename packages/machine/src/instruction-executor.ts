import * as cf from "@counterfactual/cf.js";
import { ProtocolOperation } from "@counterfactual/machine/src/middleware/protocol-operation/types";
import { ethers } from "ethers";

import { ActionExecution, instructionGroupFromProtocolName } from "./action";
import { Opcode } from "./instructions";
import { Middleware } from "./middleware/middleware";
import { applyMixins } from "./mixins/apply";
import { NotificationType, Observable } from "./mixins/observable";
import { Node } from "./node";
import { InstructionMiddlewareCallback, StateProposal } from "./types";

export class InstructionExecutorConfig {
  constructor(
    readonly responseHandler: cf.legacy.node.ResponseSink,
    readonly network: cf.legacy.network.NetworkContext,
    readonly state?: cf.legacy.channel.StateChannelInfos
  ) {}
}

export class InstructionExecutor implements Observable {
  /**
   * The object responsible for processing each Instruction in the Vm.
   */
  public middleware: Middleware;
  /**
   * The delegate handler we send responses to.
   */
  public responseHandler: cf.legacy.node.ResponseSink;
  /**
   * The underlying state for the entire machine. All state here is a result of
   * a completed and commited protocol.
   */
  public node: Node;

  // Observable
  public observers: Map<NotificationType, Function[]> = new Map();

  constructor(config: InstructionExecutorConfig) {
    this.responseHandler = config.responseHandler;
    this.node = new Node(config.state || {}, config.network);
    this.middleware = new Middleware(this.node);
  }

  public registerObserver(type: NotificationType, callback: Function) {}
  public unregisterObserver(type: NotificationType, callback: Function) {}
  public notifyObservers(type: NotificationType, data: object) {}

  public receiveClientActionMessageAck(
    msg: cf.legacy.node.ClientActionMessage
  ) {
    this.execute(
      new ActionExecution(
        msg.action,
        instructionGroupFromProtocolName(msg.action, true),
        msg,
        this,
        msg.requestId
      )
    );
  }

  public receiveClientActionMessage(msg: cf.legacy.node.ClientActionMessage) {
    this.execute(
      new ActionExecution(
        msg.action,
        instructionGroupFromProtocolName(msg.action, false),
        msg,
        this,
        msg.requestId
      )
    );
  }

  public async execute(execution: ActionExecution) {
    const stateProposal = await this.run(execution);

    this.notifyObservers("returnOfTheMachine", {
      data: {
        requestId: execution.requestId,
        name: execution.actionName,
        proposedStateTransition: stateProposal,
        clientMessage: execution.clientMessage
      }
    });
  }

  public async run(execution: ActionExecution) {
    let ret;
    try {
      ret = await execution.runAll();
      this.sendResponse(
        execution.requestId,
        cf.legacy.node.ResponseStatus.COMPLETED
      );
    } catch (e) {
      console.error(e);
      this.sendResponse(
        execution.requestId,
        cf.legacy.node.ResponseStatus.ERROR
      );
    }
    return ret;
  }

  public sendResponse(
    requestId: string,
    status: cf.legacy.node.ResponseStatus
  ) {
    this.responseHandler.sendResponse(
      new cf.legacy.node.Response(requestId, status)
    );
  }

  public mutateState(state: cf.legacy.channel.StateChannelInfos) {
    Object.assign(this.node.channelStates, state);
  }

  public register(scope: Opcode, method: InstructionMiddlewareCallback) {
    this.middleware.add(scope, method);
  }
}

export interface IntermediateResults {
  outbox?: cf.legacy.node.ClientActionMessage;
  proposedStateTransition?: StateProposal;
  operation?: ProtocolOperation;
  signature?: ethers.utils.Signature;
  inbox?: cf.legacy.node.ClientActionMessage;
}

export class Context {
  public intermediateResults: IntermediateResults = {};

  // todo(ldct): the following fields are very special-purpose and only accessed
  // in one place; it would be nice to get rid of them
  public instructionExecutor: InstructionExecutor = Object.create(null);
}

applyMixins(InstructionExecutor, [Observable]);
