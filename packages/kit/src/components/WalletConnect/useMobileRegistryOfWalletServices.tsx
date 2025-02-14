import React, { useEffect, useMemo } from 'react';

import { useIsVerticalLayout } from '@onekeyhq/components';
import debugLogger from '@onekeyhq/shared/src/logger/debugLogger';

import backgroundApiProxy from '../../background/instance/backgroundApiProxy';
import { usePromiseResult } from '../../hooks/usePromiseResult';

import { WalletService } from './types';
import { WALLET_CONNECT_WALLET_NAMES } from './walletConnectConsts';

// https://registry.walletconnect.org/data/wallets.json
function buildEnabledWallets({
  isVerticalLayout,
}: {
  isVerticalLayout: boolean;
}) {
  let enabledWallets = [
    WALLET_CONNECT_WALLET_NAMES.MetaMask,
    WALLET_CONNECT_WALLET_NAMES['Trust Wallet'],
    WALLET_CONNECT_WALLET_NAMES.Rainbow,
    WALLET_CONNECT_WALLET_NAMES.imToken,
    WALLET_CONNECT_WALLET_NAMES.TokenPocket,
    WALLET_CONNECT_WALLET_NAMES.BitKeep,
  ];
  const enabledWalletsInVerticalOnly = [
    //
    WALLET_CONNECT_WALLET_NAMES.Zerion,
  ];
  if (isVerticalLayout) {
    enabledWallets = enabledWallets.concat(enabledWalletsInVerticalOnly);
  }
  return enabledWallets;
}

const defaultState: {
  data: WalletService[];
  error?: Error;
  loading: boolean;
} = Object.freeze({
  data: [],
  error: undefined,
  loading: true,
});
// import { useMobileRegistry } from '@walletconnect/react-native-dapp';
export default function useMobileRegistry() {
  const [state, setState] = React.useState(defaultState);
  React.useEffect(() => {
    (async () => {
      try {
        const result = await fetch(
          'https://registry.walletconnect.org/data/wallets.json',
        );
        const data = await result.json();
        setState({
          data: Object.values(data),
          error: undefined,
          loading: false,
        });
      } catch (err) {
        const error = err as Error;
        debugLogger.common.error(error);
        setState({ ...defaultState, error, loading: false });
      }
    })();
  }, [setState]);
  return state;
}

export function useMobileRegistryOfWalletServices() {
  const { serviceWalletConnect } = backgroundApiProxy;
  // https://registry.walletconnect.org/data/wallets.json
  const { error, data: walletServicesRemote } = useMobileRegistry();
  const { result: walletServicesLocal } = usePromiseResult(() =>
    serviceWalletConnect.getWalletServicesList(),
  );
  const isVerticalLayout = useIsVerticalLayout();
  useEffect(() => {
    if (walletServicesRemote && walletServicesRemote.length) {
      serviceWalletConnect.saveWalletServicesList(walletServicesRemote);
    }
  }, [serviceWalletConnect, walletServicesRemote]);

  const walletServices = useMemo(
    () =>
      walletServicesLocal && walletServicesLocal.length
        ? walletServicesLocal
        : walletServicesRemote,
    [walletServicesLocal, walletServicesRemote],
  );

  const enabledWallets = useMemo(
    () => buildEnabledWallets({ isVerticalLayout }),
    [isVerticalLayout],
  );

  const walletServicesEnabled = useMemo(
    () =>
      enabledWallets
        .map((name) => walletServices.find((item) => item.name === name))
        .filter(Boolean),
    [enabledWallets, walletServices],
  );

  return { data: walletServicesEnabled, allData: walletServices, error };
}
