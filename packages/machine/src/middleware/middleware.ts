import * as cf from "@counterfactual/cf.js";
import { ethers } from "ethers";

import { Context } from "../instruction-executor";
import { Opcode } from "../instructions";
import { Node } from "../node";
import {
  InstructionMiddlewareCallback,
  InstructionMiddlewares,
  InternalMessage
} from "../types";

import { EthOpGenerator } from "./protocol-operation";
import { StateTransition } from "./state-transition/state-transition";

/**
 * Middleware is the container holding the groups of middleware responsible
 * for executing a given instruction in the Counterfactual InstructionExecutor.
 */
export class Middleware {
  /**
   * Maps instruction to list of middleware that will process the instruction.
   */
  public middlewares: InstructionMiddlewares = {
    [Opcode.ALL]: [],
    [Opcode.IO_PREPARE_SEND]: [
      {
        scope: Opcode.IO_PREPARE_SEND,
        method: (internalMessage, context) => {
          const ret = NextMsgGenerator.generate(internalMessage, context);
          context.intermediateResults.outbox = ret;
          return {
            intermediateResults: {
              outbox: ret
            }
          };
        }
      }
    ],
    [Opcode.IO_SEND]: [],
    [Opcode.IO_WAIT]: [],
    [Opcode.KEY_GENERATE]: [],
    [Opcode.OP_GENERATE]: [
      {
        scope: Opcode.OP_GENERATE,
        method: (message, context) => {
          const operation = EthOpGenerator.generate(
            message,
            context,
            this.node
          );
          context.intermediateResults.operation = operation;
          return {
            intermediateResults: {
              operation
            }
          };
        }
      }
    ],
    [Opcode.OP_SIGN]: [],
    [Opcode.OP_SIGN_VALIDATE]: [],
    [Opcode.STATE_TRANSITION_COMMIT]: [
      {
        scope: Opcode.STATE_TRANSITION_COMMIT,
        method: (message, context) => {
          const newState = context.intermediateResults.proposedStateTransition!;
          context.instructionExecutor.mutateState(newState.state);
          return {};
        }
      }
    ],
    [Opcode.STATE_TRANSITION_PROPOSE]: [
      {
        scope: Opcode.STATE_TRANSITION_PROPOSE,
        method: (message, context) => {
          const proposal = StateTransition.propose(message, context, this.node);
          context.intermediateResults.proposedStateTransition = proposal;
          return {
            intermediateResults: {
              proposedStateTransition: proposal
            }
          };
        }
      }
    ]
  };

  constructor(readonly node: Node) {
    this.initializeMiddlewares();
  }

  private initializeMiddlewares() {
    this.add(Opcode.KEY_GENERATE, KeyGenerator.generate);
    this.add(Opcode.OP_SIGN_VALIDATE, SignatureValidator.validate);
  }

  public add(scope: Opcode, method: InstructionMiddlewareCallback) {
    this.middlewares[scope].push({ scope, method });
  }

  public async run(msg: InternalMessage, context: Context): Promise<Context> {
    const middlewares = this.middlewares;
    const opCode = msg.opCode;

    this.executeMiddlewaresRegisteredOnAll(msg, context);

    for (const middleware of middlewares[opCode]) {
      const ret = await middleware.method(msg, context);
      if (ret !== undefined && ret.intermediateResults !== undefined) {
        context.intermediateResults = Object.assign(
          {},
          context.intermediateResults,
          ret
        );
      }
    }
    return context;
  }

  /**
   * Runs the middlewares for Opcode.ALL.
   */
  // TODO: currently this method seems to be passing null as the middleware callback and
  // just iterating through all the middlewares. We should pass the callback similarly to how
  // run does it, and rely on that for middleware cascading
  // https://github.com/counterfactual/monorepo/issues/132
  private executeMiddlewaresRegisteredOnAll(msg, context) {
    this.middlewares[Opcode.ALL].forEach(middleware => {
      middleware.method(msg, context);
    });
  }
}

// 🤮
export class NextMsgGenerator {
  public static generate(internalMessage: InternalMessage, context: Context) {
    const signature = NextMsgGenerator.signature(internalMessage, context);
    const lastMsg = NextMsgGenerator.lastClientMsg(internalMessage, context);
    const msg: cf.legacy.node.ClientActionMessage = {
      signature,
      requestId: "none this should be a notification on completion",
      appId: lastMsg.appId,
      appName: lastMsg.appName,
      action: lastMsg.action,
      data: lastMsg.data,
      multisigAddress: lastMsg.multisigAddress,
      toAddress: lastMsg.fromAddress, // swap to/from here since sending to peer
      fromAddress: lastMsg.toAddress,
      seq: lastMsg.seq + 1
    };
    return msg;
  }

  /**
   * @returns the last received client message for this protocol. If the
   *          protocol just started, then we haven't received a message from
   *          our peer, so just return our starting message. Otherwise, return
   *          the last message from our peer (from IO_WAIT).
   */
  public static lastClientMsg(
    internalMessage: InternalMessage,
    context: Context
  ) {
    const res = context.intermediateResults.inbox;
    return res === undefined ? internalMessage.clientMessage : res;
  }

  public static signature(
    internalMessage: InternalMessage,
    context: Context
  ): ethers.utils.Signature | undefined {
    // first time we send an install message (from non-ack side) we don't have
    // a signature since we are just exchanging an app-speicific ephemeral key.
    const lastMsg = NextMsgGenerator.lastClientMsg(internalMessage, context);
    if (
      internalMessage.actionName === cf.legacy.node.ActionName.INSTALL &&
      lastMsg.seq === 0
    ) {
      return undefined;
    }
    return context.intermediateResults.signature!;
  }
}

export class KeyGenerator {
  /**
   * After generating this machine's app/ephemeral key, mutate the
   * client message by placing the ephemeral key on it for my address.
   */
  public static generate(message: InternalMessage) {
    // https://github.com/counterfactual/monorepo/issues/116
    return {};
  }
}

export class SignatureValidator {
  public static async validate(message: InternalMessage, context: Context) {
    return {};
  }
}
