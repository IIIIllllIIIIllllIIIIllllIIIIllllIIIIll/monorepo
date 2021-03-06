import { Web3Provider } from "ethers/providers";
import { parseEther } from "ethers/utils";
import { History } from "history";
import { Action } from "redux";
import { ThunkAction } from "redux-thunk";
import { RoutePath } from "../../types";
import { ActionType, ApplicationState, Deposit, WalletState } from "../types";
import { WalletDepositTransition, WalletWithdrawTransition } from "./wallet";

export const connectToWallet = (): ThunkAction<
  void,
  ApplicationState,
  null,
  Action<ActionType>
> => async dispatch => {
  const { ethereum } = window;

  try {
    await ethereum.enable();

    dispatch({
      data: {
        ethAddress: ethereum.selectedAddress
      } as WalletState,
      type: ActionType.WalletSetAddress
    });
  } catch (e) {
    dispatch({
      data: {
        error: {
          code: "access_denied",
          message:
            "You must allow Counterfactual to connect with Metamask in order to use it."
        }
      } as WalletState,
      type: ActionType.WalletError
    });
  }
};

export const deposit = (
  // @ts-ignore
  transaction: Deposit,
  // @ts-ignore
  provider: Web3Provider,
  history?: History
): ThunkAction<
  void,
  ApplicationState,
  null,
  Action<ActionType | WalletDepositTransition>
> => async dispatch => {
  try {
    dispatch({ type: WalletDepositTransition.CheckWallet });
    dispatch({ type: WalletDepositTransition.WaitForUserFunds });
    dispatch({ type: WalletDepositTransition.WaitForCollateralFunds });
    dispatch({
      data: {
        ethereumBalance: parseEther("0.2"),
        counterfactualBalance: parseEther("0.2")
      },
      type: ActionType.WalletSetBalance
    });
    if (history) {
      history.push(RoutePath.Channels);
    }
  } catch (e) {
    const error = e as Error;
    dispatch({
      data: {
        error: {
          message: `${error.message} because of ${error.stack}`
        }
      },
      type: ActionType.WalletError
    });
  }
};

export const withdraw = (
  // @ts-ignore
  transaction: Deposit,
  // @ts-ignore
  provider: Web3Provider,
  history?: History
): ThunkAction<
  void,
  ApplicationState,
  null,
  Action<ActionType | WalletWithdrawTransition>
> => async dispatch => {
  try {
    dispatch({ type: WalletWithdrawTransition.CheckWallet });
    dispatch({ type: WalletWithdrawTransition.WaitForFunds });
    dispatch({ data: {}, type: ActionType.WalletSetBalance });

    // Optional: Redirect to Channels.
    if (history) {
      history.push(RoutePath.Channels);
    }
  } catch (e) {
    const error = e as Error;
    dispatch({
      data: {
        error: {
          message: `${error.message} because of ${error.stack}`
        }
      },
      type: ActionType.WalletError
    });
  }
};
