import * as ethers from "ethers";
import {
	Address,
	Bytes,
	Bytes32,
	Bytes4,
	H256,
	NetworkContext,
	Signature
} from "../../types";
import StateChannel from "../../../contracts/build/contracts/StateChannel.json";
import { ZERO_BYTES32 } from "@counterfactual/test-utils";

export const zeroAddress = "0x0000000000000000000000000000000000000000";
export const zeroBytes32 =
	"0x0000000000000000000000000000000000000000000000000000000000000000";

// todo: remove this and fetch the abi's from the build artifacts
export const Abi = {
	// ConditionalTranfer.sol
	executeStateChannelConditionalTransfer:
		"executeStateChannelConditionalTransfer(address,address,bytes32,uint256,bytes32,tuple(uint8,uint256,address))",
	// MinimumViableMultisig.sol
	execTransaction:
		"tuple(address to, uint256 value, bytes data, uint8 operation, bytes signatures)",
	// Multisend.sol
	multiSend: "multiSend(bytes)",
	// Registry.sol
	proxyCall: "proxyCall(address,bytes32,bytes)",
	setResolution:
		"setResolution(tuple(address, bytes4, bytes4, bytes4, bytes4) app, bytes finalState, bytes terms)",
	// StateChannel.sol
	setState: "setState(bytes32,uint256,uint256,bytes)",
	// NonceRegistry.sol
	setNonce: "setNonce(bytes32,uint256)",
	finalizeNonce: "finalizeNonce(bytes32)"
};

export abstract class CfOperation {
	abstract hashToSign(): H256;

	abstract transaction(sigs: Signature[]): Transaction;
}

export class CfAppInterface {
	constructor(
		readonly address: Address,
		readonly applyAction: Bytes4,
		readonly resolve: Bytes4,
		readonly getTurnTaker: Bytes4,
		readonly isStateTerminal: Bytes4,
		readonly abiEncoding: string
	) {}

	static generateSighash(
		abiInterface: ethers.Interface,
		functionName: string
	): string {
		return abiInterface.functions[name]
			? abiInterface.functions[name].sighash
			: "0x00000000";
	}

	encode(state: object): string {
		return ethers.utils.defaultAbiCoder.encode([this.abiEncoding], [state]);
	}

	stateHash(state: object): string {
		// assumes encoding "tuple(type key, type key, type key)"
		let regex = /\(([^)]+)\)/;
		let tuples = (regex.exec(this.abiEncoding) || [])[1].split(",");
		let hashArgs = tuples.reduce(
			(acc, tuple) => {
				let [type, key] = tuple.split(" ").filter(str => str.length > 0);
				acc.types.push(type);
				acc.values.push(state[key]);
				return acc;
			},
			{ types: ["bytes1"], values: ["0x19"] }
		);

		return ethers.utils.solidityKeccak256(hashArgs.types, hashArgs.values);
	}

	hash(): string {
		if (this.address === "0x0") {
			// FIXME:
			console.error(
				"WARNING: Can't compute hash for AppInterface because its address is 0x0"
			);
			return ZERO_BYTES32;
		}
		const appBytes = ethers.utils.defaultAbiCoder.encode(
			[
				"tuple(address addr, bytes4 applyAction, bytes4 resolve, bytes4 getTurnTaker, bytes4 isStateTerminal)"
			],
			[
				{
					addr: this.address,
					applyAction: this.applyAction,
					resolve: this.resolve,
					getTurnTaker: this.getTurnTaker,
					isStateTerminal: this.isStateTerminal
				}
			]
		);
		return ethers.utils.solidityKeccak256(["bytes"], [appBytes]);
	}
}

export class Terms {
	constructor(
		readonly assetType: number,
		readonly limit: number,
		readonly token: Address
	) {}

	hash(): string {
		return ethers.utils.keccak256(
			ethers.utils.defaultAbiCoder.encode(
				["bytes1", "uint8", "uint256", "address"],
				["0x19", this.assetType, this.limit, this.token]
			)
		);
	}
}

export enum Operation {
	Call = 0,
	Delegatecall = 1
}

export class Transaction {
	constructor(
		readonly to: Address,
		readonly value: Number,
		readonly data: string
	) {}
}

