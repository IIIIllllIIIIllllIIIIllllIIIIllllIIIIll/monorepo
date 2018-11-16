import * as cf from "@counterfactual/cf.js";

import { Context, InstructionExecutor } from "./instruction-executor";
import { ackInstructions, instructions, Opcode } from "./instructions";
import { InternalMessage, StateProposal } from "./types";

if (!Symbol.asyncIterator) {
  (Symbol as any).asyncIterator = Symbol.for("Symbol.asyncIterator");
}

export function instructionGroupFromProtocolName(
  protocolName: cf.legacy.node.ActionName,
  isAckSide: boolean
): Opcode[] {
  if (isAckSide) {
    return ackInstructions[protocolName];
  }
  return instructions[protocolName];
}

export class ActionExecution {
  public actionName: cf.legacy.node.ActionName;
  public instructions: Opcode[];
  public clientMessage: cf.legacy.node.ClientActionMessage;
  public instructionExecutor: InstructionExecutor;
  public requestId: string;

  constructor(
    actionName: cf.legacy.node.ActionName,
    instructions: Opcode[],
    clientMessage: cf.legacy.node.ClientActionMessage,
    instructionExecutor: InstructionExecutor,
    requestId: string
  ) {
    this.actionName = actionName;
    this.instructions = instructions;
    this.clientMessage = clientMessage;
    this.instructionExecutor = instructionExecutor;
    this.requestId = requestId;
  }

  public createInternalMessage(instructionPointer): InternalMessage {
    const op = this.instructions[instructionPointer];
    return new InternalMessage(this.actionName, op, this.clientMessage);
  }

  public createContext(): Context {
    return {
      intermediateResults: {},
      instructionExecutor: this.instructionExecutor
    };
  }

  public async runAll(): Promise<StateProposal> {
    let instructionPointer = 0;
    const context = this.createContext();

    while (instructionPointer < this.instructions.length) {
      const internalMessage = this.createInternalMessage(instructionPointer);

      try {
        await this.instructionExecutor.middleware.run(internalMessage, context);
        instructionPointer += 1;
      } catch (e) {
        throw Error(
          `While executing op ${Opcode[internalMessage.opCode]} at seq ${
            this.clientMessage.seq
          }, execution failed with the following error. ${e.stack}`
        );
      }
    }
    return context.intermediateResults.proposedStateTransition!;
  }
}
