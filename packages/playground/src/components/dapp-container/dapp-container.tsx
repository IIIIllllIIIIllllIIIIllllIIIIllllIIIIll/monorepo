declare var EventEmitter: any;

import { Component, Element, Prop } from "@stencil/core";
import { MatchResults, RouterHistory } from "@stencil/router";
import { BigNumber } from "ethers/utils";

import AccountTunnel from "../../data/account";
import AppRegistryTunnel from "../../data/app-registry";
import CounterfactualNode from "../../data/counterfactual";
import PlaygroundAPIClient from "../../data/playground-api-client";
import { AppDefinition, UserSession } from "../../types";

@Component({
  tag: "dapp-container",
  styleUrl: "dapp-container.scss",
  shadow: true
})
export class DappContainer {
  @Element() private readonly element: HTMLElement | undefined;

  @Prop() match: MatchResults = {} as MatchResults;
  @Prop() history: RouterHistory = {} as RouterHistory;

  @Prop({ mutable: true }) url: string = "";

  @Prop() apps: AppDefinition[] = [];

  @Prop() user: UserSession = {} as UserSession;
  @Prop() ethMultisigBalance: BigNumber = window["ethers"].constants.Zero;
  @Prop() getBalances: () => Promise<
    { ethMultisigBalance: BigNumber; ethFreeBalanceWei: BigNumber } | undefined
  > = async () => undefined;

  private frameWindow: Window | null = null;
  private port: MessagePort | null = null;
  private readonly eventEmitter: any = new EventEmitter();
  private readonly messageQueue: object[] = [];
  private iframe: HTMLIFrameElement = {} as HTMLIFrameElement;
  private readonly node = CounterfactualNode.getInstance();

  private $onMessage: (event: MessageEvent) => void = () => {};

  render() {
    return (
      <node-listener history={this.history}>
        <layout-header />
      </node-listener>
    );
  }

  getDapp(): AppDefinition {
    const dappSlug = this.match.params.dappName;
    const dapp = this.apps.find(app => app.slug === dappSlug);

    return dapp as AppDefinition;
  }

  getDappUrl(): string {
    const dapp = this.getDapp();
    const dappState =
      new URLSearchParams(window.location.search).get("dappState") || "";

    if (!dapp) {
      return "";
    }

    return `${dapp.url}${dappState}`;
  }

  componentDidLoad(): void {
    this.url = this.getDappUrl();

    this.node.on("proposeInstallVirtual", this.postOrQueueMessage.bind(this));
    this.node.on("installVirtualEvent", this.postOrQueueMessage.bind(this));
    this.node.on("getAppInstanceDetails", this.postOrQueueMessage.bind(this));
    this.node.on("getState", this.postOrQueueMessage.bind(this));
    this.node.on("takeAction", this.postOrQueueMessage.bind(this));
    this.node.on("updateStateEvent", this.postOrQueueMessage.bind(this));
    this.node.on("uninstallEvent", this.postOrQueueMessage.bind(this));

    this.node.on("protocolMessageEvent", this.getBalances.bind(this));

    /**
     * Once the component has loaded, we store a reference of the IFRAME
     * element's window so we can bind the message relay system.
     **/
    const element = (this.element as HTMLElement).shadowRoot as ShadowRoot;
    const iframe = document.createElement("iframe");
    iframe.src = this.url;
    element.appendChild(iframe);

    this.frameWindow = iframe.contentWindow as Window;
    this.$onMessage = this.configureMessageChannel.bind(this);

    // Callback for setting up the MessageChannel with the NodeProvider
    window.addEventListener("message", this.$onMessage);

    // Callback for processing Playground UI messages
    window.addEventListener("message", this.handlePlaygroundMessage.bind(this));

    this.iframe = iframe;
  }

  componentDidUnload() {
    if (this.frameWindow) {
      this.frameWindow = null;
    }

    this.eventEmitter.off("message");

    if (this.port) {
      this.port.close();
      this.port = null;
    }

    this.iframe.remove();
  }

  private async handlePlaygroundMessage(event: MessageEvent): Promise<void> {
    if (!this.frameWindow || typeof event.data !== "string") {
      return;
    }

    if (event.data === "playground:request:user") {
      await this.sendResponseForRequestUser(this.frameWindow);
    }

    if (event.data === "playground:request:matchmake") {
      await this.sendResponseForMatchmakeRequest(this.frameWindow);
    }

    if (event.data === "playground:request:appInstance") {
      await this.sendResponseForAppInstance(this.frameWindow);
    }

    if (event.data === "playground:request:getBalances") {
      await this.sendResponseForGetBalances(this.frameWindow);
    }

    if (event.data.startsWith("playground:send:dappRoute")) {
      const [, data] = event.data.split("|");
      const searchParams = new URLSearchParams(window.location.search);
      searchParams.set("dappState", data);
      const newURL = `${window.location.pathname}?${searchParams.toString()}`;
      history.pushState(null, "", newURL);
    }
  }