export class MultisigTransaction extends Transaction {
	constructor(
		readonly to: Address,
		readonly value: Number,
		readonly data: Bytes,
		readonly operation: Operation
	) {
		super(to, value, data);
	}
}

export class MultisigInput {
	constructor(
		readonly to: Address,
		readonly val: number,
		readonly data: Bytes,
		readonly op: Operation,
		readonly signatures?: Signature[]
	) {}
}

// todo: redundant with multisig input
export class MultiSendInput {
	constructor(
		readonly to: Address,
		readonly val: number,
		readonly data: Bytes,
		readonly op: Operation
	) {}
}

export class MultiSend {
	constructor(readonly transactions: Array<MultisigInput>) {}

	public input(multisend: Address): MultisigInput {
		let txs: string = "0x";
		for (const transaction of this.transactions) {
			txs += ethers.utils.defaultAbiCoder
				.encode(
					["uint256", "address", "uint256", "bytes"],
					[transaction.op, transaction.to, transaction.val, transaction.data]
				)
				.substr(2);
		}

		let data = new ethers.Interface([Abi.multiSend]).functions.multiSend.encode(
			[txs]
		);
		return new MultisigInput(multisend, 0, data, Operation.Delegatecall);
	}
}

/**
 * The state of a free balance object. Passing this into an install or uninstall
 * will update the free balance object to the values given here.
 */
export class CfFreeBalance {
	constructor(
		readonly alice: Address, // first person in free balance object
		readonly aliceBalance: number,
		readonly bob: Address, // second person in free balance object
		readonly bobBalance: number,
		readonly uniqueId: number,
		readonly localNonce: number,
		readonly timeout: number,
		readonly nonce: CfNonce
	) {}

	static terms(): Terms {
		// FIXME: Change implementation of free balance on contracts layer
		return new Terms(
			0, // 0 means ETH
			ethers.utils.parseEther("0.001").toNumber(), // FIXME: un-hardcode
			zeroAddress
		);
	}

	static contractInterface(ctx: NetworkContext): CfAppInterface {
		let address = ctx.PaymentApp;
		let applyAction = "0x00000000"; // not used
		let resolver = new ethers.Interface([
			// TODO: Put this somewhere eh
			"resolve(tuple(address,address,uint256,uint256),tuple(uint8,uint256,address))"
		]).functions.resolve.sighash;
		let turn = "0x00000000"; // not used
		let isStateTerminal = "0x00000000"; // not used
		return new CfAppInterface(
			address,
			applyAction,
			resolver,
			turn,
			isStateTerminal,
			"tuple(address alice, address bob, uint256 aliceBalance, uint256 bobBalance)"
		);
	}
}

export class CfNonce {
	public salt: Bytes32;
	public nonce: number;

	constructor(uniqueId: number, nonce?: number) {
		this.salt = ethers.utils.solidityKeccak256(["uint256"], [uniqueId]);
		if (!nonce) {
			nonce = 1;
		}
		this.nonce = nonce;
	}
}

/**
 * Maps 1-1 with StateChannel.sol (with the addition of the uniqueId, which
 * is used to calculate the cf address).
 *
 * @param signingKeys *must* be in sorted lexicographic order.
 */
export class CfStateChannel {
	constructor(
		readonly ctx: NetworkContext,
		readonly owner: Address,
		readonly signingKeys: Address[],
		readonly cfApp: CfAppInterface,
		readonly terms: Terms,
		readonly timeout: number,
		readonly uniqueId: number
	) {}

	cfAddress(): H256 {
		StateChannel.bytecode = StateChannel.bytecode.replace(
			/__Signatures_+/g,
			this.ctx.Signatures.substr(2)
		);

		StateChannel.bytecode = StateChannel.bytecode.replace(
			/__StaticCall_+/g,
			this.ctx.StaticCall.substr(2)
		);

		const initcode = new ethers.Interface(
			StateChannel.abi
		).deployFunction.encode(StateChannel.bytecode, [
			this.owner,
			this.signingKeys,
			this.cfApp.hash(),
			this.terms.hash(),
			this.timeout
		]);

		return ethers.utils.solidityKeccak256(
			["bytes1", "bytes", "uint256"],
			["0x19", initcode, this.uniqueId]
		);
	}
}