  private get token(): string {
    return window.localStorage.getItem("playground:user:token") as string;
  }

  private get matchmakeWith(): string | null {
    return window.localStorage.getItem("playground:matchmakeWith");
  }

  private async sendResponseForRequestUser(frameWindow: Window) {
    // if (!this.ethMultisigBalance) {
    //   throw new Error(
    //     "Cannot send response for user request: no multisig balance found"
    //   );
    // }
    frameWindow.postMessage(
      `playground:response:user|${JSON.stringify({
        user: {
          ...this.user,
          token: this.token
        },
        balance: this.ethMultisigBalance
          ? window["ethers"].utils.formatEther(this.ethMultisigBalance)
          : "0"
      })}`,
      "*"
    );
  }

  private getBotName(): string {
    const bots = {
      "high-roller": "HighRollerBot",
      "tic-tac-toe": "TicTacToeBot"
    };

    return bots[this.getDapp().slug];
  }

  private async sendResponseForMatchmakeRequest(frameWindow: Window) {
    const json = await PlaygroundAPIClient.matchmake(
      this.token,
      this.matchmakeWith || this.getBotName()
    );

    const response = JSON.stringify(json);
    window.localStorage.setItem("playground:lastMatchmake", response);

    frameWindow.postMessage(`playground:response:matchmake|${response}`, "*");
  }

  /**
   * Attempts to relay a message through the MessagePort. If the port
   * isn't available, we store the message in `this.messageQueue`
   * until the port is available.
   *
   * @param message {any}
   */
  public postOrQueueMessage(message: any): void {
    if (this.port) {
      this.port.postMessage(message);
    } else {
      this.queueMessage(message);
    }
  }

  /**
   * Binds the port with the MessageChannel created for this dApp
   * by responder to NodeProvider configuration messages.
   *
   * @param event {MessageEvent}
   */
  private configureMessageChannel(event: MessageEvent): void {
    if (!this.frameWindow) {
      return;
    }

    if (event.data === "cf-node-provider:init") {
      const { port2 } = this.configureMessagePorts();
      this.frameWindow.postMessage("cf-node-provider:port", "*", [port2]);
    }

    if (event.data === "cf-node-provider:ready") {
      this.flushMessageQueue();
      window.removeEventListener("message", this.$onMessage);
    }
  }

  /**
   * Binds this end of the MessageChannel (aka `port1`) to the dApp
   * container, and attaches a listener to relay messages via the
   * EventEmitter.
   */
  private configureMessagePorts(): MessageChannel {
    const channel = new MessageChannel();

    this.port = channel.port1;
    this.port.addEventListener("message", this.relayMessage.bind(this));
    this.port.start();

    return channel;
  }

  /**
   * Echoes a message received via PostMessage through
   * the EventEmitter.
   *
   * @param event {MessageEvent}
   */
  private relayMessage(event: MessageEvent): void {
    this.node.rpcRouter.dispatch({ ...event.data });
  }

  /**
   * Echoes a message received via PostMessage through
   * the EventEmitter.
   *
   * @param event {MessageEvent}
   */
  private queueMessage(message): void {
    this.messageQueue.push(message);
  }

  /**
   * Clears the message queue and forwards any messages
   * stored there through the MessagePort.
   */
  private flushMessageQueue(): void {
    if (!this.port) {
      return;
    }

    let message;
    while ((message = this.messageQueue.shift())) {
      this.port.postMessage(message);
    }
  }

  private sendResponseForAppInstance(frameWindow): void {
    const dappInstallationRequest = window.localStorage.getItem(
      "playground:installingDapp"
    );

    if (!frameWindow || !dappInstallationRequest) {
      return;
    }

    const { installedApp } = JSON.parse(dappInstallationRequest);

    frameWindow.postMessage(
      `playground:response:appInstance|${
        installedApp ? JSON.stringify(installedApp) : ""
      }`,
      "*"
    );

    if (installedApp) {
      console.log("Playground sent appInstance", JSON.stringify(installedApp));
    }

    window.localStorage.removeItem("playground:installingDapp");
  }

  private async sendResponseForGetBalances(frameWindow): Promise<void> {
    const balances = await this.getBalances();

    frameWindow.postMessage(
      `playground:response:getBalances|${JSON.stringify(balances)}`,
      "*"
    );
  }
}

AppRegistryTunnel.injectProps(DappContainer, ["apps"]);
AccountTunnel.injectProps(DappContainer, [
  "ethMultisigBalance",
  "getBalances",
  "user"
]);
